'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const follows = require('../lib/follows.ts');
const { readFollowKeys } = require('../lib/follow-request.ts');
const { safePublicReturn } = require('../lib/public-return-navigation.ts');
const nav = require('../lib/engagement-navigation.ts');
const { createPublicVideoService } = require('../lib/public-video-service.ts');
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => void m.set(k, String(v)) }; };

// Local follows: valid keys only, newest first, de-duplicated, limited.
const s = store();
assert.deepEqual(follows.readFollows(s), []);
assert.equal(follows.setFollow(s, 'alice_1', true), true);
assert.equal(follows.setFollow(s, 'id-12345', true), true);
assert.equal(follows.setFollow(s, 'alice_1', true), true);
assert.deepEqual(follows.readFollows(s), ['alice_1', 'id-12345']);
assert.equal(follows.setFollow(s, 'Alice', true), false, 'upper case is not a canonical key');
assert.equal(follows.setFollow(s, '../x', true), false);
assert.equal(follows.setFollow(s, 'alice_1', false), true);
assert.deepEqual(follows.readFollows(s), ['id-12345']);
const full = store(); for (let i = 0; i < follows.FOLLOW_LIMIT; i++) assert.equal(follows.setFollow(full, 'user' + i, true), true);
assert.equal(follows.setFollow(full, 'extra', true), false, 'limit reached');
assert.equal(follows.setFollow(full, 'user3', true), true, 'an existing follow can be re-saved at the limit');
assert.equal(follows.readFollows(full).length, follows.FOLLOW_LIMIT);
assert.deepEqual(follows.readFollows({ getItem: () => '{broken', setItem() {} }), []);
assert.equal(follows.setFollow({ getItem: () => null, setItem() { throw Error('quota'); } }, 'bob', true), false);
// Seen marker and NEW rule.
assert.equal(follows.readFollowSeen(store()), 0);
const seen = store(); follows.writeFollowSeen(seen, 1000.9); assert.equal(follows.readFollowSeen(seen), 1000);
assert.equal(follows.isNewForFollower('2026-11-12T00:00:00Z', 0), false, 'first look marks nothing new');
assert.equal(follows.isNewForFollower('2026-11-12T00:00:00Z', Date.parse('2026-11-11T00:00:00Z')), true);
assert.equal(follows.isNewForFollower('2026-11-10T00:00:00Z', Date.parse('2026-11-11T00:00:00Z')), false);
assert.equal(follows.isNewForFollower(null, 5), false);

