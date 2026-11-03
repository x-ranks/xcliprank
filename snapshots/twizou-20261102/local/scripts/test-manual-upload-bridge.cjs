'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),{NextRequest,NextResponse}=require('next/server');
const root=path.resolve(__dirname,'..');function load(file,resolver){const m={exports:{}},js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(resolver,m,m.exports);return m.exports;}
const reader=load('lib/manual-request-body.ts',require),route=load('app/api/manual-ranking/route.ts',id=>id==='next/server'?{NextRequest,NextResponse}:id.endsWith('manual-request-body')?reader:id.endsWith('manual-ranking')?{}:id.endsWith('public-video-production')?{}:require(id));
(async()=>{const oldFetch=global.fetch,oldEnv=process.env.NODE_ENV;let forwarded=0;
 try{process.env.NODE_ENV='development';global.fetch=async(url,init)=>{forwarded++;assert.equal(url,'https://twizou.net/api/engagement?type=placement');assert.equal(init.headers.Authorization,'Bearer secret');const body=JSON.parse(init.body);assert.equal(body.thumbnailData,'data:image/png;base64,AAAA');return Response.json({ok:true,state:{entries:[]}});};
 const body=JSON.stringify({action:'save',thumbnailData:'data:image/png;base64,AAAA'});
 const request=origin=>new NextRequest('http://localhost:3000/api/manual-ranking',{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer secret'},body});
 assert.equal((await route.POST(request('https://foreign.example'))).status,403);assert.equal(forwarded,0);
 assert.equal((await route.POST(request('http://localhost:3000'))).status,200);assert.equal(forwarded,1);
 console.log('PASS LOCAL MANUAL BRIDGE: same-origin protection, authenticated fixed destination and image payload; no network');
 }finally{global.fetch=oldFetch;process.env.NODE_ENV=oldEnv;}
})().catch(e=>{console.error(e);process.exitCode=1});
