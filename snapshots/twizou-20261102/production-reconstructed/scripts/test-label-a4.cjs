'use strict';
const fs=require('fs'),p=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),Module=require('module'),ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createPublicCatalog}=require('../lib/public-catalog-store.ts'),{createPublicVideoService}=require('../lib/public-video-service.ts');
const tmp=fs.mkdtempSync(p.join(os.tmpdir(),'twizou-a4-')),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),label={id:crypto.randomUUID(),name:'合成タグ',active:true};
const video=id=>({id,authorId:'10',handle:'fixture',authorName:'fixture',text:'synthetic text',videoUrl:'https://video.twimg.com/'+id+'.mp4',posterUrl:null,createdAt:null,sourceHash:sha('url'+id),eligible:true});
async function main(){
 const c=createPublicCatalog(p.join(tmp,'catalog')),rows=Array.from({length:6},(_,i)=>video(String(1001+i))),model=sha('model');
 const deps={catalog:c,posts:async ids=>rows.filter(v=>ids.includes(v.id)),authorVideos:async()=>[],candidates:async()=>[],secret:async()=>'',scanPage:async()=>({videos:rows,nextCursor:'1006',upper:'1001',done:true,scanned:rows.length})};
 const service=createPublicVideoService(deps),request=(id,ids=[])=>({labels:[label],modelRevision:model,post:{id,sourceHash:rows.find(v=>v.id===id).sourceHash,labelIds:ids}});
 await c.labels({revision:0,labels:[label],posts:[{...request('1001',[label.id]).post,basis:'manual',modelRevision:null},{...request('1002').post,basis:'model_reviewed',modelRevision:null}]});
 await service.autoPublish(request('1003',[label.id]));await service.autoPublish(request('1004'));
 const before=await c.read(),retained=await service.autoPublish({...request('1003'),modelRevision:sha('updated model')});
 assert.equal(retained.result,'protected');assert.equal(retained.reason,'empty_prediction_preserved');assert.deepEqual((await c.read()).records['1003'],before.records['1003']);assert.equal((await c.read()).revision,before.revision,'empty prediction is a no-op');
 let page=await service.autoPage(null,null,model,'empty');assert.equal(page.protected,2);assert.equal(page.already,1);assert.deepEqual(page.items.map(v=>v.id),['1004','1005','1006']);
 page=await service.autoPage(null,null,model);assert.equal(page.already,2,'ordinary cycles still skip same-revision empty predictions');
 assert.equal((await service.status()).emptyLabelRetryVersion,1);await assert.rejects(service.autoPage(null,null,model,'invalid'),/PUBLIC_INVALID_SCAN/);
 // Preservation is atomic even when an automatic non-empty tag races the read.
 const savedLabels=c.labels;let raced=false;c.labels=async input=>{if(!raced){raced=true;await savedLabels({revision:(await c.read()).revision,labels:[label],posts:[{...request('1005',[label.id]).post,basis:'model_auto',modelRevision:sha('race')}]});}return savedLabels(input);};
 assert.equal((await service.autoPublish(request('1005'))).reason,'empty_prediction_preserved');assert.deepEqual((await c.read()).records['1005'].labelIds,[label.id]);c.labels=savedLabels;
 // Human corrections, explicit tag retirement and changed video sources remain possible.
 await c.labels({revision:(await c.read()).revision,labels:[label],posts:[{...request('1003').post,basis:'manual',modelRevision:null}]});assert.deepEqual((await c.read()).records['1003'].labelIds,[]);
 rows[4].sourceHash=sha('new source');assert.equal((await service.autoPublish(request('1005'))).result,'published');assert.deepEqual((await c.read()).records['1005'].labelIds,[]);
 await service.autoPublish(request('1006',[label.id]));assert.equal((await service.autoPublish({...request('1006'),labels:[{...label,active:false}]})).result,'published');assert.deepEqual((await c.read()).records['1006'].labelIds,[]);
 const local=fs.existsSync(p.join(__dirname,'../lib/label-a4-diagnostics.ts'));
 if(local){
  const {labelA4Diagnostics}=require('../lib/label-a4-diagnostics.ts'),{createAutoLabels}=require('../lib/label-auto-service.ts');
  const vector=Array(1024).fill(0),ids=[label.id,crypto.randomUUID()],state={version:1,revision:1,labels:[label,{id:ids[1],name:'不足タグ',active:true}],videos:[...Array.from({length:4},(_,i)=>({postId:String(2001+i),hash:sha('sample'+i),author:'fixture'+i,features:vector,review:{role:'train',decisions:{[label.id]:i<2,[ids[1]]:false}}})),{postId:'2010',features:vector,review:null}],model:{id:crypto.randomUUID(),fingerprint:sha('model'),head:{spec:'label-four-frames-10-25-50-80-v1',samples:200,mean:vector,scale:Array(1024).fill(1),heads:[{id:label.id,positive:2,negative:2,weights:vector,bias:0.6},{id:ids[1],positive:0,negative:4,weights:null,bias:0}]},crossCheck:{report:null}}};
  const original=JSON.stringify(state),report=labelA4Diagnostics(state,false);
  assert.equal(report.prepared,5);assert.equal(report.training,4);assert.equal(report.unreviewed,1);assert.equal(report.independentTestVideos,0);assert.equal(report.labels[0].trained,false);assert.equal(report.labels[0].guidance,'untrained');assert.equal(report.comparisons[0].tagged,4);assert.equal(report.comparisons[0].tp,2);assert.equal(report.comparisons[0].fp,2);assert.equal(report.comparisons[1].tagged,0);assert.equal(report.comparisons[1].fn,2);assert.equal(labelA4Diagnostics(state,true).comparisons[0].videos,0);assert.equal(JSON.stringify(state),original);
  for(const word of ['features','weights','videoUrl','postId','fingerprint','frames'])assert(!JSON.stringify(report).includes('"'+word+'"'));
  const calls=[],localDeps={snapshot:async()=>({state:{...state,videos:[]},stamp:sha('stamp')}),prepare:async()=>({features:vector,frames:Array(4).fill(Buffer.from([255,216])),hash:sha('video')}),remote:async body=>{calls.push(body);if(body.action==='status')return{automaticLabelsVersion:1,emptyLabelRetryVersion:1};if(body.action==='auto-page')return{items:[video('3001')],nextCursor:'3001',upper:'3001',done:true,scanned:1,protected:0,already:0,unavailable:0};if(body.action==='auto-publish')return{result:'published'};throw Error('unexpected');}};
  const dir=p.join(tmp,'worker');let worker=createAutoLabels(dir,localDeps),view=await worker.status();
  const run=async(action,threshold=0.7)=>view=await worker.mutate({action,threshold,revision:view.revision});
  await run('retry-empty');assert.equal(view.scope,'empty');await assert.rejects(run('retry-empty'),/LABEL_AUTO_FINISH_CURRENT/);await run('pause');worker=createAutoLabels(dir,localDeps);view=await worker.status();await run('start');await run('step');assert.equal(view.phase,'completed');assert.equal(calls.find(b=>b.action==='auto-page').scope,'empty');assert.equal(view.threshold,0.7);await run('new');assert.equal(view.scope,'all','scheduled next cycle must include new videos');
  const old=JSON.parse(fs.readFileSync(p.join(dir,'job.json')));delete old.scope;fs.writeFileSync(p.join(dir,'job.json'),JSON.stringify(old));assert.equal((await worker.status()).scope,'all','legacy jobs stay compatible');old.scope='bad';fs.writeFileSync(p.join(dir,'job.json'),JSON.stringify(old));await assert.rejects(worker.status(),/LABEL_AUTO_UNREADABLE/);
  const noVersion=createAutoLabels(p.join(tmp,'old-backend'),{...localDeps,remote:async()=>({automaticLabelsVersion:1})});await assert.rejects(noVersion.mutate({action:'retry-empty',revision:0}),/LABEL_AUTO_DEPLOY_FIRST/);assert(!fs.existsSync(p.join(tmp,'old-backend/job.json')));
 }
 console.log('PASS LABEL A4: atomic preservation, race/human/retired/source-change handling, empty-only selection, legacy cycles, diagnostics privacy/staleness/threshold counts, durable scope and backend feature guard; synthetic data only.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{assert.equal(p.dirname(p.resolve(tmp)),p.resolve(os.tmpdir()));assert(p.basename(tmp).startsWith('twizou-a4-'));fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