// Request guard.
const req = (body, headers = {}) => new Request('https://twizou.net/api/follow-feed', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
(async () => {
  assert.deepEqual(await readFollowKeys(req(JSON.stringify({ keys: ['a', 'id-9'] }))), ['a', 'id-9']);
  await assert.rejects(readFollowKeys(req(JSON.stringify({ keys: ['Bad'] }))), /INVALID/);
  await assert.rejects(readFollowKeys(req(JSON.stringify({ keys: Array(31).fill('a') }))), /INVALID/);
  await assert.rejects(readFollowKeys(req(JSON.stringify({ keys: [], pad: 'x'.repeat(1300) }))), /INVALID/);
  await assert.rejects(readFollowKeys(req(JSON.stringify({ keys: ['a'] }), { origin: 'https://untrusted.invalid' })), /INVALID/);
  await assert.rejects(readFollowKeys(req(JSON.stringify({ keys: ['a'] }), { 'sec-fetch-site': 'cross-site' })), /INVALID/);
  await assert.rejects(readFollowKeys(new Request('https://twizou.net/api/follow-feed', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })), /INVALID/);

  // Navigation wiring.
  assert.equal(safePublicReturn('/following'), '/following');
  assert.equal(safePublicReturn('/following?x=1'), null);
  assert.ok(nav.publicEngagementPath('/following'));
  assert.equal(nav.engagementRange('/following'), 'following');

  // Service: newest first across accounts, hidden videos dropped, other accounts ignored, per-account cache.
  const video = (id, handle, createdAt, extra = {}) => ({ id, authorId: handle === 'bob' ? '2' : '1', handle, authorName: handle, text: 't' + id, posterUrl: 'https://pbs.twimg.com/x', videoUrl: 'https://video.twimg.com/x.mp4', createdAt, sourceHash: 'h', eligible: true, ...extra });
  const data = { alice: [video('1001', 'alice', '2026-11-10T00:00:00Z'), video('1002', 'alice', '2026-11-12T00:00:00Z'), video('1003', 'alice', '2026-11-13T00:00:00Z', { eligible: false })],
    bob: [video('2001', 'bob', '2026-11-11T00:00:00Z'), video('1001', 'alice', '2026-11-10T00:00:00Z'), video('9999', 'carol', '2026-11-20T00:00:00Z')] };
  let calls = 0;
  const svc = createPublicVideoService({ catalog: { read: async () => ({ version: 1, revision: 1, labels: [], records: {} }) }, posts: async () => [], authorVideos: async key => { calls++; if (key === 'broken') throw Error('PUBLIC_DATABASE_UNAVAILABLE'); return data[key] ?? []; }, candidates: async () => [], secret: async () => '' });
  const feed = await svc.followFeed(['alice', 'bob']);
  assert.deepEqual(feed.videos.map(v => v.id), ['1002', '2001', '1001']);
  assert.deepEqual(feed.failedKeys, []);
  assert.deepEqual(Object.keys(feed.videos[0]).sort(), ['authorName', 'createdAt', 'handle', 'id', 'posterUrl', 'text']);
  const before = calls; await svc.followFeed(['alice', 'bob']); assert.equal(calls, before, 'second request within two minutes reads the cache');
  const partial = await svc.followFeed(['alice', 'broken']);
  assert.deepEqual(partial.failedKeys, ['broken']); assert.deepEqual(partial.videos.map(v => v.id), ['1002', '1001']);
  assert.deepEqual((await svc.followFeed([])).videos, []);
  await assert.rejects(svc.followFeed(['Bad Key']), /INVALID/);
  await assert.rejects(svc.followFeed(Array(31).fill('a')), /INVALID/);

  // Wiring in pages.
  const read = f => fs.readFileSync(f, 'utf8');
  assert(read('app/accounts/[key]/page.tsx').includes('<FollowButton accountKey={d.canonicalKey} />'));
  assert(read('app/p/[id]/page.tsx').includes('<FollowButton accountKey={accountKey(v)!} compact />'), 'video page has the follow button');
  { const src = read('app/p/[id]/page.tsx'), css = read('app/globals.css'); assert(src.indexOf('post-author-follow') > src.indexOf('public-post-player') && src.indexOf('post-author-follow') < src.indexOf('<PostActionBar'), 'follow sits right under the player and above the actions'); assert(/\.public-post-page \.public-post-player video \{ max-height:46svh;/.test(css), 'on phones the player is capped so follow and save stay on the first screen'); }
  assert(read('app/components/SiteBrand.tsx').includes('href="/following"'));
  assert(read('app/following/page.tsx').includes('<FollowFeed />') && read('app/following/page.tsx').includes('index: false'));
  assert(read('app/components/FollowFeed.tsx').startsWith('"use client"') && read('app/components/FollowButton.tsx').startsWith('"use client"'));
  // The public allow-list is deny-by-default: new routes answer 404 unless listed there.
  const middleware = read('middleware.ts');
  assert(middleware.includes('"/following",') && middleware.includes('"/api/follow-feed",'), 'new routes must be on the public allow-list');
  console.log('PASS FOLLOWS: local follows, NEW rule, request guard, feed order/cache/visibility, navigation and page wiring.');
})().catch(e => { console.error(e); process.exitCode = 1; });
