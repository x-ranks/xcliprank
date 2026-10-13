const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('app/api/tier-reevaluation/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
let calls=0;
async function test(env,url,method='GET',headers={}){
 const m={exports:{}};class Response {constructor(body,opts){this.status=opts?.status??200;}static json(body,opts){return new Response(body,opts);}}
 new Function('require','exports','module','process',code)(name=>name==='next/server'?{NextResponse:Response}:{reevaluationStatus:async()=>{calls++;return{};},runReevaluation:async()=>{calls++;}},m.exports,m,{env:{NODE_ENV:env}});
 return m.exports[method]({nextUrl:new URL(url),headers:new Headers(headers),json:async()=>({action:'start'})});
}
(async()=>{
 assert.equal((await test('production','http://localhost:3004/api/tier-reevaluation')).status,404);
 assert.equal((await test('development','https://xcliprank.com/api/tier-reevaluation')).status,404);
 assert.equal((await test('development','http://localhost:3004/api/tier-reevaluation','POST',{'Content-Type':'application/json',Origin:'https://example.test'})).status,404);
 assert.equal((await test('development','http://localhost:3004/api/tier-reevaluation','POST',{'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'})).status,404);
 assert.equal(calls,0);
 assert.equal((await test('development','http://localhost:3004/api/tier-reevaluation','POST',{'Content-Type':'text/plain'})).status,415);
 assert.equal((await test('development','http://localhost:3004/api/tier-reevaluation')).status,200);
 console.log('PASS: production and nonlocal blocked; foreign origin/cross-site blocked before DB; JSON-only writes; local access allowed');
})();
