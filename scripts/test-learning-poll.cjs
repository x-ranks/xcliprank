const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const base=path.resolve(__dirname,'..');
const deps=process.env.XCLIP_TEST_DEPENDENCY_ROOT||base;
const ts=createRequire(path.join(deps,'package.json'))('typescript');
function moduleAt(rel,imports={},globals={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(base,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,require:n=>{if(n in imports)return imports[n];throw Error('UNEXPECTED_IMPORT '+n);},...globals},{filename:rel});return exports;
}
const {startLearningLoop}=moduleAt('lib/personal-learning-poll.ts');
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function clock(){
 let now=0,serial=0;const tasks=new Map();
 return {schedule:(fn,delay)=>{const id=++serial;tasks.set(id,{fn,at:now+delay});return id;},cancel:id=>tasks.delete(id),
  async advance(ms){const end=now+ms;let turns=0;while(true){await flush();const next=[...tasks].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;if(++turns>20000)throw Error('TIMER_LOOP');tasks.delete(next[0]);now=next[1].at;next[1].fn();}now=end;await flush();},
  pending:()=>tasks.size,now:()=>now};
}
function locks(){let held=false;return {request:(_name,_options,callback)=>{
 if(held)return Promise.resolve(callback(null));held=true;
 return Promise.resolve(callback({name:'test'})).finally(()=>{held=false;});
}};}
function worker(c,step,manager){const messages=[],listeners=new Set();let requests=0;
 const stop=startLearningLoop({step:async()=>{requests++;return step();},message:m=>messages.push(m),locks:manager,
  wake:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},schedule:c.schedule,cancel:c.cancel});
 return {stop,messages,count:()=>requests,wake:()=>{for(const fn of listeners)fn();},listeners};}

