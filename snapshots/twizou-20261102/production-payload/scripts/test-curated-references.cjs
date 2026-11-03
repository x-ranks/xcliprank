'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map(),authors=[{x_author_id:'10001',username:'selected',is_curated:true,curated_status:'active',review_required:false}],posts=[],references=[];
let tableFail=false,writeFail=false,manualEntries=[];const operations=[];
const db={from(table){let filters=[],rowLimit=Infinity,start=0,end=Infinity,mode='select',values,opts,single=false;
 const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(String(r[k])));return q},not(k,op,v){filters.push(r=>r[k]!==v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},lt(k,v){filters.push(r=>r[k]<v);return q},or(){return q},order(){return q},limit(n){rowLimit=n;return q},range(a,b){start=a;end=b;return q},maybeSingle(){single=true;return q},upsert(v,o){mode='upsert';values=Array.isArray(v)?v:[v];opts=o;return q},update(v){mode='update';values=[v];return q},then(resolve,reject){
  operations.push({table,mode});if(table==='curated_video_references'&&(tableFail||writeFail&&mode==='upsert'))return Promise.resolve({data:null,error:{message:'synthetic'}}).then(resolve,reject);
  const list=table==='authors'?authors:table==='posts'?posts:references;let out=list.filter(r=>filters.every(f=>f(r)));
  if(mode==='upsert'){out=[];for(const v of values){const keys=(opts?.onConflict??'x_post_id').split(','),old=list.find(r=>keys.every(k=>r[k]===v[k]));if(!old){const r={...v};list.push(r);out.push(r);}else if(!opts?.ignoreDuplicates){Object.assign(old,v);out.push(old);}}}
  if(mode==='update')for(const r of out)Object.assign(r,values[0]);
  out=out.slice(start,Math.min(end+1,start+rowLimit));return Promise.resolve({data:single?out[0]??null:out,error:null}).then(resolve,reject);
 }};return q;}};
