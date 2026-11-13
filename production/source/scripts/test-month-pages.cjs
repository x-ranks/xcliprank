'use strict';
// Monthly ranking pages: service output (Japan-time months, ranking by X views, thresholds) and the route/middleware wiring.
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { createPublicVideoService } = require('../lib/public-video-service.ts');
const { isIndexable } = require('../lib/indexability.ts');
const { monthHref, monthLabel } = require('../lib/month-pages.ts');
const v = (id, createdAt, views, handle = 'a') => ({ id, authorId: handle, handle, authorName: handle.toUpperCase(), text: 'text ' + id, posterUrl: null, videoUrl: 'u', createdAt, sourceHash: 'h', eligible: true, ...(views === undefined ? {} : { views }) });
const svcFor = rows => createPublicVideoService({ catalog: { read: async () => ({ version: 1, revision: 1, labels: [], records: {} }) }, posts: async () => [], indexVideos: async () => rows, authorVideos: async () => [], candidates: async () => [], secret: async () => '' });
(async () => {
  assert.equal(isIndexable({ type: 'month', permittedVideos: 9 }), false); assert.equal(isIndexable({ type: 'month', permittedVideos: 10 }), true);
  assert.equal(monthHref('2026-06'), '/months/2026-06'); assert.equal(monthLabel('2026-06'), '2026年6月'); assert.equal(monthLabel('2026-12'), '2026年12月');
  // 12 videos in 2026-10 (one authored in JST 11/01 via UTC 10/31 15:30), 11 in 2026-11, 3 in 2026-09 (too few to list).
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(v(String(1000 + i), `2026-10-${String(2 + i).padStart(2, '0')}T03:00:00Z`, (i + 1) * 100, i % 3 ? 'a' : 'b'));
  rows.push(v('2000', '2026-10-31T15:30:00Z', 5000)); // JST 2026-11-01
  for (let i = 0; i < 10; i++) rows.push(v(String(3000 + i), `2026-11-${String(2 + i).padStart(2, '0')}T03:00:00Z`, undefined));
  for (let i = 0; i < 3; i++) rows.push(v(String(4000 + i), `2026-09-0${1 + i}T03:00:00Z`, 10));
  rows.push({ ...v('5000', '2026-10-05T00:00:00Z', 999), eligible: false });
  rows.push({ ...v('5001', null, 999) });
  const svc = svcFor(rows);
  const list = await svc.months();
  assert.deepEqual(list.map(m => [m.month, m.count]), [['2026-11', 11], ['2026-10', 12]], 'newest first, small months omitted, Japan-time boundary respected');
  const oct = await svc.month('2026-10');
  assert.equal(oct.total, 12); assert.equal(oct.byViews, true); assert.equal(oct.measured, 12); assert.equal(oct.viewsTotal, 7800);
  assert.deepEqual(oct.ranked.map(r => r.id).slice(0, 3), ['1011', '1010', '1009'], 'ranked by X views, highest first');
  assert.equal(oct.ranked.length, 12); assert.equal(oct.prev, null); assert.equal(oct.next, '2026-11'); assert.equal(oct.index, true);
  assert.deepEqual(oct.topAuthors.map(a => [a.key, a.count]), [['a', 8], ['b', 4]]);
  // November has only one known view count (the 5000-view post crossing midnight): ranked by recency, no view statistics.
  const nov = await svc.month('2026-11');
  assert.equal(nov.total, 11); assert.equal(nov.byViews, false); assert.equal(nov.measured, 0); assert.equal(nov.viewsTotal, 0);
  assert.equal(nov.ranked[0].id, '3009', 'newest first when views are not known'); assert.equal(nov.prev, '2026-10'); assert.equal(nov.next, null);
  // Too small, invalid or unknown months do not exist (404) and are never listed.
  assert.equal(await svc.month('2026-09').then(d => d.index), false, 'a thin month exists but is noindex');
  assert.equal(await svc.month('2026-13'), null); assert.equal(await svc.month('abc'), null); assert.equal(await svc.month('2020-01'), null);
  // Routing and navigation wiring.
  const mw = fs.readFileSync('middleware.ts', 'utf8');
  assert.match(mw, /"\/months"/); assert.ok(mw.includes('months\\/'), 'middleware allows /months/YYYY-MM');
  assert.ok(fs.readFileSync('app/sitemap.ts', 'utf8').includes('/months/${m.month}'), 'sitemap lists month pages');
  assert.ok(fs.readFileSync('app/components/SiteBrand.tsx', 'utf8').includes('href="/months"'), 'masthead links to the month hub');
  console.log('PASS MONTH PAGES: Japan-time months, ranking by X views, recency fallback, thresholds, 404s, middleware/sitemap/nav wiring. Fixture only.');
})().catch(e => { console.error(e); process.exit(1); });
