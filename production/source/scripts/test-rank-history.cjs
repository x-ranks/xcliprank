'use strict';
// Ranking history: the daily record store, per-video/per-author statistics, archive pages' data, and wiring. Temp files only; no network.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { createRankHistoryStore, rankStats, validRankDay, jstDay, RANK_HISTORY_LIMIT } = require('../lib/rank-history-store.ts');
const { rememberRanking } = require('../lib/public-ranking-history.ts');
const { createPublicVideoService } = require('../lib/public-video-service.ts');
const { publicRankFacts } = require('../lib/public-video-core.ts');
const ids = (from, n) => Array.from({ length: n }, (_, i) => String(from + i));
(async () => {
  assert.equal(jstDay(Date.parse('2026-11-14T15:30:00Z')), '2026-11-15', 'Japan-time day');
  for (const bad of ['2026-13-01', '2026-02-30', '20261114', '', null]) assert.equal(validRankDay(bad), false, String(bad));
  assert.equal(validRankDay('2026-11-14'), true);
  // Store: latest list per day, throttled, top 100, survives a reload, ignores junk.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-history-')); let clock = Date.parse('2026-11-14T03:00:00Z');
  try {
    const store = createRankHistoryStore(root, () => clock);
    assert.deepEqual((await store.read()).days, [], 'no file yet');
    assert.equal(await store.record('daily', ids(1000, 150), '2026-11-14T03:00:00Z'), true);
    assert.equal(await store.record('daily', ids(2000, 20), '2026-11-14T03:05:00Z'), false, 'throttled within 30 minutes');
    assert.equal(await store.record('trending', ids(1000, 20), '2026-11-14T03:00:00Z'), false, 'only daily/weekly');
    assert.equal(await store.record('daily', ['1', 'x', '10'], '2026-11-14T03:00:00Z'), false, 'too few valid ids');
    assert.equal(await store.record('weekly', ids(5000, 10), '2026-11-14T03:00:00Z'), true);
    let s = await store.read();
    assert.equal(s.day('2026-11-14').daily.length, RANK_HISTORY_LIMIT); assert.equal(s.day('2026-11-14').weekly.length, 10);
    clock += 31 * 60 * 1000;
    assert.equal(await store.record('daily', ['1005', '1000', '1001', '9999'], '2026-11-14T03:31:00Z'), true, 'later list replaces the day');
    assert.equal(await store.record('daily', ['1005', '1000', '1001', '9999'], '2026-11-14T03:31:30Z'), false);
    await store.record('daily', ['1000', '7777', '1005'], '2026-11-14T16:00:00Z'); // JST 11/15
    s = await createRankHistoryStore(root).read();
    assert.deepEqual(s.days, ['2026-11-15', '2026-11-14']);
    assert.deepEqual(s.day('2026-11-14').daily, ['1005', '1000', '1001', '9999']); assert.equal(s.day('2026-11-14').weekly.length, 10, 'other range kept');
    assert.deepEqual(s.posts.get('1000'), { best: 1, days: 2, firstDay: '2026-11-14', lastDay: '2026-11-15' });
    assert.deepEqual(s.posts.get('1005'), { best: 1, days: 2, firstDay: '2026-11-14', lastDay: '2026-11-15' });
    assert.deepEqual(s.posts.get('7777'), { best: 2, days: 1, firstDay: '2026-11-15', lastDay: '2026-11-15' });
    assert.equal(s.posts.has('5000'), false, 'weekly lists do not create 24-hour statistics');
    fs.writeFileSync(path.join(root, 'rank-history.json'), '{broken');
    assert.deepEqual((await createRankHistoryStore(root).read()).days, [], 'unreadable file is treated as empty');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  // rememberRanking: history only for daily/weekly and only when a recorder is given.
  const calls = []; const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const body = range => ({ ok: true, range, data: [{ x_post_id: '111' }, { manual_id: 'm' }, { x_post_id: '222' }] });
  await rememberRanking(json(body('daily')), async () => {}, async (range, list) => { calls.push([range, list]); });
  await rememberRanking(json(body('trending')), async () => {}, async (range, list) => { calls.push([range, list]); });
  await rememberRanking(json(body('weekly')), async () => {}, null);
  await rememberRanking(json(body('weekly')), async () => {}, async () => { throw Error('disk'); });
  assert.deepEqual(calls, [['daily', ['111', '222']]]);
  // Service: archive day rechecks visibility, keeps original ranks, thresholds; video and author facts.
  const v = (id, handle = 'a', views = 100) => ({ id, authorId: handle, handle, authorName: handle.toUpperCase(), text: 't' + id, posterUrl: null, videoUrl: 'u', createdAt: '2026-11-01T00:00:00Z', sourceHash: 'h', eligible: true, views });
  const day1 = ids(100, 12), day2 = ['105', '100', '300', ...ids(106, 9)];
  const history = rankStats({ version: 1, days: { '2026-11-12': { daily: day1, at: 'x' }, '2026-11-13': { daily: day2, at: 'x' }, '2026-11-14': { weekly: ['100', '101', '102'], at: 'x' } } });
  const pool = [...ids(100, 12).map((id, i) => v(id, i < 6 ? 'a' : 'b', (i + 1) * 10)), v('300', 'c', 5000)].map(x => x.id === '103' ? { ...x, eligible: false } : x);
  const catalog = { version: 1, revision: 1, labels: [], records: { '100': { id: '100', labelIds: [], basis: null, modelRevision: null, sourceHash: null, labelPublishedAt: null, saves: 0, firstSavedAt: null, firstRankedAt: '2026-10-20T03:00:00Z', receipts: [] } } };
  const others = ['d', 'e', 'f'].map((h, i) => v('90' + i, h, 1));
  const svc = createPublicVideoService({ catalog: { read: async () => catalog }, posts: async list => pool.filter(x => list.includes(x.id)), indexVideos: async () => [...pool, ...others], authorVideos: async key => pool.filter(x => x.handle === key), candidates: async () => [], secret: async () => '', rankHistory: async () => history });
  assert.deepEqual(await svc.rankDays(), [{ day: '2026-11-13', count: 12 }, { day: '2026-11-12', count: 12 }], 'weekly-only days are not archive pages');
  const d1 = await svc.rankDay('2026-11-12', '2026-11-14');
  assert.equal(d1.recorded, 12); assert.equal(d1.entries.length, 11, 'hidden video dropped');
  assert.deepEqual(d1.entries.slice(0, 5).map(e => e.rank), [1, 2, 3, 5, 6], 'original ranks are kept');
  assert.equal(d1.prev, null); assert.equal(d1.next, '2026-11-13'); assert.equal(d1.newEntries, null); assert.equal(d1.index, true);
  assert.deepEqual(d1.topAuthors.map(a => [a.key, a.count, a.best]), [['b', 6, 7], ['a', 5, 1]]);
  const d2 = await svc.rankDay('2026-11-13', '2026-11-13');
  assert.equal(d2.newEntries, 1, 'only video 300 is new'); assert.equal(d2.index, false, 'the current day is not indexed yet'); assert.equal(d2.prev, '2026-11-12');
  for (const bad of ['2026-11-14', '2026-11-01', 'abc', '2026-1-1']) assert.equal(await svc.rankDay(bad), null, bad);
  const core = await svc.detailCore('100');
  assert.deepEqual(core.rank, { best: 1, days: 2, firstDay: '2026-11-12', lastDay: '2026-11-13' }); assert.equal(core.firstRankedAt, '2026-10-20T03:00:00Z');
  assert.equal((await svc.detailCore('300')).firstRankedAt, null);
  const acct = await svc.account('a');
  assert.equal(acct.ranking.everRanked, 1); assert.equal(acct.ranking.rankedVideos, 5); assert.equal(acct.ranking.best, 1); assert.equal(acct.ranking.rankedDays, 2); assert.equal(acct.ranking.since, '2026-11-12');
  assert.deepEqual(acct.ranking.standing, { authors: 6, byViews: 3, byCount: 2 }, 'c has more views; b has more videos and more views');
  // Without a history source everything still works, just without the facts.
  const plain = createPublicVideoService({ catalog: { read: async () => catalog }, posts: async list => pool.filter(x => list.includes(x.id)), authorVideos: async key => pool.filter(x => x.handle === key), candidates: async () => [], secret: async () => '' });
  assert.equal((await plain.detailCore('100')).rank, null); assert.deepEqual(await plain.rankDays(), []); assert.equal(await plain.rankDay('2026-11-12'), null);
  assert.equal((await plain.account('a')).ranking.standing, null);
  const failing = createPublicVideoService({ catalog: { read: async () => catalog }, posts: async list => pool.filter(x => list.includes(x.id)), authorVideos: async () => [], candidates: async () => [], secret: async () => '', rankHistory: async () => { throw Error('disk'); } });
  assert.equal((await failing.detailCore('100')).rank, null, 'a broken history file never breaks the video page');
  // Facts text.
  const facts = publicRankFacts({ best: 3, days: 5, firstDay: '2026-11-12', lastDay: '2026-11-20' }, '2026-10-20T03:00:00Z');
  assert.deepEqual(facts.map(f => f.label), ['twizou 24時間ランキング最高順位', 'ランクイン日数', 'twizouのランキング初掲載']);
  assert.equal(facts[0].value, '3位（2026年11月12日以降の記録）'); assert.equal(facts[1].value, '5日'); assert.equal(facts[2].value, '2026/10/20');
  assert.deepEqual(publicRankFacts(null, null), []); assert.deepEqual(publicRankFacts(undefined, 'broken'), []);
  // Wiring.
  const route = fs.readFileSync('app/api/rankings/route.ts', 'utf8');
  assert.ok(route.includes('!query.get("edition") && !query.get("page") && !query.has("visual")') && route.includes('createRankHistoryStore(publicCatalogDirectory())'), 'only the current default ranking is recorded');
  const mw = fs.readFileSync('middleware.ts', 'utf8'); assert.ok(mw.includes('"/ranking/history"') && mw.includes('ranking\\/history\\/'), 'middleware allows the archive');
  assert.ok(fs.readFileSync('app/sitemap.ts', 'utf8').includes('/ranking/history/${d.day}'));
  for (const f of ['app/components/BottomTabs.tsx', 'app/components/DedicatedRankingPage.tsx', 'app/components/PopularRankingPage.tsx']) assert.ok(fs.readFileSync(f, 'utf8').includes('/ranking/history'), f + ' links to the archive');
  assert.ok(fs.readFileSync('app/p/[id]/page.tsx', 'utf8').includes('publicRankFacts(d.rank, d.firstRankedAt)') && fs.readFileSync('app/components/PublicDetailViewer.tsx', 'utf8').includes('publicRankFacts(d.rank, d.firstRankedAt)'));
  console.log('PASS RANK HISTORY: daily store (throttle, top 100, JST, junk-safe), video/author statistics, archive days with rechecks and thresholds, optional everywhere, wiring.');
})().catch(e => { console.error(e); process.exit(1); });
// Speed: optional author standing never waits for a cold index, and repeated requests reuse the totals.
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs');
  const { createPublicVideoService } = require('../lib/public-video-service.ts');
  const v = (id, handle) => ({ id, authorId: handle, handle, authorName: handle, text: 't', posterUrl: null, videoUrl: 'u', createdAt: '2026-11-01T00:00:00Z', sourceHash: 'h', eligible: true, views: 10 });
  const pool = ['a', 'b', 'c', 'd', 'e'].map((h, i) => v('70' + i, h)), catalog = { version: 1, revision: 7, labels: [], records: {} };
  const base = { catalog: { read: async () => catalog }, posts: async () => [], authorVideos: async key => pool.filter(x => x.handle === key), candidates: async () => [], secret: async () => '' };
  const started = Date.now();
  const cold = await createPublicVideoService({ ...base, indexVideos: () => new Promise(resolve => setTimeout(() => resolve(pool), 3000)) }).account('a');
  assert.equal(cold.ranking.standing, null, 'cold index: standing is skipped'); assert.ok(Date.now() - started < 1500, 'author page did not wait for the index');
  let reads = 0; const getter = v2 => ({ ...v2, get handle() { reads++; return v2.handle; } });
  const tracked = pool.map(x => { const { handle, ...rest } = x; const o = { ...rest }; Object.defineProperty(o, 'handle', { enumerable: true, get() { reads++; return handle; } }); return o; });
  const warm = createPublicVideoService({ ...base, indexVideos: async () => tracked });
  assert.deepEqual((await warm.account('a')).ranking.standing, { authors: 5, byViews: 1, byCount: 1 }); const first = reads;
  await warm.account('b'); assert.equal(reads, first, 'totals are reused while the index and catalog are unchanged');
  const pop1 = await warm.popular('all'), pop2 = await warm.popular('all'); assert.equal(pop1, pop2, 'popular ranking result is reused within a minute');
  const src = fs.readFileSync('lib/public-video-production.ts', 'utf8');
  assert.ok(src.includes('if (lastAuthorFingerprint !== null) {') && src.includes('return lastAuthorFingerprint;'), 'change marker is served stale and refreshed in the background');
  console.log('PASS SPEED: author page never waits for a cold index; totals and popular results are reused; change marker is non-blocking.');
  setTimeout(() => process.exit(process.exitCode ?? 0), 10);
})().catch(e => { console.error(e); process.exit(1); });
