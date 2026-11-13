'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { accountProfile, profileDate, profileNumber } = require('../lib/public-video-core.ts');
const v = (id, createdAt, views) => ({ id, authorId: '1', handle: 'a', authorName: 'A', text: 't' + id, posterUrl: null, videoUrl: 'u', createdAt, sourceHash: 'h', eligible: true, ...(views === undefined ? {} : { views }) });

const p = accountProfile([v('10', '2026-11-12T20:00:00Z', 500), v('11', '2026-11-01T00:00:00Z', 9000), v('12', '2026-10-15T00:00:00Z', 20), v('12', '2026-10-15T00:00:00Z', 20), v('13', '2026-10-31T15:30:00Z')]);
assert.equal(p.total, 4, 'duplicates are counted once');
assert.equal(p.latestAt, '2026-11-12T20:00:00.000Z'); assert.equal(p.firstAt, '2026-10-15T00:00:00.000Z');
assert.equal(p.measured, 3); assert.equal(p.viewsTotal, 9520);
assert.deepEqual(p.top.map(t => t.id), ['11', '10', '12']);
// Months use Japan time: 2026-10-31T15:30Z is already 11/01 in Japan.
assert.deepEqual(p.months, [{ month: '2026-11', count: 3 }, { month: '2026-10', count: 1 }]);
// Fewer than two known view counts: no view statistics at all (nothing is implied from one number).
const few = accountProfile([v('1', '2026-11-01T00:00:00Z', 100), v('2', '2026-11-02T00:00:00Z'), v('3', '2026-11-03T00:00:00Z', -5), v('4', '2026-11-04T00:00:00Z', NaN)]);
assert.equal(few.measured, 0); assert.equal(few.viewsTotal, 0); assert.deepEqual(few.top, []); assert.equal(few.total, 4);
// Missing or invalid dates are ignored, not guessed.
const nodate = accountProfile([v('1', null), v('2', 'not a date')]);
assert.equal(nodate.firstAt, null); assert.equal(nodate.latestAt, null); assert.deepEqual(nodate.months, []);
assert.equal(accountProfile([]).total, 0);
assert.equal(profileDate('2026-11-12T20:00:00Z'), '2026年11月13日', 'dates are shown in Japan time');
assert.equal(profileDate(null), null); assert.equal(profileDate('x'), null);
assert.equal(profileNumber(1234567), '1,234,567');
// Only the latest six months are listed.
const many = accountProfile(Array.from({ length: 9 }, (_, i) => v(String(100 + i), `2026-0${i + 1}-15T00:00:00Z`)));
assert.equal(many.months.length, 6); assert.equal(many.months[0].month, '2026-09');

