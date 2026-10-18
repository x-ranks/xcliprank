import { FreeCuratedError } from "./fxtwitter-curated";

export const FREE_PRODUCTION_ENDPOINT = "https://xcliprank.com/api/free-curated-sync";
export function localDatabaseHost() {try{return new URL(process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??"").hostname;}catch{return null;}}
export async function callFreeProduction(payload:object,fetcher:typeof fetch=fetch,signal?:AbortSignal){
  const secret=process.env.CRON_SECRET;
  if(!secret)throw new FreeCuratedError(503,"ローカルのCRON_SECRETが未設定です。既存の本番用設定を確認してください。値は画面へ貼らないでください。");
  if(!localDatabaseHost())throw new FreeCuratedError(503,"ローカルのDB接続先が未設定です。");
  let response:Response;
  try{response=await fetcher(FREE_PRODUCTION_ENDPOINT,{method:"POST",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer",cache:"no-store",
    headers:{"Content-Type":"application/json",Authorization:`Bearer ${secret}`},body:JSON.stringify({...payload,databaseHost:localDatabaseHost()}),
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});}catch{throw new FreeCuratedError(502,"本番への接続が失敗・中断しました。同期結果は本番状態の確認ボタンで確認してください。");}
  if(!response.headers.get("content-type")?.includes("application/json")){await response.body?.cancel();throw new FreeCuratedError(502,"本番同期APIが未反映か、サーバーで拒否されています。先に本番更新を実行してください。");}
  let data:any;try{data=await response.json();}catch{throw new FreeCuratedError(502,"本番の応答が正しくありません。");}
  if(!response.ok||!data.ok)throw new FreeCuratedError(response.status>=400?response.status:502,typeof data.error==="string"?data.error:"本番同期に失敗しました。");
  return data;
}
