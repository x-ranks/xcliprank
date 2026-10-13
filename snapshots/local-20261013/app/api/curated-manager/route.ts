import { NextRequest, NextResponse } from "next/server";
import { allowFreeLocalRequest } from "../../../lib/fxtwitter-local-access";
import { callFreeProduction } from "../../../lib/free-curated-client";
import { FreeCuratedError } from "../../../lib/fxtwitter-curated";
import { withFreeRegistry } from "../../../lib/fxtwitter-curated-store";
export const runtime="nodejs",dynamic="force-dynamic";
const json=(value:object,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow"}});
export async function POST(request:NextRequest){
 if(!allowFreeLocalRequest(request,true))return json({ok:false,error:"Local same-origin JSON only"},403);
 try{const text=await request.text();if(Buffer.byteLength(text)>2048)throw new FreeCuratedError(413,"入力が大きすぎます。");
  let body:any;try{body=JSON.parse(text);}catch{throw new FreeCuratedError(400,"入力が正しくありません。");}
  if(!body||!["list","migrate","pause","resume","remove","availability"].includes(body.operation))throw new FreeCuratedError(400,"操作が正しくありません。");
  if(body.operation==="list"||body.operation==="availability")return json({ok:true,...await callFreeProduction(body.operation==="availability"?{action:"availability"}:{action:"manage",operation:"list"},fetch,request.signal)});
  // Same local registry -> server operation lock order as registration prevents races with a running bulk job.
  const production=await withFreeRegistry(async state=>{
   const result=await callFreeProduction(body.operation==="availability"?{action:"availability"}:{action:"manage",operation:body.operation,id:body.id,confirm:body.confirm},fetch,request.signal);
   if(["pause","resume","remove"].includes(body.operation)){
    if(body.operation==="remove")state.authors=state.authors.filter(a=>a.id!==body.id);
    else{const a=state.authors.find(a=>a.id===body.id);if(a)a.paused=body.operation==="pause";}
   }return result;
  });return json({ok:true,...production});
 }catch(e){return json({ok:false,error:e instanceof FreeCuratedError?e.message:"本番の確認・更新に失敗しました。"},e instanceof FreeCuratedError?e.status:503);}
}
