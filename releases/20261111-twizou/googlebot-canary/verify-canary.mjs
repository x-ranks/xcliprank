import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import edge from './worker.mjs';
import origin from './origin-pilot.cjs';

const { wrapPilot, createPilotVerifier, PILOT_PATH, AUDIENCE, PROOF, MARKER, NO_STORE } = origin;
const directory = await mkdtemp(join(tmpdir(), 'twizou-production-canary-'));
const secret = randomBytes(32).toString('hex');
const until = Math.floor(Date.now() / 1000) + 60;
const env = { EDGE_PILOT_SECRET: secret, CANARY_UNTIL: String(until) };
const googleUA = 'Googlebot/2.1 (+http://www.google.com/bot.html)';
const renderer = (req, res) => {
  res.writeHead(200, 'OK', {
    'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600',
    'Cloudflare-CDN-Cache-Control': 'public, max-age=3600', ETag: '"old"'
  });
  res.end(req.headers[MARKER] === '1' ? 'NO_GATE' : 'AGE_GATE');
};
const fallback = (req, res) => {
  delete req.headers[MARKER];
  renderer(req, res);
};
const events = [];
const listener = wrapPilot(renderer, fallback, createPilotVerifier({ directory }), event => events.push(event));
const server = createServer(listener);
await mkdir(join(directory, 'nonces'));
await writeFile(join(directory, 'enabled.json'), JSON.stringify({ secret, until, mode: 'observe' }));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const local = 'http://127.0.0.1:' + server.address().port;
const nativeFetch = globalThis.fetch;
let lastProof;

function sendToOrigin(url, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers: Object.fromEntries(headers) }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(new Response(body, { status: res.statusCode, headers: res.headers })));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

try {
  globalThis.fetch = async (request, options) => {
    assert.equal(request.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.equal(request.headers.get(MARKER), null);
    const parsed = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set('Host', 'twizou.net');
    lastProof = headers.get(PROOF);
    return sendToOrigin(local + parsed.pathname + parsed.search, headers);
  };
  async function check(headers, verdict, suffix = '', settings = env) {
    const request = new Request(AUDIENCE + suffix, { headers });
    Object.defineProperty(request, 'cf', { value: {} });
    const result = await edge.fetch(request, settings);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Cache-Control'), NO_STORE);
    assert.equal(result.headers.get('Cloudflare-CDN-Cache-Control'), null);
    assert.equal(result.headers.get('ETag'), null);
    assert.equal(await result.text(), verdict);
  }
  const google = { 'User-Agent': googleUA, 'CF-Connecting-IP': '66.249.66.78' };
  await check({ [MARKER]: '1', [PROOF]: 'forged' }, 'AGE_GATE');
  assert.equal(lastProof, null);
  await check({ ...google, 'CF-Connecting-IP': '203.0.113.1', 'X-Forwarded-For': '66.249.66.78' }, 'AGE_GATE');
  await check({ ...google, 'CF-Worker': 'other.example' }, 'AGE_GATE');
  await check({ ...google, 'User-Agent': 'Google-InspectionTool/1.0' }, 'AGE_GATE');
  await check(google, 'AGE_GATE', '?source=other');
  await check({ ...google, rsc: '1' }, 'AGE_GATE');
  await check(google, 'AGE_GATE', '', { ...env, CANARY_UNTIL: '1000000000' });
  assert.deepEqual(events, []);
  await check(google, 'AGE_GATE');
  assert.deepEqual(events, ['TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=observe']);
  await writeFile(join(directory, 'enabled.json'), JSON.stringify({ secret, until, mode: 'active' }));
  await check(google, 'NO_GATE');
  assert.deepEqual(events, ['TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=observe', 'TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=active']);
  assert.match(lastProof, /^v2\./);
  const replay = await sendToOrigin(local + PILOT_PATH, new Headers({
    Host: 'twizou.net', [PROOF]: lastProof, [MARKER]: '1'
  }));
  assert.equal(await replay.text(), 'AGE_GATE');
  assert.equal(replay.headers.get('Cache-Control'), NO_STORE);
  await check({}, 'AGE_GATE');
  await rm(join(directory, 'enabled.json'));
  await check(google, 'AGE_GATE');
  console.log('PRODUCTION_CANARY_ISOLATED_OK');
} finally {
  globalThis.fetch = nativeFetch;
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true });
}
