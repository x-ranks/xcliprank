import { FREE_CURATED_AUTHOR_LIMIT } from "../../../lib/free-curated-limits";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { FreeCuratedError } from "../../../lib/fxtwitter-curated";
import { synchronizeFreeCurated } from "../../../lib/free-curated-sync";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(data:object,status=200)=>NextResponse.json({...data,paid_x_requests:0},{status,headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"}});
function authorizedFreeSync(request:NextRequest){
  const secret=process.env.CRON_SECRET,token=request.headers.get("authorization");
  if(!secret||!token)return false;
  const expected=Buffer.from(`Bearer ${secret}`),provided=Buffer.from(token);
  return expected.length===provided.length&&timingSafeEqual(expected,provided);
}
export async function GET(request:NextRequest){
  if(!authorizedFreeSync(request))return json({ok:false,error:"Unauthorized"},401);
  return json({ok:true,feature:"free_curated_sync",provider:"fxtwitter",scheduledProvider:"fxtwitter",automated:true,commonManagement:true,registrationRecoveryVersion:1,registrationAuthorLimit:FREE_CURATED_AUTHOR_LIMIT,availabilityDashboard:true,intervalHours:3,authorMinHours:24,batchLimit:8,pageSize:100,dailyAuthorLimit:24});
}
export async function POST(request:NextRequest){
  if(!authorizedFreeSync(request))return json({ok:false,error:"Unauthorized"},401);
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return json({ok:false,error:"JSON required"},415);
  try{
    const reader=request.body?.getReader();if(!reader)throw new FreeCuratedError(400,"入力がありません。");
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
      if(size>4*1024*1024){await reader.cancel();throw new FreeCuratedError(413,"入力が大きすぎます。投稿取得件数を減らしてください。");}chunks.push(part.value);}}
    finally{reader.releaseLock();}
    let body:any;try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new FreeCuratedError(400,"入力形式が正しくありません。");}
    return json({ok:true,...await synchronizeFreeCurated(body)});
  }catch(e){return json({ok:false,error:e instanceof FreeCuratedError?e.message:"本番同期に失敗しました。設定値は表示しません。",...(e instanceof FreeCuratedError&&e.recoveryAction?{recoveryAction:e.recoveryAction}:{})},e instanceof FreeCuratedError?e.status:503);}
}
