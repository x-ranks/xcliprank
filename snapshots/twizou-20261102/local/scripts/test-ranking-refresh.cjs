'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript');const m={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/ranking-read-cache.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
(async()=>{
 let now=0,release;const cache=m.exports.createRankingReadCache({now:()=>now}),one=await cache.get('same',async()=>Response.json({value:1}));assert.equal((await one.json()).value,1);
 now=16000;const pending=cache.refresh('same',()=>new Promise(r=>release=()=>r(Response.json({value:2}))));
 assert.equal((await (await cache.get('same',()=>{throw Error('OLD_STILL_VALID');})).json()).value,1);
 release();await pending;now=44000;assert.equal((await (await cache.get('same',()=>{throw Error('NEW_STILL_VALID');})).json()).value,2);
 now=47000;assert.equal((await cache.get('same',async()=>Response.json({error:'unavailable'},{status:503}))).status,503,'Expired result is not used on producer failure');
 console.log('PASS proactive ranking refresh: old data only within original validity, refreshed result replaces atomically, expiry still refuses stale on error');
})().catch(e=>{console.error(e);process.exitCode=1;});
