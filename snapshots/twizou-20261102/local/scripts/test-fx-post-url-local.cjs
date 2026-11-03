'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
const substitutions={'lib/fxtwitter-curated-store':{withFreeRegistry:async()=>{throw Error('Registry changed unexpectedly')},readFreeRegistry:async()=>({version:1,cooldownUntil:0,authors:[]})},
  'lib/fxtwitter-curated-save':{},'lib/free-curated-registration':{},'lib/free-curated-client':{}};
function load(id){if(substitutions[id])return substitutions[id];if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const {NextRequest}=require('next/server'),route=load('app/api/fxtwitter-authors/route');
const post={type:'status',provider:'twitter',id:'12345',text:'sample video',author:{type:'profile',id:'67890',screen_name:'tester',name:'Tester',protected:false},
  created_timestamp:Date.now()/1000-30,possibly_sensitive:false,media:{videos:[{type:'video',formats:[{container:'mp4',url:'https://video.twimg.com/video.mp4',bitrate:100}]}]}};
const req=(action,token,origin='http://localhost:3004',url='https://x.com/tester/status/12345')=>new NextRequest('http://localhost:3004/api/fxtwitter-authors',{
  method:'POST',headers:{host:'localhost:3004',origin,'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
  body:JSON.stringify({action,url,expectedTier:'A'})});
(async()=>{const prevFetch=global.fetch,prevMode=process.env.NODE_ENV,prevDb=process.env.SUPABASE_URL;process.env.NODE_ENV='development';process.env.SUPABASE_URL='https://example.supabase.co';
  let provider=0,production=0;global.fetch=async(url,init)=>{if(String(url).startsWith('https://api.fxtwitter.com/2/status/')){provider++;assert.equal(init.credentials,'omit');return Response.json({code:200,status:post});}
    assert.equal(url,'https://twizou.net/api/engagement?type=fx-post');production++;assert.equal(init.headers.Authorization,'Bearer valid-key');assert.equal(init.headers.Origin,'https://twizou.net');
    const body=JSON.parse(init.body);assert.equal(body.databaseHost,'example.supabase.co');assert.equal(body.action,'publish-post-url');return Response.json({ok:true,published:{saved:1,promoted:0,excluded:0,duplicates:0},author:{username:'tester',added:true},message:'registered'});};
  try{assert.equal((await route.POST(req('preview-post-url',null,'https://evil.test'))).status,403);assert.equal(provider,0);
    let r=await route.POST(req('preview-post-url'));assert.equal(r.status,200);let data=await r.json();assert.equal(data.preview.text,'sample video');assert.equal(data.preview.username,'tester');assert.equal(production,0);
    assert.equal((await route.POST(req('publish-post-url'))).status,401);assert.equal(production,0);
    assert.equal((await route.POST(req('publish-post-url','valid-key','http://localhost:3004','https://evil.test/t/status/12345'))).status,400);
    r=await route.POST(req('publish-post-url','valid-key'));assert.equal(r.status,200);data=await r.json();assert.equal(data.production.published.saved,1);assert.equal(production,1);
    process.env.NODE_ENV='production';assert.equal((await route.POST(req('publish-post-url','valid-key'))).status,403);assert.equal(production,1);
  }finally{global.fetch=prevFetch;if(prevMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prevMode;if(prevDb===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=prevDb;}
  console.log('PASS FX POST LOCAL: same-origin preview, metadata, key forwarding, fixed production bridge, invalid URL, production-mode denial; network/DB mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
