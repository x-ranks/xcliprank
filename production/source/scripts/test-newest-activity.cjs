'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const ts=require('../node_modules/typescript');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'twizou-newest-activity-'));
function load(file,resolve){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(resolve,m,m.exports);return m.exports;}
const store=load('lib/free-curated-server-store.ts',name=>{
  if(name.endsWith('free-curated-limits'))return {FREE_CURATED_AUTHOR_LIMIT:1000,FREE_CURATED_SERVER_STATE_BYTES:4*1024*1024};
  if(name.endsWith('registration-lease'))return {validRegistrationFields:()=>true};
  if(name.endsWith('free-curated-metrics'))return {validFreeMetrics:()=>true};
  if(name.endsWith('fxtwitter-curated'))return {FreeCuratedError:class FreeCuratedError extends Error{}};
  return require(name);
});
(async()=>{
  const now=Date.now(),state=store.freshFreeState();
  store.rememberNewRegistrations(state,['2111989753172345043','2111989753172345044'],now);
  store.rememberPatrolPosts(state,['2111989753172345045'],now+1);
  await store.writeScheduledFreeState(state,directory);
  assert.equal((await store.recentRegistrationTimes(now,directory)).size,2);
  assert.equal((await store.recentPatrolTimes(now,directory)).size,1);
  const restarted=await store.readScheduledFreeState(directory);
  store.rememberNewRegistrations(restarted,['2111989753172345043'],now+2);
  assert.equal(restarted.recentRegistrations.length,2,'retry does not create another priority slot');
  store.rememberPatrolPosts(restarted,['2111989753172345046'],now+49*3600000);
  await store.writeScheduledFreeState(restarted,directory);
  assert.equal((await store.recentPatrolTimes(now+24*3600000,directory)).size,1,'stale patrol markers expire');
  console.log('PASS NEWEST ACTIVITY: registration and patrol IDs persist across reads, retries deduplicate, stale markers expire; temporary isolated state only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
