'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const code=ts.transpileModule(fs.readFileSync(path.join(root,'app/api/manual-ranking/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const api={};
const state={version:1,revision:0,entries:[]};
new Function('require','exports',code)(name=>{
  if(name==='next/server')return {NextResponse:{json:(value,options={})=>Response.json(value,options)}};
  if(name.endsWith('lib/manual-ranking'))return {readManualState:async()=>state,writeManualState:async()=>state,parseManualPlacement:x=>x};
  if(name.endsWith('lib/public-video-production'))return {productionPublicBackend:()=>{throw Error('NO_PRODUCTION_BACKEND_IN_TEST')}};
  return require(name);
},api);
function request(host,method,token,body){const nextUrl=new URL(`http://${host}/api/manual-ranking`);return {nextUrl,headers:new Headers({Authorization:token,'Content-Type':'application/json',Origin:nextUrl.origin}),text:async()=>JSON.stringify(body),method};}
(async()=>{const oldEnv=process.env.NODE_ENV,oldSecret=process.env.CRON_SECRET,oldFetch=global.fetch;try{
  process.env.NODE_ENV='development';delete process.env.CRON_SECRET;
  const calls=[];let deny=false;global.fetch=async(url,init)=>{calls.push({url,init});return Response.json(deny?{ok:false,error:'認証が必要です。'}:{ok:true,state},{status:deny?401:200})};
  let response=await api.GET(request('localhost:3000','GET','Bearer entered-key'));
  assert.equal(response.status,200);assert.equal(calls[0].init.headers.Authorization,'Bearer entered-key');
  assert.equal(calls[0].url,'https://twizou.net/api/public-video?type=placement');
  response=await api.POST(request('localhost:3000','POST','Bearer entered-key',{revision:0,action:'save',entry:{}}));
  assert.equal(response.status,200);assert.equal(calls[1].init.headers.Authorization,'Bearer entered-key');
  assert.equal(calls[1].url,'https://twizou.net/api/engagement?type=placement');
  assert.equal(calls[1].init.headers.Origin,'https://twizou.net');
  assert.equal(calls[1].init.method,'POST');
  response=await api.GET(request('localhost:3000','GET',''));
  assert.equal(response.status,401);assert.equal(calls.length,2);
  deny=true;response=await api.GET(request('localhost:3000','GET','Bearer wrong-key'));
  assert.equal(response.status,401);assert.match((await response.json()).error,/本番の管理キー/);deny=false;
  process.env.NODE_ENV='production';process.env.CRON_SECRET='production-key';
  response=await api.GET(request('twizou.net','GET','Bearer wrong-key'));
  assert.equal(response.status,401);assert.equal(calls.length,3);
  response=await api.GET(request('twizou.net','GET','Bearer production-key'));
  assert.equal(response.status,200);assert.equal(calls.length,3);
  console.log('PASS MANUAL RANKING AUTH: local forwards entered key; production validates its own key; no network');
}finally{global.fetch=oldFetch;if(oldEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnv;if(oldSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldSecret;}})().catch(error=>{console.error(error);process.exitCode=1;});
