import { NextRequest, NextResponse } from "next/server";
import { runVideoPreview, runLargeVideoRescue, videoPreviewStatus } from "../../../lib/tier-video-preview";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function localPreview(request:NextRequest){try{const host=new URL("http://"+(request.headers.get("host")??request.nextUrl.host)),origin=request.headers.get("origin");return process.env.NODE_ENV!=="production"&&["localhost","127.0.0.1","[::1]"].includes(host.hostname)&&(!origin||new URL(origin).origin===host.origin)&&!["cross-site","same-site"].includes(request.headers.get("sec-fetch-site")??"");}catch{return false;}}
export async function GET(request:NextRequest){if(!localPreview(request))return NextResponse.json({error:"ローカル専用です。"},{status:404});try{return NextResponse.json(await videoPreviewStatus(),{headers:{"Cache-Control":"no-store"}});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"PREVIEW_READ_FAILED"},{status:500});}}
export async function POST(request:NextRequest){
  if(!localPreview(request))return NextResponse.json({error:"ローカル専用です。"},{status:404});
  if(!request.headers.get("content-type")?.startsWith("application/json"))return NextResponse.json({error:"JSON required"},{status:415});
  try{const body=await request.json();if(typeof body.action!=="string")throw Error("操作が不正です。");
    if(body.action.startsWith("rescue-"))await runLargeVideoRescue(body.action,body.id);else await runVideoPreview(body.action,body);
    return NextResponse.json(await videoPreviewStatus(),{headers:{"Cache-Control":"no-store"}});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"PREVIEW_FAILED"},{status:400});}
}
