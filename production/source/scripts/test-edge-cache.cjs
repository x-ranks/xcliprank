'use strict';
// Edge caching of anonymous list pages: which requests may be cached, and that crawlers never are.
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { edgeCacheable, EDGE_CACHE_CONTROL } = require('../lib/edge-cache.ts');
const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
for (const p of ['/rising', '/browse', '/months', '/reels', '/months/2026-10', '/ranking/daily', '/ranking/weekly/', '/tags/abc', '/accounts/someone']) assert.equal(edgeCacheable('GET', p, ua, null), true, p + ' is cacheable');
assert.equal(edgeCacheable('HEAD', '/rising', ua, null), true);
for (const p of ['/', '/p/1850123456789', '/following', '/favorites', '/discover', '/api/push', '/api/discovery', '/tags/', '/accounts/', '/privacy', '/admin', '/sw.js']) assert.equal(edgeCacheable('GET', p, ua, null), false, p + ' is never cached');
assert.equal(edgeCacheable('POST', '/rising', ua, null), false);
for (const bot of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Google-InspectionTool/1.0', 'GoogleOther', 'AdsBot-Google']) assert.equal(edgeCacheable('GET', '/rising', bot, null), false, bot + ' is not cached');
assert.equal(edgeCacheable('GET', '/rising', ua, '1'), false, 'verified Googlebot header disables caching');
assert.equal(edgeCacheable('GET', '/rising', null, null), true);
assert.match(EDGE_CACHE_CONTROL, /s-maxage=60/); assert.match(EDGE_CACHE_CONTROL, /max-age=0/);
const mw = fs.readFileSync('middleware.ts', 'utf8');
assert(mw.includes('edgeCacheable(request.method') && mw.includes('x-twizou-verified-googlebot') && mw.includes('"Cache-Control", EDGE_CACHE_CONTROL'));
console.log('PASS EDGE CACHE: cacheable list paths, crawlers/verified Googlebot/POST/personal pages never cached, middleware wiring. Fixture only.');
