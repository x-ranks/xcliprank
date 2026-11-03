'use strict';
const fs=require('fs'),p=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),Module=require('module'),ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createAutoLabels}=require('../lib/label-auto-service.ts'),{acquirePublicOperation}=require('../lib/public-operation-lock.ts');
const tmp=fs.mkdtempSync(p.join(os.tmpdir(),'twizou-threshold-')),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),label={id:crypto.randomUUID(),name:'fixture',active:true},vector=Array(1024).fill(0);
const state={labels:[label],videos:[],model:{fingerprint:sha('model'),head:{spec:'label-four-frames-10-25-50-80-v1',samples:300,mean:vector,scale:Array(1024).fill(1),heads:[{id:label.id,weights:vector,bias:0.6}]}}};
const video=id=>({id,handle:'fixture',videoUrl:'https://video.twimg.com/'+id+'.mp4',sourceHash:sha(id)});
async function main(){
 const dir=p.join(tmp,'job'),receipts=[],pages=[];let failPublication=true,fetches=0;
 const deps={snapshot:async()=>({state,stamp:sha('stamp')}),prepare:async()=>{fetches++;return{features:vector,frames:Array(4).fill(Buffer.from([255,216])),hash:sha('video')};},remote:async b=>{
  if(b.action==='status')return{automaticLabelsVersion:1,emptyLabelRetryVersion:1};
  if(b.action==='auto-page'){pages.push(b);return{items:[video('1001')],scanned:1,nextCursor:'1001',upper:'1001',done:true,protected:0,already:0,unavailable:0};}
  if(b.action==='auto-publish'){receipts.push(b);if(failPublication)throw Error('LABEL_PUBLIC_REMOTE_UNAVAILABLE');return{result:'published'};}throw Error('unexpected');}};
 let worker=createAutoLabels(dir,deps),v=await worker.status();const run=async(action,threshold=0.7)=>v=await worker.mutate({action,threshold,revision:v.revision});
 await run('retry-empty');await run('step');assert.equal(v.phase,'paused');assert(v.pendingPublication);assert.deepEqual(receipts[0].input.post.labelIds,[]);
 const file=p.join(dir,'job.json'),old=JSON.parse(fs.readFileSync(file));old.counts.published=121;old.counts.emptyLabels=120;old.counts.processed=121;old.failures=[{id:'9999',sourceHash:sha('9999'),code:'LABEL_VIDEO_HTTP_FORBIDDEN',attemptedAt:new Date().toISOString()}];fs.writeFileSync(file,JSON.stringify(old));v=await worker.status();
 const before=fs.readFileSync(file,'utf8');await assert.rejects(run('restart-threshold',0.6),/LABEL_AUTO_INVALID_INPUT/);assert.equal(fs.readFileSync(file,'utf8'),before);
 failPublication=false;await run('restart-threshold',0.5);assert.equal(v.phase,'running');assert.equal(v.threshold,0.5);assert.equal(v.scope,'empty');assert.equal(v.counts.published,0);assert(!v.pendingPublication);
 const archive=p.join(dir,'previous-'+old.id+'-'+old.revision+'.json');assert.equal(fs.readFileSync(archive,'utf8'),before);assert.deepEqual(JSON.parse(fs.readFileSync(file)).failures,old.failures);
 worker=createAutoLabels(dir,deps);v=await worker.status();await run('step',0.5);assert.equal(v.phase,'completed');assert.equal(v.counts.published,1);assert.equal(v.counts.emptyLabels,0);assert.equal(fetches,2,'pending 0.7 prediction must not be reused at 0.5');assert.deepEqual(receipts.at(-1).input.post.labelIds,[label.id]);assert.equal(pages.at(-1).scope,'empty');assert.notEqual(pages[0].modelRevision,pages.at(-1).modelRevision);
 await run('new',0.5);assert.equal(v.scope,'all','later normal cycles retain the chosen threshold and include new videos');assert.equal(v.threshold,0.5);
 const lock=await acquirePublicOperation(p.join(dir,'worker.lock'),'fixture busy');const frozen=fs.readFileSync(file,'utf8');await assert.rejects(run('restart-threshold',0.5),/LABEL_AUTO_WORKER_BUSY/);assert.equal(fs.readFileSync(file,'utf8'),frozen);await lock.release();
 const operation=await acquirePublicOperation(p.join(dir,'operation.lock'),'fixture busy');await assert.rejects(run('restart-threshold',0.5),/LABEL_AUTO_BUSY/);assert(!fs.existsSync(p.join(dir,'worker.lock')),'failed switch releases worker lock');await operation.release();
 const staleRevision=v.revision;await run('restart-threshold',0.5);await assert.rejects(worker.mutate({action:'step',revision:staleRevision}),/LABEL_AUTO_STALE/);
 const current=JSON.parse(fs.readFileSync(file));fs.writeFileSync(p.join(dir,'previous-'+current.id+'-'+current.revision+'.json'),'different saved record');await assert.rejects(run('restart-threshold',0.5),/LABEL_AUTO_ARCHIVE_CONFLICT/);assert.deepEqual(JSON.parse(fs.readFileSync(file)),current);assert(!fs.existsSync(p.join(dir,'worker.lock')));assert(!fs.existsSync(p.join(dir,'operation.lock')));
 const unsupported=createAutoLabels(p.join(tmp,'unsupported'),{...deps,remote:async()=>({automaticLabelsVersion:1})});await assert.rejects(unsupported.mutate({action:'restart-threshold',revision:0,threshold:0.5}),/LABEL_AUTO_DEPLOY_FIRST/);assert(!fs.existsSync(p.join(tmp,'unsupported/job.json')));
 console.log('PASS THRESHOLD SWITCH: paused/running restart at 0.5, archive/counters/pending isolation, cooldown preservation, empty scope, later normal cycles, worker/step lock refusal, stale tabs, invalid threshold/backend/archive refusal; synthetic only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{assert.equal(p.dirname(p.resolve(tmp)),p.resolve(os.tmpdir()));assert(p.basename(tmp).startsWith('twizou-threshold-'));fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
