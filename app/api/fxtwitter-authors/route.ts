import { FREE_CURATED_AUTHOR_LIMIT } from "../../../lib/free-curated-limits";
import { NextRequest, NextResponse } from "next/server";
import { FreeCuratedError, fetchFreeProfile, fetchFreeMediaPage, fetchFreePostUrl, parseFreePostUrl } from "../../../lib/fxtwitter-curated";
import { readFreeRegistry, withFreeRegistry } from "../../../lib/fxtwitter-curated-store";
import { saveFreeCandidates } from "../../../lib/fxtwitter-curated-save";
import { allowFreeLocalRequest } from "../../../lib/fxtwitter-local-access";
import { startFreeRegistration, restartFreeRegistration, stepFreeRegistration } from "../../../lib/free-curated-registration";
import { callFreeProduction } from "../../../lib/free-curated-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: object, status = 200) => NextResponse.json({ ...data, paid_x_requests: 0 }, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
function failed(error: unknown) {
  return json({ ok: false, error: error instanceof FreeCuratedError ? error.message : "無料取得の処理に失敗しました。設定値は表示しません。" }, error instanceof FreeCuratedError ? error.status : 503);
}
function databaseHost() {
  try { return new URL(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname; } catch { return null; }
}

export async function GET(request: NextRequest) {
  if (!allowFreeLocalRequest(request)) return json({ error: "Local development only" }, 404);
  try { return json({ ok: true, state: await readFreeRegistry(), databaseHost: databaseHost(), automated: false,registrationAuthorLimit:FREE_CURATED_AUTHOR_LIMIT }); }
  catch (error) { return failed(error); }
}

export async function POST(request: NextRequest) {
  if (!allowFreeLocalRequest(request, true)) return json({ error: "Local same-origin JSON requests only" }, 403);
  try {
    const raw = await request.text(); if (Buffer.byteLength(raw) > 2048) throw new FreeCuratedError(400, "入力が大きすぎます。");
    let body: any; try { body = JSON.parse(raw); } catch { throw new FreeCuratedError(400, "入力形式が正しくありません。"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new FreeCuratedError(400, "入力形式が正しくありません。");
    if (!["add", "pause", "resume", "remove", "preview", "save", "sync", "production-status", "publish", "register", "register-existing", "register-step", "dashboard", "preview-post-url", "publish-post-url"].includes(body.action)) throw new FreeCuratedError(400, "操作が正しくありません。");
    if(body.action==="preview-post-url"||body.action==="publish-post-url"){
      const expectedTier=body.expectedTier==="S"?"S":body.expectedTier==="A"?"A":null;
      if(!expectedTier)throw new FreeCuratedError(400,"期待Tierを確認してください。");
      const postId=parseFreePostUrl(body.url);
      if(body.action==="preview-post-url"){
        const {author,candidate}=await fetchFreePostUrl(body.url,expectedTier,fetch,request.signal);
        return json({ok:true,preview:{postId,authorId:author.id,username:author.username,name:author.name,
          text:candidate.text,createdAt:candidate.created_at,thumbnailUrl:candidate.preview_image_url,
          xUrl:candidate.x_url,views:candidate.views,likes:candidate.likes,videoCount:candidate.videoCount}});
      }
      const token=request.headers.get("authorization"),host=databaseHost();
      if(!token?.startsWith("Bearer ")||token.length>1024)throw new FreeCuratedError(401,"本番の管理キーを入力してください。");
      if(!host)throw new FreeCuratedError(503,"ローカルのDB接続先を確認できません。");
      let response:Response;
      try{response=await fetch("https://twizou.net/api/engagement?type=fx-post",{
        method:"POST",cache:"no-store",redirect:"error",credentials:"omit",referrerPolicy:"no-referrer",
        headers:{Authorization:token,"Content-Type":"application/json",Origin:"https://twizou.net"},
        body:JSON.stringify({action:"publish-post-url",url:body.url,expectedTier,confirm:true,databaseHost:host}),
        signal:AbortSignal.any([request.signal,AbortSignal.timeout(30000)])});}
      catch{throw new FreeCuratedError(502,"本番への接続が失敗・中断しました。再試行前に本番の投稿IDを確認してください。");}
      if(!response.headers.get("content-type")?.includes("application/json")){
        await response.body?.cancel();throw new FreeCuratedError(502,"本番の投稿URL登録APIが未適用か、サーバーで拒否されています。");
      }
      const production=await response.json();
      if(!response.ok||production.ok!==true)throw new FreeCuratedError(response.status>=400?response.status:502,
        typeof production.error==="string"?production.error:"本番への登録に失敗しました。");
      return json({ok:true,production,message:production.message});
    }
    const result = await withFreeRegistry(async state => {
      if(body.action === "register")return startFreeRegistration(state,{username:body.username,count:body.count,expectedTier:body.expectedTier==="A"?"A":"S"},{signal:request.signal});
      if(body.action === "register-existing")return restartFreeRegistration(state,body.id,body.count,{signal:request.signal});
      if(body.action === "register-step")return stepFreeRegistration(state,body.id,{signal:request.signal});
      if(body.action === "dashboard") {
        const production=await callFreeProduction({action:"dashboard"},fetch,request.signal);
        if(production.dashboard?.authors)production.dashboard.authors=production.dashboard.authors.map((a:any)=>{
          const job=state.authors.find(local=>local.id===a.id)?.registration;
          return {...a,initialRegistration:job?{phase:job.phase,requested:job.requested,scanned:job.scanned,fetched:job.fetched,saved:job.saved,error:job.error}:null};
        });
        return {production,message:"本番の巡回記録を取得しました。外部サービスへの取得リクエストは発生していません。"};
      }
      if (body.action === "sync" || body.action === "production-status") {
        const production = await callFreeProduction(body.action === "sync" ? {action:"sync",authors:state.authors.map(a=>({id:a.id,username:a.username,name:a.name,expectedTier:a.expectedTier,paused:a.paused,initialPending:!!a.registration&&!a.registration.patrolReady&&a.registration.phase!=="completed",initialBaselineId:a.registration?.initialLatestId??null}))} : {action:"status"},fetch,request.signal);
        return {production,message:body.action === "sync" ? production.message : "本番の巡回状態を取得しました。"};
      }
      if (body.action === "add") {
        if (state.cooldownUntil > Date.now()) throw new FreeCuratedError(429, "無料サービスの待機期間です。5分以上あけてください。");
        if (state.authors.length >= FREE_CURATED_AUTHOR_LIMIT) throw new FreeCuratedError(409, `ローカル登録の上限${FREE_CURATED_AUTHOR_LIMIT}投稿者です。`);
        try {
          const author = await fetchFreeProfile(body.username, body.expectedTier === "A" ? "A" : "S", fetch, request.signal);
          if (state.authors.some(a => a.id === author.id)) throw new FreeCuratedError(409, "この投稿者は無料一覧に登録済みです。");
          state.authors.unshift({ ...author, paused: false, addedAt: new Date().toISOString(), checkedAt: null,
            nextCursor: null, candidates: [], rawCount: 0, skipped: 0, savedTotal: 0, lastSavedAt: null, error: null });
          return { message: "無料用の一覧へ登録しました。有料収集の対象には追加していません。" };
        } catch (error) { if (error instanceof FreeCuratedError && error.status === 429) state.cooldownUntil = Date.now() + 300000; throw error; }
      }
      const author = state.authors.find(a => a.id === body.id);
      if (!author) throw new FreeCuratedError(404, "無料一覧に投稿者が見つかりません。");
      if (body.action === "remove") {
        const authors=state.authors.filter(a=>a.id!==author.id).map(a=>({id:a.id,username:a.username,name:a.name,expectedTier:a.expectedTier,paused:a.paused}));
        const production=await callFreeProduction({action:"manage",operation:"remove",id:author.id,confirm:true},fetch,request.signal);
        state.authors=state.authors.filter(a=>a.id!==author.id);return {production,message:"投稿者を削除し、新着巡回と掲載から除外しました。"};
      }
      if (body.action === "pause" || body.action === "resume") {
        const paused=body.action==="pause",authors=state.authors.map(a=>({id:a.id,username:a.username,name:a.name,expectedTier:a.expectedTier,paused:a.id===author.id?paused:a.paused}));
        const production=await callFreeProduction({action:"manage",operation:body.action,id:author.id},fetch,request.signal);
        author.paused=paused;return {production,message:paused?"一括取得と本番の新着巡回を停止しました。":"本番の新着巡回を再開しました。"};
      }
      if (["preview","save","publish"].includes(body.action) && author.registration && author.registration.phase !== "completed") {
        throw new FreeCuratedError(409,"初回取得・掲載の途中です。「続きを再開」で完了してから詳細操作をしてください。");
      }
      if (author.paused) throw new FreeCuratedError(409, "この投稿者は無料取得を停止中です。");
      if (body.action === "publish") {
        if (!author.candidates.length) throw new FreeCuratedError(409,"先に掲載する動画を無料取得してください。");
        const production=await callFreeProduction({action:"publish",id:author.id,candidates:author.candidates,previousHiddenSaveAt:author.lastSavedAt},fetch,request.signal);
        return {production,message:production.message};
      }
      if (state.cooldownUntil > Date.now()) throw new FreeCuratedError(429, "無料サービスの待機期間です。5分以上あけてください。");
      if (body.action === "save" && body.confirmHiddenSave !== true) throw new FreeCuratedError(400, "非公開候補としてDBへ保存する操作の確認が必要です。");
      if (body.action === "preview" && (![20, 50, 100].includes(body.count) || !["latest", "older"].includes(body.mode))) throw new FreeCuratedError(400, "取得件数・取得モードが正しくありません。");
      if (body.action === "preview" && body.mode === "older" && !author.nextCursor) throw new FreeCuratedError(409, "過去分の続きがありません。まず最新分を取得してください。");
      try {
        const profile = await fetchFreeProfile(`id:${author.id}`, author.expectedTier, fetch, request.signal);
        if (body.action === "save") {
          const saved = await saveFreeCandidates(author);
          author.savedTotal += saved.saved; author.lastSavedAt = new Date().toISOString(); author.error = null;
          return { saved, message: `非公開候補を${saved.saved}件保存しました。重複${saved.duplicates}件。ランキングへは公開していません。` };
        }
        const page = await fetchFreeMediaPage(profile, body.count, body.mode === "older" ? author.nextCursor : null, fetch, request.signal);
        if (body.mode === "older" && page.nextCursor && page.nextCursor === author.nextCursor) throw new FreeCuratedError(502, "ページ情報が進みません。取得を停止しました。");
        author.username = profile.username; author.name = profile.name; author.candidates = page.posts; author.nextCursor = page.nextCursor;
        author.rawCount = page.rawCount; author.skipped = page.skipped; author.checkedAt = new Date().toISOString(); author.error = null;
        return { message: `投稿${page.rawCount}件から動画付き投稿${page.posts.length}件を取得しました。対象外${page.skipped}件。DB未保存。`,
          multipleVideoPosts: page.multipleVideoPosts };
      } catch (error) {
        if (error instanceof FreeCuratedError) { author.error = error.message; if (error.status === 429) state.cooldownUntil = Date.now() + 300000; }
        throw error;
      }
    });
    return json({ ok: true, ...result, state: await readFreeRegistry(), databaseHost: databaseHost() });
  } catch (error) {
    const response=failed(error);
    try{return json({...await response.json(),state:await readFreeRegistry(),databaseHost:databaseHost()},response.status);}
    catch{return failed(error);}
  }
}