// Service exposes the profile and the top videos with their text.
const { createPublicVideoService } = require('../lib/public-video-service.ts');
(async () => {
  const rows = [v('10', '2026-11-12T20:00:00Z', 500), v('11', '2026-11-01T00:00:00Z', 9000), v('12', '2026-10-15T00:00:00Z', 20)];
  const svc = createPublicVideoService({ catalog: { read: async () => ({ version: 1, revision: 1, labels: [], records: {} }) }, posts: async () => [], authorVideos: async () => rows, candidates: async () => [], secret: async () => '' });
  const d = await svc.account('a', 1);
  assert.equal(d.profile.total, 3); assert.deepEqual(d.topVideos.map(t => [t.video.id, t.views]), [['11', 9000], ['10', 500], ['12', 20]]);
  // Tag service output: profile, top authors (only when at least two) and top videos.
  const tagRows = [{ ...v('20', '2026-11-12T00:00:00Z', 300), handle: 'a', authorId: '1' }, { ...v('21', '2026-11-11T00:00:00Z', 4000), handle: 'a', authorId: '1' }, { ...v('22', '2026-11-10T00:00:00Z', 50), handle: 'b', authorId: '2', authorName: 'B' }];
  const catalogWithTag = { version: 1, revision: 1, labels: [{ id: 't1', name: 'タグ', active: true }], records: Object.fromEntries(tagRows.map(r => [r.id, { id: r.id, labelIds: ['t1'], sourceHash: 'h', basis: 'manual', modelRevision: null, labelPublishedAt: '2026-11-12T00:00:00Z', saves: 0, firstSavedAt: null, firstRankedAt: null, receipts: [] }])) };
  const tagSvc = createPublicVideoService({ catalog: { read: async () => catalogWithTag }, posts: async ids => tagRows.filter(r => ids.includes(r.id)), authorVideos: async () => [], candidates: async () => [], secret: async () => '' });
  const td = await tagSvc.tag('タグ', 1);
  assert.equal(td.profile.total, 3); assert.deepEqual(td.topVideos.map(t => t.video.id), ['21', '20', '22']);
  assert.deepEqual(td.topAuthors.map(a => [a.key, a.count]), [['a', 2], ['b', 1]]);
  const oneAuthor = createPublicVideoService({ catalog: { read: async () => catalogWithTag }, posts: async ids => tagRows.filter(r => ids.includes(r.id) && r.handle === 'a'), authorVideos: async () => [], candidates: async () => [], secret: async () => '' });
  assert.deepEqual((await oneAuthor.tag('タグ', 1)).topAuthors, [], 'a single author is not a ranking');
  // Sitemap dates: record timestamp wins; without one the post's own creation time is used; tags take the newest of their videos.
  const idx = [{ ...v('40', '2026-10-01T00:00:00Z', 1), handle: 'x', authorId: 'x' }, { ...v('41', '2026-10-05T00:00:00Z', 1), handle: 'x', authorId: 'x' }, { ...v('42', null, 1), handle: 'y', authorId: 'y' }];
  const idxCatalog = { version: 1, revision: 1, labels: [{ id: 't1', name: 'タグ', active: true }], records: { 40: { id: '40', labelIds: ['t1'], sourceHash: 'h', labelPublishedAt: '2026-11-02T00:00:00Z' }, 42: { id: '42', labelIds: ['t1'], sourceHash: 'other', labelPublishedAt: '2026-11-09T00:00:00Z' } } };
  const idxSvc = createPublicVideoService({ catalog: { read: async () => idxCatalog }, posts: async () => [], indexVideos: async () => idx, authorVideos: async () => [], candidates: async () => [], secret: async () => '' });
  const ix = await idxSvc.indexable();
  const mod = Object.fromEntries(ix.posts.map(p => [p.id, p.modifiedAt]));
  assert.equal(mod['40'], '2026-11-02T00:00:00Z'); assert.equal(mod['41'], '2026-10-05T00:00:00Z', 'no record: creation time'); assert.equal(mod['42'], undefined, 'no usable date: no lastmod');
  assert.equal(ix.tags.find(t => t.name === 'タグ').modifiedAt, '2026-11-02T00:00:00Z');
  assert.equal(ix.accounts.find(a => a.key === 'x')?.modifiedAt, '2026-11-02T00:00:00Z');
  // Related authors: same-tag authors, never the author itself, at least two or nothing.
  const mk = (id, handle) => ({ ...v(id, '2026-11-0' + (Number(id) % 9 + 1) + 'T00:00:00Z', 10), handle, authorId: handle, authorName: handle.toUpperCase() });
  const relRows = [mk('30', 'self'), mk('31', 'bob'), mk('32', 'bob'), mk('33', 'cat'), mk('34', 'dan')];
  const relCatalog = { version: 1, revision: 1, labels: [{ id: 't1', name: 'タグ', active: true }], records: Object.fromEntries(relRows.map(r => [r.id, { id: r.id, labelIds: ['t1'], sourceHash: 'h', basis: 'manual', modelRevision: null, labelPublishedAt: '2026-11-12T00:00:00Z', saves: 0, firstSavedAt: null, firstRankedAt: null, receipts: [] }])) };
  const relSvc = (rowsForPosts, own) => createPublicVideoService({ catalog: { read: async () => relCatalog }, posts: async ids => rowsForPosts.filter(r => ids.includes(r.id)), authorVideos: async () => own, candidates: async () => [], secret: async () => '' });
  const rd = await relSvc(relRows, [relRows[0]]).account('self', 1);
  assert.deepEqual(rd.relatedAuthors.map(a => [a.key, a.count]), [['bob', 2], ['cat', 1], ['dan', 1]]);
  assert.deepEqual((await relSvc(relRows.slice(0, 2), [relRows[0]]).account('self', 1)).relatedAuthors, [], 'a single related author is not listed');
  const failing = createPublicVideoService({ catalog: { read: async () => relCatalog }, posts: async () => { throw Error('db'); }, authorVideos: async () => [relRows[0]], candidates: async () => [], secret: async () => '' });
  assert.deepEqual((await failing.account('self', 1)).relatedAuthors, [], 'failure shows nothing instead of breaking the page');
  const tagPage = fs.readFileSync('app/tags/[name]/page.tsx', 'utf8');
  assert(fs.readFileSync('app/accounts/[key]/page.tsx', 'utf8').includes('d.relatedAuthors?.length'));
  assert(tagPage.includes('d.profile && d.profile.total >= 3') && tagPage.includes('"@type": "CollectionPage"') && tagPage.includes('page === 1 ?'));
  const page = fs.readFileSync('app/accounts/[key]/page.tsx', 'utf8');
  assert(page.includes('d.profile && d.profile.total >= 2') && page.includes('prof.measured >= 2'), 'thin or unmeasured accounts show no data block');
  assert(page.includes('"@type": "CollectionPage"') && page.includes('"@type": "BreadcrumbList"') && page.includes('page === 1 ?'));
  console.log('PASS ACCOUNT PROFILE: duplicates, JST months, no stats from a single number, bad dates ignored, service output, page wiring.');
})().catch(e => { console.error(e); process.exitCode = 1; });
