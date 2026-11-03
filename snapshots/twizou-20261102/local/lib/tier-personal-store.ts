import { supabaseAdmin } from "./supabase-admin";
import { validPersonalHead, PersonalHead, PersonalLabel, PERSONAL_FEATURE_SPEC, personalDecision } from "./tier-personal-core";
export type Seed = { id:string; author:string; label:PersonalLabel; image:string|null; video?:string|null; adultScore:number|null; creatorScore:number|null; sensitive:boolean; source?:"manual_db"|"reference"; reviewedAt?:string|null; reviewReason?:string|null };
export type PersonalBundle = { revision:number; seedsHash:string|null; trainedAt:string; head:PersonalHead; validation:unknown; featureSpec:string };
export async function personalState<T>(key:string):Promise<T|null> {
  const r=await supabaseAdmin().from("xclip_tier_state").select("payload").eq("key",key).maybeSingle();
  if(r.error)throw new Error("共通学習テーブルを読めません。付属SQLを同じSupabaseで実行してください。");return r.data?.payload as T??null;
}
export async function savePersonalState(key:string,payload:unknown) {
  const table=supabaseAdmin().from("xclip_tier_state");
  const r=payload===null?await table.delete().eq("key",key):await table.upsert({key,payload,updated_at:new Date().toISOString()});if(r.error)throw r.error;
}
export async function sharedTeacherSeeds():Promise<Seed[]> {
  try{return await personalState<Seed[]>("teacher-seeds")??[];}catch{return[];}
}
let cached:{until:number;bundle:PersonalBundle|null}|null=null;
export async function activePersonalBundle(force=false) {
  if(!force&&cached&&cached.until>Date.now())return cached.bundle;
  let bundle:PersonalBundle|null=null;
  try {const config=await personalState<{enabled:boolean}>("config");if(config?.enabled){const b=await personalState<PersonalBundle>("active-model");if(b?.featureSpec===PERSONAL_FEATURE_SPEC&&validPersonalHead(b.head))bundle=b;}}catch{/* Existing collections continue if optional tables are absent. */}
  cached={until:Date.now()+30000,bundle};return bundle;
}
export type PersonalInput={id:string;image?:string|null;video?:string|null};
export async function personalFeatures(input:PersonalInput,extract=false,options?:{retryTooLarge?:boolean;maxBytes?:number}):Promise<number[]|null> {
  const source=input.video;
  if(!source||!/^\d{1,30}$/.test(input.id))return null;
  const db=supabaseAdmin();
  const r=await db.from("xclip_tier_features").select("*").eq("post_id",input.id).maybeSingle();
  if(r.error)return null;
  if(r.data?.source_url===source&&r.data.feature_spec===PERSONAL_FEATURE_SPEC){
    const values=r.data.features;if(Array.isArray(values)&&values.length===1024&&values.every(Number.isFinite))return values;
    if(r.data.retry_after&&Date.parse(r.data.retry_after)>Date.now()&&!(options?.retryTooLarge&&r.data.error==="VIDEO_TOO_LARGE"))return null;
  }
  if(!extract)return null;
  let features:number[]|null=null,error:string|null=null;
  try {features=await (await import("./tier-personal-video")).extractPersonalVideo(source,{maxBytes:options?.maxBytes});}catch(e){error=e instanceof Error?e.message:"IMAGE_FAILED";}
  const result=await db.from("xclip_tier_features").upsert({post_id:input.id,source_url:source,feature_spec:PERSONAL_FEATURE_SPEC,features,error,retry_after:features?null:new Date(Date.now()+7*86400000).toISOString(),updated_at:new Date().toISOString()});
  if(result.error)throw result.error;return features;
}
export async function applyPersonalTier(base:{tier:string;score:number},input:PersonalInput,bundle:PersonalBundle|null,extract=false) {
  if(!bundle||["NONE","X"].includes(base.tier))return base;
  try {
    const features=await personalFeatures(input,extract);if(!features)return base;
    const decision=personalDecision(features,bundle.head,base.tier);
    if(!decision.applied)return base;
    const tier=decision.tier as "S"|"A"|"B"|"C"|"D";
    const scores={S:0.95,A:0.8,B:0.67,C:0.55,D:0.42};
    return {tier,score:scores[tier]};
  }catch{return base;}
}
