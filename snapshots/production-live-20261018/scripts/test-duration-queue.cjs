const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
const pending=[];const m={exports:{}};
const code=ts.transpileModule(fs.readFileSync('app/components/VideoDurationBadge.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','module','exports',code+'\nexports.acquire=acquireDuration;')((n)=>n.endsWith('browser-direct-playback')?{readPostVideoDuration:(id,signal)=>new Promise(resolve=>{pending.push({id,signal,resolve});signal.addEventListener('abort',()=>resolve(null),{once:true});})}:n.includes('video-duration-format')?{}:n==='react'?{}:n==='react/jsx-runtime'?{}:require(n),m,m.exports);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const a=m.exports.acquire('123'),same=m.exports.acquire('123'),b=m.exports.acquire('124'),queued=m.exports.acquire('125');
 assert.equal(pending.length,2);assert.equal(pending[0].id,'123');
 a.release();assert.equal(pending[0].signal.aborted,false);
 queued.release();assert.equal(await queued.promise,null);
 same.release();assert.equal(pending[0].signal.aborted,true);await tick();assert.equal(pending.length,2);
 pending[1].resolve(125.033);assert.equal(await b.promise,125.033);await tick();b.release();
 const cached=m.exports.acquire('124');assert.equal(await cached.promise,125.033);assert.equal(pending.length,2);cached.release();
 const failed=m.exports.acquire('126');pending[2].resolve(null);assert.equal(await failed.promise,null);await tick();failed.release();
 const failureCached=m.exports.acquire('126');assert.equal(await failureCached.promise,null);assert.equal(pending.length,3);failureCached.release();
 console.log('PASS DURATION QUEUE: two concurrent lookups, deduplication, unmount cancellation, positive/negative cache.');
})().catch(e=>{console.error(e);process.exitCode=1;});
