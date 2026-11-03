'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),Module=require('module'),ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createRangeVideoSession}=require('../lib/video-range-session.ts'),source='https://video.twimg.com/synthetic.mp4';
function fixture(changes={}){const size=1024*1024,data=Buffer.alloc(size,3);let n=0;return async(url,options)=>{assert.equal(url,source);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers['Accept-Encoding'],'identity');const m=options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);assert(m);n++;const start=+m[1],end=Math.min(+m[2],size-1),body=data.subarray(start,end+1);if(changes.status)return new Response(body,{status:changes.status});return new Response(changes.truncated?body.subarray(0,-1):body,{status:206,headers:{'content-range':changes.badRange?'bytes 1-10/100':`bytes ${start}-${end}/${size}`,'content-length':body.length,'etag':changes.changed&&n>1?'"changed"':'"fixture"'}});};}
async function main(){
 let session=await createRangeVideoSession(source,{fetcher:fixture()});try{
  let r=await fetch(session.url,{headers:{Range:'bytes=100-199'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,100);assert.equal(session.metrics().receivedBytes,256*1024);assert(session.metrics().cacheHits>0);
  r=await fetch(session.url,{method:'HEAD'});assert.equal(r.headers.get('content-length'),'1048576');
  r=await fetch(session.url,{headers:{Range:'bytes=0-10',Origin:'https://foreign.invalid'}});assert.equal(r.status,404);
  assert.equal((await fetch(session.url.replace(/\/[a-f0-9]+$/,'/bad'),{headers:{Range:'bytes=0-1'}})).status,404);
  assert.equal((await fetch(session.url)).status,416);assert.equal((await fetch(session.url,{headers:{Range:'bytes=0-1,4-5'}})).status,416);
 }finally{await session.close();}
 for(const options of [{status:200},{status:403},{status:404},{badRange:true},{truncated:true}])await assert.rejects(createRangeVideoSession(source,{fetcher:fixture(options)}),/VIDEO_/);
 session=await createRangeVideoSession(source,{fetcher:fixture(),maxBytes:256*1024});try{assert.equal((await fetch(session.url,{headers:{Range:'bytes=262144-'}})).status,502);assert.equal(session.failure().message,'VIDEO_RANGE_BUDGET_EXCEEDED');assert.equal(session.metrics().receivedBytes,256*1024);}finally{await session.close();}
 session=await createRangeVideoSession(source,{fetcher:fixture({changed:true})});try{assert.equal((await fetch(session.url,{headers:{Range:'bytes=262144-'}})).status,502);assert.equal(session.failure().message,'VIDEO_RANGE_SOURCE_CHANGED');}finally{await session.close();}
 await assert.rejects(createRangeVideoSession('http://127.0.0.1/private',{fetcher:()=>{throw Error('MUST_NOT_FETCH');}}),/UNSUPPORTED_VIDEO_URL/);
 console.log('PASS RANGE SESSION: bounded finite credential-free requests, 206-only, cache, token/origin/range guards, ignored ranges/status/shape/truncation/source changes/budget refusal; in-memory fixture and loopback only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
