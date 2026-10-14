import { randomBytes } from "node:crypto";
import { FREE_CURATED_AUTHOR_LIMIT } from "./free-curated-limits";
import { FreeCuratedError, fetchFreeProfile, fetchFreeMediaPage } from "./fxtwitter-curated";
import { callFreeProduction } from "./free-curated-client";
import { writeFreeRegistry, type FreeRegistry, type FreeRegistration } from "./fxtwitter-curated-store";

export type RegistrationJob = {
  requested: 100 | 200 | 300; scanned: number; pages: number; fetched: number;
  saved: number; excluded: number; duplicates: number;
  phase: "sync" | "fetch" | "publish" | "completed";
  sessionId?:string; emptyStreak?:number; emptyPages?:number; historyOutcome?:"complete"|"partial"; finishReason?:string; patrolReady?:boolean;
  initialLatestId?: string | null; cursor: string | null; cursors: string[]; postIds: string[]; error: string | null;
};
type Options = { profile?: typeof fetchFreeProfile; media?: typeof fetchFreeMediaPage;
  production?: typeof callFreeProduction; persist?: typeof writeFreeRegistry; pause?: () => Promise<void>; signal?: AbortSignal };
const roster = (state: FreeRegistry) => state.authors.map(a => ({id:a.id,username:a.username,name:a.name,expectedTier:a.expectedTier,paused:a.paused,initialPending:!!a.registration&&!a.registration.patrolReady&&a.registration.phase!=="completed",initialBaselineId:a.registration?.initialLatestId??null}));
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
  if(state.authors.length>=FREE_CURATED_AUTHOR_LIMIT)throw new FreeCuratedError(409,`ローカル登録の上限${FREE_CURATED_AUTHOR_LIMIT}投稿者です。`);
  // Check production authentication before requesting the provider or registering anything.
  const preflight=await(options.production??callFreeProduction)({action:"status"},fetch,options.signal);
  if(preflight.registrationRecoveryVersion!==1||preflight.registrationAuthorLimit!==FREE_CURATED_AUTHOR_LIMIT)
    throw new FreeCuratedError(503,"本番とローカルの登録機能が一致しません。先に本番更新を適用してください。");
  const registered=preflight.state?.authors;
  const normalized=input.username.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i,"").replace(/^@/,"").replace(/\/$/,"").toLowerCase();
  if(Array.isArray(registered)&&registered.length>=FREE_CURATED_AUTHOR_LIMIT&&!registered.some((a:any)=>String(a.username).toLowerCase()===normalized))
    throw new FreeCuratedError(409,`本番登録は${registered.length}投稿者、上限${FREE_CURATED_AUTHOR_LIMIT}投稿者です。`);
  let profile;
  try{await(options.pause??(()=>wait(options.signal)))();profile=await(options.profile??fetchFreeProfile)(input.username,input.expectedTier,fetch,options.signal);}
  catch(e){if(e instanceof FreeCuratedError&&e.status===429)state.cooldownUntil=Math.max(state.cooldownUntil,Date.now()+Math.max(6*3600000,e.retryAfterMs??0));throw e;}
  if(state.authors.some(a=>a.id===profile.id))throw new FreeCuratedError(409,"登録済みの投稿者です。追加取得や、途中の登録の再開は一覧から操作してください。");
  const a: FreeRegistration={...profile,paused:false,addedAt:new Date().toISOString(),checkedAt:null,nextCursor:null,
    candidates:[],rawCount:0,skipped:0,savedTotal:0,lastSavedAt:null,error:null,
    registration:{requested:input.count as 100|200|300,scanned:0,pages:0,fetched:0,saved:0,excluded:0,duplicates:0,
      phase:"sync",cursor:null,cursors:[],postIds:[],error:null}};
  state.authors.unshift(a);await(options.persist??writeFreeRegistry)(state);
  return {id:a.id,job:a.registration,production:{state:preflight.state,registrationAuthorLimit:preflight.registrationAuthorLimit},message:"無料登録を開始しました。本番への登録と動画取得を続けています。"};
}
export async function restartFreeRegistration(state: FreeRegistry, id:string, count:number, options: Options={}) {
  available(state);
  if(![100,200,300].includes(count))throw new FreeCuratedError(400,"読み込み投稿数は100・200・300から選択してください。");
  const a=state.authors.find(a=>a.id===id);
  if(!a)throw new FreeCuratedError(404,"投稿者が見つかりません。");
  if(a.paused)throw new FreeCuratedError(409,"停止中です。投稿者を再開してから操作してください。");
  if(a.registration&&a.registration.phase!=="completed")return {id,job:a.registration,message:"途中の登録処理を再開します。"};
  if(a.registration?.historyOutcome==="partial"&&a.registration.cursor&&a.registration.scanned<a.registration.requested){
    const job=a.registration;job.phase="fetch";job.sessionId=randomBytes(16).toString("hex");job.emptyStreak=0;job.historyOutcome=undefined;job.finishReason=undefined;job.error=null;a.error=null;
    await(options.persist??writeFreeRegistry)(state);return {id,job,message:"取得済み分と新着巡回の基準を保ち、過去分の続きを確認します。"};
  }
  await(options.production??callFreeProduction)({action:"status"},fetch,options.signal);
  a.registration={requested:count as 100|200|300,scanned:0,pages:0,fetched:0,saved:0,excluded:0,duplicates:0,
    phase:"sync",cursor:null,cursors:[],postIds:[],error:null};
  a.error=null;await(options.persist??writeFreeRegistry)(state);
  return {id,job:a.registration,message:"動画取得と本番掲載を開始します。"};
}
function completedMessage(job:RegistrationJob){
  return job.historyOutcome==="partial"?`過去分は部分取得：${job.scanned} / ${job.requested}投稿、本番掲載${job.saved}件。新着巡回は設定済みです。`:
    `登録完了：${job.scanned}投稿を確認し、動画付き${job.fetched}投稿を取得。本番へ${job.saved}件掲載しました。`;
}
function acceptPublication(job:RegistrationJob,p:any){
  if(!p||[p.saved??0,p.promoted??0,p.excluded??0,p.duplicates??0].some(n=>!Number.isSafeInteger(n)||n<0))throw new FreeCuratedError(502,"本番の掲載結果を確認できません。");
  job.saved+=(p.saved??0)+(p.promoted??0);job.excluded+=p.excluded??0;job.duplicates+=p.duplicates??0;
}
export async function stepFreeRegistration(state: FreeRegistry, id:string, options: Options={}) {
  const a=state.authors.find(a=>a.id===id),job=a?.registration;
  if(!a||!job)throw new FreeCuratedError(404,"再開する登録処理がありません。");
  if(a.paused)throw new FreeCuratedError(409,"停止中です。投稿者を再開してから操作してください。");
  if(job.phase==="completed")return {id,job,message:completedMessage(job)};
  available(state);const production=options.production??callFreeProduction,persist=options.persist??writeFreeRegistry;let productionSnapshot:any;
  try{
    if(job.phase!=="sync"){
      if(!job.initialLatestId&&job.scanned>0){
        // Pre-baseline releases recorded own video IDs. Recover a conservative lower boundary;
        // never replace a known server boundary or reuse another provider's pagination token.
        const existing=await production({action:"status"},fetch,options.signal);
        if(existing.registrationRecoveryVersion!==1||existing.registrationAuthorLimit!==FREE_CURATED_AUTHOR_LIMIT)
          throw new FreeCuratedError(503,"先に本番の登録回復更新を適用してください。取得位置は保持しています。");
        const known=existing.state?.authors?.find((row:any)=>row.id===a.id)?.initialBaselineId;
        const recovered=typeof known==="string"&&/^\d{2,20}$/.test(known)?known:
          job.postIds.reduce<string|null>((v,id)=>!v||BigInt(id)>BigInt(v)?id:v,null);
        if(recovered){
          job.initialLatestId=recovered;await persist(state);
          await production({action:"sync",authors:roster(state)},fetch,options.signal);
        }
      }
      if(!job.sessionId){job.sessionId=randomBytes(16).toString("hex");await persist(state);}
      const begin={action:"registration",mode:"begin",id:a.id,registrationSession:job.sessionId};
      let response;
      try{response=await production(begin,fetch,options.signal);}catch(e){
        if(!(e instanceof FreeCuratedError)||e.status!==409||e.recoveryAction!=="sync")throw e;
        await production({action:"sync",authors:roster(state)},fetch,options.signal);response=await production(begin,fetch,options.signal);
      }
      productionSnapshot={state:response.state,registrationAuthorLimit:response.registrationAuthorLimit};
      const receipt=response.registration;
      if(receipt?.version!==1||receipt.owner!==job.sessionId)throw new FreeCuratedError(503,"初回取得の回復機能が本番に未反映です。先に本番更新を適用してください。");
      if(receipt.ready){
        if(job.phase!=="publish"||!["complete","partial"].includes(receipt.outcome))throw new FreeCuratedError(409,"初回取得の完了記録が一致しません。取得位置を保持しました。");
        acceptPublication(job,receipt.publication);job.phase="completed";job.historyOutcome=receipt.outcome;job.patrolReady=true;job.error=null;a.error=null;await persist(state);
        return {id,job,production:productionSnapshot,message:completedMessage(job)};
      }
    }
    if(job.phase==="sync"){
      const synced=await production({action:"sync",authors:roster(state)},fetch,options.signal);productionSnapshot={state:synced.state,registrationAuthorLimit:synced.registrationAuthorLimit};job.phase="fetch";
    }else if(job.phase==="fetch"){
      if(job.pages>=30){
        if(!job.scanned||!job.initialLatestId)throw new FreeCuratedError(502,"初回取得の基準がありません。取得位置を保持しました。");
        job.historyOutcome="partial";job.finishReason="page_limit";job.phase="publish";a.candidates=[];await persist(state);
        return {id,job,production:productionSnapshot,message:"過去分の上限に達しました。取得済み分を保持して新着巡回を設定します。"};
      }
      await(options.pause??(()=>wait(options.signal)))();
      const page=await(options.media??fetchFreeMediaPage)(a,100,job.cursor,fetch,options.signal,Math.min(100,job.requested-job.scanned));
      if(page.rawCount===0){
        if(!job.scanned||!job.initialLatestId)throw new FreeCuratedError(502,"初回の投稿一覧が空です。取得基準を確認できないため、後ほど続きを再開してください。");
        job.pages++;job.emptyPages=(job.emptyPages??0)+1;a.candidates=[];a.rawCount=0;a.skipped=page.skipped;a.checkedAt=new Date().toISOString();
        if(!page.nextCursor){job.cursor=null;job.historyOutcome="complete";job.phase="publish";}
        else if(page.nextCursor===job.cursor||job.cursors.includes(page.nextCursor)){
          job.historyOutcome="partial";job.finishReason="cursor_stalled";job.phase="publish";
        }else{
          job.cursor=page.nextCursor;job.cursors.push(page.nextCursor);job.emptyStreak=(job.emptyStreak??0)+1;
          if(job.emptyStreak>=3){job.historyOutcome="partial";job.finishReason="empty_limit";job.phase="publish";}
        }
        a.nextCursor=job.cursor;job.error=null;a.error=null;await persist(state);
        return {id,job,production:productionSnapshot,message:job.phase==="publish"?"過去分の確認を区切り、取得済み分から新着巡回を設定します。":"空のページを通過しました。取得済み分を保って続きを確認します。"};
      }
      job.emptyStreak=0;
      if(page.rawCount>0&&!page.timelineIds.length)throw new FreeCuratedError(502,"同一投稿者の投稿一覧を確認できません。");
      if(page.nextCursor&&(page.nextCursor===job.cursor||job.cursors.includes(page.nextCursor)))throw new FreeCuratedError(502,"ページ送りが進みません。取得済み動画は保持しています。");
      // Each provider response has at most 100 posts. Trim the last page to the selected total.
      const remaining=job.requested-job.scanned;
      if(page.rawCount>remaining)throw new FreeCuratedError(502,"投稿数が選択上限を超えるページです。取得済み動画は保持しています。");
      if(!job.patrolReady)job.initialLatestId=page.timelineIds.reduce<string|null>((v,id)=>!v||BigInt(id)>BigInt(v)?id:v,job.initialLatestId??null);
      const seen=new Set(job.postIds);a.candidates=page.posts.filter(p=>!seen.has(p.x_post_id));
      job.postIds.push(...a.candidates.map(p=>p.x_post_id));job.fetched+=a.candidates.length;job.scanned+=page.rawCount;job.pages++;
      job.cursor=page.rawCount? page.nextCursor:null;if(job.cursor)job.cursors.push(job.cursor);
      a.rawCount=page.rawCount;a.skipped=page.skipped;a.nextCursor=job.cursor;a.checkedAt=new Date().toISOString();job.phase="publish";
      await persist(state);
    }else{
      {
        const finishing=job.historyOutcome==="partial"||job.scanned>=job.requested||!job.cursor;
        const payload={action:"publish",id:a.id,candidates:a.candidates,previousHiddenSaveAt:a.lastSavedAt,initialBaselineId:job.initialLatestId??null,
          registrationSession:job.sessionId,registrationPage:job.pages,registrationScanned:job.scanned,
          registrationComplete:finishing,registrationOutcome:job.historyOutcome??"complete"};
        let result;
        try{result=await production(payload,fetch,options.signal);}
        catch(e){
          // Recover only an explicitly missing registration, not a production pause or a DB/validation failure.
          if(!(e instanceof FreeCuratedError)||e.status!==409||e.recoveryAction!=="sync")throw e;
          await production({action:"sync",authors:roster(state)},fetch,options.signal);
          result=await production(payload,fetch,options.signal);
        }
        if(result.registration?.version!==1||result.registration.owner!==job.sessionId||result.registration.ready!==finishing)
          throw new FreeCuratedError(502,"本番の初回取得設定を確認できません。掲載済み分と取得位置は保持します。");
        productionSnapshot={state:result.state,registrationAuthorLimit:result.registrationAuthorLimit};
        acceptPublication(job,result.published);
        if(finishing){job.historyOutcome=job.historyOutcome??"complete";job.patrolReady=true;}
      }
      job.phase=job.historyOutcome==="partial"||job.scanned>=job.requested||!job.cursor?"completed":"fetch";
    }
    job.error=null;a.error=null;await persist(state);
    return {id,job,production:productionSnapshot,message:job.phase==="completed"?completedMessage(job):
      `${job.scanned} / ${job.requested}投稿を確認中・本番掲載${job.saved}件`};
  }catch(e){rememberFailure(state,a,e);await persist(state);throw e;}
}
