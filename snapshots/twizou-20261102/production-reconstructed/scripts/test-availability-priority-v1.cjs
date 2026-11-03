const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {scanAvailabilityStatuses}=require('../lib/availability-scan.ts');
const {readPostState}=require('../lib/post-status-store.ts');
const {POST_BATCH_LIMIT}=require('../lib/availability-policy.ts');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-priority-test-'));process.env.XCLIP_FREE_CURATED_STATE_DIR=path.join(root,'manual');
(async()=>{try{
 assert.equal(POST_BATCH_LIMIT,100);
 const rows=Array.from({length:160},(_,i)=>({x_post_id:String(90000-i),author_id:'123',author_username:'test'}));
 let calls=0,priorityCalls=0,now=100*86400000;
 const fetcher=async url=>{calls++;const id=url.split('/').at(-1);return url.includes('/profile/')?Response.json({code:200,user:{type:'profile',id:'123',screen_name:'test',protected:false}}):Response.json({code:200,status:{type:'status',provider:'twitter',id,text:'ok',media:{videos:[{type:'video',url:'https://video.twimg.com/x.mp4'}]},author:{id:'123',screen_name:'test',protected:false}}});};
 const opts={directory:root,now:()=>now,pause:async()=>{},fetcher,loadPriority:async()=>{priorityCalls++;return rows.slice(50,130)}};
 const load=async cursor=>rows.filter(x=>!cursor||BigInt(x.x_post_id)<BigInt(cursor)).slice(0,200);
 const one=await scanAvailabilityStatuses(load,opts);assert.equal(one.post_checked,100);assert.equal(priorityCalls,1);assert.equal(new Set(Object.keys((await readPostState(root)).entries)).size,100);assert((await readPostState(root)).cursor,'89969');
 const again=await scanAvailabilityStatuses(load,opts);assert(again.skipped);assert.equal(priorityCalls,1);assert.equal(calls,101);
 console.log('PASS 100/3h priority 80 + rotation 20; durable cursor; no duplicate call; skipped run avoids priority DB');
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});