(async()=>{
 // Real controller, fake time/HTTP. Idle multi-tab requests are counted across a full day.
 const c=clock(),manager=locks();const a=worker(c,()=>({newVideosIdle:true}),manager),b=worker(c,()=>({newVideosIdle:true}),manager);
 await flush();assert.equal(a.count(),1);assert.equal(b.count(),0);
 await c.advance(86400000);assert(a.count()<=300);assert.equal(b.count(),0);
 const idleDaily=a.count();a.stop();await flush();await c.advance(15000);assert.equal(b.count(),1);
 b.stop();await flush();assert.equal(c.pending(),0);assert.equal(a.listeners.size,0);

 const workClock=clock();let kind='work';const active=worker(workClock,()=>kind==='work'?{remaining:2}:{newVideosIdle:true});
 await flush();await workClock.advance(4500);assert.equal(active.count(),4);
 kind='idle';await workClock.advance(1500);const before=active.count();await workClock.advance(29999);assert.equal(active.count(),before);
 active.wake();await flush();assert.equal(active.count(),before+1);active.stop();await flush();assert.equal(workClock.pending(),0);

 for(const result of [{paused:true},{newVideosPaused:true}]){
  const pc=clock(),p=worker(pc,()=>result);await flush();await pc.advance(299999);assert.equal(p.count(),1);await pc.advance(1);assert.equal(p.count(),2);p.stop();
 }
 const busyClock=clock(),busy=worker(busyClock,()=>({busy:true}));await flush();await busyClock.advance(29999);assert.equal(busy.count(),1);await busyClock.advance(1);assert.equal(busy.count(),2);busy.stop();
 const errClock=clock(),err=worker(errClock,()=>{throw Error('MOCK_ERROR');});await flush();await errClock.advance(29999);assert.equal(err.count(),1);await errClock.advance(1);assert.equal(err.count(),2);err.stop();
 const videoClock=clock(),video=worker(videoClock,()=>({newVideoProcessed:true}));await flush();await videoClock.advance(4999);assert.equal(video.count(),1);await videoClock.advance(1);assert.equal(video.count(),2);video.stop();

 // Wake during work does not overlap requests. Stop retains the lock until settlement.
 const pendingClock=clock(),pendingManager=locks();let resolve;
 const pending=worker(pendingClock,()=>new Promise(r=>{resolve=r;}),pendingManager);
 const next=worker(pendingClock,()=>({newVideosIdle:true}),pendingManager);
 await flush();pending.wake();pending.wake();assert.equal(pending.count(),1);pending.stop();
 await pendingClock.advance(15000);assert.equal(next.count(),0);
 resolve({finished:true});await flush();await pendingClock.advance(15000);assert.equal(next.count(),1);
 assert.equal(pending.messages.length,0);next.stop();await flush();assert.equal(pendingClock.pending(),0);
 const lockErrorClock=clock(),lockError=worker(lockErrorClock,()=>({}),{request:()=>Promise.reject(Error('LOCK_FAILED'))});await flush();await lockErrorClock.advance(60000);assert.equal(lockError.count(),0);lockError.stop();

 // Execute the actual TSX effect with mocked browser/React, rather than a source-text test.
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
 function render(rel,hostname,shared={}){
  const effects=[],cleanup=[],calls=[],listeners=new Map(),cc=shared.clock||clock();let hidden=false;
  const win={addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n),dispatchEvent:e=>{listeners.get(e.type)?.();}};
  const doc={get visibilityState(){return hidden?'hidden':'visible';},addEventListener:win.addEventListener,removeEventListener:win.removeEventListener};
  const globals={location:{hostname},navigator:{locks:shared.manager||locks()},window:win,document:doc,setTimeout:cc.schedule,clearTimeout:cc.cancel,AbortController,Event,BroadcastChannel:shared.Channel,
   fetch:async(url,opts={})=>{calls.push({url,method:opts.method||'GET',body:opts.body});return {ok:true,json:async()=>opts.method==='POST'?{newVideosIdle:true}:{enabled:true,status:null,release:null}};}};
  const react={useEffect:fn=>effects.push(fn),useState:v=>[typeof v==='function'?v():v,()=>{}],useCallback:fn=>fn};
  const clientLoop=moduleAt('lib/personal-learning-poll.ts',{}, {setTimeout:cc.schedule,clearTimeout:cc.cancel});
  const imports={'react':react,'react/jsx-runtime':jsx,'next/link':{default:()=>null},'../../lib/personal-learning-poll':clientLoop,'../components/PersonalLearningWorker':{default:()=>null}};
  const mod=moduleAt(rel,imports,globals);mod.default();for(const effect of effects){const f=effect();if(f)cleanup.push(f);}
  return {calls,cc,wake:()=>win.dispatchEvent(new Event('xclip-personal-learning-wake')),hide:()=>{hidden=true;},show:()=>{hidden=false;listeners.get('visibilitychange')?.();},stop:()=>cleanup.forEach(f=>f()),listeners};
 }
 const actual=render('app/components/PersonalLearningWorker.tsx','localhost');await flush();assert.equal(actual.calls.length,1);assert.equal(actual.calls[0].method,'POST');assert.equal(JSON.parse(actual.calls[0].body).action,'step');actual.stop();await flush();assert.equal(actual.listeners.size,0);
 const prod=render('app/components/PersonalLearningWorker.tsx','xcliprank.com');await flush();assert.equal(prod.calls.length,0);prod.stop();
 const page=render('app/tier-personal-model/page.tsx','localhost');await flush();assert.equal(page.calls.length,1);
 await page.cc.advance(59999);assert.equal(page.calls.length,1);await page.cc.advance(1);assert.equal(page.calls.length,2);
 page.hide();await page.cc.advance(180000);assert.equal(page.calls.length,2);page.show();await flush();assert.equal(page.calls.length,3);page.stop();await page.cc.advance(120000);assert.equal(page.calls.length,3);assert.equal(page.listeners.size,0);
 const channels=new Set();class Channel{constructor(){this.listeners=new Set();channels.add(this);}addEventListener(_n,fn){this.listeners.add(fn);}removeEventListener(_n,fn){this.listeners.delete(fn);}postMessage(){for(const other of channels)if(other!==this)for(const fn of other.listeners)fn();}close(){channels.delete(this);}}
 const shared={clock:clock(),manager:locks(),Channel};const leader=render('app/components/PersonalLearningWorker.tsx','localhost',shared),follower=render('app/components/PersonalLearningWorker.tsx','localhost',shared);
 await flush();assert.equal(leader.calls.length,1);assert.equal(follower.calls.length,0);await shared.clock.advance(210000);const count=leader.calls.length;follower.wake();await flush();assert.equal(leader.calls.length,count+1);assert.equal(follower.calls.length,0);leader.stop();follower.stop();await flush();assert.equal(channels.size,0);assert.equal(shared.clock.pending(),0);
 console.log('PASS LEARNING POLL: real controller and TSX effects; idle 24h two-tab worker POSTs='+idleDaily+' versus old nominal 34560 GET+34560 POST; active 1.5s/5s preserved; pause/busy/errors/backoff/wake; one browser leader and handover; pending cleanup; no GET-model preflight; hidden detail polling paused; 60s visible status; local-only. HTTP/DB mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
