import { randomInt, randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "./supabase-admin";
import { personalFeatures, personalState, PersonalBundle } from "./tier-personal-store";
import { PERSONAL_FEATURE_SPEC, validPersonalHead, safeAutomaticTier, personalDecision } from "./tier-personal-core";
import { PERSONAL_EVALUATION_SPEC, featureFailureCode, scoreRanking, rankingTeacherLabel } from "./tier-personal-evaluation";

type Model = PersonalBundle & {evaluationSpec: string; trainingAuthors: string[]; previewOnly: true;mode?:string};
type VideoRow = {id: number; x_post_id: string; author_id: string|null; author_username: string|null; preview_image_url: string|null; video_url: string; adult_tier: string; manual_tier: string|null; manual_category: string|null};
type Entry = {row: VideoRow; proposed: string; rawTier: string; confidence: number; visualApplied: boolean; authorSeen: boolean; features: number[]; decisionReason?:string; predictionShown?: boolean; review?: {tier: string; reason: string|null; predictionSeen: boolean}};
type PreviewJob = {id: string; createdAt: string; model: Model; pool: number[]; cursor: number; entries: Entry[]; failed: Record<string,number>; skipped: number; cancelled: boolean; done: boolean};
type RescueJob = {id: string; ids: string[]; cursor: number; ready: number; failed: Record<string,number>; skipped: number; done: boolean};
const folder=path.join(process.cwd(),".local-admin","tier-video-preview");
const fields="id,x_post_id,author_id,author_username,preview_image_url,video_url,adult_tier,manual_tier,manual_category";
async function read<T>(name: string):Promise<T|null>{try{return JSON.parse(await readFile(path.join(folder,name+".json"),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
async function save(name: string,value: unknown){await mkdir(folder,{recursive:true,mode:0o700});const file=path.join(folder,name+".json"),temp=file+"."+randomUUID();await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,file);}
async function locked<T>(work:()=>Promise<T>){await mkdir(folder,{recursive:true,mode:0o700});let lock;try{lock=await open(path.join(folder,"lock"),"wx",0o600);}catch{throw Error("プレビューの別処理が実行中です。少し待ってください。");}try{return await work();}finally{await lock.close();await unlink(path.join(folder,"lock"));}}
function safeRows(){return supabaseAdmin().from("posts").select(fields).eq("moderation_blocked",false).eq("review_required",false).eq("content_category","PASS").eq("is_visible",true).not("video_url","is",null).not("adult_tier","in","(NONE,X)");}
async function unreviewed(ids: number[]){const r=await safeRows().is("manual_tier",null).in("id",ids);if(r.error)throw r.error;return (r.data??[]) as VideoRow[];}
export function reservoirAdd(pool: number[],id: number,seen: number,limit=150){if(pool.length<limit)pool.push(id);else{const j=randomInt(seen);if(j<limit)pool[j]=id;}}
async function randomPool(excluded:number[]=[]){const hidden=new Set(excluded);const pool:number[]=[];let cursor=0,seen=0;while(true){const r=await safeRows().is("manual_tier",null).gt("id",cursor).order("id").limit(500);if(r.error)throw r.error;const rows=(r.data??[]) as VideoRow[];for(const row of rows){if(hidden.has(row.id))continue;seen++;reservoirAdd(pool,row.id,seen);}if(rows.length<500)break;cursor=rows.at(-1)!.id;if(seen>=20000)throw Error("対象が2万件以上あります。抽出範囲の調整が必要です。");}for(let i=pool.length-1;i>0;i--){const j=randomInt(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}return pool;}
function validModel(model: Model|null):model is Model{return Boolean(model?.previewOnly&&model.featureSpec===PERSONAL_FEATURE_SPEC&&model.evaluationSpec===PERSONAL_EVALUATION_SPEC&&validPersonalHead(model.head));}
export async function runVideoPreview(action: string,body:{id?:string;postId?:number;tier?:string;reason?:string;predictionSeen?:boolean}={}){
  return locked(async()=>{
    let job=await read<PreviewJob>("preview");
    if(action==="start"){
      const model=await personalState<Model>("manual-preview-model");
      if(!validModel(model))throw Error("先に共通学習画面で「保存済み特徴で候補モデルを比較」を実行してください。");
      const revision=(await personalState<{value:number}>("revision"))?.value??0;
      if(model.revision!==revision||model.seedsHash!==await personalState<string>("seed-hash"))throw Error("教師データが更新されています。候補比較をもう一度実行してください。");
      const seen=[...new Set([...(await read<number[]>("seen-posts")??[]),...(job?.entries.map(e=>e.row.id)??[])])];
      if(job)await save("preview-"+job.id,job);
      await save("seen-posts",seen);
      job={id:randomUUID(),createdAt:new Date().toISOString(),model,pool:await randomPool(seen),cursor:0,entries:[],failed:{},skipped:0,cancelled:false,done:false};
      if(!job.pool.length)job.done=true;await save("preview",job);return;
    }
    if(!job||job.id!==body.id)throw Error("プレビューの識別子が一致しません。画面を更新してください。");
    if(action==="cancel"){job.cancelled=true;await save("preview",job);return;}
    if(action==="reveal"){
      for(const entry of job.entries)if(body.postId===undefined||entry.row.id===body.postId)entry.predictionShown=true;
      await save("preview",job);return;
    }
    if(action==="review"){
      if(!["S","A","B","C","D","X"].includes(body.tier??""))throw Error("評価が不正です。");
      const entry=job.entries.find(e=>e.row.id===body.postId);if(!entry)throw Error("対象がありません。");
      if(!(await unreviewed([entry.row.id])).length)throw Error("対象は手動評価済みまたは公開条件が変わっています。");
      entry.review={tier:body.tier!,reason:body.tier==="X"?(body.reason==="weak_content"?"weak_content":"out_of_scope"):null,predictionSeen:Boolean(entry.predictionShown||entry.review)};await save("preview",job);return;
    }
    if(action!=="step")throw Error("未対応の操作です。");
    if(job.cancelled||job.done)return;
    const next=job.pool[job.cursor];
    if(next===undefined){job.done=true;await save("preview",job);return;}
    const row=(await unreviewed([next]))[0];
    if(!row)job.skipped++;
    else{
      await (await import("./tier-personal-video")).ensureVideoTools();
      const features=await personalFeatures({id:row.x_post_id,video:row.video_url},true);
      if(features){const p=personalDecision(features,job.model.head,row.adult_tier),applied=p.applied;
        job.entries.push({row,features,proposed:p.tier,rawTier:safeAutomaticTier(p.label),confidence:p.confidence,visualApplied:applied,decisionReason:p.reason,authorSeen:job.model.trainingAuthors.includes(row.author_id??"unknown")});}
      else{const r=await supabaseAdmin().from("xclip_tier_features").select("error").eq("post_id",row.x_post_id).maybeSingle();if(r.error)throw r.error;const code=featureFailureCode(r.data?.error);job.failed[code]=(job.failed[code]??0)+1;}
    }
    const seen=await read<number[]>("seen-posts")??[];for(const entry of job.entries)if(!seen.includes(entry.row.id))seen.push(entry.row.id);await save("seen-posts",seen);
    job.cursor++;if(job.entries.length>=50||job.cursor>=job.pool.length)job.done=true;await save("preview",job);
  });
}
export async function runLargeVideoRescue(action: string,id?:string){return locked(async()=>{
  let job=await read<RescueJob>("rescue");
  if(action==="rescue-start"){
    const r=await supabaseAdmin().from("xclip_tier_features").select("post_id").eq("feature_spec",PERSONAL_FEATURE_SPEC).eq("error","VIDEO_TOO_LARGE").order("post_id").limit(1000);if(r.error)throw r.error;
    const history=await read<string[]>("rescue-history")??[];
    const ids=(r.data??[]).map(v=>v.post_id as string).filter(id=>!history.includes(id)),usable:string[]=[];
    // Only manually reviewed, safe quality teachers; never re-collect authors.
    for(let i=0;i<ids.length&&usable.length<10;i+=100){const p=await safeRows().not("manual_tier","is",null).in("x_post_id",ids.slice(i,i+100));if(p.error)throw p.error;
      for(const row of (p.data??[]) as VideoRow[]){const label=rankingTeacherLabel({id:row.x_post_id,author:row.author_id??"unknown",label:row.manual_tier as "S",reviewReason:row.manual_category,image:null,video:row.video_url,adultScore:null,creatorScore:null,sensitive:false});if(label&&["S","A","A+","B","B+","C","D","D+","X"].includes(row.manual_tier??""))usable.push(row.x_post_id);if(usable.length===10)break;}}
    job={id:randomUUID(),ids:usable,cursor:0,ready:0,failed:{},skipped:0,done:!usable.length};await save("rescue",job);return;
  }
  if(!job||job.id!==id)throw Error("再試行の識別子が一致しません。");
  if(action!=="rescue-step")throw Error("未対応の再試行操作です。");if(job.done)return;
  const postId=job.ids[job.cursor];const r=await safeRows().not("manual_tier","is",null).eq("x_post_id",postId);if(r.error)throw r.error;
  const row=r.data?.[0] as VideoRow|undefined;
  if(!row||!rankingTeacherLabel({id:postId,author:row.author_id??"unknown",label:row.manual_tier as "S",reviewReason:row.manual_category,image:null,adultScore:null,creatorScore:null,sensitive:false})||!["S","A","A+","B","B+","C","D","D+","X"].includes(row.manual_tier??""))job.skipped++;
  else{
    await (await import("./tier-personal-video")).ensureVideoTools();
    const features=await personalFeatures({id:postId,video:row.video_url},true,{retryTooLarge:true,maxBytes:256*1024*1024});
    if(features)job.ready++;else{const f=await supabaseAdmin().from("xclip_tier_features").select("error").eq("post_id",postId).maybeSingle();if(f.error)throw f.error;const code=featureFailureCode(f.data?.error);job.failed[code]=(job.failed[code]??0)+1;}
  }
  const history=await read<string[]>("rescue-history")??[];if(!history.includes(postId))await save("rescue-history",[...history,postId]);
  job.cursor++;if(job.cursor>=job.ids.length)job.done=true;await save("rescue",job);
});}
export async function videoPreviewStatus(){
  const job=await read<PreviewJob>("preview"),rescue=await read<RescueJob>("rescue");
  if(!job)return {job:null,samples:[],rescue};
  const current=await unreviewed(job.entries.map(e=>e.row.id));
  const entries=job.entries.filter(e=>current.some(r=>r.id===e.row.id));
  const samples=entries.map(e=>({id:e.row.id,x_post_id:e.row.x_post_id,author:e.row.author_username,poster:e.row.preview_image_url,video:e.row.video_url,before:e.row.adult_tier,proposed:e.proposed,rawTier:e.rawTier,confidence:e.confidence,visualApplied:e.visualApplied,decisionReason:e.decisionReason??(e.visualApplied?"visual":"confidence"),authorSeen:e.authorSeen,predictionShown:e.predictionShown??false,review:e.review??null}));
  const reviewed=entries.flatMap(e=>{if(!e.review||e.review.predictionSeen)return[];const label=rankingTeacherLabel({id:e.row.x_post_id,author:e.row.author_id??"unknown",label:e.review.tier as "S",reviewReason:e.review.reason,image:null,adultScore:null,creatorScore:null,sensitive:false});return label?[{id:e.row.x_post_id,actual:label,baseline:e.row.adult_tier,features:e.features}]:[];});
  const unseen=reviewed.filter(r=>!entries.find(e=>e.row.x_post_id===r.id)?.authorSeen);
  const report=reviewed.length?scoreRanking(reviewed,job.model.head):null;
  return {job:{id:job.id,createdAt:job.createdAt,attempted:job.cursor,pool:job.pool.length,total:entries.length,done:job.done,cancelled:job.cancelled,failed:job.failed,skipped:job.skipped,changed:entries.filter(e=>e.proposed!==e.row.adult_tier).length,visualApplied:entries.filter(e=>e.visualApplied).length,trainingSamples:job.model.head.samples,modelTrainedAt:job.model.trainedAt,modelMode:job.model.mode??"manual_only",policy:job.model.head.policy??null,evaluationSpec:job.model.evaluationSpec,manualReviews:entries.filter(e=>e.review).length,blindedQualityReviews:reviewed.length,unseenAuthorReviews:unseen.length,previewOnly:true},samples,rescue,
    reviewReport:report,unseenAuthorReport:unseen.length?scoreRanking(unseen,job.model.head):null,
    note:"未採用モデルのお試し表示。評価メモはPC内だけに保存し、postsのTier・手動評価・ランキングは更新しません。予測を見た後の評価は精度検証に含めません。50件の体感確認であり、自動採用はしません。"};
}
