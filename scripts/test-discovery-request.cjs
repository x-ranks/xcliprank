'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(f){const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);return m.exports;}
const {readDiscoveryIds}=load('lib/discovery-request.ts');
const {safePublicReturn}=load('lib/public-return-navigation.ts');
async function main(){
 const request=body=>new Request('https://twizou.net/api/discovery',{method:'POST',headers:{'content-type':'application/json'},body});
 assert.deepEqual(await readDiscoveryIds(request(JSON.stringify({ids:['12','345']}))),['12','345']);
 await assert.rejects(readDiscoveryIds(request(JSON.stringify({ids:['bad']}))),/INVALID/);
 await assert.rejects(readDiscoveryIds(request(JSON.stringify({ids:Array(51).fill('12')}))),/INVALID/);
 await assert.rejects(readDiscoveryIds(request(JSON.stringify({ids:[],extra:'x'.repeat(1700)}))),/INVALID/);
 await assert.rejects(readDiscoveryIds(new Request('https://twizou.net/api/discovery',{method:'POST',headers:{'content-type':'application/json',origin:'https://untrusted.invalid'},body:JSON.stringify({ids:['12']})})),/INVALID/);
 assert.deepEqual(await readDiscoveryIds(new Request('http://localhost:3000/api/discovery',{method:'POST',headers:{'content-type':'application/json',origin:'https://twizou.net','sec-fetch-site':'same-origin'},body:JSON.stringify({ids:['12']})})),['12']);
 await assert.rejects(readDiscoveryIds(new Request('https://twizou.net/api/discovery',{method:'POST',headers:{'content-type':'application/json',origin:'https://twizou.net','sec-fetch-site':'cross-site'},body:JSON.stringify({ids:['12']})})),/INVALID/);
 assert.equal(safePublicReturn('/discover?mode=search&q=author'),'/discover?mode=search&q=author');
 assert.equal(safePublicReturn('/favorites?mode=saveHistory'),'/favorites?mode=saveHistory');
 assert.equal(safePublicReturn('/discover?mode=random&seed=4294967296'),null);
 assert.equal(safePublicReturn('/discover?mode=search&from=https%3A%2F%2Fevil.test'),null);
 console.log('PASS DISCOVERY REQUESTS: bounded body, valid IDs, safe return paths');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
