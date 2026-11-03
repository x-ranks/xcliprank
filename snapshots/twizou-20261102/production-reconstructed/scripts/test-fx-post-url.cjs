'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
const removals=[];
const substitutions={
  'lib/supabase-admin':{supabaseAdmin:()=>({})},
  'lib/free-curated-publish':{publishFreeCandidates:async()=>{throw Error('Unexpected database write')}},
  'lib/curated-common':{},'lib/curated-removals':{readCuratedRemovals:async()=>removals},'lib/availability-dashboard':{},'lib/free-curated-dashboard':{},
};
function load(id){if(substitutions[id])return substitutions[id];if(cache.has(id))return cache.get(id).exports;
  const m={exports:{}};cache.set(id,m);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const fx=load('lib/fxtwitter-curated'),store=load('lib/free-curated-server-store'),sync=load('lib/free-curated-sync');
const status=id=>({type:'status',provider:'twitter',id,text:'video text',author:{type:'profile',id:'12345',screen_name:'tester',name:'Tester',protected:false},
  created_timestamp:Date.now()/1000-60,possibly_sensitive:false,media:{videos:[{type:'video',id:'media-'+id,formats:[{container:'mp4',url:'https://video.twimg.com/'+id+'.mp4',bitrate:300}],thumbnail_url:'https://pbs.twimg.com/'+id+'.jpg'}]},views:11,likes:2});
const response=(post,id=post.id)=>Response.json({code:200,status:post});
(async()=>{let calls=0;for(const url of ['https://x.com.evil/t/status/12345','http://x.com/t/status/12345','https://user@x.com/t/status/12345','https://x.com/t/status/12345#frag','https://x.com/t/status/abc'])assert.throws(()=>fx.parseFreePostUrl(url));
  assert.equal(fx.parseFreePostUrl('https://twitter.com/tester/status/12345?s=20'),'12345');
  const fetched=await fx.fetchFreePostUrl('https://x.com/tester/status/12345','A',async(url,init)=>{calls++;assert.equal(url,'https://api.fxtwitter.com/2/status/12345');assert.equal(init.redirect,'error');return response(status('12345'));});
  assert.equal(calls,1);assert.equal(fetched.author.name,'Tester');assert.equal(fetched.candidate.text,'video text');assert.equal(fetched.candidate.video_url,'https://video.twimg.com/12345.mp4');
  for(const invalid of [{...status('12345'),id:'99999'},{...status('12345'),author:{...status('12345').author,protected:true}},{...status('12345'),media:{videos:[]}}])
    await assert.rejects(fx.fetchFreePostUrl('https://x.com/tester/status/12345','A',async()=>response(invalid)),e=>e.status===422);
  const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-fx-post-url-'));const originalFetch=global.fetch,oldEnv=process.env.SUPABASE_URL;process.env.SUPABASE_URL='https://example.supabase.co';
  let saves=0;const publish=async(author,candidates)=>{saves++;assert.equal(candidates.length,1);assert.equal(author.expectedTier,'A');return {saved:saves===1?1:0,promoted:0,excluded:0,duplicates:saves===1?0:1};};
  global.fetch=async()=>response(status('12345'));
  try{const body={action:'publish-post-url',url:'https://x.com/tester/status/12345',expectedTier:'A',confirm:true,databaseHost:'example.supabase.co'};
    await assert.rejects(sync.synchronizeFreeCurated({...body,databaseHost:'wrong'},{directory:tmp,publish}),e=>e.status===400);
    let result=await sync.synchronizeFreeCurated(body,{directory:tmp,publish});assert.equal(result.published.saved,1);assert.equal(result.author.added,true);
    let state=await store.readScheduledFreeState(tmp);assert.equal(state.authors.length,1);assert.equal(state.authors[0].initialBaselineId,'12345');assert.equal(state.authors[0].latestId,'12345');assert.equal(state.authors[0].initialPending,false);assert.equal(state.authors[0].savedTotal,1);
    result=await sync.synchronizeFreeCurated(body,{directory:tmp,publish});assert.equal(result.published.saved,0);assert.equal(result.author.added,false);state=await store.readScheduledFreeState(tmp);assert.equal(state.authors.length,1);assert.equal(state.authors[0].savedTotal,1);
    state.authors[0].paused=true;await store.writeScheduledFreeState(state,tmp);await assert.rejects(sync.synchronizeFreeCurated(body,{directory:tmp,publish}),e=>e.status===409);assert.equal(saves,2);
    removals.push({id:'12345'});await assert.rejects(sync.synchronizeFreeCurated(body,{directory:tmp,publish}),e=>e.status===409&&/手動削除済み/.test(e.message));assert.equal(saves,2);
  }finally{global.fetch=originalFetch;if(oldEnv===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldEnv;await fsp.rm(tmp,{recursive:true,force:true});}
  console.log('PASS FX POST URL: fixed provider, strict URL/status/video, author registration and scan baseline, idempotent retry, paused/removed author, DB-host guard; all network/DB mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
