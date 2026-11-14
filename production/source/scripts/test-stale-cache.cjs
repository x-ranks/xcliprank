'use strict';
// Stale-while-revalidate for the video index: nobody waits for a rebuild once a value exists. Fake clock, no network.
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { createStaleCache } = require('../lib/stale-cache.ts');
const tick = () => new Promise(r => setImmediate(r));
(async () => {
  const H = 3600e3; let t = 0; const cache = createStaleCache({ freshMs: 12 * H, staleMaxMs: 24 * H, retryMs: 30e3, now: () => t });
  // First start: callers wait, and concurrent callers share one build.
  let builds = 0, release; const gate = new Promise(r => { release = r; });
  const build = value => async () => { builds++; await gate; return value; };
  const a = cache.get('k1', build(['v1'])), b = cache.get('k1', build(['x']));
  release(); assert.deepEqual(await a, ['v1']); assert.deepEqual(await b, ['v1']); assert.equal(builds, 1, 'concurrent first requests share one build');
  // Same key, still fresh: no rebuild.
  assert.deepEqual(await cache.get('k1', async () => { throw Error('must not rebuild'); }), ['v1']);
  // Key changed: the OLD value comes back immediately; one background rebuild runs; later callers get the new value.
  let finish; const slow = new Promise(r => { finish = r; }); let rebuilds = 0;
  const rebuild = async () => { rebuilds++; await slow; return ['v2']; };
  assert.deepEqual(await cache.get('k2', rebuild), ['v1'], 'stale value served at once');
  assert.deepEqual(await cache.get('k2', rebuild), ['v1'], 'still stale while rebuilding');
  assert.equal(rebuilds, 1, 'only one background rebuild at a time');
  finish(); await tick(); await tick();
  assert.deepEqual(await cache.get('k2', async () => { throw Error('must not rebuild'); }), ['v2'], 'new value after the rebuild');
  // Time-based expiry also serves stale and refreshes in the background.
  t += 13 * H; assert.deepEqual(await cache.get('k2', async () => ['v3']), ['v2']); await tick(); await tick();
  assert.deepEqual(await cache.get('k2', async () => { throw Error('no'); }), ['v3']);
  // Failed rebuild keeps the old value and is not retried more often than retryMs.
  let fails = 0; const failing = async () => { fails++; throw Error('db down'); };
  assert.deepEqual(await cache.get('k3', failing), ['v3']); await tick(); await tick();
  assert.deepEqual(await cache.get('k3', failing), ['v3']); await tick(); assert.equal(fails, 1, 'no retry within retryMs');
  t += 31e3; assert.deepEqual(await cache.get('k3', async () => ['v4']), ['v3']); await tick(); await tick();
  assert.equal(fails, 1); assert.deepEqual(await cache.get('k3', async () => { throw Error('no'); }), ['v4'], 'recovers after the retry delay');
  // Key unknown (could not be computed): keep serving the cached value; when expired, rebuild with the last known key.
  assert.deepEqual(await cache.get(null, async () => { throw Error('no'); }), ['v4']);
  // Too old (beyond staleMaxMs): callers wait for a fresh build rather than get very old data.
  t += 25 * H; assert.deepEqual(await cache.get('k3', async () => ['v5']), ['v5'], 'blocking rebuild when far too old');
  // A failed first build is not cached.
  const empty = createStaleCache({ freshMs: 1, staleMaxMs: 2, retryMs: 1, now: () => t });
  await assert.rejects(empty.get('a', async () => { throw Error('first fail'); }), /first fail/); await tick();
  assert.deepEqual(await empty.get('a', async () => ['ok']), ['ok'], 'failed first build can be retried');
  await assert.rejects(createStaleCache({ freshMs: 1, staleMaxMs: 2, retryMs: 1 }).get(null, async () => []), /STALE_CACHE_KEY_UNAVAILABLE/);
  // Wiring: the production index uses it and keeps the original error when the change marker is unreadable.
  const src = fs.readFileSync('lib/public-video-production.ts', 'utf8');
  assert(src.includes('createStaleCache') && src.includes('indexCache.get(authorFingerprint') && !src.includes('indexCache = {'), 'index goes through the stale cache');
  assert(src.includes('throw fingerprintError ?? error'));
  console.log('PASS STALE CACHE: stale value served instantly while one background rebuild runs; failures keep old data; far-too-old data rebuilds first.');
})().catch(e => { console.error(e); process.exitCode = 1; });