const stubs={'lib/manual-ranking':{readManualState:async()=>({revision:0,entries:manualEntries})},'lib/supabase-admin':{supabaseAdmin:()=>db},'lib/curated-common':{ensureCommonAuthor:async()=>{throw Error('REFERENCE_MUST_NOT_ENROLL_AUTHOR')}},'lib/tier-learning':{loadTierLearningModel:async()=>null,predictLearnedTier:()=>null,blendRuleAndLearnedTier:r=>r},'lib/post-status-store':{unavailableKeys:async()=>new Set()},'lib/public-catalog-store':{createPublicCatalog:()=>({})},'lib/public-save-secret':{publicCatalogDirectory:()=>'/fixture-unused',publicSaveSecret:async()=>''},'lib/public-video-service':{createPublicVideoService:deps=>deps}};
function load(id){if(stubs[id])return stubs[id];if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const parser=load('lib/fxtwitter-curated'),helper=load('lib/curated-video-references');
const curator={id:'10001',username:'selected',name:'Selected',expectedTier:'S'},source={id:'20001',screen_name:'original',name:'Original',protected:false};
const video={type:'video',format:'video/mp4',url:'https://video.twimg.com/fixture.mp4',id:'video-fixture',duration:20,publisher:{...source}};
const post=(id,author=source)=>({type:'status',provider:'twitter',id,author,text:'fixture video',created_timestamp:Math.floor(Date.now()/1000)-3600,possibly_sensitive:false,media:{videos:[{...video,url:'https://video.twimg.com/'+id+'.mp4',id:'video'+id}]}});
const original=post('30001'),quote={...post('40001',{...curator,screen_name:curator.username,protected:false}),media:undefined,quote:original};
const parse=rows=>parser.parseFreeMediaPage({code:200,results:rows},curator,true,true);
(async()=>{
 const native=post('41001',{...curator,screen_name:curator.username,protected:false});native.media.videos[0].publisher=source;
 assert.equal(parse([native]).posts.length,1);assert.equal(parse([native]).posts[0].author_id,curator.id); // Same structure as supplied embedded-video example.
 let p=parse([quote,original]);assert.equal(p.timeline.trusted,true);assert.equal(p.posts.length,0);assert.equal(p.referencedPosts.length,1);assert.equal(p.referencedPosts[0].candidate.author_id,source.id);assert.equal(p.referencedPosts[0].candidate.x_post_id,original.id);assert.deepEqual(p.timeline.ids,[quote.id]);
 assert.equal(parser.parseFreeMediaPage({code:200,results:[quote]},curator,true).referencedPosts.length,0); // Old registration contract unchanged.
 p=parse([{...original,reposted_by:{id:curator.id}}]);assert.equal(p.referencedPosts.length,1);assert.equal(p.referencedPosts[0].kind,'repost');assert.deepEqual(p.timeline.ids,[]);
 assert.equal(parse([{...original,reposted_by:{id:'90001'}}]).timeline.trusted,false);
 p=parse([quote,post('50001')]);assert.equal(p.timeline.trusted,true); // Unrelated foreign row does not discard the author's verified quote.
 assert.deepEqual(p.timeline.ids,[quote.id]);assert.equal(p.posts.length,0);assert.equal(p.referencedPosts.length,1);
 assert.equal(parse([{...quote,quote:{...original,type:'tombstone',reason:'deleted'}}]).referencedPosts.length,0);
 assert.equal(parse([{...quote,quote:{...original,author:{...source,protected:true}}}]).referencedPosts.length,0);
 assert.equal(parse([{...quote,quote:{...original,media:{videos:[{...video,url:'https://outside.invalid/a.mp4'}]}}}]).referencedPosts.length,0);
 assert.equal(parse([{...quote,quote:undefined,card:{url:'https://outside.invalid/'}}]).referencedPosts.length,0);
 const pub=load('lib/free-curated-publish'),ref=parse([quote]).referencedPosts;
 let result=await pub.publishFreeReferencedPosts(curator,ref,{database:db,blocked:new Set()});assert.equal(result.saved,1);assert.equal(posts[0].author_id,source.id);assert.equal(posts[0].author_username,'original');assert.equal(posts[0].x_url,'https://x.com/original/status/30001');assert.equal(authors.find(a=>a.x_author_id===source.id).is_curated,false);assert.equal(authors.filter(a=>a.is_curated).length,1);assert.equal(references.length,1);
 const insertAt=operations.findIndex(o=>o.table==='posts'&&o.mode==='upsert'),proofAt=operations.findIndex(o=>o.table==='curated_video_references'&&o.mode==='upsert');assert(proofAt<insertAt);
 result=await pub.publishFreeReferencedPosts(curator,ref,{database:db,blocked:new Set()});assert.equal(result.saved,0);assert.equal(result.outcomes.knownPostOrMedia,1);assert.equal(posts.length,1);
 let facts=await helper.readCuratedReferences(db,[original.id]),eligible=await helper.eligibleCuratedReferences(db,facts);assert.equal(eligible.length,1);assert(helper.referencePermitsPost(posts[0],eligible));assert(!helper.referencePermitsPost({...posts[0],video_url:'https://video.twimg.com/changed.mp4'},eligible));assert(!helper.referencePermitsPost({...posts[0],x_post_id:'30099'},eligible));
 authors[0].curated_status='paused';assert.equal((await helper.eligibleCuratedReferences(db,facts)).length,0);authors[0].curated_status='active';authors[0].review_required=true;assert.equal((await helper.eligibleCuratedReferences(db,facts)).length,0);
 const newRef=parse([{...quote,id:'40002',quote:post('30002')}]).referencedPosts;
 result=await pub.publishFreeReferencedPosts(curator,newRef,{database:db,blocked:new Set()});assert.equal(result.outcomes.contentOrReview,1);assert.equal(posts.length,1);authors[0].review_required=false;
 const owner=authors.find(a=>a.x_author_id===source.id);owner.review_required=true;result=await pub.publishFreeReferencedPosts(curator,newRef,{database:db,blocked:new Set()});assert.equal(result.outcomes.contentOrReview,1);assert.equal((await helper.eligibleCuratedReferences(db,facts)).length,0);owner.review_required=false;
 owner.curated_status='removed';result=await pub.publishFreeReferencedPosts(curator,newRef,{database:db,blocked:new Set()});assert.equal(result.outcomes.unavailable,1);owner.curated_status=null;
 result=await pub.publishFreeReferencedPosts(curator,[{...newRef[0],viaText:'高校生'}],{database:db,blocked:new Set()});assert.equal(result.outcomes.contentOrReview,1);assert.equal(posts.length,1);
 tableFail=true;await assert.rejects(helper.readCuratedReferences(db),/REFERENCES_UNAVAILABLE/);tableFail=false;
 writeFail=true;await assert.rejects(pub.publishFreeReferencedPosts(curator,newRef,{database:db,blocked:new Set()}),/REFERENCE_WRITE_FAILED/);assert.equal(posts.length,1);writeFail=false;
 const service=load('lib/public-video-production').productionPublicBackend().service;
 posts.push({...posts[0],x_post_id:'30099',video_url:'https://video.twimg.com/unrelated.mp4'});
 let visible=await service.posts(['30001','30099']);assert.deepEqual(visible.map(v=>v.id),['30001']);assert.equal(visible[0].handle,'original'); // One referenced video grants no permission for the author's other posts.
 const routeSource=fs.readFileSync(path.join(root,'app/api/rankings/route.ts'),'utf8'),region=routeSource.slice(routeSource.indexOf('async function fetchCandidates('),routeSource.indexOf('function sortPosts('));
 const compiled=ts.transpileModule(region+'\nexport {fetchCandidatePool};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,rankingModule={exports:{}};
 const manualPermission=load('lib/manual-x-permissions');
 new Function('supabaseAdmin','unavailableKeys','isUnavailablePost','applyManualTierOverride','DISPLAY_TIERS','readCuratedReferences','eligibleCuratedReferences','referencePermitsPost','readManualState','eligibleManualXIds','exports',compiled)(()=>db,async()=>new Set(),()=>false,p=>p,['S','A+','A','B+','B','C'],helper.readCuratedReferences,helper.eligibleCuratedReferences,helper.referencePermitsPost,stubs['lib/manual-ranking'].readManualState,manualPermission.eligibleManualXIds,rankingModule.exports);
 let ranking=await rankingModule.exports.fetchCandidatePool(null,new Set([curator.id]));assert.deepEqual(ranking.map(v=>v.x_post_id),['30001']);
 manualEntries=[{xApproval:{postId:'30099',authorId:source.id,videoHash:helper.referenceSourceHash(posts[1].video_url)}}];
 assert.deepEqual((await service.posts(['30099'])).map(v=>v.id),['30099']);
 assert.deepEqual((await rankingModule.exports.fetchCandidatePool(null,new Set([curator.id]),undefined,{ids:['30099']})).map(v=>v.x_post_id),['30099']);
 posts[1].is_visible=false;assert.deepEqual(await service.posts(['30099']),[]);assert.deepEqual(await rankingModule.exports.fetchCandidatePool(null,new Set([curator.id]),undefined,{ids:['30099']}),[]);posts[1].is_visible=true;manualEntries=[];
 authors[0].curated_status='paused';assert.equal((await load('lib/public-video-production').productionPublicBackend().service.posts(['30001'])).length,0);assert.equal((await rankingModule.exports.fetchCandidatePool(null,new Set())).length,0);authors[0].curated_status='active';
 assert.equal((await helper.eligibleCuratedReferences(db,facts,new Set(['post:40001']))).length,0);assert.equal((await helper.eligibleCuratedReferences(db,facts,new Set(['id:'+source.id]))).length,0);
 posts[0].is_visible=false;posts[0].manual_tier='X';const saved=JSON.stringify(posts[0]);result=await pub.publishFreeReferencedPosts(curator,ref,{database:db,blocked:new Set()});assert.equal(result.promoted,0);assert.equal(result.saved,0);assert.equal(JSON.stringify(posts[0]),saved);
 console.log('PASS CURATED REFERENCES: native embedded sample shape, explicit quote/repost, original attribution, no source-author enrollment, duplicate/hidden/manual/safety preservation, reference-before-insert, per-post eligibility, fresh pause/review controls and DB failures. Network/DB mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
