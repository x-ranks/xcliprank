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
  const page = fs.readFileSync('app/accounts/[key]/page.tsx', 'utf8');
  assert(page.includes('d.profile && d.profile.total >= 2') && page.includes('d.profile.measured >= 2'), 'thin or unmeasured accounts show no data block');
  assert(page.includes('"@type": "CollectionPage"') && page.includes('"@type": "BreadcrumbList"') && page.includes('page === 1 ?'));
  console.log('PASS ACCOUNT PROFILE: duplicates, JST months, no stats from a single number, bad dates ignored, service output, page wiring.');
})().catch(e => { console.error(e); process.exitCode = 1; });
