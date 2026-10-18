import { supabaseAdmin } from "./supabase-admin";
import { FreeCuratedError, type FreeAuthor } from "./fxtwitter-curated";
import { withScheduledFreeState, writeScheduledFreeState, type ScheduledFreeState } from "./free-curated-server-store";
import { readCuratedRemovals, writeCuratedRemovals } from "./curated-removals";
type DB=ReturnType<typeof supabaseAdmin>;
export async function ensureCommonAuthor(author:FreeAuthor&{paused?:boolean;initialPending?:boolean},db:DB,directory?:string){
 if((await readCuratedRemovals(directory)).some(e=>e.id===author.id))throw new FreeCuratedError(409,"手動削除済みの投稿者です。古い一覧から再登録はできません。");
 const {data:old,error}=await db.from("authors").select("*").eq("x_author_id",author.id).maybeSingle();if(error)throw new FreeCuratedError(503,"共通投稿者情報の確認に失敗しました。");
 if(old?.curated_status==="removed")throw new FreeCuratedError(409,"削除済みの投稿者です。");
 // An existing common status is authoritative. A stale local roster must never resume it.
 const status=old?.is_curated?old.curated_status:(author.paused?"paused":"active");
 const fields={username:author.username,name:author.name,is_curated:true,curated_status:status??"paused",curated_expected_tier:author.expectedTier,
  ...(!old?.curated_added_at?{curated_added_at:new Date().toISOString()}:{}),...(!old?{curated_backfill_status:author.initialPending?"pending":"completed"}: {})};
 const result=old?await db.from("authors").update(fields).eq("x_author_id",author.id):await db.from("authors").upsert({x_author_id:author.id,...fields},{onConflict:"x_author_id",ignoreDuplicates:true});
 if(result.error)throw new FreeCuratedError(503,"共通投稿者情報の保存に失敗しました。");return status??"paused";
}
export async function migrateCommonAuthors(state:ScheduledFreeState,db:DB,directory?:string){
 const removed=new Set((await readCuratedRemovals(directory)).map(e=>e.id));let migrated=0;
 for(const a of state.authors){if(removed.has(a.id)){a.paused=true;continue;}const status=await ensureCommonAuthor(a,db,directory);a.paused=status!=="active";migrated++;}
 await writeScheduledFreeState(state,directory);return migrated;
}
export async function manageCommonAuthors(body:any,options:{directory?:string;database?:DB}={}){
 const db=options.database??supabaseAdmin();
 if(body.operation==="list"){
  const {data,error}=await db.from("authors").select("x_author_id,username,name,is_curated,curated_status,curated_expected_tier,curated_backfill_status,curated_last_post_id,curated_last_collected_at,curated_last_error").eq("is_curated",true).order("curated_added_at",{ascending:false}).limit(1000);
  if(error)throw new FreeCuratedError(503,"共通一覧の取得に失敗しました。");const removed=await readCuratedRemovals(options.directory),ids=new Set(removed.map(e=>e.id));return {authors:(data??[]).filter(a=>!ids.has(String(a.x_author_id))),removed};
 }
 if(!["migrate","pause","resume","remove"].includes(body.operation))throw new FreeCuratedError(400,"操作が正しくありません。");
 return withScheduledFreeState(async state=>{
  if(body.operation==="migrate")return {migrated:await migrateCommonAuthors(state,db,options.directory),message:"既存の登録を共通管理へ移行しました。動画の取り直しはしていません。"};
  const id=body.id;if(typeof id!=="string"||!/^\d{2,20}$/.test(id))throw new FreeCuratedError(400,"投稿者IDが正しくありません。");
  const removals=await readCuratedRemovals(options.directory),tombstone=removals.find(e=>e.id===id);
  const {data:row,error}=await db.from("authors").select("*").eq("x_author_id",id).maybeSingle();if(error)throw new FreeCuratedError(503,"投稿者の確認に失敗しました。");
  const cached=state.authors.find(a=>a.id===id);
  if(!row&&!cached&&!tombstone)throw new FreeCuratedError(404,"投稿者が見つかりません。");
  if(body.operation!=="remove"&&(tombstone||row?.curated_status==="removed"))throw new FreeCuratedError(409,"削除済みの投稿者は再開できません。");
  if(body.operation==="remove"){
   if(body.confirm!==true)throw new FreeCuratedError(400,"投稿者とその動画の掲載除外を確認してください。");
   const username=String(row?.username??cached?.username??tombstone?.username??"");if(!/^[a-z0-9_]{1,15}$/i.test(username))throw new FreeCuratedError(409,"投稿者名を確認できません。");
   if(!tombstone){if(removals.length>=5000)throw new FreeCuratedError(409,"削除記録の上限です。");removals.push({id,username,at:Date.now()});await writeCuratedRemovals(removals,options.directory);}
   // Durable exclusion first: even a later DB failure cannot expose/recollect the author.
   if(cached)cached.paused=true;await writeScheduledFreeState(state,options.directory);
   const a=await db.from("authors").update({is_curated:false,curated_status:"removed"}).eq("x_author_id",id);if(a.error)throw new FreeCuratedError(503,"削除を予約しましたがDB更新に失敗しました。同じ削除を再試行してください。");
   const p=await db.from("posts").update({is_visible:false}).eq("author_id",id);if(p.error)throw new FreeCuratedError(503,"投稿者は除外済みですが動画DB更新に失敗しました。削除済み一覧から再試行してください。");
   state.authors=state.authors.filter(a=>a.id!==id);await writeScheduledFreeState(state,options.directory);
   return {message:"投稿者を削除し、巡回と動画掲載から除外しました。DBデータと評価履歴は復旧用に保持しています。"};
  }
  const paused=body.operation==="pause";
  const result=await db.from("authors").update({curated_status:paused?"paused":"active"}).eq("x_author_id",id).eq("is_curated",true);
  if(result.error)throw new FreeCuratedError(503,"投稿者状態の更新に失敗しました。");
  if(cached)cached.paused=paused;await writeScheduledFreeState(state,options.directory);
  return {message:paused?"新着巡回を停止しました。":"新着巡回を再開しました。"};
 },options.directory);
}
