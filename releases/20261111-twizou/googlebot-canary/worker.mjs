import ipaddr from 'ipaddr.js';
import snapshot from './ranges.generated.mjs';

// Cloudflare Worker in front of twizou.net. For a request that really comes from Google's crawler it adds a
// short-lived signed proof (HMAC) that the origin checks before it leaves out the 18+ gate for that single request.
// Every other request is passed through untouched, except that any proof/marker header a visitor sent is removed.
const ORIGIN = 'https://twizou.net';
const proofHeader = 'x-twizou-edge-pilot';
const marker = 'x-twizou-verified-googlebot';
const rangesUrl = 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json';
const MAX_WINDOW_SECONDS = 30 * 86400;
const RANGES_FRESH_MS = 6 * 3600 * 1000; // re-read Google's published list at most every 6 hours per isolate
const RANGES_STALE_OK_MS = 7 * 86400 * 1000; // keep using a fetched list if Google is briefly unreachable
const SNAPSHOT_OK_MS = 45 * 86400 * 1000; // bundled list is only a fallback and expires on its own
const encoder = new TextEncoder();
const excludedHeaders = ['authorization', 'cookie', 'range', 'rsc', 'next-router-prefetch',
  'next-router-segment-prefetch', 'next-router-state-tree', 'cf-worker', 'cf-ew-via', 'cf-connecting-o2o'];
const skippedPaths = ['/_next/', '/api/'];

// Search Console's live test uses Google-InspectionTool; Google's own crawler is Googlebot/2.1.
const googlebotUA = /\bGooglebot\/2\.1(?=[\s;()]|$)/;
const inspectionUA = /\bGoogle-InspectionTool\/1\.0(?=[\s;()]|$)/;
const looksGoogle = /Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google|Storebot-Google/i;

function userAgentKind(ua) {
  if (googlebotUA.test(ua)) return 'googlebot';
  if (inspectionUA.test(ua)) return 'inspection-tool';
  return null;
}

function parseRanges(prefixes) {
  return prefixes.map(prefix => ipaddr.parseCIDR(prefix));
}

const bundled = parseRanges(snapshot.ranges);
let fetched = null; // { at, ranges }
let retryAt = 0;

// Only a well-formed, narrow, unicast prefix list from Google is ever accepted.
function validPrefixes(body) {
  const prefixes = body?.prefixes;
  if (!Array.isArray(prefixes) || prefixes.length < 10 || prefixes.length > 2000) return null;
  const out = [];
  for (const item of prefixes) {
    const prefix = item?.ipv4Prefix ?? item?.ipv6Prefix;
    if (typeof prefix !== 'string' || prefix.length > 64) return null;
    const [network, bits] = ipaddr.parseCIDR(prefix);
    if (network.range() !== 'unicast' || bits < (item.ipv4Prefix ? 16 : 24)) return null;
    out.push(prefix);
  }
  return out;
}

async function currentRanges(now) {
  if (fetched && now - fetched.at < RANGES_FRESH_MS) return { ranges: fetched.ranges, source: 'google' };
  if (now >= retryAt) {
    try {
      const response = await fetch(rangesUrl, { redirect: 'error', cf: { cacheTtl: 3600, cacheEverything: true } });
      if (!response.ok) throw new Error('status');
      const prefixes = validPrefixes(await response.json());
      if (!prefixes) throw new Error('shape');
      fetched = { at: now, ranges: parseRanges(prefixes) };
      return { ranges: fetched.ranges, source: 'google' };
    } catch {
      retryAt = now + 10 * 60 * 1000;
    }
  }
  if (fetched && now - fetched.at < RANGES_STALE_OK_MS) return { ranges: fetched.ranges, source: 'google-stale' };
  if (now >= snapshot.fetchedAt - 10000 && now - snapshot.fetchedAt < SNAPSHOT_OK_MS) return { ranges: bundled, source: 'bundled' };
  return null;
}

