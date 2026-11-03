'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),Module=require('node:module'),ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createAutoLabels}=require('../lib/label-auto-service.ts'),{createLabelPublication}=require('../lib/label-publication-service.ts');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'twizou-label-expand-')),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const label={id:crypto.randomUUID(),name:'A',active:true},vector=Array(1024).fill(0),state={labels:[label],model:{fingerprint:sha('model'),head:{spec:'label-four-frames-10-25-50-80-v1',samples:300,mean:vector,scale:Array(1024).fill(1),heads:[{id:label.id,weights:vector,bias:5}]}},videos:[]};
const video=id=>({id,handle:'fixture',videoUrl:'https://video.twimg.com/'+id+'.mp4',sourceHash:sha(id)});
async function main(){
 const revisions=[],receipts=[],catalog=new Map();let prepared=0,remoteFailures=false;
 const deps={snapshot:async()=>({state,stamp:sha('stamp')}),prepare:async()=>{prepared++;return {features:vector,frames:Array(4).fill(Buffer.from([255,216])),hash:sha('bytes')};},remote:async b=>{
 if(b.action==='status')return{automaticLabelsVersion:1};
 if(b.action==='auto-page'){revisions.push(b.modelRevision);const items=[video('1001')].filter(v=>catalog.get(v.id)!==b.modelRevision);return{items,nextCursor:'1001',upper:'1001',done:true,scanned:1,protected:0,already:1-items.length,unavailable:0};}
 if(b.action==='auto-publish'){if(remoteFailures)throw Error('LABEL_PUBLIC_REMOTE_UNAVAILABLE');catalog.set(b.input.post.id,b.input.modelRevision);receipts.push(b);return{result:'published'};}throw Error('unexpected');}};
 let service=createAutoLabels(path.join(tmp,'auto'),deps),v=await service.status();const run=async(action)=>v=await service.mutate({action,revision:v.revision,threshold:0.5});
 await run('start');await assert.rejects(run('retag-all'),/LABEL_AUTO_FINISH_CURRENT/);await run('step');assert.equal(prepared,1);
 await run('new');await run('step');assert.equal(v.counts.already,1);assert.equal(prepared,1);
 await run('retag-all');remoteFailures=true;await run('step');assert(v.pendingPublication);const token=JSON.parse(fs.readFileSync(path.join(tmp,'auto/job.json'))).replayToken;assert(token);
 service=createAutoLabels(path.join(tmp,'auto'),deps);v=await service.status();remoteFailures=false;await run('start');await run('step');assert.equal(prepared,2,'lost response retry reuses pending prediction');assert.equal(v.counts.published,1);assert.notEqual(revisions[0],revisions.at(-1));
 await run('new');await run('step');assert.equal(v.counts.already,1,'ordinary cycles retain replay version');assert.equal(prepared,2);
 await run('retag-all');await run('step');assert.equal(prepared,3,'same model can be explicitly re-run twice');assert.equal(receipts.length,3);
 // Existing failure receipts: old full-file capacity failures become eligible for the new partial receiver.
 for(const [name,code,version,expected] of [['old-size','LABEL_VIDEO_TOO_LARGE',undefined,1],['old-1024-size','LABEL_VIDEO_TOO_LARGE',2,1],['current-size','LABEL_VIDEO_TOO_LARGE',3,0],['403','LABEL_VIDEO_HTTP_FORBIDDEN',undefined,0],['404','LABEL_VIDEO_HTTP_NOT_FOUND',undefined,0]]){
  const dir=path.join(tmp,name);let calls=0;const local=createAutoLabels(dir,{...deps,prepare:async()=>{calls++;return deps.prepare();},remote:async b=>b.action==='auto-page'?{items:[video('2001')],nextCursor:'2001',upper:'2001',done:true,scanned:1,protected:0,already:0,unavailable:0}:deps.remote(b)});
  let status=await local.status();status=await local.mutate({action:'start',revision:status.revision});const file=path.join(dir,'job.json'),j=JSON.parse(fs.readFileSync(file));j.failures=[{id:'2001',sourceHash:sha('2001'),code,attemptedAt:new Date().toISOString(),...(version?{preparationVersion:version}:{})}];fs.writeFileSync(file,JSON.stringify(j));await local.mutate({action:'step',revision:status.revision});assert.equal(calls,expected,name);
 }
 // 300 manual teachers can be staged and sent in three bounded batches.
 const manual={...state,videos:Array.from({length:300},(_,i)=>({postId:String(3000+i),author:'fixture',url:'https://video.twimg.com/'+i+'.mp4',hash:sha(String(i)),review:{decisions:{[label.id]:i%2===0}},features:vector}))};const sizes=[];
 const publication=createLabelPublication(path.join(tmp,'publication'),{snapshot:async()=>({state:manual,stamp:sha('manual')}),prepare:async()=>{throw Error('must not refetch teachers');},remote:async b=>{if(b.action==='status')return{featureVersion:1,revision:1};if(b.action==='inspect')return b.ids.map(id=>({id,eligible:true,sourceHash:sha(manual.videos.find(v=>v.postId===id).url)}));if(b.action==='publish'){sizes.push(b.input.posts.length);return{revision:2};}throw Error('unexpected');}});
 let pv=await publication.status();pv=await publication.mutate({action:'stage-manual',revision:pv.revision});assert.equal(pv.rows.length,300);for(let i=0;i<3;i++)pv=await publication.mutate({action:'publish',revision:pv.revision});assert(pv.rows.every(r=>r.published));assert.deepEqual(sizes,[100,100,100]);
 console.log('PASS LABEL EXPAND: repeat full retag, replay version retained across ordinary cycles/restart; pending retry; active-job guard; legacy size retry once; 403/404 cooldown preserved; 300 manual teachers in bounded batches; synthetic data only.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{assert.equal(path.dirname(path.resolve(tmp)),path.resolve(os.tmpdir()));assert(path.basename(tmp).startsWith('twizou-label-expand-'));fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:50});});

