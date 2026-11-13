'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const {NextRequest}=require('next/server');
const file=path.join(__dirname,'../middleware.ts'),loaded={exports:{}};
const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
// middleware.ts imports ./lib/edge-cache, which plain require cannot resolve from scripts/: transpile it the same way.
const edge={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/edge-cache.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,edge,edge.exports);
new Function('require','module','exports',js)(n=>n==='./lib/edge-cache'?edge.exports:require(n),loaded,loaded.exports);
const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
try{
 for(const path of ['/browse','/browse?page=2','/accounts','/accounts?page=2','/tags','/tags/%E7%84%A1%E4%BF%AE%E6%AD%A3','/months','/months/2026-10','/api/manual-ranking','/rising']){
  const response=loaded.exports.middleware(new NextRequest('https://twizou.net'+path));
  assert.equal(response.status,200,path);
 }
 for(const host of ['xcliprank.com','www.xcliprank.com','www.twizou.net']){
  for(const path of ['/','/p/2111989753172345043','/tags/%E5%80%8B%E4%BA%BA%E6%92%AE%E5%BD%B1?from=old']){
   const response=loaded.exports.middleware(new NextRequest('https://'+host+path));
   assert.equal(response.status,301,host+path);
   assert.equal(response.headers.get('location'),'https://twizou.net'+path);
  }
  const api=loaded.exports.middleware(new NextRequest('https://'+host+'/api/engagement'));
  assert.equal(api.status,200,'legacy API remains reachable on '+host);
 }
 for(const [from,to] of [['/p/2111989753172345043?from=%2Fbrowse%3Fpage%3D2','/p/2111989753172345043'],['/p/2111989753172345043?from=/accounts/x&utm_source=x','/p/2111989753172345043?utm_source=x'],['/p/2111989753172345043/?from=/','/p/2111989753172345043']]){
  const response=loaded.exports.middleware(new NextRequest('https://twizou.net'+from));
  assert.equal(response.status,301,from);assert.equal(response.headers.get('location'),'https://twizou.net'+to,from);
 }
 assert.equal(loaded.exports.middleware(new NextRequest('https://twizou.net/p/2111989753172345043')).status,200,'clean video URL is served');
 assert.equal(loaded.exports.middleware(new NextRequest('https://twizou.net/tags/%E5%80%8B%E4%BA%BA%E6%92%AE%E5%BD%B1?from=old')).status,200,'only video pages redirect');
 assert.equal(loaded.exports.middleware(new NextRequest('https://twizou.net/manual-ranking')).status,404);
 {const ok=loaded.exports.middleware(new NextRequest('https://twizou.net/rising',{headers:{'user-agent':'Mozilla/5.0 Chrome/120'}}));assert.equal(ok.headers.get('cache-control'),'public, max-age=0, s-maxage=60, stale-while-revalidate=300','anonymous list page is edge-cacheable');
  for(const headers of [{'user-agent':'Googlebot/2.1'},{'user-agent':'Mozilla/5.0','x-twizou-verified-googlebot':'1'}])assert.equal(loaded.exports.middleware(new NextRequest('https://twizou.net/rising',{headers})).headers.get('cache-control'),null,'crawlers are never edge-cached');
  assert.equal(loaded.exports.middleware(new NextRequest('https://twizou.net/p/2111989753172345043',{headers:{'user-agent':'Mozilla/5.0'}})).headers.get('cache-control'),null,'video pages are not edge-cached');}
 console.log('PASS SEO MIDDLEWARE: new canonical host, path-preserving permanent redirects, legacy APIs, protected admin route');
}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
