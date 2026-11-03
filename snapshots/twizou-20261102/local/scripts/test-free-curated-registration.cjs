function registrationAck(p){return {version:1,owner:p.registrationSession,ready:p.action==='publish'?!!p.registrationComplete:false};}
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(id){if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);
const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const {startFreeRegistration:start,stepFreeRegistration:step,restartFreeRegistration:restart}=load('lib/free-curated-registration');
const {FreeCuratedError,fetchFreeMediaPage}=load('lib/fxtwitter-curated'),store=load('lib/fxtwitter-curated-store');
const profile={id:'123',username:'test',name:'Test',expectedTier:'S'};
const candidate=id=>({x_post_id:String(id),author_id:'123',author_username:'test',author_name:'Test',text:'test',possibly_sensitive:false,created_at:new Date().toISOString(),x_url:`https://x.com/test/status/${id}`,media_key:null,media_type:'video',preview_image_url:null,video_url:`https://video.twimg.com/${id}.mp4`,video_bitrate:1,views:0,likes:0,reposts:0,replies:0,quotes:0,bookmarks:0,durationSeconds:1,videoCount:1});
function fixture(){let pages=0,pauses=0,profiles=0,authFailures=false,publishFailures=0,limit=false;const published=new Set(),sent=[];let disk;
const state={version:1,cooldownUntil:0,authors:[]};
const options={persist:async s=>{disk=JSON.stringify(s)},pause:async()=>{pauses++},profile:async()=>{profiles++;return profile},
media:async(a,c,cursor,f,signal,maximum)=>{pages++;assert.equal(c,100);if(limit)throw new FreeCuratedError(429,'rate limit',7*3600000);const index=cursor?Number(cursor):0;
const posts=Array.from({length:maximum},(_,i)=>candidate(1000+index*100+i));return {posts,timelineIds:posts.map(p=>p.x_post_id),rawCount:maximum,skipped:0,multipleVideoPosts:0,nextCursor:String(index+1)}},
production:async payload=>{sent.push(payload.action);if(authFailures)throw new FreeCuratedError(401,'auth failed');if(payload.action==='registration')return {ok:true,registration:registrationAck(payload)};if(payload.action==='publish'){
for(const p of payload.candidates)published.add(p.x_post_id);if(publishFailures-- >0)throw new FreeCuratedError(502,'lost response');
return {ok:true,registration:registrationAck(payload),published:{saved:payload.candidates.length,promoted:0,excluded:0,duplicates:0}};}return {ok:true,registrationAuthorLimit:1000,registrationRecoveryVersion:1};}};
return {state,options,published,sent,get pages(){return pages},get pauses(){return pauses},get profiles(){return profiles},get disk(){return disk},set authFailures(v){authFailures=v},set publishFailures(v){publishFailures=v},set limit(v){limit=v}};}
async function finish(f,id){for(let n=0;n<65;n++){const r=await step(f.state,id,f.options);if(r.job.phase==='completed')return r}throw Error('not complete')}
(async()=>{
for(const count of [100,200,300]){const f=fixture();const r=await start(f.state,{username:'test',count,expectedTier:'S'},f.options);await finish(f,r.id);
assert.equal(f.state.authors[0].registration.scanned,count);assert.equal(f.published.size,count);assert.equal(f.pages,count/100);assert.equal(f.pauses,f.pages+1);assert.deepEqual(f.sent.slice(0,2),['status','sync']);await step(f.state,r.id,f.options);assert.equal(f.pages,count/100);assert.equal(JSON.parse(f.disk).authors[0].registration.phase,'completed');}
const preflight=fixture();preflight.authFailures=true;await assert.rejects(start(preflight.state,{username:'test',count:100,expectedTier:'S'},preflight.options),e=>e.status===401);assert.equal(preflight.profiles,0);assert.equal(preflight.state.authors.length,0);
const f=fixture();const r=await start(f.state,{username:'test',count:300,expectedTier:'S'},f.options);await step(f.state,r.id,f.options);await step(f.state,r.id,f.options);
f.publishFailures=1;await assert.rejects(step(f.state,r.id,f.options),e=>e.status===502);assert.equal(f.state.authors[0].registration.phase,'publish');assert.equal(f.pages,1);f.state.authors=JSON.parse(f.disk).authors;await finish(f,r.id);assert.equal(f.pages,3);assert.equal(f.published.size,300);
const limit=fixture();const l=await start(limit.state,{username:'test',count:100,expectedTier:'S'},limit.options);await step(limit.state,l.id,limit.options);limit.limit=true;await assert.rejects(step(limit.state,l.id,limit.options),e=>e.status===429);assert(limit.state.cooldownUntil>Date.now()+6*3600000);const pageCount=limit.pages;await assert.rejects(step(limit.state,l.id,limit.options),e=>e.status===429);assert.equal(limit.pages,pageCount);
const exhausted=fixture();exhausted.options.media=async()=>({posts:[candidate(9999)],timelineIds:['9999'],rawCount:5,skipped:4,multipleVideoPosts:0,nextCursor:null});const e=await start(exhausted.state,{username:'test',count:300,expectedTier:'S'},exhausted.options);await finish(exhausted,e.id);assert.equal(exhausted.state.authors[0].registration.scanned,5);
const blank=fixture();blank.options.media=async()=>({posts:[],timelineIds:[],rawCount:0,skipped:0,multipleVideoPosts:0,nextCursor:'gap'});const b=await start(blank.state,{username:'test',count:100,expectedTier:'S'},blank.options);await step(blank.state,b.id,blank.options);await assert.rejects(step(blank.state,b.id,blank.options),e=>e.status===502);assert.equal(blank.state.authors[0].registration.phase,'fetch');assert.equal(blank.state.authors[0].registration.scanned,0);assert.equal(blank.published.size,0);
const cycle=fixture();cycle.options.media=async()=>({posts:[],timelineIds:['9999'],rawCount:20,skipped:20,multipleVideoPosts:0,nextCursor:'same'});const c=await start(cycle.state,{username:'test',count:300,expectedTier:'S'},cycle.options);await step(cycle.state,c.id,cycle.options);await step(cycle.state,c.id,cycle.options);await step(cycle.state,c.id,cycle.options);await assert.rejects(step(cycle.state,c.id,cycle.options),e=>e.status===502);
const existing=fixture();existing.state.authors=[{...profile,paused:false,addedAt:new Date().toISOString(),checkedAt:null,nextCursor:null,candidates:[],rawCount:0,skipped:0,savedTotal:0,lastSavedAt:null,error:null}];const old=await restart(existing.state,'123',200,existing.options);await finish(existing,old.id);assert.equal(existing.published.size,200);
for(const count of [0,20,400]){const f=fixture();await assert.rejects(start(f.state,{username:'test',count,expectedTier:'S'},f.options),e=>e.status===400);}
const raw=Array.from({length:100},(_,i)=>({type:'status',provider:'twitter',id:String(5000+i),text:'test',author:{id:'123',protected:false},created_timestamp:Date.now()/1000,possibly_sensitive:false,media:{videos:[{type:'video',format:'video/mp4',url:`https://video.twimg.com/${i}.mp4`}]}}));const sliced=await fetchFreeMediaPage(profile,100,null,async()=>Response.json({code:200,results:raw,cursor:{bottom:'cursor'}}),undefined,17);assert.equal(sliced.rawCount,17);assert.equal(sliced.posts.length,17);
const tmp=await fs.promises.mkdtemp(path.join(require('os').tmpdir(),'xclip-registration-'));try{await store.writeFreeRegistry(f.state,tmp);const stored=await store.readFreeRegistry(tmp);assert.equal(stored.authors[0].registration.scanned,300);stored.authors[0].registration.phase='bad';await store.writeFreeRegistry(stored,tmp);await assert.rejects(store.readFreeRegistry(tmp),e=>e.status===503);}finally{await fs.promises.rm(tmp,{recursive:true,force:true})}
// Exercise the actual local route and durable registry with mocked provider/production transports.
const cwd=process.cwd(),oldMode=process.env.NODE_ENV,nativeTimer=global.setTimeout;
const routeDir=await fs.promises.mkdtemp(path.join(require('os').tmpdir(),'xclip-registration-route-'));
try{
 process.chdir(routeDir);process.env.NODE_ENV='development';global.setTimeout=(fn,ms,...args)=>nativeTimer(fn,ms===5000?0:ms,...args);
 const free=load('lib/fxtwitter-curated'),client=load('lib/free-curated-client');let routePage=0,transportCalls=0,failPublish=false;
 free.fetchFreeProfile=async()=>profile;
 free.fetchFreeMediaPage=async()=>{routePage++;return {posts:[candidate(8000+routePage),candidate(9000+routePage)],timelineIds:[String(8000+routePage)],rawCount:100,skipped:98,nextCursor:String(routePage),multipleVideoPosts:0};};
 client.callFreeProduction=async b=>{transportCalls++;if(b.action==='registration')return {ok:true,registration:registrationAck(b)};if(b.action==='dashboard')return {ok:true,dashboard:{feature:'free_curated_dashboard',authors:[{id:'123'}]}};if(b.action==='publish'){if(failPublish)throw new FreeCuratedError(502,'mock interrupted');return {ok:true,registration:registrationAck(b),published:{saved:1,promoted:0,excluded:1,duplicates:0}}}return {ok:true,registrationAuthorLimit:1000,registrationRecoveryVersion:1}};
 const {NextRequest}=require('next/server'),route=load('app/api/fxtwitter-authors/route');
 const req=body=>new NextRequest('http://localhost:3004/api/fxtwitter-authors',{method:'POST',headers:{origin:'http://localhost:3004','content-type':'application/json'},body:JSON.stringify(body)});
 let response=await route.POST(req({action:'register',username:'test',count:200}));assert.equal(response.status,200);let data=await response.json();const id=data.id;assert.equal(data.state.authors[0].registration.phase,'sync');
 await route.POST(req({action:'register-step',id}));await route.POST(req({action:'register-step',id}));
 const premature=await route.POST(req({action:'preview',id,count:100,mode:'latest'}));assert.equal(premature.status,409);
 failPublish=true;response=await route.POST(req({action:'register-step',id}));assert.equal(response.status,502);data=await response.json();assert.equal(data.state.authors[0].registration.phase,'publish');assert.equal(routePage,1);
 failPublish=false;
 for(let i=0;i<10;i++){response=await route.POST(req({action:'register-step',id}));assert.equal(response.status,200);data=await response.json();if(data.job.phase==='completed')break;}
 assert.equal(data.job.phase,'completed');assert.equal(data.job.scanned,200);assert.equal(data.job.saved,2);assert.equal(data.job.excluded,2);assert.equal(routePage,2);
 const dash=await route.POST(req({action:'dashboard'}));assert.equal(dash.status,200);const dashData=await dash.json();assert.equal(dashData.production.dashboard.authors[0].initialRegistration.scanned,200);assert.equal(routePage,2);
 const before=transportCalls;
 const cross=new NextRequest('http://localhost:3004/api/fxtwitter-authors',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:'{"action":"register-step","id":"123"}'});
 assert.equal((await route.POST(cross)).status,403);process.env.NODE_ENV='production';assert.equal((await route.POST(req({action:'register-step',id}))).status,403);assert.equal(transportCalls,before);
}finally{process.chdir(cwd);process.env.NODE_ENV=oldMode;global.setTimeout=nativeTimer;await fs.promises.rm(routeDir,{recursive:true,force:true})}
console.log('PASS actual local API: register -> sync -> paged fetch/publish -> complete; persisted partial failure/JSON response; progress; no overwrite by advanced preview; origin/production guards. Network/DB mocked.');
console.log('PASS SIMPLE REGISTRATION: 100/200/300; auth before provider; sequential spacing; auto sync/publish; durable page checkpoints/retry; rate-limit cooldown; history end; cursor cycle refusal; existing account; raw final-page trim; corrupt job refused. Network/DB mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
