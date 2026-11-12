'use strict';
// Origin-side proof check for the site-wide Googlebot age-gate exception. No network, no real state directory.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { wrapPilot, createPilotVerifier, PROOF, MARKER, NO_STORE, MAX_WINDOW_SECONDS } = require('./origin-pilot.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'origin-pilot-'));
fs.mkdirSync(path.join(dir, 'nonces'), { mode: 0o700 });
const secret = crypto.randomBytes(32).toString('hex');
let clock = 1_800_000_000_000;
const seconds = () => Math.floor(clock / 1000);
function settings(mode, untilOffset) {
  fs.writeFileSync(path.join(dir, 'enabled.json'), JSON.stringify({ secret, mode, started: seconds() - 10, until: seconds() + untilOffset }));
}
function proof(url, { kind = 'GOOGLEBOT', issued = seconds(), nonce = crypto.randomUUID(), key = secret } = {}) {
  const mac = crypto.createHmac('sha256', key).update(['v2', 'https://twizou.net' + url, 'GET', issued, nonce, kind].join('\n')).digest('hex');
  return ['v2', issued, nonce, kind, mac].join('.');
}
function run(url, { proofValue, headers = {}, method = 'GET' } = {}) {
  const request = { method, url, headers: { host: 'twizou.net', ...headers }, headersDistinct: proofValue ? { [PROOF]: [proofValue] } : {} };
  if (proofValue) request.headers[PROOF] = proofValue;
  const sent = {};
  const response = {
    removed: [], setHeader(name, value) { sent[name.toLowerCase()] = value; }, removeHeader(name) { this.removed.push(name.toLowerCase()); },
    writeHead(status) { this.status = status; this.sent = { ...sent }; }
  };
  const result = { handler: 0, fallback: 0, logs: [] };
  const wrapped = wrapPilot(
    (req, res) => { result.handler++; result.marker = req.headers[MARKER]; res.writeHead(200); },
    (req, res) => { result.fallback++; result.marker = req.headers[MARKER]; res.writeHead(200); },
    createPilotVerifier({ directory: dir, now: () => clock }), message => result.logs.push(message));
  return Promise.resolve(wrapped(request, response)).then(() => ({ ...result, response, request }));
}

(async () => {
  settings('active', 3600);
  // Different paths, queries and a percent-encoded Japanese path are all accepted when the proof matches that URL.
  for (const url of ['/', '/p/2091860611881967725', '/ranking/daily?page=2', '/tags/%E5%80%8B%E4%BA%BA%E6%92%AE%E5%BD%B1', '/accounts/someone']) {
    const r = await run(url, { proofValue: proof(url) });
    assert.equal(r.marker, '1', url); assert.equal(r.handler, 1); assert.equal(r.fallback, 0);
    assert.equal(r.response.sent['cache-control'], NO_STORE, 'proof responses are never stored');
    assert.deepEqual(r.logs, ['TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=active']);
  }
  // Ordinary traffic: no proof -> fallback path, untouched caching, and a client-sent marker is removed.
  const plain = await run('/ranking/daily', { headers: { [MARKER]: '1' } });
  assert.equal(plain.fallback, 1); assert.equal(plain.handler, 0); assert.equal(plain.marker, undefined);
  assert.equal(plain.response.sent['cache-control'], undefined);
  // A proof is single use.
  const once = proof('/p/1234567890123456789');
  assert.equal((await run('/p/1234567890123456789', { proofValue: once })).marker, '1');
  assert.equal((await run('/p/1234567890123456789', { proofValue: once })).marker, undefined);
  // A proof cannot be moved to another URL or query.
  const moved = proof('/p/1234567890123456789');
  assert.equal((await run('/p/1234567890123456780', { proofValue: moved })).marker, undefined);
  assert.equal((await run('/p/1234567890123456789?x=1', { proofValue: proof('/p/1234567890123456789') })).marker, undefined);
  // Wrong secret, wrong kind, stale or future issue time, extra credentials, non-GET.
  assert.equal((await run('/', { proofValue: proof('/', { key: crypto.randomBytes(32).toString('hex') }) })).marker, undefined);
  assert.equal((await run('/', { proofValue: proof('/', { kind: 'OTHER' }) })).marker, undefined);
  assert.equal((await run('/', { proofValue: proof('/', { issued: seconds() - 31 }) })).marker, undefined);
  assert.equal((await run('/', { proofValue: proof('/', { issued: seconds() + 6 }) })).marker, undefined);
  assert.equal((await run('/', { proofValue: proof('/'), headers: { cookie: 'a=b' } })).marker, undefined);
  assert.equal((await run('/', { proofValue: proof('/'), headers: { rsc: '1' } })).marker, undefined);
  assert.equal((await run('/', { proofValue: proof('/'), headers: { host: 'example.com' } })).marker, undefined);
  assert.equal((await run('/', { proofValue: proof('/'), method: 'POST' })).marker, undefined);
  assert.equal((await run('//evil.example/x', { proofValue: proof('//evil.example/x') })).marker, undefined);
  // Observe mode records the proof but never sets the marker.
  settings('observe', 3600);
  const observed = await run('/p/1111111111111111111', { proofValue: proof('/p/1111111111111111111') });
  assert.equal(observed.marker, undefined); assert.deepEqual(observed.logs, ['TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=observe']);
  // Window limits: up to 30 days is valid, longer is refused, expired is refused.
  settings('active', MAX_WINDOW_SECONDS - 5);
  assert.equal((await run('/', { proofValue: proof('/') })).marker, '1');
  settings('active', MAX_WINDOW_SECONDS + 5);
  assert.equal((await run('/', { proofValue: proof('/') })).marker, undefined);
  settings('active', -1);
  assert.equal((await run('/', { proofValue: proof('/') })).marker, undefined);
  fs.rmSync(dir, { recursive: true });
  console.log('PASS ORIGIN PILOT: proof bound to exact URL, single use, 30s freshness, 30-day window cap, observe vs active, cookies/RSC/non-GET refused, ordinary traffic and caching untouched.');
})().catch(error => { fs.rmSync(dir, { recursive: true, force: true }); console.error(error); process.exit(1); });
