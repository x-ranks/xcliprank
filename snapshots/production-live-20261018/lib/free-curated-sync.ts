import { FREE_CURATED_AUTHOR_LIMIT } from "./free-curated-limits";
import { REGISTRATION_LEASE_MS, validRegistrationOwner, registrationLeaseActive, requireRegistrationOwner, type RegistrationReceipt } from "./registration-lease";
import { ensureCommonAuthor, manageCommonAuthors } from "./curated-common";
import { readCuratedRemovals } from "./curated-removals";
import { availabilityDashboard } from "./availability-dashboard";
import { freeCuratedDashboard } from "./free-curated-dashboard";
import { supabaseAdmin } from "./supabase-admin";
import { FreeCuratedError, type FreeAuthor, type FreeCandidate } from "./fxtwitter-curated";
import { withScheduledFreeState, writeScheduledFreeState, readScheduledFreeState } from "./free-curated-server-store";
import { newScheduledAuthor } from "./free-curated-scan";
import { publishFreeCandidates } from "./free-curated-publish";

export function databaseHost() { try{return new URL(process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??"").hostname;}catch{return null;} }
export function parseSyncAuthor(raw:any):FreeAuthor&{paused:boolean;initialPending?:boolean;initialBaselineId?:string|null}{
  if(!raw||typeof raw!=="object"||!/^\d{2,20}$/.test(raw.id)||!/^[a-z0-9_]{1,15}$/i.test(raw.username)||
    !["S","A"].includes(raw.expectedTier)||typeof raw.name!=="string"||raw.name.length>256||typeof raw.paused!=="boolean")throw new FreeCuratedError(400,"投稿者情報が正しくありません。");
  if(raw.initialPending!==undefined&&typeof raw.initialPending!=="boolean"||raw.initialBaselineId!==undefined&&raw.initialBaselineId!==null&&!/^\d{2,20}$/.test(raw.initialBaselineId))throw new FreeCuratedError(400,"初回取得の基準が正しくありません。");
  return {id:raw.id,username:raw.username,name:raw.name,expectedTier:raw.expectedTier,paused:raw.paused,
    ...(raw.initialPending!==undefined?{initialPending:raw.initialPending}:{}),...(raw.initialBaselineId!==undefined?{initialBaselineId:raw.initialBaselineId}:{})};
}
export function parseSyncCandidates(raw:any,author:FreeAuthor):FreeCandidate[]{
  if(!Array.isArray(raw)||raw.length>100)throw new FreeCuratedError(400,"投稿数が正しくありません。");
  const url=(v:any,host:string,nullable=false)=>{if(v===null&&nullable)return true;try{const u=new URL(v);return typeof v==="string"&&v.length<=4096&&u.protocol==="https:"&&u.hostname===host&&!u.port&&!u.username&&!u.password;}catch{return false;}};
  const ids=new Set<string>();
  return raw.map(p=>{
    if(!p||!/^\d{2,20}$/.test(p.x_post_id)||ids.has(p.x_post_id)||p.author_id!==author.id||
      typeof p.text!=="string"||p.text.length>100000||typeof p.possibly_sensitive!=="boolean"||!Number.isFinite(Date.parse(p.created_at))||
      Date.parse(p.created_at)>Date.now()+300000||!url(p.video_url,"video.twimg.com")||!new URL(p.video_url).pathname.toLowerCase().endsWith(".mp4")||
      !url(p.preview_image_url,"pbs.twimg.com",true)||(p.media_key!==null&&(typeof p.media_key!=="string"||p.media_key.length>128))||
      [p.views,p.likes,p.reposts,p.replies,p.quotes,p.bookmarks].some(n=>!Number.isFinite(n)||n<0)||
      !Number.isInteger(p.videoCount)||p.videoCount<1||p.videoCount>4)throw new FreeCuratedError(400,"動画候補が正しくありません。");
    ids.add(p.x_post_id);
    return {x_post_id:p.x_post_id,author_id:author.id,author_username:author.username,author_name:author.name,text:p.text,
      possibly_sensitive:p.possibly_sensitive,created_at:new Date(p.created_at).toISOString(),x_url:`https://x.com/${author.username}/status/${p.x_post_id}`,
      media_key:p.media_key,media_type:"video",preview_image_url:p.preview_image_url,video_url:p.video_url,
      video_bitrate:Number.isFinite(p.video_bitrate)&&p.video_bitrate>=0?p.video_bitrate:null,
      views:p.views,likes:p.likes,reposts:p.reposts,replies:p.replies,quotes:p.quotes,bookmarks:p.bookmarks,
      durationSeconds:typeof p.durationSeconds==="number"&&Number.isFinite(p.durationSeconds)&&p.durationSeconds>0?p.durationSeconds:null,videoCount:p.videoCount};
  });
}
export async function synchronizeFreeCurated(body:any,options:{directory?:string;database?:ReturnType<typeof supabaseAdmin>;publish?:typeof publishFreeCandidates}={}){
  if(!body||typeof body!=="object"||Array.isArray(body)||body.databaseHost!==databaseHost()||!databaseHost())throw new FreeCuratedError(400,"ローカルと本番のDB接続先が一致しません。");
  if(body.action==="manage")return manageCommonAuthors(body,options);
  if(body.action==="availability")return {availability:await availabilityDashboard({curatedDirectory:options.directory})};
  if(body.action==="dashboard")return {dashboard:await freeCuratedDashboard({directory:options.directory,database:options.database})};
  if(body.action==="status")return {state:await readScheduledFreeState(options.directory),databaseHost:databaseHost(),registrationAuthorLimit:FREE_CURATED_AUTHOR_LIMIT,registrationRecoveryVersion:1};
  if(!["sync","publish","registration"].includes(body.action))throw new FreeCuratedError(400,"操作が正しくありません。");
  return withScheduledFreeState(async state=>{
    if(body.action==="sync"){
      if(!Array.isArray(body.authors)||body.authors.length>FREE_CURATED_AUTHOR_LIMIT)throw new FreeCuratedError(400,"登録一覧が正しくありません。");
      const authors=body.authors.map((a:any)=>parseSyncAuthor(a));if(new Set(authors.map((a:any)=>a.id)).size!==authors.length)throw new FreeCuratedError(400,"投稿者が重複しています。");
      const removed=new Set((await readCuratedRemovals(options.directory)).map(e=>e.id));
      const total=new Set([...state.authors.map(a=>a.id),...authors.filter((a:any)=>!removed.has(a.id)).map((a:any)=>a.id)]).size;
      // Refuse capacity before touching the shared DB; omission is never deletion.
      if(total>FREE_CURATED_AUTHOR_LIMIT)throw new FreeCuratedError(409,`本番登録は${state.authors.length}投稿者、上限${FREE_CURATED_AUTHOR_LIMIT}投稿者です。`);
      for(const a of authors){if(removed.has(a.id))continue;
        const status=await ensureCommonAuthor(a,options.database??supabaseAdmin(),options.directory);a.paused=status!=="active";
        const old=state.authors.find(x=>x.id===a.id);
        if(old){
          const ready=old.initialReady===true||(old.initialPending===false&&!!old.initialBaselineId);
          Object.assign(old,{username:a.username,name:a.name,expectedTier:a.expectedTier,paused:a.paused,source:"free",
            ...(a.initialPending!==undefined?{initialPending:ready?false:a.initialPending}:{}),
            ...(!old.initialBaselineId&&a.initialBaselineId?{initialBaselineId:a.initialBaselineId}:{})});
          if(ready)old.initialReady=true;
        }else state.authors.push({...newScheduledAuthor(a,"free",Date.now()),paused:a.paused,initialPending:a.initialPending??true,initialBaselineId:a.initialBaselineId??null});
      }
      await writeScheduledFreeState(state,options.directory);
      return {synced:authors.length,state,databaseHost:databaseHost(),registrationAuthorLimit:FREE_CURATED_AUTHOR_LIMIT,message:"本番へ登録一覧を同期しました。新着巡回はFxTwitterを使います（直近24時間で最大24投稿者）。"};
    }
    if((await readCuratedRemovals(options.directory)).some(e=>e.id===body.id))throw new FreeCuratedError(409,"手動削除済みの投稿者は掲載できません。");
    const author=state.authors.find(a=>a.id===body.id);
    if(!author)throw new FreeCuratedError(409,"本番の投稿者登録がありません。登録一覧を同期してから掲載してください。",undefined,false,"sync");
    if(author.paused)throw new FreeCuratedError(409,"本番で停止中の投稿者は掲載できません。登録画面で再開してから操作してください。");
    const now=Date.now(),owner=body.registrationSession;
    if(body.action==="registration"){
      if(body.mode!=="begin"||!validRegistrationOwner(owner))throw new FreeCuratedError(400,"初回取得の処理情報が正しくありません。");
      const common=await ensureCommonAuthor(author,options.database??supabaseAdmin(),options.directory);
      if(common!=="active")throw new FreeCuratedError(409,"共通管理で停止中の投稿者です。");
      if(author.registrationReceipt?.owner===owner&&author.registrationReceipt.ready)
        return {registration:{version:1,...author.registrationReceipt},state,databaseHost:databaseHost(),registrationAuthorLimit:FREE_CURATED_AUTHOR_LIMIT};
      if(registrationLeaseActive(author,now)&&author.registrationLease!.owner!==owner)throw new FreeCuratedError(409,"別の初回取得が処理中です。完了後に再開してください。");
      author.registrationLease={owner,expiresAt:now+REGISTRATION_LEASE_MS};await writeScheduledFreeState(state,options.directory);
      return {registration:{version:1,owner,ready:false,expiresAt:author.registrationLease.expiresAt},state,databaseHost:databaseHost(),registrationAuthorLimit:FREE_CURATED_AUTHOR_LIMIT};
    }
    const scoped=owner!==undefined;
    const outcome=body.registrationComplete?(body.registrationOutcome??"complete"):null;
    if(body.registrationComplete!==undefined&&(typeof body.registrationComplete!=="boolean"||body.initialBaselineId!==null&&!/^\d{2,20}$/.test(body.initialBaselineId)))throw new FreeCuratedError(400,"初回取得の完了情報が正しくありません。");
    if(scoped&&(!validRegistrationOwner(owner)||!Number.isSafeInteger(body.registrationPage)||body.registrationPage<0||body.registrationPage>30||
      !Number.isSafeInteger(body.registrationScanned)||body.registrationScanned<0||body.registrationScanned>300||![null,"complete","partial"].includes(outcome)))throw new FreeCuratedError(400,"初回取得の処理情報が正しくありません。");
    if(body.initialBaselineId&&((BigInt(body.initialBaselineId)>>22n)+1288834974657n)>BigInt(now+300000))throw new FreeCuratedError(400,"取得基準が未来の時刻です。");
    const receipt=author.registrationReceipt;
    if(scoped&&receipt&&receipt.owner===owner&&receipt.page===body.registrationPage&&receipt.outcome===outcome){
      const common=await ensureCommonAuthor(author,options.database??supabaseAdmin(),options.directory);
      if(common!=="active")throw new FreeCuratedError(409,"共通管理で停止中の投稿者です。");
      return {published:receipt.publication,registration:{version:1,...receipt},state,databaseHost:databaseHost(),registrationAuthorLimit:FREE_CURATED_AUTHOR_LIMIT};
    }
    if(scoped){requireRegistrationOwner(author,owner,now);if(receipt&&receipt.owner===owner&&receipt.page>body.registrationPage)throw new FreeCuratedError(409,"古い掲載要求です。状態を確認してください。");}
    else if(registrationLeaseActive(author,now))throw new FreeCuratedError(409,"初回取得の処理中です。完了後に再開してください。");
    if(outcome==="partial"){
      if(!scoped||!body.initialBaselineId||body.registrationScanned===0||author.initialBaselineId!==body.initialBaselineId)throw new FreeCuratedError(409,"新着巡回の基準を本番で確認できません。取得位置を保持します。");
      if(!author.initialPageConfirmed){
        // Legacy runs have no receipt; require at least one already registered own post.
        const proof=await(options.database??supabaseAdmin()).from("posts").select("x_post_id").eq("author_id",author.id).limit(1);
        if(proof.error||!proof.data?.some((p:any)=>typeof p.x_post_id==="string"&&/^\d{2,20}$/.test(p.x_post_id)&&BigInt(p.x_post_id)<=BigInt(body.initialBaselineId)))throw new FreeCuratedError(503,"初回ページの本番記録を確認できません。取得位置を保持します。");
      }
    }
    const status=await ensureCommonAuthor(author,options.database??supabaseAdmin(),options.directory);if(status!=="active")throw new FreeCuratedError(409,"共通管理で停止中の投稿者です。");
    const candidates=parseSyncCandidates(body.candidates,author);
    const previousHiddenSaveAt=typeof body.previousHiddenSaveAt==="string"&&Number.isFinite(Date.parse(body.previousHiddenSaveAt))?body.previousHiddenSaveAt:null;
    const result=candidates.length?await(options.publish??publishFreeCandidates)(author,candidates,{database:options.database??supabaseAdmin(),previousHiddenSaveAt}):{saved:0,promoted:0,excluded:0,duplicates:0,paid_x_requests:0};
    if(body.registrationComplete){
      if(scoped&&(!body.initialBaselineId||body.registrationScanned===0))throw new FreeCuratedError(409,"初回取得の基準がありません。巡回を開始しません。");
      const update=await(options.database??supabaseAdmin()).from("authors").update({curated_backfill_status:outcome==="partial"?"partial":"completed"}).eq("x_author_id",author.id);
      if(update.error)throw new FreeCuratedError(503,"初回完了情報の保存に失敗しました。");
      author.initialReady=true;author.initialPending=false;author.initialHistoryOutcome=outcome as "complete"|"partial";
    }else if(body.registrationComplete!==undefined&&!author.initialReady)author.initialPending=true;
    if(body.initialBaselineId&&!author.initialReady)author.initialBaselineId=body.initialBaselineId;
    // Keep an existing readiness baseline immutable; scheduled watermarks are never changed here.
    if(body.initialBaselineId&&!author.initialBaselineId)author.initialBaselineId=body.initialBaselineId;
    if(scoped&&body.registrationScanned>0&&body.initialBaselineId)author.initialPageConfirmed=true;
    if(scoped){
      author.registrationReceipt={owner,page:body.registrationPage,outcome,ready:!!body.registrationComplete,
        publication:{saved:result.saved,promoted:result.promoted,excluded:result.excluded,duplicates:result.duplicates}};
      if(body.registrationComplete)delete author.registrationLease;
    }
    author.savedTotal+=result.saved;await writeScheduledFreeState(state,options.directory);
    return {published:result,...(scoped?{registration:{version:1,...author.registrationReceipt}}:{}),state,databaseHost:databaseHost(),registrationAuthorLimit:FREE_CURATED_AUTHOR_LIMIT,message:`本番へ新規${result.saved}件・非公開候補から${result.promoted}件を掲載しました。対象外${result.excluded}件。表示はランキングの条件と更新周期に従います。`};
  },options.directory);
}

