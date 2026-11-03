import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import { unavailableKeys } from "./post-status-store";

type DB=ReturnType<typeof supabaseAdmin>;
export type CuratedVideoReference={post_id:string;source_author_id:string;selected_author_id:string;selected_post_id:string;reference_kind:"quote"|"repost";source_hash:string;observed_at:string};
const FIELDS="post_id,source_author_id,selected_author_id,selected_post_id,reference_kind,source_hash,observed_at";
const id=(x:unknown):x is string=>typeof x==="string"&&/^\d{2,20}$/.test(x);
export const referenceSourceHash=(url:string)=>createHash("sha256").update(url).digest("hex");
export function validCuratedReference(r:CuratedVideoReference){return !!r&&[r.post_id,r.source_author_id,r.selected_author_id,r.selected_post_id].every(id)&&["quote","repost"].includes(r.reference_kind)&&/^[a-f0-9]{64}$/.test(r.source_hash)&&Number.isFinite(Date.parse(r.observed_at));}
// No control decisions are cached: pausing/removing/reviewing either author is
// checked against the DB on each request. Facts never grant author-wide access.
export async function readCuratedReferences(database:DB,postIds?:string[],selectedIds?:string[]){
 if(postIds?.length===0||selectedIds?.length===0)return [];
 const groups=postIds?Array.from({length:Math.ceil(postIds.length/100)},(_,i)=>postIds.slice(i*100,i*100+100)):[null];
 const rows:CuratedVideoReference[]=[];
 for(const group of groups){
  let q=database.from("curated_video_references").select(FIELDS).order("post_id").order("selected_author_id").order("selected_post_id");
  if(group)q=q.in("post_id",group);if(selectedIds)q=q.in("selected_author_id",selectedIds);
  let complete=false;
  for(let offset=0;offset<20000;offset+=500){const r=await q.range(offset,offset+499);if(r.error)throw Error("CURATED_REFERENCES_UNAVAILABLE");
   const page=(r.data??[]) as CuratedVideoReference[];if(page.some(v=>!validCuratedReference(v)))throw Error("CURATED_REFERENCE_INVALID");rows.push(...page);if(page.length<500){complete=true;break;}}
  if(!complete)throw Error("CURATED_REFERENCE_LIMIT");
 }
 return rows;
}
export async function eligibleCuratedReferences(database:DB,refs:CuratedVideoReference[],blocked?:ReadonlySet<string>){
 if(!refs.length)return [];
 const unavailable=blocked??await unavailableKeys();
 const ids=[...new Set(refs.flatMap(r=>[r.source_author_id,r.selected_author_id]))],authors=new Map<string,any>();
 for(let offset=0;offset<ids.length;offset+=100){const r=await database.from("authors").select("x_author_id,username,is_curated,curated_status,review_required").in("x_author_id",ids.slice(offset,offset+100)).limit(100);if(r.error)throw Error("CURATED_REFERENCE_AUTHORS_UNAVAILABLE");for(const row of r.data??[])authors.set(String(row.x_author_id),row);}
 return refs.filter(r=>{const a=authors.get(r.selected_author_id),s=authors.get(r.source_author_id);return a?.is_curated===true&&a.curated_status==="active"&&a.review_required!==true&&s&&s.review_required!==true&&!['paused','removed','unavailable'].includes(s.curated_status)&&!["id:"+r.source_author_id,"id:"+r.selected_author_id,"post:"+r.post_id,"post:"+r.selected_post_id,"name:"+String(a.username??'').toLowerCase(),"name:"+String(s.username??'').toLowerCase()].some(key=>unavailable.has(key));});
}
export function referencePermitsPost(row:Record<string,any>,refs:readonly CuratedVideoReference[]){
 return typeof row.video_url==="string"&&refs.some(r=>r.post_id===String(row.x_post_id)&&r.source_author_id===String(row.author_id)&&r.source_hash===referenceSourceHash(row.video_url));
}
export async function writeCuratedReferences(database:DB,refs:CuratedVideoReference[]){
 if(!refs.length)return;if(refs.length>100||refs.some(r=>!validCuratedReference(r)))throw Error("CURATED_REFERENCE_INVALID");
 const r=await database.from("curated_video_references").upsert(refs,{onConflict:"post_id,selected_author_id,selected_post_id"});if(r.error)throw Error("CURATED_REFERENCE_WRITE_FAILED");
}
