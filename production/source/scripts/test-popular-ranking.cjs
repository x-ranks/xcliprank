'use strict';
// Popular-video hubs: service output (30 days / all time, X views, thresholds) and routing wiring. Fixture only.
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { createPublicVideoService } = require('../lib/public-video-service.ts');
const day = 86400000, ago = d => new Date(Date.now() - d * day).toISOString();
const v = (id, daysAgo, views, handle = 'a') => ({ id, authorId: handle, handle, authorName: handle.toUpperCase(), text: 't' + id, posterUrl: null, videoUrl: 'u', createdAt: ago(daysAgo), sourceHash: 'h', eligible: true, ...(views === undefined ? {} : { views }) });
const svcFor = rows => createPublicVideoService({ catalog: { read: async () => ({ version: 1, revision: 1, labels: [], records: {} }) }, posts: async () => [], indexVideos: async () => rows, authorVideos: async () => [], candidates: async () => [], secret: async () => '' });
(async () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(v('100' + String(i).padStart(2, '0'), 2 + i, (i + 1) * 1000, i % 3 ? 'a' : 'b')); // within 30 days
  for (let i = 0; i < 5; i++) rows.push(v('200' + String(i).padStart(2, '0'), 60 + i, 50000 + i, 'c'));                  // older than 30 days
  rows.push(v('30000', 3, undefined, 'a'));                                                                               // views not known
  rows.push({ ...v('30001', 3, 999999), eligible: false });                                                               // not published
  rows.push({ ...v('30002', 3, 1), createdAt: null });                                                                    // no date
  rows.push(v('100', 4, 7000, 'a'), v('100', 4, 7000, 'a'));                                                              // duplicate id counted once
  const svc = svcFor(rows);
  const m = await svc.popular('30days');
  assert.equal(m.total, 14, '12 measured + 1 unmeasured + 1 duplicate-id post counted once; ineligible, undated and 60-day posts are out');
  assert.equal(m.measured, 13); assert.equal(m.viewsTotal, 12 * 13 / 2 * 1000 + 7000);
  assert.deepEqual(m.ranked.map(r => r.id).slice(0, 2), ['10011', '10010'], 'highest X views first');
  assert.ok(!m.ranked.some(r => r.id === '30000' || r.id.startsWith('200')), 'unmeasured and out-of-range posts are not ranked');
  assert.equal(m.index, true); assert.equal(m.months.length, 0, 'month breakdown is only for the all-time page');
  assert.deepEqual(m.topAuthors.map(a => a.key), ['a', 'b'], 'authors ordered by total views');
  const all = await svc.popular('all');
  assert.equal(all.total, 20, 'all time also counts the undated post (30 days cannot)'); assert.equal(all.ranked[0].id, '20004', 'all time includes older posts');
  assert.ok(all.ranked.length <= 100);
  assert.equal(all.average, Math.round(all.viewsTotal / all.measured)); assert.ok(all.median > 0);
  assert.ok(all.firstAt <= all.latestAt);
  // Too few measured posts: still renders, but is not indexed, and one author alone gives no author ranking.
  const thin = await svcFor([v('1', 1, 10, 'a'), v('2', 2, 20, 'a')]).popular('30days');
  assert.equal(thin.index, false); assert.deepEqual(thin.topAuthors, [], 'a single author is not shown as a ranking');
  // Unknown ranges do not exist.
  for (const bad of ['7days', 'ALL', '__proto__', 'constructor', '']) assert.equal(await svc.popular(bad), null, bad);
  // Wiring: middleware allows the paths, tracking and edge cache (the /ranking/ prefix) cover them, menu/tabs link to them.
  const mw = fs.readFileSync('middleware.ts', 'utf8');
  for (const p of ['"/ranking/30days"', '"/ranking/all"']) assert.ok(mw.includes(p), 'middleware allows ' + p);
  assert.ok(fs.readFileSync('lib/engagement-navigation.ts', 'utf8').includes('"/ranking/30days", "/ranking/all"'));
  const edge = require('../lib/edge-cache.ts');
  for (const p of ['/ranking/30days', '/ranking/all']) assert.equal(edge.edgeCacheable('GET', p, 'Mozilla/5.0', null), true, p + ' is edge-cacheable');
  for (const f of ['app/components/BottomTabs.tsx', 'app/components/DedicatedRankingPage.tsx']) { const t = fs.readFileSync(f, 'utf8'); assert.ok(t.includes('/ranking/30days') && t.includes('/ranking/all'), f + ' links to both hubs'); }
  console.log('PASS POPULAR RANKING: 30-day/all-time ranking by X views, author totals, thresholds, unknown ranges, wiring. Fixture only.');
})().catch(e => { console.error(e); process.exit(1); });
