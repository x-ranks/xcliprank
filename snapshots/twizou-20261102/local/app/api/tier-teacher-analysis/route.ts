import {NextRequest,NextResponse} from "next/server";
import {analyzeTeachers} from "../../../lib/tier-teacher-analysis";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){
  try{
    const host=new URL("http://"+(request.headers.get("host")??request.nextUrl.host));const origin=request.headers.get("origin");
    if(process.env.NODE_ENV==="production"||!["localhost","127.0.0.1","[::1]"].includes(host.hostname)||(origin&&new URL(origin).origin!==host.origin)||["cross-site","same-site"].includes(request.headers.get("sec-fetch-site")??""))return NextResponse.json({error:"ローカル開発環境で開いてください。"},{status:404});
    return NextResponse.json(await analyzeTeachers(),{headers:{"Cache-Control":"no-store"}});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"教師データの診断に失敗しました。"},{status:500});}
}
