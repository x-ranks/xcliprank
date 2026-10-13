import {NextRequest,NextResponse} from "next/server";
import {preparePreviewPlayback,servePreviewPlayback} from "../../../lib/tier-preview-playback";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function local(req:NextRequest){try{const h=new URL("http://"+(req.headers.get("host")??req.nextUrl.host)),o=req.headers.get("origin");return process.env.NODE_ENV!=="production"&&["localhost","127.0.0.1","[::1]"].includes(h.hostname)&&(!o||new URL(o).origin===h.origin)&&!["same-site","cross-site"].includes(req.headers.get("sec-fetch-site")??"");}catch{return false;}}
async function media(req:NextRequest,head=false){if(!local(req))return NextResponse.json({error:"LOCAL_ONLY"},{status:404});try{return await servePreviewPlayback(Number(req.nextUrl.searchParams.get("id")),req.headers.get("range"),head);}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"VIDEO_READ_FAILED"},{status:400});}}
export async function GET(req:NextRequest){return media(req);}
export async function HEAD(req:NextRequest){return media(req,true);}
export async function POST(req:NextRequest){if(!local(req))return NextResponse.json({error:"LOCAL_ONLY"},{status:404});if(!req.headers.get("content-type")?.startsWith("application/json"))return NextResponse.json({error:"JSON_REQUIRED"},{status:415});try{const b=await req.json();return NextResponse.json(await preparePreviewPlayback(b.id));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"PREPARE_FAILED"},{status:400});}}
