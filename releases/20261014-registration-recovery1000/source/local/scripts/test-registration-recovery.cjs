function registrationAck(p){return {version:1,owner:p.registrationSession,ready:p.action==='publish'?!!p.registrationComplete:false};}
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(id){if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);
 const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const reg=load('lib/free-curated-registration'),{FreeCuratedError}=load('lib/fxtwitter-curated');
function state(){return {version:1,cooldownUntil:0,authors:[{id:'123',username:'test',name:'Test',expectedTier:'S',paused:false,addedAt:new Date().toISOString(),checkedAt:new Date().toISOString(),nextCursor:null,
 candidates:[],rawCount:100,skipped:100,savedTotal:0,lastSavedAt:null,error:null,registration:{requested:100,scanned:100,pages:1,fetched:0,saved:0,excluded:0,duplicates:0,phase:'publish',initialLatestId:'9999',cursor:null,cursors:[],postIds:[],error:null}}]}}
(async()=>{
 let s=state(),calls=[],first=true,mediaCalls=0;
 const options={persist:async()=>{},media:async()=>{mediaCalls++;throw Error('MUST_NOT_REFETCH')},production:async p=>{if(p.action==='registration')return {ok:true,registration:registrationAck(p)};calls.push(p);
  if(p.action==='publish'&&first){first=false;throw new FreeCuratedError(409,'missing',undefined,false,'sync')}
  return {ok:true,registration:registrationAck(p),published:{saved:0,promoted:0,excluded:0,duplicates:0}}}};
 const result=await reg.stepFreeRegistration(s,'123',options);assert.equal(result.job.phase,'completed');assert.deepEqual(calls.map(p=>p.action),['publish','sync','publish']);assert.equal(mediaCalls,0);
 assert.equal(calls[1].authors[0].initialPending,true);assert.equal(calls[2].registrationComplete,true);assert.equal(calls[2].initialBaselineId,'9999');assert.deepEqual(calls[0].candidates,calls[2].candidates);
 for(const error of [new FreeCuratedError(409,'paused'),new FreeCuratedError(401,'auth'),new FreeCuratedError(503,'db')]){
  s=state();calls=[];await assert.rejects(reg.stepFreeRegistration(s,'123',{persist:async()=>{},production:async p=>{if(p.action==='registration')return {ok:true,registration:registrationAck(p)};calls.push(p);throw error}}));assert.equal(calls.length,1);assert.equal(s.authors[0].registration.phase,'publish');}
 s=state();calls=[];await assert.rejects(reg.stepFreeRegistration(s,'123',{persist:async()=>{},production:async p=>{if(p.action==='registration')return {ok:true,registration:registrationAck(p)};calls.push(p);throw new FreeCuratedError(409,'missing',undefined,false,'sync')}}));assert.deepEqual(calls.map(p=>p.action),['publish','sync']);
 const client=load('lib/free-curated-client');process.env.CRON_SECRET='MOCK_ONLY';process.env.SUPABASE_URL='https://example.supabase.co';
 await assert.rejects(client.callFreeProduction({action:'publish'},async()=>Response.json({ok:false,error:'missing',recoveryAction:'sync'},{status:409})),e=>e.recoveryAction==='sync');
 console.log('PASS REGISTRATION RECOVERY: missing production roster resyncs once and republishes same persisted page; zero-video completion delivered; paused/auth/DB errors never auto-unpause; failed sync preserves publish checkpoint; no Fx/X network or real DB.');
})().catch(e=>{console.error(e);process.exitCode=1});
