'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),state={version:1,revision:0,entries:[]};
const next={NextResponse:{json:(body,init={})=>Response.json(body,init)}};
const backend={productionPublicBackend:()=>({service:{activeLabels:async()=>['label'],inspect:async()=>{throw Error('UNEXPECTED_INSPECT')}}})};
const storage={parseManualPlacement:x=>x,readManualState:async()=>state,writeManualState:async()=>state};
function load(file,resolve){const module={exports:{}};let target=path.join(root,file);if(!fs.existsSync(target)&&process.env.XCLIP_TEST_SOURCE_ROOT)target=path.join(process.env.XCLIP_TEST_SOURCE_ROOT,file);const code=ts.transpileModule(fs.readFileSync(target,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(resolve,module,module.exports);return module.exports;}
const mocks={'manual-thumbnail':{},'manual-thumbnail-store':{},'manual-request-body':{readManualRequestBody:r=>r.text()},'manual-x-candidate':{},'free-curated-publish':{},'fxtwitter-curated':{},'post-status-store':{},'post-status':{}};
const manual=load('app/api/manual-ranking/route.ts',name=>name==='next/server'?next:name.endsWith('manual-ranking')?storage:name.endsWith('public-video-production')?backend:mocks[name.split('/').pop()]??require(name));
const publicVideo=load('app/api/public-video/route.ts',name=>name.endsWith('manual-ranking/route')?manual:name.endsWith('public-video-production')?backend:name.endsWith('manual-ranking')?storage:name.endsWith('manual-thumbnail-store')?{}:require(name));
const engagement=load('app/api/engagement/route.ts',name=>name==='next/server'?next:name.endsWith('manual-ranking/route')?manual:name.endsWith('free-curated-sync/route')?{POST:async()=>Response.json({ok:true,kind:'fx-post'})}:name.endsWith('supabase-admin')?{supabaseAdmin:()=>{throw Error('UNEXPECTED_DB')}}:require(name));
function req(path,method='GET',token){const nextUrl=new URL('https://twizou.net'+path),headers=new Headers({'Content-Type':'application/json'});if(token)headers.set('Authorization','Bearer '+token);return {url:nextUrl.href,nextUrl,headers,method,text:async()=>JSON.stringify({revision:0,action:'remove',entry:{id:'fixture'}}),json:async()=>({})};}
(async()=>{const oldSecret=process.env.CRON_SECRET,oldEnv=process.env.NODE_ENV;try{
 process.env.NODE_ENV='production';process.env.CRON_SECRET='fixture-secret';
 let response=await publicVideo.GET(req('/api/public-video?type=placement'));assert.equal(response.status,401);
 response=await publicVideo.GET(req('/api/public-video?type=placement','GET','fixture-secret'));assert.equal(response.status,200);assert.deepEqual((await response.json()).state,state);
 response=await publicVideo.GET(req('/api/public-video?type=labels'));assert.equal(response.status,200);assert.deepEqual((await response.json()).data,['label']);
 response=await engagement.POST(req('/api/engagement?type=placement','POST'));assert.equal(response.status,401);
 response=await engagement.POST(req('/api/engagement?type=placement','POST','fixture-secret'));assert.equal(response.status,200);assert.deepEqual((await response.json()).state,state);
 response=await engagement.POST(req('/api/engagement?type=fx-post','POST','fixture-secret'));assert.equal(response.status,200);assert.equal((await response.json()).kind,'fx-post');
 response=await engagement.POST(req('/api/engagement','POST'));assert.equal(response.status,400);
 console.log('PASS MANUAL RANKING BRIDGE: existing GET/POST routes delegate only placement; production auth required; ordinary behavior retained; no network');
}finally{if(oldSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldSecret;if(oldEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnv;}})().catch(error=>{console.error(error);process.exitCode=1;});
