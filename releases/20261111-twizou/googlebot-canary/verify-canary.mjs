import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import snapshot from './ranges.generated.mjs';

// The origin side under test is the real production file that the auto-deploy ships.
const here = dirname(fileURLToPath(import.meta.url));
const origin = createRequire(import.meta.url)(join(here, '../../../production/source/scripts/origin-pilot.cjs'));
const { wrapPilot, createPilotVerifier, ORIGIN, PROOF, MARKER, NO_STORE } = origin;
const RANGES_URL = 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json';

const directory = await mkdtemp(join(tmpdir(), 'twizou-production-canary-'));
const secret = randomBytes(32).toString('hex');
const until = Math.floor(Date.now() / 1000) + 29 * 86400;
const env = { EDGE_PILOT_SECRET: secret, CANARY_UNTIL: String(until) };
const googleUA = 'Googlebot/2.1 (+http://www.google.com/bot.html)';
const inspectionUA = 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)';
const publicCache = 'public, max-age=3600';

const renderer = (req, res) => {
  res.writeHead(200, 'OK', {
    'Content-Type': 'text/html', 'Cache-Control': publicCache,
    'Cloudflare-CDN-Cache-Control': publicCache, ETag: '"old"'
  });
  res.end(req.headers[MARKER] === '1'
    ? '<meta name="rating" content="adult"><main>NO_GATE</main>'
    : '<meta name="rating" content="adult"><div class="age-gate" role="dialog">AGE_GATE</div>');
};
const fallback = (req, res) => {
  delete req.headers[MARKER];
  renderer(req, res);
};
const events = [];
const server = createServer(wrapPilot(renderer, fallback, createPilotVerifier({ directory }), event => events.push(event)));
await mkdir(join(directory, 'nonces'));
await writeFile(join(directory, 'enabled.json'), JSON.stringify({ secret, until, mode: 'observe' }));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const local = 'http://127.0.0.1:' + server.address().port;

const nativeFetch = globalThis.fetch;
const nativeLog = console.log;
let rangesMode = 'ok';
let rangesFetches = 0;
let lastProof = null;
let lastOptions = null;
const logs = [];

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

function rangesBody() {
  const toItem = prefix => (prefix.includes(':') ? { ipv6Prefix: prefix } : { ipv4Prefix: prefix });
  if (rangesMode === 'evil') {
    return { prefixes: [...snapshot.ranges.slice(0, 11), '0.0.0.0/0'].map(toItem) };
  }
  if (rangesMode === 'empty-ish') return { prefixes: [{ ipv4Prefix: '203.0.113.0/24' }] };
  // A Google-published list that no longer contains the bundled 66.249.66.x range proves the live list wins.
  if (rangesMode === 'moved') return { prefixes: ['192.0.2.0/24', ...snapshot.ranges.filter(p => !p.startsWith('66.249.')).slice(0, 12)].map(toItem) };
  return { prefixes: snapshot.ranges.map(toItem) };
}

