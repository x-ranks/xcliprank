'use strict';
const fs=require('fs/promises'),path=require('path'),os=require('os'),assert=require('assert/strict'),ts=require('typescript');
const {run}=require('./ranking-prewarm.cjs');
(async()=>{
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'twizou-prewarm-test-'));
 try{
  const calls=[];let tries=0;const bucket=1793192400000;
  const result=await run({now:()=>bucket+3000,stateRoot:scratch,sleep:async()=>{},get:async url=>{calls.push(url);if(url.includes('range=trending'))return JSON.stringify({ok:true,edition:(++tries<2?bucket-300000:bucket)+'-abcdefabcdef'});return url.startsWith('/api/')?'{"ok":true}':'<html>public fixture</html>';}});
  assert(!result.skipped);assert.equal(calls.length,7);assert(calls.every(x=>!x.includes('video')&&!x.includes('engagement')&&!x.includes('collect')));
  assert((await run({now:()=>bucket+20000,stateRoot:scratch,get:async()=>{throw Error('SHOULD_NOT_FETCH_SAME_BUCKET');}})).skipped);
  const source=await fs.readFile(path.join(__dirname,'../lib/public-thumbnail.ts'),'utf8'),module={exports:{}};new Function('module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module,module.exports);
  const thumb=module.exports.publicThumbnail;
  const image=thumb('https://pbs.twimg.com/amplify_video_thumb/123/img/sample.jpg');assert(image.src.endsWith('?name=small'));assert(image.srcSet.includes('name=medium'));
  assert(thumb('https://pbs.twimg.com/media/example?format=jpg&name=orig').src.includes('format=jpg&name=small'));
  for(const raw of ['https://example.com/image.jpg','http://pbs.twimg.com/media/a.jpg','https://pbs.twimg.com/media/a.gif','https://pbs.twimg.com/media/a.jpg?token=private','https://pbs.twimg.com.evil.invalid/media/a.jpg'])assert.deepEqual(thumb(raw),{src:raw});
  const originalFetch=global.fetch,originalWindow=global.window,originalNow=Date.now;
  let cleanup,focusEvents=0;const requests=[];let tick=bucket+10000;
  try{
   Date.now=()=>tick;global.window={setTimeout:()=>123,clearTimeout(){}};
   global.fetch=async(url,options)=>{requests.push({url,options});return new Response('fixture');};
   const navModule={exports:{}},navSource=await fs.readFile(path.join(__dirname,'../app/components/RankingNavLink.tsx'),'utf8');
   new Function('require','module','exports',ts.transpileModule(navSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(n=>n==='react'?{useRef:value=>({current:value}),useEffect:effect=>cleanup=effect()}:n==='next/link'?()=>{}:require(n),navModule,navModule.exports);
   const props=navModule.exports.default({href:'/ranking/daily?edition='+bucket+'-abcdefabcdef',onFocus:()=>focusEvents++}).props;
   assert.equal(props.prefetch,false);assert.equal(requests.length,0,'No page-load prefetch');props.onPointerEnter({pointerType:'touch'});assert.equal(requests.length,0);
   props.onFocus({});assert.equal(focusEvents,1);assert.equal(requests[0].url,'/api/rankings?range=daily&edition='+bucket+'-abcdefabcdef');assert.equal(requests[0].options.cache,'no-store');
   props.onTouchStart({});assert.equal(requests.length,1,'Repeated intent within 15 seconds is coalesced');tick+=16000;props.onTouchStart({});assert.equal(requests.length,2);cleanup();assert(requests[1].options.signal.aborted,'Unmount cancels pending metadata prefetch');await new Promise(resolve=>setImmediate(resolve));
   for(const [href,url] of [["/","/api/rankings?range=trending&page=1"],["/ranking/daily","/api/rankings?range=daily"],["/ranking/weekly","/api/rankings?range=weekly"]]){
    const nav=navModule.exports.default({href}).props;
    const before=requests.length;
    assert.equal(nav.prefetch,false);
    nav.onFocus({});
    assert.equal(requests.length,before+1);
    assert.equal(requests.at(-1).url,url);
    cleanup();
   }
   await new Promise(resolve=>setImmediate(resolve));
  }finally{global.fetch=originalFetch;global.window=originalWindow;Date.now=originalNow;}
  console.log('PASS prewarm once per edition, delayed readiness retry, known public paths only, safe CDN thumbnail variants and external/signed/GIF preservation; no real network');
 }finally{await fs.rm(scratch,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
