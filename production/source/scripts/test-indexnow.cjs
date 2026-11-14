'use strict';
// IndexNow: only our own sitemap pages are sent, only new/changed ones, in capped batches, saved only when accepted. No network.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const nx = require('../lib/indexnow.ts');
const O = 'https://twizou.net';
(async () => {
  // Key file: public text file equal to the key, so the engines can verify ownership.
  assert.match(nx.INDEXNOW_KEY, /^[a-f0-9]{32}$/);
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'public', nx.INDEXNOW_KEY + '.txt'), 'utf8').trim(), nx.INDEXNOW_KEY);
  const middleware = fs.readFileSync(path.join(__dirname, '..', 'middleware.ts'), 'utf8');
  assert(middleware.includes('"/api/indexnow",'), 'route is reachable');

  const T0 = Date.UTC(2026, 10, 14, 0); // JST 09:00 on 2026-11-14
  const rows = [
    { url: O }, { url: O + '/ranking/daily' }, { url: O + '/months/2026-10', lastModified: '2026-10-31T00:00:00.000Z' },
    { url: O + '/p/111', lastModified: '2026-11-01T00:00:00.000Z' }, { url: O + '/p/222', lastModified: '2026-11-10T00:00:00.000Z' },
    { url: O + '/accounts/abc', lastModified: '2026-11-02T00:00:00.000Z' }, { url: O + '/accounts' },
    { url: 'https://evil.example/p/1' }, { url: O + 'x.evil.example/p/1' }, { url: O + '/p/111', lastModified: '2026-11-01T00:00:00.000Z' },
  ];
  // First plan: everything of ours, hubs first, videos newest first, authors last; foreign hosts and duplicates dropped.
  const blank = nx.parseState('');
  const plan = nx.planSubmission(rows, blank, T0);
  assert.deepEqual(plan.due.map(d => d.url), [O, O + '/ranking/daily', O + '/months/2026-10', O + '/accounts', O + '/p/222', O + '/p/111', O + '/accounts/abc']);
  assert.equal(plan.total, 7);
  assert.equal(nx.planSubmission(rows, blank, T0, 3).due.length, 3, 'run limit');
  assert.deepEqual(nx.parseState('{bad'), blank); assert.deepEqual(nx.parseState('{"version":2}'), blank);

  // Full run with a fake service: accepted batches are saved; the next run (after the interval) sends nothing new.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-')); let clock = T0; const calls = [];
  const fetchOk = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { status: 202 }; };
  const run = (fetchImpl, rowsFn = async () => rows) => nx.runIndexNow({ rows: rowsFn, dir, now: () => clock, fetchImpl });
  let r = await run(fetchOk);
  assert.deepEqual([r.planned, r.submitted, r.pending, r.failedStatus], [7, 7, 0, undefined]);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, nx.INDEXNOW_ENDPOINT);
  assert.deepEqual([calls[0].body.host, calls[0].body.key, calls[0].body.keyLocation], ['twizou.net', nx.INDEXNOW_KEY, `${O}/${nx.INDEXNOW_KEY}.txt`]);
  assert.equal(calls[0].body.urlList.length, 7);
  // Too soon: skipped without even reading the sitemap.
  clock += 3600e3; r = await run(fetchOk, async () => { throw Error('must not read the sitemap'); }); assert.equal(r.skipped, 'interval'); assert.equal(calls.length, 1);
  // After the interval, same day, nothing changed: nothing sent.
  clock += 5 * 3600e3; r = await run(fetchOk); assert.equal(r.planned, 0); assert.equal(calls.length, 1);
  // A changed lastmod, a new video, and the next Japan-time day for the always-changing pages.
  clock += 24 * 3600e3;
  const rows2 = rows.map(x => x.url === O + '/p/111' ? { ...x, lastModified: '2026-11-15T00:00:00.000Z' } : x).concat([{ url: O + '/p/333', lastModified: '2026-11-14T00:00:00.000Z' }]);
  r = await run(fetchOk, async () => rows2);
  assert.deepEqual(calls[1].body.urlList.sort(), [O, O + '/ranking/daily', O + '/p/111', O + '/p/333'].sort());

  // Batching (1000 per request) and the per-run cap; failures stop the run and leave the rest for later.
  const many = Array.from({ length: 6200 }, (_, i) => ({ url: `${O}/p/${1000 + i}`, lastModified: new Date(T0 - i * 1000).toISOString() }));
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-')); clock = T0; const sizes = [];
  const fetchSizes = async (u, init) => { sizes.push(JSON.parse(init.body).urlList.length); return { status: 200 }; };
  r = await nx.runIndexNow({ rows: async () => many, dir: dir2, now: () => clock, fetchImpl: fetchSizes });
  assert.deepEqual(sizes, [1000, 1000, 1000, 1000, 1000]); assert.deepEqual([r.planned, r.submitted, r.pending], [6200, 5000, 1200]);
  clock += 6 * 3600e3; sizes.length = 0;
  r = await nx.runIndexNow({ rows: async () => many, dir: dir2, now: () => clock, fetchImpl: fetchSizes });
  assert.deepEqual(sizes, [1000, 200]); assert.equal(r.pending, 0, 'backlog finishes on the next run');
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-')); clock = T0; let n = 0;
  const flaky = async () => ({ status: ++n === 2 ? 429 : 200 });
  r = await nx.runIndexNow({ rows: async () => many, dir: dir3, now: () => clock, fetchImpl: flaky });
  assert.deepEqual([r.submitted, r.pending, r.failedStatus], [1000, 5200, 429], 'stops at the refusal; accepted batch kept');
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-')); n = 0;
  r = await nx.runIndexNow({ rows: async () => rows, dir: dir4, now: () => clock, fetchImpl: async () => { throw Error('offline'); } });
  assert.deepEqual([r.submitted, r.failedStatus], [0, 0], 'network failure is reported, nothing marked as sent');
  assert.equal(nx.parseState(fs.readFileSync(path.join(dir4, nx.INDEXNOW_STATE_FILE), 'utf8')).urls[O + '/p/222'], undefined);
  // A sitemap failure surfaces (the route answers 503) and never marks anything as sent.
  await assert.rejects(() => nx.runIndexNow({ rows: async () => { throw Error('db'); }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'indexnow-')), now: () => clock, fetchImpl: fetchOk }));
  // The route file exists and does not accept GET or a caller-chosen URL list.
  const route = fs.readFileSync(path.join(__dirname, '..', 'app/api/indexnow/route.ts'), 'utf8');
  assert(route.includes('export async function POST()') && !route.includes('export async function GET') && !route.includes('request'));
  console.log('PASS INDEXNOW: own pages only, new/changed only, daily hubs, batches + cap, accepted-only state, interval, failures');
})().catch(e => { console.error(e); process.exit(1); });
