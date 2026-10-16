import { FreeCuratedError, fetchFreeProfile, fetchFreeMediaPage } from "./fxtwitter-curated";
import { callFreeProduction } from "./free-curated-client";
import { writeFreeRegistry, type FreeRegistry, type FreeRegistration } from "./fxtwitter-curated-store";

export type RegistrationJob = {
  requested: 100 | 200 | 300; scanned: number; pages: number; fetched: number;
  saved: number; excluded: number; duplicates: number;
  phase: "sync" | "fetch" | "publish" | "completed";
  initialLatestId?: string | null; cursor: string | null; cursors: string[]; postIds: string[]; error: string | null;
};
type Options = { profile?: typeof fetchFreeProfile; media?: typeof fetchFreeMediaPage;
  production?: typeof callFreeProduction; persist?: typeof writeFreeRegistry; pause?: () => Promise<void>; signal?: AbortSignal };
const roster = (state: FreeRegistry) => state.authors.map(a => ({id:a.id,username:a.username,name:a.name,expectedTier:a.expectedTier,paused:a.paused,initialPending:!!a.registration&&a.registration.phase!=="completed",initialBaselineId:a.registration?.initialLatestId??null}));
const wait = (signal?: AbortSignal) => new Promise<void>((resolve,reject) => {
  if(signal?.aborted){reject(new FreeCuratedError(499,"操作が中断されました。登録一覧から続きを再開できます。"));return;}
  const done=()=>{signal?.removeEventListener("abort",abort);resolve();};
  const timer=setTimeout(done,5000);
  const abort=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(new FreeCuratedError(499,"操作が中断されました。登録一覧から続きを再開できます。"));};
  signal?.addEventListener("abort",abort,{once:true});
});
function available(state: FreeRegistry) {
  if(state.cooldownUntil>Date.now())throw new FreeCuratedError(429,"無料取得の休止期間です。表示された待機期限後に再開してください。");
}
function rememberFailure(state: FreeRegistry, a: FreeRegistration, e: unknown) {
  const message=e instanceof FreeCuratedError?e.message:"登録処理が中断しました。登録一覧から続きを再開してください。";
  a.error=message;if(a.registration)a.registration.error=message;
  if(e instanceof FreeCuratedError&&e.status===429)state.cooldownUntil=Math.max(state.cooldownUntil,Date.now()+Math.max(6*3600000,e.retryAfterMs??0));
}
export async function startFreeRegistration(state: FreeRegistry, input: {username:string;count:number;expectedTier:"S"|"A"}, options: Options={}) {
  available(state);
  if(![100,200,300].includes(input.count))throw new FreeCuratedError(400,"読み込み投稿数は100・200・300から選択してください。");
  if(state.authors.length>=100)throw new FreeCuratedError(409,"登録上限は100投稿者です。");
  // Check production authentication before requesting the provider or registering anything.
  await(options.production??callFreeProduction)({action:"status"},fetch,options.signal);
  let profile;
  try{await(options.pause??(()=>wait(options.signal)))();profile=await(options.profile??fetchFreeProfile)(input.username,input.expectedTier,fetch,options.signal);}
  catch(e){if(e instanceof FreeCuratedError&&e.status===429)state.cooldownUntil=Math.max(state.cooldownUntil,Date.now()+Math.max(6*3600000,e.retryAfterMs??0));throw e;}
  if(state.authors.some(a=>a.id===profile.id))throw new FreeCuratedError(409,"登録済みの投稿者です。追加取得や、途中の登録の再開は一覧から操作してください。");
  const a: FreeRegistration={...profile,paused:false,addedAt:new Date().toISOString(),checkedAt:null,nextCursor:null,
    candidates:[],rawCount:0,skipped:0,savedTotal:0,lastSavedAt:null,error:null,
    registration:{requested:input.count as 100|200|300,scanned:0,pages:0,fetched:0,saved:0,excluded:0,duplicates:0,
      phase:"sync",cursor:null,cursors:[],postIds:[],error:null}};
  state.authors.unshift(a);await(options.persist??writeFreeRegistry)(state);
  return {id:a.id,job:a.registration,message:"無料登録を開始しました。本番への登録と動画取得を続けています。"};
}
export async function restartFreeRegistration(state: FreeRegistry, id:string, count:number, options: Options={}) {
  available(state);
  if(![100,200,300].includes(count))throw new FreeCuratedError(400,"読み込み投稿数は100・200・300から選択してください。");
  const a=state.authors.find(a=>a.id===id);
  if(!a)throw new FreeCuratedError(404,"投稿者が見つかりません。");
  if(a.paused)throw new FreeCuratedError(409,"停止中です。投稿者を再開してから操作してください。");
  if(a.registration&&a.registration.phase!=="completed")return {id,job:a.registration,message:"途中の登録処理を再開します。"};
  await(options.production??callFreeProduction)({action:"status"},fetch,options.signal);
  a.registration={requested:count as 100|200|300,scanned:0,pages:0,fetched:0,saved:0,excluded:0,duplicates:0,
    phase:"sync",cursor:null,cursors:[],postIds:[],error:null};
  a.error=null;await(options.persist??writeFreeRegistry)(state);
  return {id,job:a.registration,message:"動画取得と本番掲載を開始します。"};
}
export async function stepFreeRegistration(state: FreeRegistry, id:string, options: Options={}) {
  const a=state.authors.find(a=>a.id===id),job=a?.registration;
  if(!a||!job)throw new FreeCuratedError(404,"再開する登録処理がありません。");
  if(a.paused)throw new FreeCuratedError(409,"停止中です。投稿者を再開してから操作してください。");
  if(job.phase==="completed")return {id,job,message:`登録完了：${job.scanned}投稿を確認し、動画付き${job.fetched}投稿を取得。本番へ${job.saved}件掲載しました。`};
  available(state);const production=options.production??callFreeProduction,persist=options.persist??writeFreeRegistry;
  try{
    if(job.phase==="sync"){
      await production({action:"sync",authors:roster(state)},fetch,options.signal);job.phase="fetch";
    }else if(job.phase==="fetch"){
      if(job.pages>=30)throw new FreeCuratedError(502,"ページ数が上限に達しました。取得済み動画は保持しています。");
      await(options.pause??(()=>wait(options.signal)))();
      const page=await(options.media??fetchFreeMediaPage)(a,100,job.cursor,fetch,options.signal,Math.min(100,job.requested-job.scanned));
      if(page.rawCount===0&&(job.scanned===0||page.nextCursor))throw new FreeCuratedError(502,"FxTwitterの投稿一覧が空で、動画取得を確認できません。投稿者の本番登録は済んでいます。後ほど「続きを再開」で試してください。");
      if(page.rawCount>0&&!page.timelineIds.length)throw new FreeCuratedError(502,"同一投稿者の投稿一覧を確認できません。");
      if(page.nextCursor&&(page.nextCursor===job.cursor||job.cursors.includes(page.nextCursor)))throw new FreeCuratedError(502,"ページ送りが進みません。取得済み動画は保持しています。");
      // Each provider response has at most 100 posts. Trim the last page to the selected total.
      const remaining=job.requested-job.scanned;
      if(page.rawCount>remaining)throw new FreeCuratedError(502,"投稿数が選択上限を超えるページです。取得済み動画は保持しています。");
      job.initialLatestId=page.timelineIds.reduce<string|null>((v,id)=>!v||BigInt(id)>BigInt(v)?id:v,job.initialLatestId??null);
      const seen=new Set(job.postIds);a.candidates=page.posts.filter(p=>!seen.has(p.x_post_id));
      job.postIds.push(...a.candidates.map(p=>p.x_post_id));job.fetched+=a.candidates.length;job.scanned+=page.rawCount;job.pages++;
      job.cursor=page.rawCount? page.nextCursor:null;if(job.cursor)job.cursors.push(job.cursor);
      a.rawCount=page.rawCount;a.skipped=page.skipped;a.nextCursor=job.cursor;a.checkedAt=new Date().toISOString();job.phase="publish";
      await persist(state);
    }else{
      {
        const payload={action:"publish",id:a.id,candidates:a.candidates,previousHiddenSaveAt:a.lastSavedAt,initialBaselineId:job.initialLatestId??null,registrationComplete:job.scanned>=job.requested||!job.cursor};
        let result;
        try{result=await production(payload,fetch,options.signal);}
        catch(e){
          // Recover only an explicitly missing registration, not a production pause or a DB/validation failure.
          if(!(e instanceof FreeCuratedError)||e.status!==409||e.recoveryAction!=="sync")throw e;
          await production({action:"sync",authors:roster(state)},fetch,options.signal);
          result=await production(payload,fetch,options.signal);
        }
        const p=result.published;job.saved+=(p.saved??0)+(p.promoted??0);job.excluded+=p.excluded??0;job.duplicates+=p.duplicates??0;
      }
      job.phase=job.scanned>=job.requested||!job.cursor?"completed":"fetch";
    }
    job.error=null;a.error=null;await persist(state);
    return {id,job,message:job.phase==="completed"?`登録完了：${job.scanned}投稿を確認し、動画付き${job.fetched}投稿を取得。本番へ${job.saved}件掲載しました。`:
      `${job.scanned} / ${job.requested}投稿を確認中・本番掲載${job.saved}件`};
  }catch(e){rememberFailure(state,a,e);await persist(state);throw e;}
}
