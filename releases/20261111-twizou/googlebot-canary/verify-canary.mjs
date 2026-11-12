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
const inspectionUA = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0)';
const logs = [];
const nativeLog = console.log;
const renderer = (req, res) => {
  res.writeHead(200, 'OK', {
    'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600',
    'Cloudflare-CDN-Cache-Control': 'public, max-age=3600', ETag: '"old"'
  });
  res.end(req.headers[MARKER] === '1' ? '<meta name="rating" content="adult">NO_GATE'
    : '<meta name="rating" content="adult"><div class="age-gate" role="dialog">AGE_GATE</div>');
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
  console.log = (...args) => { if (typeof args[0] === 'string' && args[0].startsWith('{')) logs.push(args[0]); else nativeLog(...args); };
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
    assert.equal((await result.text()).replace(/<[^>]+>/g, ''), verdict);
  }
  const takeLogs = () => logs.splice(0).map(line => JSON.parse(line)).filter(entry => entry.event === 'twizou-canary');
  const google = { 'User-Agent': googleUA, 'CF-Connecting-IP': '66.249.66.78' };
  await check({ [MARKER]: '1', [PROOF]: 'forged' }, 'AGE_GATE');
  assert.equal(lastProof, null);
  await check({ ...google, 'CF-Connecting-IP': '203.0.113.1', 'X-Forwarded-For': '66.249.66.78' }, 'AGE_GATE');
  await check({ ...google, 'CF-Worker': 'other.example' }, 'AGE_GATE');
  await check({ ...google, 'User-Agent': 'Google-InspectionTool/2.0' }, 'AGE_GATE');
  assert.equal(lastProof, null);
  await check({ 'User-Agent': inspectionUA, 'CF-Connecting-IP': '203.0.113.1' }, 'AGE_GATE');
  assert.equal(lastProof, null);
  await check({ 'User-Agent': inspectionUA, 'CF-Connecting-IP': '66.249.66.78', 'Cookie': 'a=b' }, 'AGE_GATE');
  assert.equal(lastProof, null);
  await check({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0', 'CF-Connecting-IP': '66.249.66.78' }, 'AGE_GATE');
  assert.equal(lastProof, null);
  await check(google, 'AGE_GATE', '?source=other');
  await check({ ...google, rsc: '1' }, 'AGE_GATE');
  await check(google, 'AGE_GATE', '', { ...env, CANARY_UNTIL: '1000000000' });
  assert.deepEqual(events, []);
  // Every Google-looking request to the test URL is logged with the reason it was or was not signed, and the log
  // records facts about the HTML returned. Ordinary browsers and non-test URLs must produce no log line.
  const before = takeLogs();
  assert.ok(before.length >= 7 && before.every(entry => entry.signed === false));
  assert.ok(before.every(entry => entry.ageGateInHtml === true && entry.adultRatingInHtml === true && entry.status === 200));
  const reasons = new Set(before.map(entry => entry.reason));
  for (const reason of ['ip-not-in-googlebot-ranges', 'excluded-header:cf-worker', 'url-mismatch', 'excluded-header:rsc',
    'window-expired', 'user-agent-not-eligible', 'excluded-header:cookie']) assert.ok(reasons.has(reason), reason);
  assert.ok(!before.some(entry => entry.ua.includes('Windows NT')));
  await check(google, 'AGE_GATE');
  let [observed] = takeLogs();
  assert.deepEqual([observed.signed, observed.reason, observed.agent, observed.ageGateInHtml], [true, 'eligible', 'googlebot', true]);
  assert.deepEqual(events, ['TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=observe']);
  await writeFile(join(directory, 'enabled.json'), JSON.stringify({ secret, until, mode: 'active' }));
  await check(google, 'NO_GATE');
  [observed] = takeLogs();
  assert.deepEqual([observed.signed, observed.ageGateInHtml, observed.adultRatingInHtml, observed.status], [true, false, true, 200]);
  assert.deepEqual(events, ['TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=observe', 'TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=active']);
  assert.match(lastProof, /^v2\./);
  // The Search Console live test (Google-InspectionTool) is accepted for this one URL from a Google IP and is
  // treated exactly like Googlebot by the origin.
  await check({ 'User-Agent': inspectionUA, 'CF-Connecting-IP': '66.249.66.78' }, 'NO_GATE');
  [observed] = takeLogs();
  assert.deepEqual([observed.signed, observed.agent, observed.ageGateInHtml], [true, 'inspection-tool', false]);
  assert.equal(events.length, 3);
  await check({ 'User-Agent': inspectionUA, 'CF-Connecting-IP': '203.0.113.1' }, 'AGE_GATE');
  assert.equal(takeLogs()[0].reason, 'ip-not-in-googlebot-ranges');
  await check({ 'User-Agent': inspectionUA, 'CF-Connecting-IP': '66.249.66.78' }, 'AGE_GATE', '?x=1');
  assert.equal(takeLogs()[0].reason, 'url-mismatch');
  const replay = await sendToOrigin(local + PILOT_PATH, new Headers({
    Host: 'twizou.net', [PROOF]: lastProof, [MARKER]: '1'
  }));
  assert.equal((await replay.text()).replace(/<[^>]+>/g, ''), 'AGE_GATE');
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
