const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();let dbCalls=0,paidCalls=0,dbFailure=false;
const authors=[{x_author_id:'123',username:'test',name:'Test',is_curated:true,curated_status:'active',curated_expected_tier:'S',curated_last_post_id:'5000'}],posts=[];
const db={from(table){dbCalls++;let operation='read',values,filters=[];const q={select(){return q;},eq(k,v){filters.push([k,[v]]);return q;},is(k,v){filters.push([k,[v]]);return q;},in(k,v){filters.push([k,v]);return q;},limit(){return q;},order(){return q;},
 upsert(v,o){assert.equal(o.ignoreDuplicates,true);operation='insert';values=Array.isArray(v)?v:[v];return q;},update(v){operation='update';values=v;return q;},
 maybeSingle(){return q.then(r=>({...r,data:r.data?.[0]??null}));},then(resolve,reject){let data=[];const store=table==='authors'?authors:posts;
 if(dbFailure)return Promise.resolve({data:null,error:{message:'DB_ERROR'}}).then(resolve,reject);
 if(operation==='insert'){for(const row of values){const key=table==='authors'?'x_author_id':'x_post_id';if(!store.some(x=>x[key]===row[key])){store.push({...row});data.push(row);}}}
 else{data=store.filter(row=>filters.every(([k,v])=>v.includes(row[k]===undefined&&v.includes(null)?null:row[k])));if(operation==='update')for(const row of data)Object.assign(row,values);}
 return Promise.resolve({data,error:null}).then(resolve,reject);}};return q;}};
const substitutions={'lib/supabase-admin':{supabaseAdmin:()=>db},'lib/tier-learning':{loadTierLearningModel:async()=>null,predictLearnedTier:()=>null,blendRuleAndLearnedTier:r=>r},
 'lib/curated-collector':{collectCuratedAuthor:()=>{paidCalls++;throw Error('PAID_CALLED');},CURATED_AUTHOR_SELECT:'*'},'lib/x':{validRecentSearchSinceId:()=>{paidCalls++;throw Error('PAID_CALLED');}},'lib/post-status-store':{unavailableKeys:async()=>new Set(),readPostState:async()=>({cooldownUntil:0})}};
