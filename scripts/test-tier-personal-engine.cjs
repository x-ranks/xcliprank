const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),path=require('node:path');
const rows=Array.from({length:360},(_,i)=>({id:i+1,x_post_id:String(10000+i),author_id:String(1000+Math.floor(i/12)),author_username:'u'+Math.floor(i/12),manual_tier:['S','A','B','C','D','X'][i%6],preview_image_url:'https://pbs.twimg.com/'+i+'.jpg',video_url:'https://video.twimg.com/'+i+'.mp4',adult_score:0.5,creator_score:0.5,possibly_sensitive:true,moderation_blocked:false,review_required:false,content_category:'PASS',is_visible:true,adult_tier:'B',manual_reviewed_at:'2026-10-06'}));
rows[0].manual_tier='A';
rows.push({...rows[1],id:400,x_post_id:'20000',manual_tier:null});
rows.push({...rows[1],id:401,x_post_id:'20001',manual_tier:null,moderation_blocked:true});
const original=JSON.stringify(rows),states=new Map([['config',{enabled:true}],['revision',{value:1}]]),features=new Map(),authors=Array.from({length:30},(_,i)=>({x_author_id:String(1000+i),review_required:false,is_curated:true}));
for(const r of rows)features.set(r.x_post_id,{post_id:r.x_post_id,source_url:r.video_url,feature_spec:'nsfwjs-mobilenetv2-flatten-four-frames-10-25-50-80-v2',features:Array.from({length:1024},(_,j)=>j%6===r.id%6?1+r.id*0.000001:0),retry_after:null});
const db={rpc:async()=>({data:true,error:null}),from(table){let filters=[],limit=Infinity,key=null,mutation=null;
 const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);if(k==='key')key=v;return q;},is(k,v){filters.push(r=>r[k]===v);return q;},not(k,op,v){filters.push(r=>r[k]!==v);return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},order(){return q;},limit(v){limit=v;return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},delete(){mutation='delete';return q;},upsert(value){assert.notEqual(table,'posts');if(table==='xclip_tier_state')states.set(value.key,value.payload);else throw Error('unexpected feature extraction');return q;},maybeSingle:async()=>({data:table==='xclip_tier_features'?[...features.values()].filter(r=>filters.every(f=>f(r)))[0]??null:states.has(key)?{payload:states.get(key)}:null,error:null}),then(a,b){
   const source=table==='posts'?rows:table==='authors'?authors:table==='xclip_tier_features'?[...features.values()]:[];
   return Promise.resolve({data:mutation==='delete'?[]:source.filter(r=>filters.every(f=>f(r))).slice(0,limit),error:null}).then(a,b);}};return q;}};
const teacher={authors:[{username:'u0',posts:[{xPostId:'10000',review:{tier:'S'},safetyReasons:[]},{xPostId:'20000',review:{tier:'S'},safetyReasons:[]},{xPostId:'20001',review:{tier:'S'},safetyReasons:[]}]}]};
const modules=new Map(),trained=[];
function load(id){
 if(id==='lib/supabase-admin')return{ supabaseAdmin:()=>db};
 if(id==='lib/tier-personal-video')return{ensureVideoTools:async()=>{const job=states.get('video-preparation');if(job)states.set('video-preparation',{...job,enabled:false});}};
 if(id==='lib/curated-collector')return{calculateTier:()=>({tier:'B',score:0.67}),applyCuratedTierFloor:v=>v};
 if(modules.has(id))return modules.get(id).exports;
 const m={exports:{}};modules.set(id,m);const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const req=name=>name==='node:fs/promises'?{readFile:async()=>JSON.stringify(teacher)}:name.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),name))):require(name);
 new Function('require','exports','module','process',code)(req,m.exports,m,{cwd:()=>'/test',env:{}});
 if(id==='lib/tier-personal-core'){const train=m.exports.trainPersonal;m.exports.trainPersonal=(s,...rest)=>{trained.push(s);return train(s,...rest);};}
 return m.exports;
}
(async()=>{const engine=load('lib/tier-personal-engine');assert.equal(await engine.importPersonalTeachers(),2,'blocked reference video excluded');
 await engine.personalModelStep();assert.equal(states.get('worker-status').total,361);assert.equal(states.get('worker-status').finished,true);
 assert(trained.length>0);const final=trained.at(-1);assert.equal(final.find(s=>s.id==='10000').label,'A','DB manual review wins');assert(!final.some(s=>s.id==='20001'));
 assert.equal(JSON.stringify(rows),original,'training never updates posts');assert(!states.has('active-model'),'candidate is not silently adopted');
 states.set('video-preparation',{enabled:true,cursor:0,processed:0,ready:0,failed:0});
 const prep=await engine.personalModelStep();assert.equal(prep.preparing,true);assert.equal(states.get('video-preparation').ready,1);assert.equal(states.get('video-preparation').enabled,false,'pause during in-flight work preserved');assert.equal(states.get('video-preparation').cursor,400,'unsafe student excluded');
 assert.equal(JSON.stringify(rows),original,'preparation never changes Tier');
 // Cached comparison must not fetch videos, even if one feature is absent.
 states.set('config',{enabled:true,comparisonCachedOnly:true,autoPromote:true});states.delete('worker-status');
 features.delete('10003');modules.delete('lib/tier-personal-engine');
 const cachedEngine=load('lib/tier-personal-engine');await cachedEngine.personalModelStep();
 assert.equal(states.get('worker-status').missingFeatures,1);assert.equal(states.get('worker-status').finished,true);
 assert(states.get('manual-preview-model')?.previewOnly,'manual preview is explicitly unadopted');
 assert.equal(states.get('manual-preview-model').evaluationSpec,'high-tier-recall-tuning-v5');
 assert(states.get('worker-status').diagnostics);assert(!states.has('active-model'),'comparison never auto-adopts');
 states.set('video-preparation',{enabled:true,cursor:0,processed:0,ready:0,failed:0});
 const comparisonDone=await cachedEngine.personalModelStep();assert.equal(comparisonDone.comparisonOnly,true);assert.equal(states.get('video-preparation').processed,0,'comparison does not launch student downloads');
 assert.equal(JSON.stringify(rows),original,'cached comparison never updates posts');
 const store=load('lib/tier-personal-store'),core=load('lib/tier-personal-core');
 const bundle={head:core.trainPersonal(final),featureSpec:core.PERSONAL_FEATURE_SPEC};
 const safety={tier:'X',score:0};assert.deepEqual(await store.applyPersonalTier(safety,{id:'20000',image:rows[0].preview_image_url},bundle,true),safety);
 assert.deepEqual(await store.applyPersonalTier({tier:'B',score:0.67},{id:'99999',image:null},bundle,true),{tier:'B',score:0.67});
 console.log('PASS: teacher import, DB precedence, safety recheck, candidate separated from active model, unchanged posts, missing-feature fallback, safety tier preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
