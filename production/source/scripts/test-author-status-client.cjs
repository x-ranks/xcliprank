const fs=require('fs'),assert=require('node:assert/strict'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('app/components/useSuspendedAuthors.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let state=[],effect,timer,listeners=new Map(),controller,requestCount=0,result={ok:true,blockedKeys:['id:123']},fail=false;
const react={useState:()=>[state,update=>{state=update(state);}],useEffect:fn=>{effect=fn;}};
global.document={hidden:false,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{assert.equal(listeners.get(type),fn);listeners.delete(type);}};
global.window={setInterval:(fn,ms)=>{assert.equal(ms,900000);timer=fn;return 10;},clearInterval:id=>{assert.equal(id,10);timer=null;}};
global.fetch=async (url,options)=>{assert.equal(url,'/api/rankings?range=author-status');assert.equal(options.cache,'no-store');controller=options.signal;requestCount++;if(fail)throw Error('network');return Response.json(result);};
const m={exports:{}};new Function('require','module','exports',code)(n=>n==='react'?react:require(n),m,m.exports);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 m.exports.default();const cleanup=effect();await settle();assert.deepEqual(state,['id:123']);
 const unchanged=state;timer();await settle();assert.equal(state,unchanged,'no extra rendering for unchanged state');
 document.hidden=true;const before=requestCount;timer();await settle();assert.equal(requestCount,before);
 document.hidden=false;fail=true;listeners.get('visibilitychange')();await settle();assert.deepEqual(state,['id:123']);
 fail=false;result={ok:true,blockedKeys:['post:456']};timer();await settle();assert.deepEqual(state,['post:456']);result={ok:true,blockedKeys:[]};timer();await settle();assert.deepEqual(state,[]);
 cleanup();assert.equal(controller.aborted,true);assert.equal(timer,null);assert.equal(listeners.size,0);
 console.log('PASS LIVE STATUS CLIENT: internal JSON only, visible-page 15-minute refresh, same-state dedup, hidden-page pause, network failure retains blocks, restoration, abort/listener/timer cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;});
