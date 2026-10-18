'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const load=Module._load;let calls=[];Module._load=function(id,parent,isMain){if(id.endsWith('/label-auto-server'))return{autoLabels:{status:async()=>{calls.push('status');return{phase:'idle',revision:0};},mutate:async b=>{calls.push(b);return{phase:'running',revision:1};}}};return load.apply(this,arguments);};
async function main(){
 const api=require('../app/api/label-auto/route.ts');process.env.NODE_ENV='production';let r=await api.GET(new Request('http://localhost:3004/api/label-auto'));assert.equal(r.status,404);r=await api.POST(new Request('http://localhost:3004/api/label-auto',{method:'POST',headers:{origin:'http://localhost:3004','content-type':'application/json'},body:'{}'}));assert.equal(r.status,404);assert.equal(calls.length,0);
 process.env.NODE_ENV='development';r=await api.GET(new Request('http://evil.invalid/api/label-auto'));assert.equal(r.status,404);r=await api.POST(new Request('http://localhost:3004/api/label-auto',{method:'POST',headers:{origin:'https://foreign.invalid','content-type':'application/json'},body:'{}'}));assert.equal(r.status,404);assert.equal(calls.length,0);
 r=await api.GET(new Request('http://localhost:3004/api/label-auto'));assert.equal(r.status,200);assert.equal((await r.json()).phase,'idle');assert.deepEqual(calls,['status']);
 r=await api.POST(new Request('http://localhost:3004/api/label-auto',{method:'POST',headers:{origin:'http://localhost:3004','content-type':'application/json'},body:JSON.stringify({action:'start',revision:0,threshold:0.7})}));assert.equal(r.status,200);assert.equal(calls[1].action,'start');assert.match(r.headers.get('cache-control'),/no-store/);
 r=await api.POST(new Request('http://localhost:3004/api/label-auto',{method:'POST',headers:{origin:'http://localhost:3004','content-type':'application/json'},body:JSON.stringify({action:'start',padding:'x'.repeat(3000)})}));assert.equal(r.status,400);assert.equal(calls.length,2);
 console.log('PASS AUTO LOCAL API: actual route, production/foreign-origin/host guards before service import, read-only status, bounded authenticated local mutations; mocked service, no provider or DB.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{Module._load=load;});
