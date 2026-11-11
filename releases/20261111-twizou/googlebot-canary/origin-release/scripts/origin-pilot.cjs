'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PILOT_PATH = '/p/2091860611881967725';
const PROOF = 'x-twizou-edge-pilot';
const MARKER = 'x-twizou-verified-googlebot';
const AUDIENCE = 'https://twizou.net' + PILOT_PATH;
const WINDOW = 30;
const NO_STORE = 'private, no-cache, no-store, max-age=0, must-revalidate';
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const state = '/home/rbxfxmfd/.xclip-edge-production-canary-v1';
const removedCacheHeaders = new Set(['cache-control', 'cdn-cache-control', 'cloudflare-cdn-cache-control',
  'surrogate-control', 'expires', 'etag', 'last-modified']);

function createPilotVerifier({ directory = state, now = Date.now } = {}) {
  let pruneAt = 0;
  return async function verify(request, values) {
    if (request.method !== 'GET' || request.url !== PILOT_PATH ||
        request.headers.host !== 'twizou.net' ||
        request.headers.cookie || request.headers.authorization || request.headers.range ||
        request.headers.rsc || request.headers['next-router-prefetch'] ||
        request.headers['next-router-segment-prefetch'] || request.headers['next-router-state-tree'] ||
        values?.length !== 1 || values[0].length > 160) return false;
    const [version, issued, nonce, kind, mac, ...extra] = values[0].split('.');
    if (version !== 'v2' || extra.length || !/^\d{10}$/.test(issued) ||
        !noncePattern.test(nonce) || kind !== 'GOOGLEBOT' || !/^[0-9a-f]{64}$/.test(mac)) return false;
    const time = Math.floor(now() / 1000);
    if (time - Number(issued) > WINDOW || Number(issued) - time > 5) return false;

    const settings = JSON.parse(await fs.readFile(path.join(directory, 'enabled.json'), 'utf8'));
    if (!/^[0-9a-f]{64}$/.test(settings.secret ?? '') || !['observe', 'active'].includes(settings.mode) ||
        !Number.isSafeInteger(settings.until) || settings.until <= time || settings.until - time > 86400) return false;
    const expected = crypto.createHmac('sha256', settings.secret)
      .update(['v2', AUDIENCE, 'GET', issued, nonce, kind].join('\n')).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(mac, 'hex'))) return false;

    const nonces = path.join(directory, 'nonces');
    const claim = await fs.open(path.join(nonces, issued + '.' + nonce), 'wx', 0o600);
    await claim.close();
    if (time >= pruneAt) {
      pruneAt = time + 60;
      for (const item of await fs.readdir(nonces)) {
        if (/^\d{10}\.[a-f0-9-]{36}$/.test(item) && Number(item.slice(0, 10)) < time - 120) {
          await fs.unlink(path.join(nonces, item)).catch(() => {});
        }
      }
    }
    return settings.mode;
  };
}

function disableResponseCaching(response) {
  const writeHead = response.writeHead;
  response.writeHead = function(status, ...args) {
    const message = typeof args[0] === 'string' ? args.shift() : undefined;
    const incoming = args[0];
    for (const name of removedCacheHeaders) this.removeHeader(name);
    this.setHeader('Cache-Control', NO_STORE);
    const filtered = Array.isArray(incoming)
      ? incoming.filter((_, index) => !removedCacheHeaders.has(String(incoming[index - index % 2]).toLowerCase()))
      : Object.fromEntries(Object.entries(incoming ?? {}).filter(([name]) => !removedCacheHeaders.has(name.toLowerCase())));
    return message === undefined ? writeHead.call(this, status, filtered) : writeHead.call(this, status, message, filtered);
  };
}

function wrapPilot(handler, fallback, verify = createPilotVerifier(), log = console.info) {
  return (request, response) => {
    const values = request.headersDistinct?.[PROOF];
    delete request.headers[PROOF];
    if (request.url?.split('?')[0] !== PILOT_PATH) return fallback(request, response);
    delete request.headers[MARKER];
    disableResponseCaching(response);
    if (!values) return handler(request, response);
    return verify(request, values).catch(() => false).then(mode => {
      if (mode === 'active') request.headers[MARKER] = '1';
      if (mode === 'active' || mode === 'observe') log('TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=' + mode);
      return handler(request, response);
    });
  };
}

module.exports = { PILOT_PATH, AUDIENCE, PROOF, MARKER, NO_STORE, createPilotVerifier, wrapPilot };
