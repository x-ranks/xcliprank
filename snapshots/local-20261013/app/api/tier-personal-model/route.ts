import { NextRequest, NextResponse } from "next/server";
import { resetPersonalSnapshot, importPersonalTeachers, personalModelStatus, personalModelStep } from "../../../lib/tier-personal-engine";
import { personalState, savePersonalState, PersonalBundle } from "../../../lib/tier-personal-store";
import { validPersonalHead, PERSONAL_FEATURE_SPEC } from "../../../lib/tier-personal-core";
import { PERSONAL_EVALUATION_SPEC } from "../../../lib/tier-personal-evaluation";
import { releaseModel, releaseStatus } from "../../../lib/tier-model-release";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function local(request:NextRequest) {
  try{const host=new URL("http://"+(request.headers.get("host")??request.nextUrl.host)),origin=request.headers.get("origin");
    return process.env.NODE_ENV!=="production"&&["localhost","127.0.0.1","[::1]"].includes(host.hostname)&&(!origin||new URL(origin).origin===host.origin)&&!["cross-site","same-site"].includes(request.headers.get("sec-fetch-site")??"");}catch{return false;}
}
export async function GET(request:NextRequest){
  if(!local(request))return NextResponse.json({error:"ローカル専用です。"},{status:404});
  try{return NextResponse.json({...await personalModelStatus(),release:await releaseStatus()},{headers:{"Cache-Control":"no-store"}});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"STATUS_FAILED"},{status:500});}
}
export async function POST(request:NextRequest){
  if(!local(request))return NextResponse.json({error:"ローカル専用です。"},{status:404});
  try{const {action,previewId,modelHash}=await request.json();
    if(action==="adopt-reviewed"||action==="restore-model") {await releaseModel(action,previewId,modelHash);return NextResponse.json({...await personalModelStatus(),release:await releaseStatus()});}
    if(action==="resume-new-videos"||action==="pause-new-videos"){
      const worker=await personalState<Record<string,unknown>>("new-video-evaluation");
      if(!worker)throw Error("先に今回のモデルを採用してください。");
      await savePersonalState("new-video-evaluation",{...worker,enabled:action==="resume-new-videos"});
      if(action==="resume-new-videos"){const config=await personalState<Record<string,unknown>>("config");await savePersonalState("config",{...config,enabled:true,comparisonCachedOnly:false,autoPromote:false});}
      return NextResponse.json(await personalModelStatus());
    }
    if(action==="enable"){const imported=await importPersonalTeachers();const old=await personalState<Record<string,unknown>>("config");await savePersonalState("config",{...old,enabled:true,autoPromote:old?.manualAdoption?false:old?.autoPromote??false,comparisonCachedOnly:false});return NextResponse.json({imported,...await personalModelStatus()});}
    if(action==="compare-cached"){
      resetPersonalSnapshot();
      const config=await personalState<Record<string,unknown>>("config");
      await savePersonalState("config",{...config,enabled:true,autoPromote:false,comparisonCachedOnly:true});
      await savePersonalState("worker-status",null);
      return NextResponse.json(await personalModelStatus());
    }
    if(action==="disable"){await savePersonalState("config",{enabled:false});return NextResponse.json(await personalModelStatus());}
    if(action==="step")return NextResponse.json(await personalModelStep());
    if(action==="prepare-videos"){
      const config=await personalState<{enabled:boolean;autoPromote?:boolean;comparisonCachedOnly?:boolean}>("config");
      if(!config?.enabled)throw Error("先に共通学習を有効化してください。");
      await savePersonalState("config",{...config,comparisonCachedOnly:false});
      const job=await personalState<{cursor:number;processed:number;ready:number;failed:number;done?:boolean}>("video-preparation");
      await savePersonalState("video-preparation",job&&!job.done?{...job,enabled:true}:{enabled:true,cursor:0,processed:0,ready:0,failed:0});
      return NextResponse.json(await personalModelStatus());
    }
    if(action==="pause-videos"){
      const job=await personalState<Record<string,unknown>>("video-preparation");
      if(job)await savePersonalState("video-preparation",{...job,enabled:false});
      return NextResponse.json(await personalModelStatus());
    }
    if(action==="activate"){
      if((await personalState<Record<string,unknown>>("config"))?.manualAdoption)throw Error("今回のモデルを固定採用しています。別候補への切り替えは停止中です。");
      const candidate=await personalState<PersonalBundle>("candidate-model");
      const revision=(await personalState<{value:number}>("revision"))?.value??0;
      if(!candidate||candidate.revision!==revision||candidate.seedsHash!==(await personalState<string>("seed-hash"))||(candidate as PersonalBundle & {evaluationSpec?:string}).evaluationSpec!==PERSONAL_EVALUATION_SPEC||candidate.featureSpec!==PERSONAL_FEATURE_SPEC||!validPersonalHead(candidate.head)||!(candidate.validation as {passed?:boolean})?.passed)throw Error("最新の精度検証を通過した候補がありません。");
      await savePersonalState("active-model",candidate);await savePersonalState("config",{enabled:true,autoPromote:true});return NextResponse.json(await personalModelStatus());
    }
    if(action==="deactivate"){await savePersonalState("active-model",null);const config=await personalState<{enabled:boolean}>("config");await savePersonalState("config",{enabled:config?.enabled??false,autoPromote:false});return NextResponse.json(await personalModelStatus());}
    return NextResponse.json({error:"INVALID_ACTION"},{status:400});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"LEARNING_FAILED"},{status:500});}
}
