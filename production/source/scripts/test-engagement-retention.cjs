'use strict';
const fs = require('fs'), assert = require('node:assert/strict'), ts = require('typescript');
const load = file => { const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(m, m.exports, n => n.endsWith('engagement-surface') ? load('lib/engagement-surface.ts') : require(n)); return m.exports; };
const surface = load('lib/engagement-surface.ts'), retention = load('lib/engagement-retention.ts');

// Surface detection: installed app wins, then app browsers that announce themselves, else a normal browser.
assert.equal(surface.detectSurface(true, 'Mozilla/5.0 Twitter for iPhone'), 'installed');
assert.equal(surface.detectSurface(false, 'Mozilla/5.0 (iPhone) AppleWebKit Mobile Twitter for iPhone'), 'x-app');
assert.equal(surface.detectSurface(false, 'Mozilla/5.0 (Linux; Android 14; wv) Chrome Mobile TwitterAndroid'), 'x-app');
assert.equal(surface.detectSurface(false, 'Mozilla/5.0 (iPhone) Mobile Safari Line/13.0'), 'other-app');
assert.equal(surface.detectSurface(false, 'Mozilla/5.0 (Linux; Android 14; Pixel; wv) Chrome/120'), 'other-app');
assert.equal(surface.detectSurface(false, 'Mozilla/5.0 (iPhone) Version/17 Mobile Safari/604.1'), 'browser');
assert.equal(surface.detectSurface(false, undefined), 'browser');
assert.equal(surface.isStandaloneDisplay({ matchMedia: () => ({ matches: true }) }), true);
assert.equal(surface.isStandaloneDisplay({ navigator: { standalone: true } }), true);
assert.equal(surface.isStandaloneDisplay({ matchMedia() { throw Error('x'); } }), false);
assert.equal(surface.isStandaloneDisplay({}), false);

// Retention grouping by first source and surface, with bounce visits.
const at = (d, h = 3) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
const row = (user, session, type, day, meta = {}) => ({ occurred_at: at(day), event_type: type, anonymous_id_hash: user, session_id: session, metadata: meta });
const rows = [
  row('x1', 's1', 'page_view', 5, { referrerHost: 't.co', surface: 'x-app' }), row('x1', 's1', 'video_open', 5, { referrerHost: 't.co', surface: 'x-app' }),
  row('x1', 's2', 'page_view', 8, { surface: 'installed' }), row('x1', 's2', 'video_open', 8, { surface: 'installed' }),
  row('x2', 's3', 'page_view', 5, { utmSource: 'x', surface: 'x-app' }),
  row('g1', 's4', 'page_view', 5, { referrerHost: 'www.google.com', surface: 'browser' }), row('g1', 's4', 'video_open', 5, {}),
  row('d1', 's5', 'page_view', 6, {}), row('d1', 's5', 'page_view', 6, {}),
  row('d1', 's6', 'page_view', 7, { referrerHost: 'x.com' }), row('d1', 's6', 'video_open', 7, { referrerHost: 'x.com' })
];
const r = retention.summarizeRetention(rows);
assert.deepEqual({ ...r.returnByAcquisition.x }, { users: 3, returningUsers: 2 }, 'x1 and d1 (direct then X) both counted under x; x2 once');
assert.deepEqual({ ...r.returnByAcquisition['referral:www.google.com'] }, { users: 1, returningUsers: 0 });
assert.deepEqual({ ...r.returnBySurface.installed }, { users: 1, returningUsers: 1 }, 'installed wins over the earlier x-app visit');
assert.deepEqual({ ...r.returnBySurface['x-app'] }, { users: 1, returningUsers: 0 });
assert.deepEqual({ ...r.returnBySurface.unknown }, { users: 1, returningUsers: 1 }, 'older rows without a surface are grouped as unknown');
assert.equal(r.bounce.sessions, 6);
assert.equal(r.bounce.bounceSessions, 1, 'only s3: one page, no video; s5 browsed two pages');
assert.equal(r.bounce.bounceRate, 16.7);
console.log('PASS ENGAGEMENT RETENTION: surface detection, first-source and surface return rates, bounce visits.');
