const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {scanAvailabilityStatuses}=require('../lib/availability-scan.ts'),{readPostState,writePostState}=require('../lib/post-status-store.ts');
const policy=require('../lib/availability-policy.ts'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'twizou-hourly-'));process.env.XCLIP_FREE_CURATED_STATE_DIR=path.join(dir,'manual');
(async()=>{try{
 assert.equal(policy.BATCH_INTERVAL,3600000);let now=100*86400000,deleted=false;
 const rows=[{x_post_id:'901',author_id:'123'},{x_post_id:'902',author_id:'123'}];
 const fetcher=async url=>{const id=url.split('/').at(-1);if(url.includes('/profile/'))return Response.json({code:200,user:{type:'profile',id:'123',screen_name:'fixture',protected:false}});if(deleted&&id==='901')return Response.json({code:404,message:'NOT_FOUND'},{status:404});return Response.json({code:200,status:{type:'status',provider:'twitter',id,text:'fixture',author:{id:'123',screen_name:'fixture',protected:false},media:{videos:[{type:'video',url:'https://video.twimg.com/fixture.mp4'}]}}});};
 const options={directory:dir,now:()=>now,pause:async()=>{},fetcher,loadPriority:async()=>[...rows]};
 await scanAvailabilityStatuses(async()=>rows,options);deleted=true;now+=3600000;
 await scanAvailabilityStatuses(async()=>[],options);let state=await readPostState(dir);assert(state.entries['901'].missingSince);assert.equal(state.entries['901'].blocked,false);
 const duplicate=await scanAvailabilityStatuses(async()=>[],options);assert(duplicate.skipped);
 now+=3600000;await scanAvailabilityStatuses(async()=>[],options);state=await readPostState(dir);assert.equal(state.entries['901'].blocked,true,'two separated missing replies plus healthy public reply exclude');
 // Legacy 24h due date must not delay an hourly ranking recheck.
 state.entries['902'].nextCheckAt=now+86400000;state.entries['902'].checkedAt=now-3600000;state.nextBatchAt=now;await writePostState(state,dir);
 const migrated=await scanAvailabilityStatuses(async()=>[],options);assert(migrated.priority_checked>0);
 console.log('PASS hourly patrol: separated confirmation, healthy-provider guard, durable duplicate skip and legacy due-time migration');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
