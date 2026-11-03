'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
const { buildDiscoveryIndex, selectDiscovery, matchesDiscovery } = require('../lib/discovery-index.ts');
const { createPublicVideoService } = require('../lib/public-video-service.ts');
const rows = Array.from({ length: 123 }, (_, n) => ({ id: String(n + 100), authorId: '1', handle: 'author', authorName: 'テスト作者', text: n === 0 ? 'ひとつの本文' : '共通本文', posterUrl: 'https://pbs.twimg.com/x', videoUrl: 'https://video.twimg.com/x', sourceHash: 'hash', eligible: true, adultTier: n % 2 ? 'A' : 'S', createdAt: n === 0 ? '2026-09-30T15:01:00Z' : '2026-10-01T00:00:00Z' }));
const catalog = { version: 1, revision: 1, labels: [{ id: 'tag', name: '手コキ', active: true }], records: { '100': { id: '100', sourceHash: 'hash', labelIds: ['tag'] } } };
const index = buildDiscoveryIndex(rows, catalog);
assert.deepEqual(index.months, ['2026-10']);
assert.deepEqual(selectDiscovery(index, {mode:'search',query:'手コキ',offset:0}).ids, ['100']);
assert.deepEqual(selectDiscovery(index, {mode:'search',query:'テスト作者 ひとつ',offset:0}).ids, ['100']);
assert.equal(selectDiscovery(index, {mode:'tier',tier:'S',offset:0}).ids.length, 50);
assert.throws(() => selectDiscovery(index, {mode:'search',query:''}), /INVALID/);
const shuffled = []; for (let offset=0; offset<123; offset+=50) shuffled.push(...selectDiscovery(index,{mode:'random',seed:2026,offset}).ids);
assert.equal(shuffled.length, 123); assert.equal(new Set(shuffled).size, 123);
assert.deepEqual(shuffled.slice(0,50), selectDiscovery(index,{mode:'random',seed:2026,offset:0}).ids);
assert.equal(matchesDiscovery({...rows[0],sourceHash:'changed'},catalog,{mode:'search',query:'手コキ'}),false);
async function main() {
 let fresh = rows.map(x => ({...x})), indexed = rows.map(x => ({...x}));
 const svc = createPublicVideoService({catalog:{read:async()=>catalog}, posts:async ids=>fresh.filter(x=>ids.includes(x.id)&&x.eligible), indexVideos:async()=>indexed, authorVideos:async()=>[], candidates:async()=>[], secret:async()=>''});
 fresh[0].eligible = false;
 let result = await svc.discovery({mode:'search',query:'手コキ'});
 assert.deepEqual(result.videos, []); // stale candidate cannot bypass current publication checks
 fresh[0].eligible = true; fresh[0].adultTier = 'A';
 result = await svc.discovery({mode:'tier',tier:'S'});
 assert(!result.videos.some(v=>v.id==='100')); // changed tier is rechecked
 assert(!('videoUrl' in result.videos[0])); // responses contain no media URL
 assert.deepEqual((await svc.personalVideos(['101','100'])).map(v=>v.id), ['101','100']);
 fresh[0].eligible = false;
 assert.deepEqual((await svc.personalVideos(['100','101'])).map(v=>v.id), ['101']);
 await assert.rejects(svc.personalVideos(['bad']), /INVALID/);
 let calls=0; const tierService=createPublicVideoService({catalog:{read:async()=>{throw Error('unexpected catalog read')}},posts:async()=>[],indexVideos:async()=>{throw Error('unexpected full index read')},tierPage:async(tier,offset)=>{calls++;assert.equal(tier,'A+');assert.equal(offset,50);return {videos:[{...rows[1],adultTier:'A+'}],hasMore:true}},authorVideos:async()=>[],candidates:async()=>[],secret:async()=>''});
 const tierResult=await tierService.discovery({mode:'tier',tier:'A+',offset:50});assert.equal(calls,1);assert.equal(tierResult.videos[0].id,'101');assert.equal(tierResult.nextOffset,100);
 await assert.rejects(tierService.discovery({mode:'tier',tier:'BAD',offset:0}), /INVALID/);assert.equal(calls,1);
 let release,signal;const waiting=new Promise(r=>signal=r),hold=new Promise(r=>release=r);let current=[{...rows[0],createdAt:'2026-10-01T00:00:00Z'}],reads=0;
 const concurrent=createPublicVideoService({catalog:{read:async()=>catalog},indexVideos:async()=>current,posts:async()=>{reads++;if(reads===1){signal();await hold;}return [{...rows[0]}]},authorVideos:async()=>[],candidates:async()=>[],secret:async()=>''});
 const first=concurrent.discovery({mode:'random',seed:5});await waiting;current=[{...rows[0],createdAt:'2026-09-01T00:00:00Z'}];const second=await concurrent.discovery({mode:'random',seed:5});release();const one=await first;
 assert.deepEqual(one.months,['2026-10']);assert.deepEqual(second.months,['2026-09']);
 console.log('PASS discovery: Japanese search, JST month, tier recheck, stable pagination, exclusions, personal ID order, no media URLs');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
