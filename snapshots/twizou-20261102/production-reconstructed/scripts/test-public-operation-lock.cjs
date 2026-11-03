'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),cp=require('node:child_process'),ts=require('typescript'),Module=require('node:module');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {acquirePublicOperation}=require('../lib/public-operation-lock.ts'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-public-lock-')),file=path.join(tmp,'operation.lock');
async function main(){
 const h=await acquirePublicOperation(file,'FIXTURE_BUSY');await assert.rejects(acquirePublicOperation(file,'FIXTURE_BUSY'),/FIXTURE_BUSY/);await h.release();
 const child=cp.spawn(process.execPath,['-e',''],{windowsHide:true});await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});fs.writeFileSync(file,JSON.stringify({pid:child.pid}));
 const results=await Promise.allSettled([acquirePublicOperation(file,'FIXTURE_BUSY'),acquirePublicOperation(file,'FIXTURE_BUSY')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'stale recovery has one owner');assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(JSON.parse(fs.readFileSync(file)).pid,process.pid);await results.find(r=>r.status==='fulfilled').value.release();
 fs.writeFileSync(file,JSON.stringify({pid:child.pid}));fs.writeFileSync(file+'.recovery','');await assert.rejects(acquirePublicOperation(file,'FIXTURE_BUSY'),/FIXTURE_BUSY/);assert.equal(JSON.parse(fs.readFileSync(file)).pid,child.pid);fs.unlinkSync(file+'.recovery');
 const recovered=await acquirePublicOperation(file,'FIXTURE_BUSY');await recovered.release();fs.writeFileSync(file,'invalid');await assert.rejects(acquirePublicOperation(file,'FIXTURE_BUSY'),/FIXTURE_BUSY/);assert.equal(fs.readFileSync(file,'utf8'),'invalid');
 console.log('PASS PUBLIC LOCK: active lock exclusion, actual dead PID recovery, simultaneous recovery serialization, stale recovery/corrupt ownership refused. No application state.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{assert.equal(path.dirname(path.resolve(tmp)),path.resolve(os.tmpdir()));assert(path.basename(tmp).startsWith('xclip-public-lock-'));fs.rmSync(tmp,{recursive:true,force:true});});
