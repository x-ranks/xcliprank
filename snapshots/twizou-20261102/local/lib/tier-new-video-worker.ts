import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { activePersonalBundle, applyPersonalTier, personalFeatures, personalState, savePersonalState } from "./tier-personal-store";
import { ReleasedBundle } from "./tier-model-release";
import { supabaseAdmin } from "./supabase-admin";
type Worker={adoptionId:string;enabled:boolean;cursor:number;processed:number;applied:number;failed:number};
export async function newVideoEvaluationStep(){
 const worker=await personalState<Worker>("new-video-evaluation");
 const bundle=await activePersonalBundle(true) as ReleasedBundle|null;
 if(!worker?.enabled||!bundle?.adoption||bundle.adoption.id!==worker.adoptionId)return {newVideosPaused:true};
 const db=supabaseAdmin();
 const {data,error}=await db.from("posts").select("id,x_post_id,video_url,adult_tier,effective_adult_score")
 .gt("id",worker.cursor).is("manual_tier",null).eq("content_category","PASS").eq("moderation_blocked",false)
 .eq("review_required",false).eq("is_visible",true).not("video_url","is",null).not("adult_tier","in","(NONE,X)").order("id").limit(1);
 if(error)throw error;const row=data?.[0];if(!row)return {newVideosIdle:true};
 const features=await personalFeatures({id:row.x_post_id,video:row.video_url},true);
 const next=await applyPersonalTier({tier:row.adult_tier,score:row.effective_adult_score},{id:row.x_post_id,video:row.video_url},bundle,false);
 const latest=await personalState<Worker>("new-video-evaluation");
 const active=await activePersonalBundle(true) as ReleasedBundle|null;
 if(!latest?.enabled||latest.adoptionId!==worker.adoptionId||active?.adoption?.id!==worker.adoptionId)return {newVideosPaused:true};
 let applied=false;
 if(features&&(next.tier!==row.adult_tier||next.score!==row.effective_adult_score)){
  const folder=path.join(process.cwd(),".local-admin","tier-model-release",worker.adoptionId+"-new-videos");await mkdir(folder,{recursive:true,mode:0o700});
  const filename=path.join(folder,row.id+".json");
  // Never overwrite the original pre-change backup on a retry.
  await writeFile(filename,JSON.stringify({before:row,next,adoptionId:worker.adoptionId}),{mode:0o600,flag:"wx"}).catch(e=>{if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;});
  let q=db.from("posts").update({adult_tier:next.tier,effective_adult_score:next.score})
  .eq("id",row.id).eq("x_post_id",row.x_post_id).eq("video_url",row.video_url).is("manual_tier",null)
  .eq("content_category","PASS").eq("moderation_blocked",false).eq("review_required",false).eq("is_visible",true).eq("adult_tier",row.adult_tier);
  q=row.effective_adult_score===null?q.is("effective_adult_score",null):q.eq("effective_adult_score",row.effective_adult_score);
  const result=await q.select("id");if(result.error)throw result.error;applied=Boolean(result.data?.length);
 }
 await savePersonalState("new-video-evaluation",{...latest,cursor:row.id,processed:worker.processed+1,applied:worker.applied+(applied?1:0),failed:worker.failed+(features?0:1),updatedAt:new Date().toISOString()});
 return {newVideoProcessed:true,applied};
}