// Returns [reason] when the request may not receive a proof, or [null, rangesSource] when it may.
async function rejection(request, env, now, ua) {
  const seconds = Math.floor(now / 1000);
  const until = Number(env.CANARY_UNTIL);
  if (!request.cf) return ['no-cf-object'];
  if (request.method !== 'GET') return ['method'];
  if (!request.url.startsWith(ORIGIN + '/') || request.url.length > 2200) return ['url-mismatch'];
  const path = new URL(request.url).pathname;
  if (skippedPaths.some(prefix => path.startsWith(prefix))) return ['path-not-eligible'];
  if (!/^[0-9a-f]{64}$/.test(env.EDGE_PILOT_SECRET ?? '')) return ['secret-invalid'];
  if (!/^\d{10}$/.test(env.CANARY_UNTIL ?? '')) return ['canary-until-invalid'];
  if (until <= seconds) return ['window-expired'];
  if (until - seconds > MAX_WINDOW_SECONDS) return ['window-longer-than-30d'];
  const blocked = excludedHeaders.find(name => request.headers.has(name));
  if (blocked) return ['excluded-header:' + blocked];
  if (!userAgentKind(ua)) return ['user-agent-not-eligible'];
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || !/^[0-9a-f:.]+$/i.test(ip) || !ipaddr.isValid(ip) ||
      (!ip.includes(':') && !ipaddr.IPv4.isValidFourPartDecimal(ip))) return ['ip-invalid'];
  const list = await currentRanges(now);
  if (!list) return ['ip-ranges-unavailable'];
  const address = ipaddr.process(ip);
  const inside = list.ranges.some(([network, bits]) => network.kind() === address.kind() && address.match(network, bits));
  return inside ? [null, list.source] : ['ip-not-in-google-ranges', list.source];
}

async function sign(secret, url, now) {
  const issued = Math.floor(now / 1000);
  const nonce = crypto.randomUUID();
  const kind = 'GOOGLEBOT';
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key,
    encoder.encode(['v2', url, 'GET', issued, nonce, kind].join('\n')));
  const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
  return ['v2', issued, nonce, kind, hex].join('.');
}

function clean(value, limit) {
  return String(value ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, limit);
}

// One JSON line per Google-looking request. Ordinary visitors are never logged. For signed requests it also records
// facts about the HTML the origin returned (age gate present or not), never the HTML itself.
async function describeResponse(response, base, inspectBody) {
  let body = '';
  if (inspectBody) {
    try {
      body = await response.text();
    } catch {
      // A failed read is logged as an empty body.
    }
  }
  console.log(JSON.stringify({
    event: 'twizou-canary', ...base, status: response.status,
    contentType: clean(response.headers.get('content-type'), 60),
    ...(inspectBody ? {
      htmlChars: body.length,
      ageGateInHtml: body.includes('class="age-gate"'),
      adultRatingInHtml: /<meta[^>]+name="rating"[^>]+content="adult"/i.test(body)
    } : {})
  }));
}

export default {
  async fetch(request, env, ctx) {
    const hadForeignHeaders = request.headers.has(proofHeader) || request.headers.has(marker);
    const ua = request.headers.get('User-Agent') ?? '';
    if (!looksGoogle.test(ua) || request.method !== 'GET') {
      // Ordinary traffic: nothing to sign. Only strip headers a visitor must never be able to set.
      if (!hadForeignHeaders) return fetch(request);
      const stripped = new Headers(request.headers);
      stripped.delete(proofHeader);
      stripped.delete(marker);
      return fetch(new Request(request, { headers: stripped }));
    }

    const headers = new Headers(request.headers);
    headers.delete(proofHeader);
    headers.delete(marker);
    const now = Date.now();
    const [reason, rangesSource] = await rejection(request, env, now, ua);
    let signed = false;
    if (reason === null) {
      try {
        headers.set(proofHeader, await sign(env.EDGE_PILOT_SECRET, request.url, now));
        headers.delete('if-none-match');
        headers.delete('if-modified-since');
        signed = true;
      } catch {
        // Absence of proof preserves the normal age check.
      }
    }

    const outgoing = new Request(request, { headers });
    const response = signed ? await fetch(new Request(outgoing, { redirect: 'manual' }), { cache: 'no-store' }) : await fetch(outgoing);
    let result = response;
    if (signed) {
      // A response produced for a proof-carrying request must never be stored by anything downstream.
      const resultHeaders = new Headers(response.headers);
      for (const name of ['CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control', 'Surrogate-Control', 'Expires', 'ETag', 'Last-Modified']) {
        resultHeaders.delete(name);
      }
      resultHeaders.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
      result = new Response(response.body, { status: response.status, statusText: response.statusText, headers: resultHeaders });
    }

    const target = new URL(request.url);
    const base = {
      at: new Date(now).toISOString(), signed, reason: signed ? 'eligible' : (reason ?? 'sign-failed'),
      agent: userAgentKind(ua) ?? 'other-google', ua: clean(ua, 160), path: clean(target.pathname, 120),
      ip: clean(request.headers.get('CF-Connecting-IP'), 45), ray: clean(request.headers.get('CF-Ray'), 40),
      ranges: rangesSource ?? null
    };
    const task = describeResponse(result.clone(), base, signed);
    if (ctx?.waitUntil) ctx.waitUntil(task); else await task;
    return result;
  }
};
