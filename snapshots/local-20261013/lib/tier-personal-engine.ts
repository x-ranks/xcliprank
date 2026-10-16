import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "./supabase-admin";
import { PersonalLabel, PersonalSample, PERSONAL_FEATURE_SPEC, personalGroup, trainPersonal, predictPersonal, safeAutomaticTier } from "./tier-personal-core";
import { Seed, personalState, savePersonalState, personalFeatures, PersonalBundle } from "./tier-personal-store";
import { PERSONAL_EVALUATION_SPEC, rankingTeacherLabel, partitionTeachers, compareTeacherSources, summarizeFeatureHealth, CachedFeature, ComparisonRow } from "./tier-personal-evaluation";
import { predictLearnedTier, blendRuleAndLearnedTier, TierLearningModel } from "./tier-learning";
import { calculateTier, applyCuratedTierFloor } from "./curated-collector";
type Post={id:number;x_post_id:string;author_id:string|null;author_username:string|null;manual_tier:string|null;preview_image_url:string|null;video_url:string|null;adult_score:number|null;creator_score:number|null;possibly_sensitive:boolean|null;moderation_blocked:boolean;review_required:boolean;content_category:string;manual_reviewed_at:string|null;manual_category:string|null};
const fields="id,x_post_id,author_id,author_username,manual_tier,preview_image_url,video_url,adult_score,creator_score,possibly_sensitive,moderation_blocked,review_required,content_category,manual_reviewed_at,manual_category";
const labels=["S","A","B","C","D","X","OTHER"];
const safe=(p:Post)=>!p.moderation_blocked&&!p.review_required&&p.content_category==="PASS";
export async function importPersonalTeachers() {
  type Store={authors:{username:string;posts:{xPostId:string;previewImageUrl:string|null;safetyReasons?:string[];review:{tier:string;reason?:string}|null}[]}[]};
  let store:Store;
  try{store=JSON.parse(await readFile(path.join(process.cwd(),"data","teacher-authors.json"),"utf8"));}
  catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return 0;throw e;}
  const candidates=store.authors.flatMap(a=>a.posts.filter(p=>p.review&&labels.includes(p.review.tier)&&!p.safetyReasons?.length&&p.review.reason!=="policy_violation"&&/^\d{1,30}$/.test(p.xPostId)).map(p=>({...p,author:a.username})));
  const db=supabaseAdmin();const records=new Map<string,Post>();
  for(let i=0;i<candidates.length;i+=200){const r=await db.from("posts").select(fields).in("x_post_id",candidates.slice(i,i+200).map(p=>p.xPostId));if(r.error)throw r.error;for(const p of r.data??[])records.set(p.x_post_id,p as Post);}
  // Only linked, safe DB videos become seeds. Manual review always overrides below.
  const seeds:Seed[]=candidates.flatMap(p=>{const r=records.get(p.xPostId);return r&&safe(r)&&r.manual_tier!=="NONE"?[{id:p.xPostId,author:r.author_id??p.author.toLowerCase(),label:p.review!.tier as PersonalLabel,image:r.preview_image_url,video:r.video_url,adultScore:r.adult_score,creatorScore:r.creator_score,sensitive:r.possibly_sensitive===true,reviewReason:p.review?.reason??null,source:"reference" as const}]:[];});
  await savePersonalState("teacher-seeds",seeds);
  // Changes to imported seeds invalidate training without rewriting any teacher labels.
  await savePersonalState("seed-hash",createHash("sha256").update(JSON.stringify(seeds)).digest("hex"));return seeds.length;
}
async function teachers() {
  const db=supabaseAdmin();const entries=new Map<string,Seed>();
  const seeds=await personalState<Seed[]>("teacher-seeds")??[];
  // Re-check safety and manual overrides for imported seeds on every learning pass.
  for(let i=0;i<seeds.length;i+=200){const r=await db.from("posts").select(fields).in("x_post_id",seeds.slice(i,i+200).map(s=>s.id));if(r.error)throw r.error;
    for(const p of (r.data??[]) as Post[]){const seed=seeds.find(s=>s.id===p.x_post_id);if(seed&&safe(p)&&p.manual_tier!=="NONE")entries.set(p.x_post_id,{...seed,image:p.preview_image_url,video:p.video_url});}}
  let cursor=0,total=0;
  while(total<20000){const r=await db.from("posts").select(fields).not("manual_tier","is",null).gt("id",cursor).order("id").limit(500);if(r.error)throw r.error;const rows=(r.data??[]) as Post[];
    for(const p of rows){entries.delete(p.x_post_id);if(safe(p)&&labels.includes(p.manual_tier??""))entries.set(p.x_post_id,{id:p.x_post_id,author:p.author_id??p.author_username?.toLowerCase()??"unknown",label:p.manual_tier as PersonalLabel,image:p.preview_image_url,video:p.video_url,adultScore:p.adult_score,creatorScore:p.creator_score,sensitive:p.possibly_sensitive===true,source:"manual_db",reviewedAt:p.manual_reviewed_at,reviewReason:p.manual_category});}
    total+=rows.length;if(rows.length<500)break;cursor=rows[rows.length-1].id;
  }
  if(total>=20000)throw Error("教師データが2万件に達しました。上限の調整が必要です。");
  return [...entries.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export async function personalModelStatus(){
  const config=await personalState<{enabled:boolean}>("config");
  const status=await personalState<Record<string,unknown>>("worker-status");
  const active=await personalState<PersonalBundle>("active-model");
  const preparation=await personalState<Record<string,unknown>>("video-preparation");
  const newVideos=await personalState<Record<string,unknown>>("new-video-evaluation");
  return {enabled:config?.enabled??false,status,preparation,newVideos,active:active?.featureSpec===PERSONAL_FEATURE_SPEC?{trainedAt:active.trainedAt,revision:active.revision,samples:active.head.samples,validation:active.validation}:null};
}
type VideoPreparation={enabled:boolean;cursor:number;processed:number;ready:number;failed:number};
async function prepareStoredVideoStep(){
  const job=await personalState<VideoPreparation>("video-preparation");
  if(!job?.enabled)return {unchanged:true};
  const r=await supabaseAdmin().from("posts").select("id,x_post_id,video_url")
    .is("manual_tier",null).eq("content_category","PASS").eq("moderation_blocked",false)
    .eq("review_required",false).eq("is_visible",true).not("video_url","is",null)
    .not("adult_tier","in","(NONE,X)").gt("id",job.cursor).order("id").limit(1);
  if(r.error)throw r.error;
  const row=r.data?.[0];
  if(!row){await savePersonalState("video-preparation",{...job,enabled:false,done:true});return {preparationDone:true};}
  await (await import("./tier-personal-video")).ensureVideoTools();
  const features=await personalFeatures({id:row.x_post_id,video:row.video_url},true);
  const latest=await personalState<VideoPreparation>("video-preparation");
  // A pause clicked while this video was being decoded must remain paused.
  await savePersonalState("video-preparation",{...job,...latest,cursor:row.id,processed:job.processed+1,ready:job.ready+(features?1:0),failed:job.failed+(features?0:1),updatedAt:new Date().toISOString()});
  return {preparing:true,processed:job.processed+1};
}
type FeatureRecord=CachedFeature;
export function resetPersonalSnapshot(){snapshot=null;}
let snapshot:{key:string;until:number;data:Seed[];features:Map<string,FeatureRecord>}|null=null;
export async function personalModelStep() {
  const db=supabaseAdmin(),owner=randomUUID();
  if(!(await personalState<{enabled:boolean}>("config"))?.enabled)return {paused:true};
  const claim=await db.rpc("xclip_claim_tier_worker",{p_owner:owner});if(claim.error)throw claim.error;if(!claim.data)return {busy:true};
  try{
    const adoptionConfig=await personalState<{manualAdoption?:string;comparisonCachedOnly?:boolean}>("config");
    if(adoptionConfig?.manualAdoption&&!adoptionConfig.comparisonCachedOnly){
      const prep=await personalState<{enabled?:boolean}>("video-preparation");
      return prep?.enabled?await prepareStoredVideoStep():await (await import("./tier-new-video-worker")).newVideoEvaluationStep();
    }
    const revision=(await personalState<{value:number}>("revision"))?.value??0;
    const seedsHash=await personalState<string>("seed-hash");
    const cachedOnly=(await personalState<{comparisonCachedOnly?:boolean}>("config"))?.comparisonCachedOnly===true;
    const previous=await personalState<{revision:number;seedsHash:string|null;finished:boolean;evaluationSpec?:string}>("worker-status");
    if(previous?.revision===revision&&previous.seedsHash===seedsHash&&previous.finished && (previous as typeof previous & {featureSpec:string}).featureSpec===PERSONAL_FEATURE_SPEC && previous.evaluationSpec===PERSONAL_EVALUATION_SPEC)return cachedOnly?{finished:true,comparisonOnly:true}:await prepareStoredVideoStep();
    const snapshotKey=PERSONAL_EVALUATION_SPEC+":"+String(revision)+":"+String(seedsHash);
    const reuse=snapshot?.key===snapshotKey&&snapshot.until>Date.now()?snapshot:null;
    const data=reuse?.data??await teachers();const available:(Seed & PersonalSample)[]=[];const missing:Seed[]=[];let failed=0;
    // Read cached features in one batched query rather than one request per video.
    const cache=reuse?.features??new Map<string,FeatureRecord>();
    if(!reuse)for(let i=0;i<data.length;i+=200){const r=await db.from("xclip_tier_features").select("post_id,source_url,feature_spec,features,retry_after,error").in("post_id",data.slice(i,i+200).map(s=>s.id));if(r.error)throw r.error;for(const row of r.data??[])cache.set(row.post_id,row);}
    snapshot={key:snapshotKey,until:Date.now()+300000,data,features:cache};
    const collect=()=>{available.length=0;missing.length=0;failed=0;
      for(const s of data){const c=cache.get(s.id);if(c&&c.source_url===s.video&&c.feature_spec===PERSONAL_FEATURE_SPEC&&Array.isArray(c.features)&&c.features.length===1024&&c.features.every(Number.isFinite))available.push({...s,features:c.features});
        else if(!s.video||c?.source_url===s.video&&c.feature_spec===PERSONAL_FEATURE_SPEC&&c.retry_after&&Date.parse(c.retry_after)>Date.now())failed++;else missing.push(s);}};
    collect();
    // One video per request; four frames. No X API or author re-collection.
    if(!cachedOnly&&missing.length)await (await import("./tier-personal-video")).ensureVideoTools();
    for(const s of (cachedOnly?[]:missing.slice(0,1))){
      const features=await personalFeatures({id:s.id,video:s.video},true);
      const recorded=await db.from("xclip_tier_features").select("source_url,feature_spec,features,retry_after,error").eq("post_id",s.id).maybeSingle();
      if(recorded.error)throw recorded.error;
      cache.set(s.id,recorded.data??{source_url:s.video!,feature_spec:PERSONAL_FEATURE_SPEC,features,retry_after:features?null:new Date(Date.now()+7*86400000).toISOString(),error:features?null:"NO_RECORDED_CAUSE"});
    }
    if(!cachedOnly&&missing.length){await savePersonalState("worker-status",{revision,seedsHash,featureSpec:PERSONAL_FEATURE_SPEC,finished:false,total:data.length,usable:available.length,remaining:missing.length,failed,stage:"特徴抽出",updatedAt:new Date().toISOString()});return {extracted:Math.min(1,missing.length),remaining:missing.length};}
    const health=summarizeFeatureHealth(data,cache,PERSONAL_FEATURE_SPEC);
    const quality=available.flatMap(s=>{const label=rankingTeacherLabel(s);return label?[{...s,label}]:[];});
    const split=partitionTeachers(quality);
    const manualTune=split.tuning.filter(s=>s.source==="manual_db"),manualTest=split.test.filter(s=>s.source==="manual_db");
    const blockedAuthors=new Set([...split.tuning,...split.test].map(s=>s.author));
    const blockedFingerprints=new Set([...split.tuning,...split.test].map(s=>createHash("sha256").update(JSON.stringify(s.features)).digest("hex")));
    const baseRows=quality.filter(s=>s.source==="manual_db"&&!blockedAuthors.has(s.author)&&!blockedFingerprints.has(createHash("sha256").update(JSON.stringify(s.features)).digest("hex"))&&["S","A","B","C","D"].includes(s.label)&&s.adultScore!==null&&s.creatorScore!==null).sort((a,b)=>(b.reviewedAt??"").localeCompare(a.reviewedAt??"")).slice(0,1000);
    const legacy:TierLearningModel|null=baseRows.length>=100?{trainedAt:"holdout",samples:baseRows.map(s=>({authorId:s.author,adultScore:s.adultScore!,creatorScore:s.creatorScore!,possiblySensitive:s.sensitive,tier:s.label as "S"|"A"|"B"|"C"|"D",value:({S:5,A:4,B:3,C:2,D:1} as Record<string,number>)[s.label]}))}:null;
    const authorIds=[...new Set([...manualTune,...manualTest].map(s=>s.author))].filter(id=>/^\d+$/.test(id));
    const authorRows=await db.from("authors").select("*").in("x_author_id",authorIds);if(authorRows.error)throw authorRows.error;
    const comparisons=(rows:typeof quality):ComparisonRow[]=>rows.flatMap(s=>{
      if(!legacy||s.adultScore===null||s.creatorScore===null)return[];
      const prediction=predictLearnedTier(legacy,{authorId:s.author,adultScore:s.adultScore,creatorScore:s.creatorScore,possiblySensitive:s.sensitive});if(!prediction)return[];
      const author=authorRows.data?.find(a=>String(a.x_author_id)===s.author);if(!author||author.review_required)return[];
      const rule=calculateTier({possibly_sensitive:s.sensitive,adult_score:s.adultScore,creator_score:s.creatorScore,review_required:false},author);
      const base=blendRuleAndLearnedTier(author.is_curated?applyCuratedTierFloor(rule,author,"PASS"):rule,prediction);
      return ["NONE","X"].includes(base.tier)?[]:[{id:s.id,actual:s.label,baseline:base.tier,features:s.features}];
    });
    const experiment=compareTeacherSources(split.train,comparisons(manualTune),comparisons(manualTest));
    const head=experiment.head,validation=experiment.validation;
    const latest=(await personalState<{value:number}>("revision"))?.value??0;
    const stable=latest===revision&&(await personalState<string>("seed-hash"))===seedsHash;
    const bundle=head?{revision,seedsHash,trainedAt:new Date().toISOString(),featureSpec:PERSONAL_FEATURE_SPEC,head,evaluationSpec:PERSONAL_EVALUATION_SPEC,validation}:null;
    if(bundle)await savePersonalState("candidate-model",bundle);
    const manualHead=experiment.manualPreviewHead;
    if(manualHead&&stable)await savePersonalState("manual-preview-model",{revision,seedsHash,trainedAt:new Date().toISOString(),featureSpec:PERSONAL_FEATURE_SPEC,evaluationSpec:PERSONAL_EVALUATION_SPEC,head:manualHead,trainingAuthors:[...new Set(split.train.filter(s=>s.source==="manual_db").map(s=>s.author))],validation:validation.candidates.find(c=>c.mode===validation.manualPreviewMode)?.final,mode:validation.manualPreviewMode,previewOnly:true});
    // After the first adoption, later qualified versions are promoted automatically.
    const config=await personalState<{enabled:boolean;autoPromote?:boolean;manualAdoption?:string}>("config");
    const stillCurrent=(await personalState<{value:number}>("revision"))?.value===revision&&(await personalState<string>("seed-hash"))===seedsHash;
    const active=await personalState<{evaluationSpec?:string}>("active-model");
    if(!cachedOnly&&bundle&&stable&&stillCurrent&&config?.enabled&&config.autoPromote&&!config.manualAdoption&&active?.evaluationSpec===PERSONAL_EVALUATION_SPEC&&validation.passed)await savePersonalState("active-model",bundle);
    await savePersonalState("worker-status",{revision,seedsHash,featureSpec:PERSONAL_FEATURE_SPEC,finished:stable,total:data.length,usable:available.length,remaining:0,failed,evaluationSpec:PERSONAL_EVALUATION_SPEC,diagnostics:health,missingFeatures:missing.length,qualityUsable:quality.length,partition:{train:split.train.length,tuning:manualTune.length,test:manualTest.length,groups:split.groups},stage:"検証完了",validation,updatedAt:new Date().toISOString()});
    return {finished:stable,validation};
  }finally {await db.from("xclip_tier_worker_lease").delete().eq("key","training").eq("owner",owner);}
}
