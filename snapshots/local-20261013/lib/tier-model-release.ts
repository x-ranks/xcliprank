import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import path from "node:path";
import { personalState, savePersonalState, PersonalBundle, activePersonalBundle } from "./tier-personal-store";
import { PERSONAL_FEATURE_SPEC, validPersonalHead } from "./tier-personal-core";
import { PERSONAL_EVALUATION_SPEC } from "./tier-personal-evaluation";
import { supabaseAdmin } from "./supabase-admin";
export type ReleasedBundle = PersonalBundle & { mode?:string; evaluationSpec?:string; previewOnly?:boolean; adoption?:{id:string;at:string;previewId:string;modelHash:string;method:string} };
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
export function modelHash(model:PersonalBundle) {return createHash("sha256").update(JSON.stringify(canonical({head:model.head,featureSpec:model.featureSpec,revision:model.revision,seedsHash:model.seedsHash,trainedAt:model.trainedAt}))).digest("hex");}
type Backup={id:string;before:ReleasedBundle|null;config:Record<string,unknown>|null;after:ReleasedBundle};
const folder=path.join(process.cwd(),".local-admin","tier-model-release");
export async function releaseStatus(){
 const active=await personalState<ReleasedBundle>("active-model");
 let preview:{id:string;model:ReleasedBundle;entries:unknown[]}|null=null;
 try{preview=JSON.parse(await readFile(path.join(process.cwd(),".local-admin","tier-video-preview","preview.json"),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
 return {activeMode:active?.mode??null,adoption:active?.adoption??null,preview:preview?{id:preview.id,mode:preview.model.mode,count:preview.entries.length,trainedAt:preview.model.trainedAt,modelHash:modelHash(preview.model)}:null};
}
export async function releaseModel(action:string,previewId?:string,expectedHash?:string){
 await mkdir(folder,{recursive:true,mode:0o700});
 const lock=await open(path.join(folder,"lock"),"wx",0o600).catch(()=>{throw Error("モデルの採用・復元が実行中です。");});
 const owner=randomUUID();let claimed=false;
 try{
  const claim=await supabaseAdmin().rpc("xclip_claim_tier_worker",{p_owner:owner});if(claim.error)throw claim.error;if(!claim.data)throw Error("学習処理が実行中です。少し待って再試行してください。");claimed=true;
  if(action==="adopt-reviewed"){
   const preview=JSON.parse(await readFile(path.join(process.cwd(),".local-admin","tier-video-preview","preview.json"),"utf8")) as {id:string;model:ReleasedBundle;entries:unknown[]};
   const m=preview.model;
   if(preview.id!==previewId||modelHash(m)!==expectedHash)throw Error("プレビューが変わりました。画面を更新してください。");
   if(m.mode!=="manual_recall"||!m.previewOnly||m.featureSpec!==PERSONAL_FEATURE_SPEC||m.evaluationSpec!==PERSONAL_EVALUATION_SPEC||!validPersonalHead(m.head)||!preview.entries.length)throw Error("今回確認したmanual_recallプレビューが見つかりません。");
   const last=await supabaseAdmin().from("posts").select("id").order("id",{ascending:false}).limit(1);if(last.error)throw last.error;
   const id=randomUUID(),at=new Date().toISOString();
   const active=await personalState<ReleasedBundle>("active-model");
   if(active?.adoption?.modelHash===expectedHash)return releaseStatus();
   const config=await personalState<Record<string,unknown>>("config");
   const after:ReleasedBundle={...m,previewOnly:false,adoption:{id,at,previewId:preview.id,modelHash:expectedHash,method:"user-reviewed-manual-adoption"}};
   const backup:Backup={id,before:active,config,after};
   // Persist both copies BEFORE changing either config or active model.
   await writeFile(path.join(folder,id+".json"),JSON.stringify(backup),{mode:0o600,flag:"wx"});
   await savePersonalState("model-release-backup-"+id,backup);
   await savePersonalState("config",{...config,enabled:true,autoPromote:false,comparisonCachedOnly:false,manualAdoption:id});
   await savePersonalState("new-video-evaluation",{adoptionId:id,enabled:true,cursor:last.data?.[0]?.id??0,processed:0,applied:0,failed:0});
   await savePersonalState("active-model",after);
  }else if(action==="restore-model"){
   const active=await personalState<ReleasedBundle>("active-model");
   if(!active?.adoption||active.adoption.modelHash!==expectedHash||modelHash(active)!==expectedHash)throw Error("現在の採用モデルが変わっています。画面を更新してください。");
   const backup=await personalState<Backup>("model-release-backup-"+active.adoption.id);
   if(!backup||modelHash(backup.after)!==expectedHash)throw Error("復元用の記録が見つかりません。");
   const config=await personalState<Record<string,unknown>>("config");
   await savePersonalState("config",{...config,autoPromote:false});
   const worker=await personalState<Record<string,unknown>>("new-video-evaluation");
   if(worker)await savePersonalState("new-video-evaluation",{...worker,enabled:false});
   await savePersonalState("active-model",backup.before);
   await savePersonalState("config",{...backup.config,enabled:backup.config?.enabled??false,autoPromote:false});
  }else throw Error("INVALID_RELEASE_ACTION");
  await activePersonalBundle(true);return releaseStatus();
 }finally{if(claimed)await supabaseAdmin().from("xclip_tier_worker_lease").delete().eq("key","training").eq("owner",owner);await lock.close();await unlink(path.join(folder,"lock"));}
}
