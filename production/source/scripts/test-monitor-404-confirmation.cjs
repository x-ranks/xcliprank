'use strict';
// Real 2026 FxTwitter 404 shape (no message): still needs two separated observations and a healthy control. Fixture only.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { scanAvailabilityStatuses } = require('../lib/availability-scan.ts');
const { unavailableKeys } = require('../lib/post-status-store.ts');
const HOUR = 3600000;
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xclip-404-'));
process.env.XCLIP_FREE_CURATED_STATE_DIR = path.join(mk(), 'manual');
const rows = [{ x_post_id: '9002', author_id: '123', author_username: 'fixture' }, { x_post_id: '9001', author_id: '123', author_username: 'fixture' }];
const real404 = () => Response.json({ status: null, thread: null, author: null, code: 404 }, { status: 404 });
const publicPost = id => Response.json({ code: 200, status: { type: 'status', provider: 'twitter', id, text: 't', author: { id: '123', screen_name: 'fixture', protected: false }, media: { videos: [{ type: 'video', url: 'https://video.twimg.com/a.mp4' }] } } });
const profile = () => Response.json({ code: 200, user: { type: 'profile', id: '123', screen_name: 'fixture', protected: false } });
const run = async (dir, now, gone) => scanAvailabilityStatuses(async () => rows, { directory: dir, now: () => now, pause: async () => {}, loadPriority: async () => [rows[1]], // 9001 doubles as the healthy control
  
  fetcher: async url => url.includes('/profile/') ? profile() : gone(url.split('/').at(-1)) });
(async () => {
  // 1) 9002 is gone, 9001 is a healthy control: first sighting is only a candidate; the second (>=1h later) excludes it.
  let dir = mk(), now = 100 * 86400000;
  let r = await run(dir, now, id => id === '9002' ? real404() : publicPost(id));
  assert.equal(r.post_missing, 1); assert.equal(r.post_hidden, 0); assert.equal((await unavailableKeys(dir)).has('post:9002'), false, 'one sighting must not exclude');
  r = await run(dir, now + 2 * HOUR, id => id === '9002' ? real404() : publicPost(id));
  assert.equal(r.post_hidden, 1); assert((await unavailableKeys(dir)).has('post:9002'), 'second separated sighting excludes');
  // 2) provider-wide 404 with no healthy control: nothing is ever excluded.
  dir = mk(); now = 200 * 86400000;
  await run(dir, now, () => real404()); r = await run(dir, now + 2 * HOUR, () => real404());
  assert.equal(r.post_hidden, 0); assert.equal((await unavailableKeys(dir)).size, 0, 'outage must not exclude anything');
  // 3) 401 (owner-restricted) follows the same path.
  dir = mk(); now = 300 * 86400000; const r401 = () => Response.json({ code: 401 }, { status: 401 });
  await run(dir, now, id => id === '9002' ? r401() : publicPost(id)); r = await run(dir, now + 2 * HOUR, id => id === '9002' ? r401() : publicPost(id));
  assert.equal(r.post_hidden, 1); assert((await unavailableKeys(dir)).has('post:9002'));
  console.log('PASS 404/401 CONFIRMATION: single sighting never excludes, second separated sighting with healthy control does, provider-wide 404 never excludes. Fixture only.');
})().catch(e => { console.error(e); process.exitCode = 1; });