function load(id){if(substitutions[id])return substitutions[id];if(/x-api-usage/.test(id))throw Error('PAID_IMPORT');if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const author={id:'123',username:'test',name:'Test',expectedTier:'S',paused:false};
const candidate=id=>({x_post_id:id,author_id:'123',author_username:'test',author_name:'Test',text:'public video test',possibly_sensitive:false,
 created_at:new Date(Date.now()-3600000).toISOString(),x_url:`https://x.com/test/status/${id}`,media_key:'v'+id,media_type:'video',preview_image_url:null,
 video_url:`https://video.twimg.com/${id}.mp4`,video_bitrate:100,views:30,likes:2,reposts:1,replies:0,quotes:0,bookmarks:0,durationSeconds:20,videoCount:1});
const status=id=>({type:'status',provider:'twitter',id,text:'public video test',author:{id:'123',screen_name:'test',protected:false},created_timestamp:Date.now()/1000-3600,possibly_sensitive:false,media:{videos:[{type:'video',duration:20,formats:[{container:'mp4',url:`https://video.twimg.com/${id}.mp4`,bitrate:100}]}]}});
(async()=>{const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-free-production-'));try{
 const publish=load('lib/free-curated-publish'),store=load('lib/free-curated-server-store'),scan=load('lib/free-curated-scan'),sync=load('lib/free-curated-sync');
 const protectedRow={...candidate('8888'),is_visible:false,moderation_blocked:true,review_required:true,manual_tier:'NONE',collection_source:'curated',last_seen_at:new Date().toISOString(),author_stats_counted:false,adult_tier:'S',content_category:'PASS'};posts.push(protectedRow);
 const preserved=JSON.stringify(protectedRow);
 let result=await publish.publishFreeCandidates(author,[candidate('8888'),candidate('9000'),candidate('9001')],{database:db,blocked:new Set(['post:9001']),modelLoader:async()=>null,previousHiddenSaveAt:new Date().toISOString()});
 assert.equal(result.saved,1);assert.equal(result.promoted,0);assert.equal(result.excluded,1);assert.equal(JSON.stringify(protectedRow),preserved);assert(posts.find(p=>p.x_post_id==='9000').is_visible);assert.equal(authors[0].curated_status,'active');
 const visible=posts.find(p=>p.x_post_id==='9000');visible.is_visible=false;visible.manual_tier='NONE';const before=JSON.stringify(visible);
 result=await publish.publishFreeCandidates(author,[candidate('9000')],{database:db,blocked:new Set(),modelLoader:async()=>null});assert.equal(result.saved,0);assert.equal(result.promoted,0);assert.equal(JSON.stringify(visible),before);
 const hidden={...candidate('7777'),is_visible:false,moderation_blocked:false,review_required:false,manual_tier:null,collection_source:'curated',last_seen_at:new Date(Date.now()-2000).toISOString(),author_stats_counted:false,adult_tier:'B',content_category:'PASS'};posts.push(hidden);
 result=await publish.publishFreeCandidates(author,[{...hidden,durationSeconds:20,videoCount:1}],{database:db,blocked:new Set(),modelLoader:async()=>null,previousHiddenSaveAt:new Date().toISOString()});assert.equal(result.promoted,1);assert.equal(hidden.adult_tier,'B');
 assert.equal(result.outcomes.knownPostOrMedia,0); // Promotion accounted once, not as a remaining duplicate.
 authors[0].review_required=true;
 result=await publish.publishFreeCandidates(author,[candidate('6666')],{database:db,blocked:new Set(),modelLoader:async()=>null});
 assert.equal(result.saved,0);assert.equal(result.excluded,1);assert.equal(result.outcomes.contentOrReview,1);assert(!posts.some(p=>p.x_post_id==='6666'));assert.equal(authors[0].review_required,true);delete authors[0].review_required;
 result=await publish.publishFreeCandidates(author,[candidate('6101'),{...candidate('6102'),video_url:candidate('6101').video_url}],{database:db,blocked:new Set(),modelLoader:async()=>null});
 assert.equal(result.saved,1);assert.equal(result.outcomes.batchDuplicate,1);
 result=await publish.publishFreeCandidates(author,[candidate('6101')],{database:db,blocked:new Set(),modelLoader:async()=>null});assert.equal(result.saved,0);assert.equal(result.outcomes.knownPostOrMedia,1);
 dbFailure=true;await assert.rejects(publish.publishFreeCandidates(author,[candidate('2222')],{database:db,blocked:new Set(),modelLoader:async()=>null}),e=>e.status===503);dbFailure=false;
 const baseline=store.freshFreeState();baseline.authors=[{...scan.newScheduledAuthor(author,"free",Date.now()),latestId:"8000"}];await store.writeScheduledFreeState(baseline,tmp);
 process.env.SUPABASE_URL='https://example.supabase.co';process.env.CRON_SECRET='TEST_SECRET_NOT_FOR_LOGS';
 const {NextRequest}=require('next/server'),route=load('app/api/free-curated-sync/route');
 assert.equal((await route.GET(new NextRequest('https://xcliprank.com/api/free-curated-sync?secret=TEST_SECRET_NOT_FOR_LOGS'))).status,401);
 const authorized=new NextRequest('https://xcliprank.com/api/free-curated-sync',{headers:{authorization:'Bearer TEST_SECRET_NOT_FOR_LOGS'}});assert.equal((await route.GET(authorized)).status,200);
 await assert.rejects(sync.synchronizeFreeCurated({action:'sync',databaseHost:'wrong',authors:[author]},{directory:tmp}),e=>e.status===400);
 result=await sync.synchronizeFreeCurated({action:'sync',databaseHost:'example.supabase.co',authors:[author]},{directory:tmp});assert.equal(result.synced,1);assert.equal(result.state.authors[0].source,'free');assert.equal(result.state.authors[0].latestId,'8000');
 result=await sync.synchronizeFreeCurated({action:'sync',databaseHost:'example.supabase.co',authors:[]},{directory:tmp});assert.equal(result.state.authors[0].paused,false);
 const batch=load('app/api/collect-curated-batch/route');process.env.NODE_ENV='production';const normal=new NextRequest('https://xcliprank.com/api/collect-curated-batch',{headers:{authorization:'Bearer TEST_SECRET_NOT_FOR_LOGS'}});
 assert.equal((await (await batch.GET(normal)).json()).paid_x_requests,0);assert.equal(paidCalls,0);
 assert.equal((await batch.GET(new NextRequest('https://xcliprank.com/api/collect-curated-batch'))).status,401);
 assert.equal((await batch.GET(new NextRequest('https://xcliprank.com/api/collect-curated-batch?recovery=1',{headers:{authorization:'Bearer TEST_SECRET_NOT_FOR_LOGS'}}))).status,400);
 const client=load('lib/free-curated-client');let proxyCalls=0;
 await client.callFreeProduction({action:'status'},async(url,init)=>{proxyCalls++;assert.equal(url,'https://xcliprank.com/api/free-curated-sync');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer TEST_SECRET_NOT_FOR_LOGS');return Response.json({ok:true});});assert.equal(proxyCalls,1);
 const valid=sync.parseSyncCandidates([candidate('3333')],author);assert.equal(valid[0].x_url,'https://x.com/test/status/3333');assert.throws(()=>sync.parseSyncCandidates([{...candidate('3333'),video_url:'https://evil.test/a.mp4'}],author));
 await fsp.writeFile(path.join(tmp,'state-v1.json'),'corrupt');await assert.rejects(store.readScheduledFreeState(tmp),e=>e.status===503);
 console.log('PASS PRODUCTION PUBLICATION: public rows; hidden promotion; manual/removal/duplicates preserved; DB failure; authenticated sync/DB match; legacy scheduled entry bypass; fixed client destination; corrupt state refused. Network/DB mocked.');
 }finally{await fsp.rm(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
