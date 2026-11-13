'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { exportTransferCode, importTransferCode } = require('../lib/list-transfer.ts');
const { readVideoLists, setVideoListEntry, VIDEO_LIST_LIMIT } = require('../lib/local-video-lists.ts');
const { readFollows, setFollow, FOLLOW_LIMIT } = require('../lib/follows.ts');
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)) }; };

// Round trip: favorites keep their order, save history and follows come along.
const a = store();
for (const id of ['2068093685171142896', '2104068903244791874', '99']) setVideoListEntry(a, 'favorites', id, true);
setVideoListEntry(a, 'saveHistory', '2097100891405132202', true);
setFollow(a, 'gulililucky', true); setFollow(a, 'id-123', true);
const code = exportTransferCode(a);
assert(code.startsWith('TWZ1.') && /^[A-Za-z0-9._-]+$/.test(code), 'copy-paste safe characters only');
const b = store();
assert.deepEqual(importTransferCode(b, code), { ok: true, favorites: 3, saveHistory: 1, follows: 2 });
assert.deepEqual(readVideoLists(b), readVideoLists(a)); assert.deepEqual(readFollows(b), readFollows(a));
// Importing again adds nothing, and whitespace/line breaks from a chat app are tolerated.
assert.deepEqual(importTransferCode(b, code.replace(/(.{40})/g, '$1\n  ')), { ok: true, favorites: 0, saveHistory: 0, follows: 0 });
// Existing entries stay first; imported ones follow.
const c = store(); setVideoListEntry(c, 'favorites', '555', true); setFollow(c, 'mine', true);
importTransferCode(c, code);
assert.equal(readVideoLists(c).favorites[0], '555'); assert.equal(readVideoLists(c).favorites.length, 4); assert.equal(readFollows(c)[0], 'mine');
// Limits hold: a full favorites list or follow list takes nothing more.
const full = store(); for (let i = 0; i < FOLLOW_LIMIT; i++) setFollow(full, 'u' + i, true);
for (let i = 0; i < VIDEO_LIST_LIMIT; i++) full.setItem('twizou-video-lists-v1', JSON.stringify({ favorites: Array.from({ length: VIDEO_LIST_LIMIT }, (_, n) => String(1000 + n)), saveHistory: [] }));
assert.deepEqual(importTransferCode(full, code), { ok: true, favorites: 0, saveHistory: 1, follows: 0 });
assert.equal(readFollows(full).length, FOLLOW_LIMIT); assert.equal(readVideoLists(full).favorites.length, VIDEO_LIST_LIMIT);
// Bad input is refused without touching storage.
const d = store();
for (const bad of ['', 'hello', 'TWZ1.', 'TWZ1.!!!', 'TWZ1.' + Buffer.from('not json').toString('base64url'), 'TWZ2.' + code.slice(5), 'TWZ1.' + 'A'.repeat(200001)]) assert.deepEqual(importTransferCode(d, bad), { ok: false, reason: 'format' }, JSON.stringify(bad.slice(0, 20)));
assert.equal(d.getItem('twizou-video-lists-v1'), null);
// Hostile content inside a valid envelope is filtered by the same validators as normal entries.
const hostile = 'TWZ1.' + Buffer.from(JSON.stringify({ f: ['zzzzzzzzzzzzzzzzzzzzzzzz', '<script>', 5, '0', 'a'], s: 'x', a: ['Bad Key!', '../x', 'ok_user', 'UPPER'] })).toString('base64url');
const e = store(); const r = importTransferCode(e, hostile);
assert.equal(r.ok, true); assert.deepEqual(readFollows(e), ['ok_user']); assert.deepEqual(readVideoLists(e).saveHistory, []);
// Storage failure is reported, not thrown.
assert.deepEqual(importTransferCode({ getItem: () => null, setItem: () => { throw Error('quota'); } }, code), { ok: false, reason: 'storage' });
// Wiring.
assert(fs.readFileSync('app/favorites/page.tsx', 'utf8').includes('<TransferPanel />'));
const panel = fs.readFileSync('app/components/TransferPanel.tsx', 'utf8');
assert(panel.startsWith('"use client"') && !/fetch\(|XMLHttpRequest|sendBeacon/.test(panel), 'nothing leaves the browser');
console.log('PASS LIST TRANSFER: round trip, merge order, limits, bad/hostile codes, storage failure, wiring, no network.');
