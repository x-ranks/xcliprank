'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),ts=require('typescript');
const root=p.resolve(__dirname,'..'),{NextRequest}=require('next/server');
function load(file,resolve=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(p.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}
const middleware=load('middleware.ts'),previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
try{
 for(const path of ['/','/rising','/ranking/daily','/ranking/weekly','/reels','/download','/p/2110660690478301409','/p/2110660690478301409?from=%2Frising','/accounts/fixture','/tags/test','/api/video-playback-url?postId=123']){
  const response=middleware.middleware(new NextRequest('https://twizou.net'+path));assert.equal(response.status,200);assert.equal(response.headers.get('Referrer-Policy'),'same-origin',path);
 }
 assert.equal(middleware.middleware(new NextRequest('https://twizou.net/curated-manager')).status,404);
 assert.equal(middleware.middleware(new NextRequest('https://xcliprank.com/p/123')).status,301);
 const layout=load('app/layout.tsx',n=>n.endsWith('/seo')?{SITE_NAME:'twizou',SITE_URL:'https://twizou.net'}:n.endsWith('.css')||n.includes('/components/')?{}:require(n));assert.equal(layout.metadata.referrer,'same-origin','Client transitions/local dev retain document policy');
 // Incoming attribution is read from document.referrer. The outgoing resource
 // policy does not replace it; same-origin navigation/session return stay intact.
 const tracking=fs.readFileSync(p.join(root,'lib/engagement-client.ts'),'utf8');assert(tracking.includes('document.referrer'));
 const boundary=fs.readFileSync(p.join(root,'app/api/video/route.ts'),'utf8');assert(boundary.includes('410'));
 assert(!fs.readFileSync(p.join(root,'app/components/DirectPlaybackVideo.tsx'),'utf8').includes('crossOrigin="anonymous"'));
 console.log('PASS REFERRER PLAYBACK: public response same-origin policy, root metadata for client transitions/local dev, incoming attribution retained, private routes and legacy redirects preserved, relay410. No real media requests.');
}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
