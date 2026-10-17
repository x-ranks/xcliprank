'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
require('node:module')._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createLabelService}=require(path.join(root,'lib/label-learning-service.ts'));
const batch=require(path.join(root,'lib/label-learning-batch.ts'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-label100-'));
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const pool=Array.from({length:125},(_,i)=>({postId:String(10000+i),author:'author'+i,authorKey:'stable'+i,url:'https://video.twimg.com/'+i+'.mp4'}));
let prepares=0,lists=0;const deps={candidates:async()=>{lists++;return pool;},find:async id=>pool.find(c=>c.postId===id)??null,prepare:async url=>{prepares++;const i=Number(url.match(/\/(\d+)\.mp4$/)[1]);return{hash:hash(i),features:Array.from({length:1024},(_,j)=>j<64?(i%2?1:-1):0),times:[1,2.5,5,8],frames:Array.from({length:4},()=>Buffer.from([255,216,255,217]))};}};
async function main(){
 const outside=path.join(tmp,'protected.json');fs.writeFileSync(outside,JSON.stringify({quota:24,removed:['keep'],weights:[1,2],paused:true}));const before=fs.readFileSync(outside);
 let service=createLabelService(path.join(tmp,'state'),deps),view=await service.status();
 const run=async(action,args={})=>view=await service.mutate({action,...args,revision:view.revision});
 await run('create-label',{name:'A'});const id=view.labels[0].id;
 await assert.rejects(run('prepare',{purpose:'test'}),/LABEL_RETRAIN_REQUIRED/);assert.equal(prepares,0);assert.equal(lists,0);
 for(let i=0;i<100;i++){
  await run('prepare',{purpose:'train'});const v=view.videos.at(-1);assert.equal(v.preparedFor,'train');
  const index=Number(v.postId)-10000;
  await run('review',{postId:v.postId,role:'train',decisions:{[id]:Boolean(index%2)}});
  if(i===9){await run('train');assert.equal(view.model.samples,10);}
  if(i===19){service=createLabelService(path.join(tmp,'state'),deps);view=await service.status();assert.equal(view.trainingCount,20);assert.equal(batch.remainingPreparation(view.videos,'train',100),80);}
 }
 assert.equal(view.trainingCount,100);assert.equal(batch.preparedCount(view.videos,'train'),100);assert.equal(batch.remainingPreparation(view.videos,'train',100),0);
 await run('train');assert.equal(view.model.samples,100);assert.equal(view.model.stale,false);assert.equal(view.model.crossCheck.groups,100);assert.equal(view.model.crossCheck.report.videos,100);
 const teachers=JSON.stringify(view.videos.map(v=>v.review));
 // A changed handle with a previously learned immutable author ID is rejected.
 pool[100].author='renamed';pool[100].authorKey='stable0';
 const beforeRejected=prepares;await assert.rejects(run('prepare',{purpose:'test',postId:pool[100].postId}),/LABEL_TEST_AUTHOR_NOT_UNSEEN/);assert.equal(prepares,beforeRejected);
 for(let i=0;i<10;i++){
  await run('prepare',{purpose:'test'});const v=view.videos.at(-1);assert.equal(v.preparedFor,'test');assert.equal(v.everTrained,false);assert.equal(v.prediction,null);
  const index=Number(v.postId)-10000;assert(index>100);
  await run('review',{postId:v.postId,role:'test',decisions:{[id]:Boolean(index%2)}});
 }
 assert.equal(view.trainingCount,100);assert.equal(batch.preparedCount(view.videos,'test'),10);assert.equal(JSON.stringify(view.videos.slice(0,100).map(v=>v.review)),teachers);
 await run('check');assert.equal(view.testReport.videos,10);assert.equal(view.testReport.agreement,1);assert.equal(view.trainingCount,100);assert.equal(view.model.stale,false);
 const saved=path.join(tmp,'state/state.json');let data=JSON.parse(fs.readFileSync(saved));
 // Legacy v1 state needs no migration, no deletion, and no replacement of models.
 data.videos.forEach(v=>delete v.preparedFor);fs.writeFileSync(saved,JSON.stringify(data));service=createLabelService(path.join(tmp,'state'),deps);view=await service.status();assert.equal(view.trainingCount,100);assert.equal(view.model.samples,100);assert.equal(view.testReport.videos,10);assert.equal(batch.preparedCount(view.videos,'test'),10);
 assert.deepEqual(fs.readFileSync(outside),before);
 const partial=Array.from({length:37},()=>({review:null,preparedFor:'train'}));assert.equal(batch.preparationGoal(partial,'train',100),100);assert.equal(batch.remainingPreparation(partial,'train',100),63);assert.equal(batch.preparationGoal(partial,'train',10),47);
 assert.equal(batch.remainingPreparation(Array.from({length:300},()=>({review:null,preparedFor:'train'})),'test',10),0);
 console.log('PASS LABEL100: 100 cumulative teachers, 10-to-100 retraining, restart/resume, 10 unseen-author blind random candidates, immutable identity rejection before download, old state/model retention, 100 grouped cross-check rows, protected state and bounded goals. Synthetic media/DB only; not real-world accuracy.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{const p=path.resolve(tmp);if(path.dirname(p)!==path.resolve(os.tmpdir())||!path.basename(p).startsWith('xclip-label100-'))throw Error('UNSAFE_CLEANUP');fs.rmSync(p,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
