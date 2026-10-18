import type { FreeAuthor, FreeCandidate } from "./fxtwitter-curated";
import type { XPosition } from "./x-curated-state";
import { X_PAGE_SIZE } from "./x-curated-state";
import { recordXApiUsage } from "./x";

export class XCollectionError extends Error {
  constructor(public status:number,message:string,public retryAt=0){super(message);}
}
const validId=(v:unknown):v is string=>typeof v==="string"&&/^\d{2,20}$/.test(v);
export const snowflakeTime=(id:string)=>Number((BigInt(id)>>22n)+1288834974657n);
export const maxPostId=(a:string|null,b:string|null)=>a===null?b:b===null?a:BigInt(a)>BigInt(b)?a:b;
function mediaUrl(value:unknown,host:string,mp4=false):value is string {
  try{const u=new URL(String(value));return typeof value==="string"&&value.length<=4096&&u.protocol==="https:"&&u.hostname===host&&
    !u.port&&!u.username&&!u.password&&(!mp4||u.pathname.toLowerCase().endsWith(".mp4"));}catch{return false;}
}
const number=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)&&n>=0?n:0;
export async function searchXCurated(author:FreeAuthor,position:XPosition,options:{now:number;fetcher?:typeof fetch;token?:string}) {
  const token=options.token??process.env.X_BEARER_TOKEN;
  if(!token)throw new XCollectionError(401,"X API認証が未設定です。取得位置を保持して停止しました。");
  const params=new URLSearchParams({query:`from:${author.username} has:videos -is:retweet`,max_results:String(X_PAGE_SIZE),sort_order:"recency",
    "tweet.fields":"id,text,author_id,created_at,attachments,possibly_sensitive,public_metrics",
    expansions:"attachments.media_keys","media.fields":"media_key,type,preview_image_url,duration_ms,public_metrics,variants"});
  // Never combine start_time with since_id, or end_time with until_id.
  if(position.startTime)params.set("start_time",position.startTime);else params.set("since_id",position.sinceId);
  if(position.endTime)params.set("end_time",position.endTime);
  if(position.nextToken)params.set("next_token",position.nextToken);
  const started=Date.now();let response:Response;
  try{response=await(options.fetcher??fetch)(`https://api.x.com/2/tweets/search/recent?${params}`,{
    method:"GET",headers:{Authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(45000)});}
  catch{await recordXApiUsage({source:"curated_incremental",endpoint:"/2/tweets/search/recent",status:0,durationMs:Date.now()-started,error:"transport_failure"});
    throw new XCollectionError(0,"X APIへの接続に失敗しました。取得位置を保持しています。");}
  if(!response.ok){await response.body?.cancel();
    await recordXApiUsage({source:"curated_incremental",endpoint:"/2/tweets/search/recent",status:response.status,durationMs:Date.now()-started,error:"request_failed"});
    const reset=Number(response.headers.get("x-rate-limit-reset"))*1000;
    const retry=response.headers.get("retry-after");const retryAt=retry?(Number.isFinite(Number(retry))?options.now+Number(retry)*1000:Date.parse(retry)):0;
    throw new XCollectionError(response.status,`X API取得失敗（HTTP ${response.status}）。取得位置を保持しています。`,Math.max(Number.isFinite(reset)?reset:0,Number.isFinite(retryAt)?retryAt:0));
  }
  let body:any;try{body=await response.json();}catch{throw new XCollectionError(502,"X APIの応答JSONを確認できません。");}
  const raw=body?.data??[];
  await recordXApiUsage({source:"curated_incremental",endpoint:"/2/tweets/search/recent",status:200,posts:Array.isArray(raw)?raw.length:0,durationMs:Date.now()-started});
  if(!body||body.errors?.length||!Array.isArray(raw)||raw.length>X_PAGE_SIZE||!body.meta||
    !Number.isSafeInteger(body.meta.result_count)||body.meta.result_count!==raw.length||
    body.meta.next_token!==undefined&&(typeof body.meta.next_token!=="string"||!body.meta.next_token.length||body.meta.next_token.length>4096)||
    body.meta.next_token!==undefined&&raw.length===0)throw new XCollectionError(502,"X APIの部分失敗・不正な一覧応答です。取得位置を進めません。");
  const media = new Map<string,any>();
  if(body.includes?.media!==undefined&&!Array.isArray(body.includes.media))throw new XCollectionError(502,"動画情報の形式を確認できません。");
  for(const m of body.includes?.media??[])if(typeof m.media_key==="string")media.set(m.media_key,m);
  const posts:FreeCandidate[]=[];let newest:string|null=null;const ids=new Set<string>();
  for(const p of raw){
    if(!validId(p.id)||ids.has(p.id)||p.author_id!==author.id||typeof p.text!=="string"||typeof p.possibly_sensitive!=="boolean"||
      !Number.isFinite(Date.parse(p.created_at))||Date.parse(p.created_at)>options.now+300000||
      position.endTime&&Date.parse(p.created_at)>Date.parse(position.endTime)||!Array.isArray(p.attachments?.media_keys))
      throw new XCollectionError(502,"投稿者・投稿ID・動画情報を照合できません。取得位置を進めません。");
    ids.add(p.id);newest=maxPostId(newest,p.id);
    if(BigInt(p.id)<=BigInt(position.sinceId))continue;
    const videos=p.attachments.media_keys.map((k:string)=>media.get(k)).filter((m:any)=>m?.type==="video");
    const variants=videos.flatMap((m:any)=>(m.variants??[]).filter((v:any)=>v.content_type==="video/mp4"&&mediaUrl(v.url,"video.twimg.com",true)).map((v:any)=>({m,v})))
      .sort((a:any,b:any)=>number(b.v.bit_rate)-number(a.v.bit_rate));
    if(!variants.length)throw new XCollectionError(502,"動画付き投稿の再生URLが不足しています。取得位置を進めません。");
    const {m,v}=variants[0],metrics=p.public_metrics??{};
    posts.push({x_post_id:p.id,author_id:author.id,author_username:author.username,author_name:author.name,text:p.text,
      possibly_sensitive:p.possibly_sensitive,created_at:new Date(p.created_at).toISOString(),x_url:`https://x.com/${author.username}/status/${p.id}`,
      media_key:m.media_key,media_type:"video",preview_image_url:mediaUrl(m.preview_image_url,"pbs.twimg.com")?m.preview_image_url:null,
      video_url:v.url,video_bitrate:number(v.bit_rate)||null,views:number(metrics.impression_count)||number(m.public_metrics?.view_count),
      likes:number(metrics.like_count),reposts:number(metrics.retweet_count??metrics.repost_count),replies:number(metrics.reply_count),quotes:number(metrics.quote_count),bookmarks:number(metrics.bookmark_count),
      durationSeconds:number(m.duration_ms)?number(m.duration_ms)/1000:null,videoCount:Math.min(4,videos.length)});
  }
  return {posts,rawCount:raw.length,newestId:newest,nextToken:(body.meta.next_token??null) as string|null};
}
