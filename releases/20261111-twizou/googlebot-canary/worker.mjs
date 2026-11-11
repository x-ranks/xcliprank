import ipaddr from 'ipaddr.js';
import snapshot from './ranges.generated.mjs';

const url = 'https://twizou.net/p/2091860611881967725';
const proofHeader = 'x-twizou-edge-pilot';
const marker = 'x-twizou-verified-googlebot';
const ranges = snapshot.ranges.map(prefix => ipaddr.parseCIDR(prefix));
const encoder = new TextEncoder();
const excludedHeaders = ['authorization', 'cookie', 'range', 'rsc', 'next-router-prefetch',
  'next-router-segment-prefetch', 'next-router-state-tree', 'cf-worker', 'cf-ew-via', 'cf-connecting-o2o'];

function eligible(request, env, now) {
  const until = Number(env.CANARY_UNTIL);
  if (!request.cf || request.method !== 'GET' || request.url !== url ||
      !/^[0-9a-f]{64}$/.test(env.EDGE_PILOT_SECRET ?? '') ||
      !/^\d{10}$/.test(env.CANARY_UNTIL ?? '') ||
      until <= Math.floor(now / 1000) || until - Math.floor(now / 1000) > 86400 ||
      now < snapshot.fetchedAt - 10000 || now - snapshot.fetchedAt > 14 * 86400 * 1000 ||
      excludedHeaders.some(name => request.headers.has(name))) return false;
  const ua = request.headers.get('User-Agent') ?? '';
  if (!/\bGooglebot\/2\.1(?=[\s;()]|$)/.test(ua) || /Google-InspectionTool/i.test(ua)) return false;
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || !/^[0-9a-f:.]+$/i.test(ip) || !ipaddr.isValid(ip) ||
      (!ip.includes(':') && !ipaddr.IPv4.isValidFourPartDecimal(ip))) return false;
  const address = ipaddr.process(ip);
  return ranges.some(([network, bits]) => network.kind() === address.kind() && address.match(network, bits));
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

export default {
  async fetch(request, env) {
    const headers = new Headers(request.headers);
    headers.delete(proofHeader);
    headers.delete(marker);
    const now = Date.now();
    if (eligible(request, env, now)) {
      try {
        headers.set(proofHeader, await sign(env.EDGE_PILOT_SECRET, now));
        headers.delete('if-none-match');
        headers.delete('if-modified-since');
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
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: resultHeaders });
  }
};
