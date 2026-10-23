'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module');
const ts=require('typescript'),root=path.resolve(__dirname,'..'),realLoad=Module._load;
const mocks=new Map();
Module._load=function(id,parent,main){const resolved=(()=>{try{return Module._resolveFilename(id,parent);}catch{return id;}})();return mocks.has(resolved)?mocks.get(resolved):realLoad.apply(this,arguments);};
Module._extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const core=require('../lib/label-learning-core.ts'),{createLabelService}=require('../lib/label-learning-service.ts'),http=require('../lib/label-learning-http.ts');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-label-test-'));
const sha=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
const vector=x=>Array.from({length:1024},(_,i)=>i<128?x:0);
const fixture=Array.from({length:20},(_,i)=>({postId:String(100+i),author:'author'+i,authorKey:'id'+i,url:'https://video.twimg.com/'+i+'.mp4'}));
const deps={candidates:async()=>fixture,find:async id=>fixture.find(x=>x.postId===id)??null,prepare:async url=>{const i=Number(url.match(/\/(\d+)\.mp4$/)[1]);return{hash:sha(i),features:vector(i%2?1:-1),frames:Array.from({length:4},()=>Buffer.from([255,216,255,217])),times:[1,2.5,5,8]};}};
async function main(){
 const protection=path.join(temporary,'untouched.json');fs.writeFileSync(protection,JSON.stringify({authors:[{id:1,paused:true}],quota:24,cursor:'preserve',removed:['2'],teacher:['A'],weights:[1,2,3]}));const original=fs.readFileSync(protection);
 const service=createLabelService(path.join(temporary,'labels'),deps);
 let state=await service.status();assert.equal(state.revision,0);assert(!fs.existsSync(path.join(temporary,'labels')));
 const run=async(action,body={})=>{state=await service.mutate({action,...body,revision:state.revision});return state;};
 await run('create-label',{name:'ラベルA'});const a=state.labels[0].id;await run('create-label',{name:'ラベルB'});const b=state.labels[1].id;
 await assert.rejects(run('create-label',{name:'ラベルA'}),/LABEL_DUPLICATE_NAME/);
 await assert.rejects(service.mutate({action:'create-label',name:'stale',revision:0}),/LABEL_STALE_SCREEN/);
 for(let i=0;i<10;i++){
  await run('prepare',{postId:fixture[i].postId});
  await run('review',{postId:fixture[i].postId,role:'train',decisions:{[a]:Boolean(i%2),[b]:null}});
 }
 assert.equal(state.trainingCount,10);assert.equal((await service.frame('100',0))[0],255);
 await assert.rejects(service.frame('../100',0),/LABEL_INVALID_INPUT/);
 await assert.rejects(service.frame('100',4),/LABEL_INVALID_INPUT/);
 await run('train');assert(state.model);assert.equal(state.model.stale,false);
 assert.equal(state.model.heads.find(x=>x.id===b).ready,false);assert(state.model.crossCheck.report.agreement>.9);
 assert(!JSON.stringify(state).includes('"features"'));assert(!JSON.stringify(state).includes('"weights"'));
 await run('prepare',{postId:'110'});await run('review',{postId:'110',role:'test',decisions:{[a]:false,[b]:null}});
 await run('prepare',{postId:'111'});await run('review',{postId:'111',role:'test',decisions:{[a]:true}});
 await run('check');assert.equal(state.testReport.videos,2);assert.equal(state.testReport.agreement,1);assert.equal(state.testReport.labels.find(x=>x.id===b).scored,0);
 await run('review',{postId:'110',role:'test',decisions:{[a]:false}});assert.equal(state.videos.find(v=>v.postId==='110').review.blinded,false);
 await run('check');assert.equal(state.testReport.videos,1);
 await run('predict',{postId:'112'}).catch(e=>assert.match(e.message,/LABEL_VIDEO_NOT_FOUND/));
 await run('prepare',{postId:'112'});await run('predict',{postId:'112'});await run('review',{postId:'112',role:'test',decisions:{[a]:false}});assert.equal(state.videos.find(v=>v.postId==='112').review.blinded,false);
 await run('review',{postId:'100',role:'test',decisions:{[a]:false}});assert.equal(state.model.stale,true);assert(state.videos.find(v=>v.postId==='100').everTrained);
 await assert.rejects(run('check'),/LABEL_RETRAIN_REQUIRED/);
 const restarted=createLabelService(path.join(temporary,'labels'),deps);assert.equal((await restarted.status()).trainingCount,9);
 await run('review',{postId:'100',role:'train',decisions:{[a]:false}});await run('train');assert.equal(state.model.stale,false);
 // Same immutable author identifier, changed handle: cannot count as unseen-author test.
 fixture[13].authorKey='id0';fixture[13].author='renamed';await run('prepare',{postId:'113'});await run('review',{postId:'113',role:'test',decisions:{[a]:true}});await run('check');assert.equal(state.testReport.videos,1);
 await run('edit-label',{id:a,name:'ラベルA改',active:false});assert.equal(state.model.stale,true);assert.equal(state.trainingCount,10);
 const corrupted=path.join(temporary,'labels','state.json'),saved=fs.readFileSync(corrupted);fs.writeFileSync(corrupted,'{"version":9}');await assert.rejects(service.status(),/LABEL_STATE_CORRUPT/);await assert.rejects(service.mutate({action:'create-label',name:'no',revision:state.revision}),/LABEL_STATE_CORRUPT/);assert.equal(fs.readFileSync(corrupted,'utf8'),'{"version":9}');fs.writeFileSync(corrupted,saved);
 assert.deepEqual(fs.readFileSync(protection),original);
 // All labels unknown -> no negatives invented; train/test grouping includes duplicates.
 const samples=Array.from({length:10},(_,i)=>({postId:String(i),hash:sha(i),author:'a'+i,features:vector(i%2?1:-1),decisions:{a:Boolean(i%2),b:null}}));
 assert.equal(core.fitLabels(samples,['a','b']).heads[1].negative,0);samples[1].hash=samples[0].hash;const groups=core.sampleGroups(samples);assert.equal(groups[0],groups[1]);
 assert.equal(core.crossCheckLabels(samples.map(s=>({...s,author:'same'})),['a']).report,null);
 // Request guards precede dynamic imports, no external Host/Origin/production access.
 const req=(method='GET',host='localhost:3004',origin)=>new Request('http://'+host+'/api/label-learning',{method,headers:{host,...(origin?{origin}:{})}});
 assert(http.allowLabelRequest(req(),false));assert(!http.allowLabelRequest(req(),true));assert(!http.allowLabelRequest(req('POST'),false));assert(!http.allowLabelRequest(req('POST','localhost:3004','https://evil.invalid'),false));assert(!http.allowLabelRequest(req('GET','example.com'),false));assert(!http.allowLabelRequest(new Request('http://localhost:3004/api',{headers:{host:'127.0.0.1:3004'}}),false));
 const env=process.env.NODE_ENV;process.env.NODE_ENV='development';let backendCalls=0;
 mocks.set(path.join(root,'lib','label-learning-server.ts'),{labelService:{status:async()=>{backendCalls++;return {ok:true};},mutate:async body=>{backendCalls++;return {action:body.action};},frame:async()=>{backendCalls++;return Buffer.from([255,216]);}}});
 const route=require('../app/api/label-learning/route.ts');assert.equal((await route.GET(req('GET','example.com'))).status,404);assert.equal(backendCalls,0);assert.equal((await route.GET(req())).status,200);
 const postReq=body=>new Request('http://localhost:3004/api/label-learning',{method:'POST',headers:{host:'localhost:3004',origin:'http://localhost:3004','content-type':'application/json'},body});
 assert.equal((await route.POST(postReq(JSON.stringify({action:'train',revision:1})))).status,200);const before=backendCalls;assert.equal((await route.POST(postReq('x'.repeat(40000)))).status,400);assert.equal(backendCalls,before);
 process.env.NODE_ENV='production';assert.equal((await route.GET(req())).status,404);assert.equal(backendCalls,before);if(env===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=env;
 const frameRoute=require('../app/api/label-learning/frame/route.ts');process.env.NODE_ENV='development';const badFrame=new Request('http://localhost:3004/api/label-learning/frame?postId=100&index=0abc',{headers:{host:'localhost:3004'}});assert.equal((await frameRoute.GET(badFrame)).status,400);
 // A live mutation lock rejects concurrent writers; failed preparation survives restart.
 let unblock;const wait=new Promise(resolve=>unblock=resolve);const concurrent=createLabelService(path.join(temporary,'concurrent'),{...deps,prepare:async u=>{await wait;return deps.prepare(u);}});let c=await concurrent.mutate({action:'create-label',name:'A',revision:0});const pending=concurrent.mutate({action:'prepare',postId:'100',revision:c.revision});await new Promise(resolve=>setTimeout(resolve,20));await assert.rejects(concurrent.mutate({action:'create-label',name:'B',revision:c.revision}),/LABEL_BUSY/);unblock();await pending;
 const failed=createLabelService(path.join(temporary,'failed'),{...deps,prepare:async()=>{throw Error('LABEL_VIDEO_FETCH_FAILED');}});await failed.mutate({action:'create-label',name:'A',revision:0});await assert.rejects(failed.mutate({action:'prepare',postId:'100',revision:1}),/LABEL_VIDEO_FETCH_FAILED/);assert.equal((await failed.status()).revision,2);assert.equal((await failed.status()).videos.length,0);
 const duplicate=createLabelService(path.join(temporary,'duplicate'),{...deps,prepare:async()=>deps.prepare(fixture[0].url)});await duplicate.mutate({action:'create-label',name:'A',revision:0});await duplicate.mutate({action:'prepare',postId:'100',revision:1});await assert.rejects(duplicate.mutate({action:'prepare',postId:'101',revision:2}),/LABEL_DUPLICATE_VIDEO/);assert.equal((await duplicate.status()).videos.length,1);
 const linkTarget=path.join(temporary,'link-target'),linkParent=path.join(temporary,'linked');fs.mkdirSync(linkTarget);fs.symlinkSync(linkTarget,linkParent,process.platform==='win32'?'junction':'dir');const linked=createLabelService(path.join(linkParent,'labels'),deps);await assert.rejects(linked.mutate({action:'create-label',name:'A',revision:0}),/LABEL_UNSAFE_FILE/);assert.equal(fs.readdirSync(linkTarget).length,0);fs.unlinkSync(linkParent);
 // Actual video helper with synthetic bytes: allowlist, max-size refusal, four frames,
 // matching feature order, no Tier cache writes, and temporary MP4 cleanup.
 const tierVideo=path.join(root,'lib','tier-personal-video.ts'),tierImage=path.join(root,'lib','tier-personal-image.ts');let decoded=0,lastVideoFile;
 mocks.set(tierVideo,{ensureVideoTools:async()=>{},extractLocalVideoFrames:async file=>{decoded++;lastVideoFile=file;assert.deepEqual(fs.readFileSync(file),Buffer.from([1,2,3]));return{times:[1,2,3,4],frames:Array.from({length:4},(_,i)=>Buffer.from([255,216,i]))};}});
 mocks.set(tierImage,{extractPersonalFrame:async bytes=>Array(256).fill(bytes[2])});
 const video=require('../lib/label-learning-video.ts');const previousFetch=global.fetch;let httpCalls=0;
 try{
  global.fetch=async(u,o)=>{httpCalls++;assert.equal(o.redirect,'error');assert.equal(o.cache,'no-store');return new Response(new Uint8Array([1,2,3]),{headers:{'content-length':'3'}});};
  const prepared=await video.prepareLabelVideo('https://video.twimg.com/fixture.mp4');assert.equal(prepared.features.length,1024);assert.equal(prepared.features[256],1);assert.equal(prepared.features[768],3);assert.equal(prepared.frames.length,4);assert(!fs.existsSync(lastVideoFile));assert.equal(decoded,1);
  await assert.rejects(video.prepareLabelVideo('https://evil.invalid/fixture.mp4'),/LABEL_VIDEO_URL_REFUSED/);assert.equal(httpCalls,1);
  global.fetch=async()=>new Response(new Uint8Array([1]),{headers:{'content-length':String(97*1024*1024)}});await assert.rejects(video.prepareLabelVideo('https://video.twimg.com/too-big.mp4'),/LABEL_VIDEO_TOO_LARGE/);assert.equal(decoded,1);
  global.fetch=async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-length':String(97*1024*1024)}});await video.prepareLabelVideo('https://video.twimg.com/auto-limit.mp4',{maxBytes:256*1024*1024});assert.equal(decoded,2);
  global.fetch=async()=>new Response(null,{status:403});await assert.rejects(video.prepareLabelVideo('https://video.twimg.com/forbidden.mp4'),/LABEL_VIDEO_HTTP_FORBIDDEN/);
 }finally{global.fetch=previousFetch;}
 // Actual read-only DB adapter, isolated cwd; query selection excludes heavy columns.
 const priorCwd=process.cwd();process.chdir(temporary);
 try{
  let databaseReads=0;const queryCalls=[];const row={x_post_id:'900',author_id:'stable-author',author_username:'fixture',video_url:'https://video.twimg.com/0.mp4'};
  const db={from(table){assert.equal(table,'posts');const q={};for(const method of ['select','eq','not','or','order','limit','range'])q[method]=(...args)=>{queryCalls.push([method,...args]);return q;};q.maybeSingle=async()=>{databaseReads++;const eq=queryCalls.filter(c=>c[0]==='eq'&&c[1]==='x_post_id').at(-1);return{data:eq?.[2]==='901'?{...row,x_post_id:'901',author_id:'stable-author-2',video_url:'https://video.twimg.com/1.mp4'}:row,error:null};};q.then=(resolve,reject)=>{databaseReads++;return Promise.resolve({data:[row,{...row,x_post_id:'901',author_id:'stable-author-2',video_url:'https://video.twimg.com/1.mp4'}],error:null}).then(resolve,reject);};return q;}};
  mocks.set(path.join(root,'lib','supabase-admin.ts'),{supabaseAdmin:()=>db});
  mocks.set(path.join(root,'lib','label-learning-video.ts'),{allowedLabelVideo:video.allowedLabelVideo,prepareLabelVideo:deps.prepare});
  const serverPath=path.join(root,'lib','label-learning-server.ts');mocks.delete(serverPath);delete require.cache[serverPath];const server=require(serverPath).labelService;
  await server.status();assert.equal(databaseReads,0);await server.mutate({action:'create-label',name:'fixture',revision:0});await server.mutate({action:'prepare',revision:1});assert.equal(databaseReads,2);assert(queryCalls.some(c=>c[0]==='select'&&c[1]==='x_post_id,author_id,author_username,video_url'));assert(queryCalls.some(c=>c[0]==='range'&&c[1]===0&&c[2]===199));assert(queryCalls.some(c=>c[0]==='eq'&&c[1]==='is_visible'&&c[2]===true));await server.mutate({action:'prepare',revision:2});assert.equal(databaseReads,3);assert.equal(queryCalls.filter(c=>c[0]==='range').length,1,'candidate metadata reused; each selected post still rechecked');
 }finally{process.chdir(priorCwd);}
 console.log('PASS LABEL LEARNING: 10-video training; 4 frames; masked unknown; grouped OOF; blind unseen tests; train/author/duplicate exclusion; stale/restart/corrupt state; isolated writes; guards and actual API handlers; concurrency and failed receipts. No provider/DB calls.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{const resolved=path.resolve(temporary);if(!path.basename(resolved).startsWith('xclip-label-test-')||path.dirname(resolved)!==path.resolve(os.tmpdir()))throw Error('UNSAFE_TEST_CLEANUP');fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
