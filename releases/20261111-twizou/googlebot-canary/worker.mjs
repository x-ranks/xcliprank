import ipaddr from 'ipaddr.js';
import snapshot from './ranges.generated.mjs';

const url = 'https://twizou.net/p/2091860611881967725';
const proofHeader = 'x-twizou-edge-pilot';
const marker = 'x-twizou-verified-googlebot';
const ranges = snapshot.ranges.map(prefix => ipaddr.parseCIDR(prefix));
const encoder = new TextEncoder();
const excludedHeaders = ['authorization', 'cookie', 'range', 'rsc', 'next-router-prefetch',
  'next-router-segment-prefetch', 'next-router-state-tree', 'cf-worker', 'cf-ew-via', 'cf-connecting-o2o'];

// Search Console's "live test" fetches with Google-InspectionTool, so that user agent is accepted for this one URL
// only. The source IP must still be inside Google's published googlebot.json ranges, exactly as for Googlebot.
const googlebotUA = /\bGooglebot\/2\.1(?=[\s;()]|$)/;
const inspectionUA = /\bGoogle-InspectionTool\/1\.0(?=[\s;()]|$)/;
const looksGoogle = /Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google|Storebot-Google/i;

function userAgentKind(ua) {
  if (googlebotUA.test(ua)) return 'googlebot';
  if (inspectionUA.test(ua)) return 'inspection-tool';
  return null;
}

// Returns null when the request may receive a proof, otherwise a short machine-readable reason (used for logs only).
function rejection(request, env, now) {
  const seconds = Math.floor(now / 1000);
  const until = Number(env.CANARY_UNTIL);
  if (!request.cf) return 'no-cf-object';
  if (request.method !== 'GET') return 'method';
  if (request.url !== url) return 'url-mismatch';
  if (!/^[0-9a-f]{64}$/.test(env.EDGE_PILOT_SECRET ?? '')) return 'secret-invalid';
  if (!/^\d{10}$/.test(env.CANARY_UNTIL ?? '')) return 'canary-until-invalid';
  if (until <= seconds) return 'window-expired';
  if (until - seconds > 86400) return 'window-longer-than-24h';
  if (now < snapshot.fetchedAt - 10000 || now - snapshot.fetchedAt > 14 * 86400 * 1000) return 'ip-snapshot-stale';
  const blocked = excludedHeaders.find(name => request.headers.has(name));
  if (blocked) return 'excluded-header:' + blocked;
  if (!userAgentKind(request.headers.get('User-Agent') ?? '')) return 'user-agent-not-eligible';
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || !/^[0-9a-f:.]+$/i.test(ip) || !ipaddr.isValid(ip) ||
      (!ip.includes(':') && !ipaddr.IPv4.isValidFourPartDecimal(ip))) return 'ip-invalid';
  const address = ipaddr.process(ip);
  return ranges.some(([network, bits]) => network.kind() === address.kind() && address.match(network, bits))
    ? null : 'ip-not-in-googlebot-ranges';
}

async function sign(secret, now) {
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

// One JSON line per Google-looking request to the test URL. Ordinary visitors are never logged. What the origin
// actually returned is recorded as facts about the HTML (age gate present or not), never the HTML itself.
async function describeResponse(response, base) {
  let body = '';
  try {
    body = await response.text();
  } catch {
    // A failed read is logged as an empty body.
  }
  console.log(JSON.stringify({
    event: 'twizou-canary', ...base, status: response.status,
    contentType: clean(response.headers.get('content-type'), 60),
    htmlChars: body.length,
    ageGateInHtml: body.includes('class="age-gate"'),
    adultRatingInHtml: /<meta[^>]+name="rating"[^>]+content="adult"/i.test(body)
  }));
}

export default {
  async fetch(request, env, ctx) {
    const headers = new Headers(request.headers);
    headers.delete(proofHeader);
    headers.delete(marker);
    const now = Date.now();
    const ua = request.headers.get('User-Agent') ?? '';
    const target = new URL(request.url);
    const observed = target.origin + target.pathname === url && request.method === 'GET' && looksGoogle.test(ua);
    const reason = rejection(request, env, now);
    let signed = false;
    if (reason === null) {
      try {
        headers.set(proofHeader, await sign(env.EDGE_PILOT_SECRET, now));
        headers.delete('if-none-match');
        headers.delete('if-modified-since');
        signed = true;
      } catch {
        // Absence of proof preserves the normal age check.
      }
    }
    const outgoing = new Request(request, { headers, redirect: 'manual' });
    const response = await fetch(outgoing, { cache: 'no-store' });
    const resultHeaders = new Headers(response.headers);
    for (const name of ['CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control', 'Surrogate-Control', 'Expires', 'ETag', 'Last-Modified']) {
      resultHeaders.delete(name);
    }
    resultHeaders.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
    if (observed) {
      const base = {
        at: new Date(now).toISOString(), signed,
        reason: signed ? 'eligible' : (reason ?? 'sign-failed'),
        agent: userAgentKind(ua) ?? 'other-google', ua: clean(ua, 160),
        ip: clean(request.headers.get('CF-Connecting-IP'), 45), ray: clean(request.headers.get('CF-Ray'), 40)
      };
      const task = describeResponse(response.clone(), base);
      if (ctx?.waitUntil) ctx.waitUntil(task); else await task;
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: resultHeaders });
  }
};