globalThis.fetch = async (input, options) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url === RANGES_URL) {
    rangesFetches += 1;
    if (rangesMode === 'fail') throw new Error('network');
    return new Response(JSON.stringify(rangesBody()), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const parsed = new URL(url);
  assert.equal(input.headers.get(MARKER), null, 'marker must never reach the origin from outside');
  lastOptions = options ?? null;
  lastProof = input.headers.get(PROOF);
  const headers = new Headers(input.headers);
  headers.set('Host', parsed.host);
  return sendToOrigin(local + parsed.pathname + parsed.search, headers);
};

const pending = [];
const ctx = { waitUntil: promise => { pending.push(promise); } };
console.log = (...args) => {
  const line = args.join(' ');
  if (line.includes('"twizou-canary"')) logs.push(JSON.parse(line)); else nativeLog(...args);
};

let counter = 0;
async function freshWorker() {
  counter += 1;
  return (await import('./worker.mjs?run=' + counter)).default;
}

try {
  let edge = await freshWorker();
  async function ask(headers, suffix = '/', settings = env, method = 'GET') {
    const request = new Request(ORIGIN + suffix, { headers, method });
    Object.defineProperty(request, 'cf', { value: {} });
    const response = await edge.fetch(request, settings, ctx);
    const text = await response.text();
    await Promise.all(pending.splice(0));
    return { response, text };
  }
  const gate = text => text.includes('class="age-gate"');
  const google = { 'User-Agent': googleUA, 'CF-Connecting-IP': '66.249.66.78' };

  // 1. Ordinary visitors: untouched, never logged, forged headers removed.
  let r = await ask({ 'User-Agent': 'Mozilla/5.0', [MARKER]: '1', [PROOF]: 'forged' }, '/p/123');
  assert.equal(lastProof, null);
  assert.ok(gate(r.text));
  assert.equal(r.response.headers.get('Cache-Control'), publicCache);
  r = await ask({ 'User-Agent': 'Mozilla/5.0' }, '/ranking/daily');
  assert.equal(r.response.headers.get('ETag'), '"old"');
  assert.deepEqual(logs, []);
  assert.equal(rangesFetches, 0);

  // 2. Googlebot UA from a non-Google address, or with a forwarded Google address, is not signed.
  r = await ask({ ...google, 'CF-Connecting-IP': '203.0.113.1', 'X-Forwarded-For': '66.249.66.78' }, '/p/123');
  assert.equal(lastProof, null);
  assert.ok(gate(r.text));
  assert.equal(r.response.headers.get('Cache-Control'), publicCache);
  assert.equal(logs.at(-1).reason, 'ip-not-in-google-ranges');
  assert.equal(logs.at(-1).signed, false);
  assert.equal(lastOptions, null);

  // 3. Other refusals: foreign worker, RSC, stale/over-long window, other agents, POST, API and asset paths.
  for (const extra of [{ 'CF-Worker': 'other.example' }, { rsc: '1' }, { Cookie: 'a=b' }, { Range: 'bytes=0-9' }]) {
    r = await ask({ ...google, ...extra }, '/p/123');
    assert.equal(lastProof, null);
    assert.ok(gate(r.text));
  }
  r = await ask({ ...google, 'User-Agent': 'AdsBot-Google (+http://www.google.com/adsbot.html)' }, '/');
  assert.equal(lastProof, null);
  assert.equal(logs.at(-1).reason, 'user-agent-not-eligible');
  r = await ask(google, '/p/123', { ...env, CANARY_UNTIL: '1000000000' });
  assert.equal(lastProof, null);
  assert.equal(logs.at(-1).reason, 'window-expired');
  r = await ask(google, '/p/123', { ...env, CANARY_UNTIL: String(Math.floor(Date.now() / 1000) + 31 * 86400) });
  assert.equal(lastProof, null);
  assert.equal(logs.at(-1).reason, 'window-longer-than-30d');
  r = await ask(google, '/p/123', { ...env, EDGE_PILOT_SECRET: 'x' });
  assert.equal(logs.at(-1).reason, 'secret-invalid');
  await ask(google, '/_next/static/chunk.js');
  assert.equal(lastProof, null);
  assert.equal(logs.at(-1).reason, 'path-not-eligible');
  await ask(google, '/api/engagement-stats');
  assert.equal(lastProof, null);
  await ask(google, '/p/123', env, 'POST').catch(() => {});
  assert.equal(lastProof, null);
  assert.deepEqual(events, []);

  // 4. Observe mode: a real Googlebot request on any page is signed, logged, but the gate is still served.
  r = await ask(google, '/p/2091860611881967725');
  assert.match(lastProof, /^v2\./);
  assert.deepEqual(lastOptions, { cache: 'no-store' });
  assert.ok(gate(r.text));
  assert.equal(r.response.headers.get('Cache-Control'), NO_STORE);
  assert.equal(r.response.headers.get('ETag'), null);
  assert.equal(r.response.headers.get('Cloudflare-CDN-Cache-Control'), null);
  assert.equal(logs.at(-1).signed, true);
  assert.equal(logs.at(-1).ageGateInHtml, true);
  assert.equal(logs.at(-1).adultRatingInHtml, true);
  assert.deepEqual(events, ['TWIZOU_PRODUCTION_CANARY_GOOGLEBOT mode=observe']);

  // 5. Active mode: signed requests on any page, with queries and Japanese paths, get the page without the gate.
  await writeFile(join(directory, 'enabled.json'), JSON.stringify({ secret, until, mode: 'active' }));
  const pages = ['/', '/p/2091860611881967725', '/rising', '/ranking/weekly?page=2', '/creator/%E3%83%86%E3%82%B9%E3%83%88?x=1&y=2', '/reels'];
  for (const page of pages) {
    r = await ask(google, page);
    assert.match(r.text, /NO_GATE/, page);
    assert.equal(r.response.headers.get('Cache-Control'), NO_STORE);
    assert.equal(logs.at(-1).ageGateInHtml, false);
    assert.equal(logs.at(-1).path, new URL(ORIGIN + page).pathname);
  }
  r = await ask({ ...google, 'User-Agent': inspectionUA }, '/rising');
  assert.match(r.text, /NO_GATE/);
  assert.equal(logs.at(-1).agent, 'inspection-tool');

  // 6. A captured proof cannot be replayed, nor used for another URL, nor by an ordinary visitor.
  await ask(google, '/p/777');
  const proof = lastProof;
  const replay = await sendToOrigin(local + '/p/777', new Headers({ Host: 'twizou.net', [PROOF]: proof, [MARKER]: '1' }));
  assert.ok(gate(await replay.text()));
  assert.equal(replay.headers.get('Cache-Control'), NO_STORE);
  await ask(google, '/p/778');
  const other = lastProof;
  const moved = await sendToOrigin(local + '/p/779', new Headers({ Host: 'twizou.net', [PROOF]: other }));
  assert.ok(gate(await moved.text()));
  r = await ask({ 'User-Agent': 'Mozilla/5.0', [PROOF]: other }, '/p/778');
  assert.ok(gate(r.text));

  // 7. Google's published list is used when reachable and replaces the bundled one.
  rangesMode = 'moved';
  edge = await freshWorker();
  r = await ask(google, '/p/123');
  assert.equal(lastProof, null, 'a live list that no longer holds the address must win over the bundled one');
  assert.equal(logs.at(-1).reason, 'ip-not-in-google-ranges');
  assert.equal(logs.at(-1).ranges, 'google');

  // 8. When Google cannot be reached, or returns something implausible, the bundled list is the fallback.
  for (const mode of ['fail', 'evil', 'empty-ish']) {
    rangesMode = mode;
    edge = await freshWorker();
    r = await ask(google, '/p/123');
    assert.match(lastProof ?? '', /^v2\./, mode);
    assert.equal(logs.at(-1).ranges, 'bundled', mode);
    assert.match(r.text, /NO_GATE/);
  }
  // A failed fetch is not retried on every request.
  rangesMode = 'fail';
  edge = await freshWorker();
  const before = rangesFetches;
  await ask(google, '/p/1');
  await ask(google, '/p/2');
  await ask(google, '/p/3');
  assert.equal(rangesFetches - before, 1);
  rangesMode = 'ok';

  // 9. Normal-case list is cached between requests.
  edge = await freshWorker();
  const count = rangesFetches;
  await ask(google, '/p/1');
  await ask(google, '/p/2');
  assert.equal(rangesFetches - count, 1);

  // 10. Switching the origin off immediately restores the normal age check.
  await rm(join(directory, 'enabled.json'));
  r = await ask(google, '/p/123');
  assert.ok(gate(r.text));
  nativeLog('PRODUCTION_CANARY_SITE_WIDE_OK');
} finally {
  console.log = nativeLog;
  globalThis.fetch = nativeFetch;
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true });
}
