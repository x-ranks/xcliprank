import { supabaseAdmin } from "./supabase-admin";
import { fetchFreeMediaPage, FreeCuratedError } from "./fxtwitter-curated";
import { publishFreeCandidates, emptyPublicationOutcomes } from "./free-curated-publish";
import { newFreeMetrics, type FreeScanMetrics } from "./free-curated-metrics";
import { importLegacyAuthors } from "./free-curated-scan";
import { withScheduledFreeState, writeScheduledFreeState } from "./free-curated-server-store";
import { readXState, writeXState, activeReservations, X_DAY, X_DAILY_AUTHORS } from "./x-curated-state";
import { readFxState, writeFxState, fxCursorHash } from "./fx-curated-state";
import { maxPostId, snowflakeTime } from "./x-curated-search";
import { unavailableKeys } from "./post-status-store";
import { randomInt } from "node:crypto";

export type FxScanOptions={directory?:string;database?:ReturnType<typeof supabaseAdmin>;now?:()=>number;
  fetcher?:typeof fetch;pause?:()=>Promise<void>;publish?:typeof publishFreeCandidates;blocked?:()=>Promise<Set<string>>;verification?:"random-five"};
export async function scanFxCurated(options:FxScanOptions={}){
  const now=options.now??Date.now;
  return withScheduledFreeState(async state=>{
    const x=await readXState(options.directory),fx=await readFxState(options.directory),at=now();
    // Share the EXISTING rolling quota across providers; never release failed X attempts at the switch.
    x.reservations=activeReservations(x,at);
    const stats={feature:"fx_curated_collection",provider:"fxtwitter",processed:0,saved:0,fetched:0,new_posts:0,failed:0,pending:0,empty:0,
      skipped:false,stopped:false,skip_reason:null as string|null,paid_x_requests:0,fx_requests:0,daily_limit:X_DAILY_AUTHORS,quota_used:x.reservations.length,
      publication:emptyPublicationOutcomes(),
      verification:options.verification?{requested:5,result:"WAITING",authors:[] as {username:string;success:boolean;saved:number|null;error:string|null;publication:FreeScanMetrics["lastPublication"]}[]}:null};
    state.lastRun={at,finishedAt:0,outcome:"running",reason:null,processed:0,fetched:0,saved:0,failed:0,empty:0};
    const finish=async(reason:string|null=null)=>{
      stats.skip_reason=reason;stats.quota_used=x.reservations.length;
      Object.assign(state.lastRun!,{finishedAt:now(),outcome:stats.skipped?"skipped":"completed",reason,
        processed:stats.processed,saved:stats.saved,fetched:stats.fetched,failed:stats.failed,empty:stats.empty});
      await writeScheduledFreeState(state,options.directory);return stats;
    };
    if(state.nextBatchAt>at){stats.skipped=true;return finish("interval");}
    if(x.reservations.length>=X_DAILY_AUTHORS){stats.skipped=true;return finish("daily_author_limit");}
    if(options.verification&&X_DAILY_AUTHORS-x.reservations.length<5){stats.skipped=true;return finish("verification_needs_five_quota_slots");}
    const db=options.database??supabaseAdmin();await importLegacyAuthors(state,db,at);
    const blocked=await(options.blocked??unavailableKeys)();
    const eligible=state.authors.filter(a=>!a.paused&&!a.initialPending&&a.nextCheckAt<=at&&
      (!options.verification||!!fx.positions[a.id]||!!x.positions[a.id]||!!a.latestId||!!a.initialBaselineId||!!(a.pendingCursor&&a.baselineId))&&
      !blocked.has("id:"+a.id)&&!blocked.has("name:"+a.username.toLowerCase())&&!x.reservations.some(r=>r.id===a.id))
      .sort((a,b)=>a.checkedAt-b.checkedAt||a.id.localeCompare(b.id));
    if(options.verification&&eligible.length<5){stats.skipped=true;return finish("verification_needs_five_eligible_authors");}
    if(options.verification)for(let i=eligible.length-1;i>0;i--){const j=randomInt(i+1);[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}
    const due=eligible.slice(0,options.verification?5:Math.min(8,X_DAILY_AUTHORS-x.reservations.length));
    state.nextBatchAt=at+3*3600000-5*60000;await writeScheduledFreeState(state,options.directory);
    for(const author of due){
      const started=now(),metrics=author.metrics??newFreeMetrics(started);author.metrics=metrics;
      Object.assign(metrics,{lastOutcome:"running",lastFetched:null,lastNew:null,lastSaved:null,lastDurationMs:null,lastPublication:null});
      author.checkedAt=started;author.nextCheckAt=started+X_DAY;
      x.reservations.push({id:author.id,at:started});fx.attempts++;
      // All quota/checkpoint writes must succeed before network access. State failure is never an author error.
      await writeXState(x,options.directory);await writeFxState(fx,options.directory);await writeScheduledFreeState(state,options.directory);
      try{
        let p=fx.positions[author.id];
        if(!p){
          // Restart at the lower X/legacy boundary; provider-specific tokens are never reused.
          let base=author.pendingCursor?author.baselineId:author.latestId;
          const xp=x.positions[author.id];if(xp)base=base&&BigInt(base)<BigInt(xp.sinceId)?base:xp.sinceId;
          if(!base)base=author.initialBaselineId??null;
          if(!base){const {data,error}=await db.from("posts").select("x_post_id").eq("author_id",author.id).order("created_at",{ascending:false}).limit(1);
            if(error)throw new FreeCuratedError(503,"取得基準のDB確認に失敗しました。取得位置を保持しています。");
            base=data?.[0]?.x_post_id?String(data[0].x_post_id):null;}
          if(!base||!/^\d{2,20}$/.test(base))throw new FreeCuratedError(422,"取得基準がありません。登録画面で一括取得を完了してください。");
          p={sinceId:base,cursor:null,upperId:null,seenCursorHashes:[],checkedAt:0};fx.positions[author.id]=p;
        }
        if(snowflakeTime(p.sinceId)>started)throw new FreeCuratedError(422,"取得基準が未来の時刻です。取得位置を保持しています。");
        await(options.pause??(()=>new Promise<void>(r=>setTimeout(r,5000))))();
        fx.requests++;stats.fx_requests++;await writeFxState(fx,options.directory);
        const page=await fetchFreeMediaPage(author,100,p.cursor,options.fetcher,undefined,100,true);
        fx.rawPosts+=page.rawCount;stats.fetched+=page.rawCount;metrics.fetchedTotal+=page.rawCount;metrics.lastFetched=page.rawCount;
        if(!page.rawCount){stats.empty++;throw new FreeCuratedError(502,"FxTwitterの投稿一覧が空です。取得位置を保持して次の投稿者へ進みます。");}
        // Accept only attributed reposts and identical pinned duplicates, not arbitrary foreign rows.
        const timeline=page.timeline,c=timeline.counts;
        if(!timeline.trusted)throw new FreeCuratedError(502,`FxTwitter投稿一覧の判定失敗（本人${c.own}/RP${c.reposts}/会話${c.context}/重複${c.duplicates}/種別${c.type}/provider${c.provider}/ID${c.id}/投稿者ID${c.author}/別人${c.foreign}/RP不一致${c.repostIdentity}/矛盾${c.conflict}）。取得位置を保持しています。`);
        // Freeze at the start of this window, including own posts behind an initial repost-only page.
        const upper=p.upperId??maxPostId(p.sinceId,(((BigInt(started)-1288834974657n)<<22n)+4194303n).toString())!;
        // Old pending positions used their observed maximum as upperId. Preserve that checkpoint on upgrade.
        const previousNewest=p.newestId??(p.cursor?p.upperId:p.sinceId);
        const newest=timeline.ids.filter(id=>BigInt(id)<=BigInt(upper)).reduce<string>((a,b)=>maxPostId(a,b)!,previousNewest!);
        const candidates=page.posts.filter(v=>BigInt(v.x_post_id)>BigInt(p.sinceId)&&BigInt(v.x_post_id)<=BigInt(upper));
        metrics.lastNew=candidates.length;metrics.newTotal+=candidates.length;stats.new_posts+=candidates.length;
        // Reposts have original-post IDs (not repost time). A mixed/repost-only page cannot prove the lower boundary.
        const reached=timeline.ids.length>0&&!c.reposts&&!c.context&&!c.duplicates&&timeline.ids.every(id=>BigInt(id)<=BigInt(p.sinceId));
        const next=reached?null:page.nextCursor;
        if(next&&(next===p.cursor||p.seenCursorHashes.includes(fxCursorHash(next))||p.seenCursorHashes.length>=200))throw new FreeCuratedError(502,"FxTwitterのページ送りが進みません。取得位置を保持しています。");
        const saved=candidates.length?await(options.publish??publishFreeCandidates)(author,candidates,{database:db}):{saved:0,promoted:0,outcomes:emptyPublicationOutcomes()};
        if(saved.outcomes){
          metrics.lastPublication={candidates:candidates.length,saved:saved.saved,promoted:saved.promoted,...saved.outcomes};
          for(const key of Object.keys(stats.publication) as (keyof typeof stats.publication)[])stats.publication[key]+=saved.outcomes[key];
        }
        const count=saved.saved+saved.promoted;author.savedTotal+=count;stats.saved+=count;
        // Commit only AFTER publication. A DB failure replays the same page; deduplication stays in publishFreeCandidates.
        p.checkedAt=started;
        if(next){p.upperId=upper;p.newestId=newest;p.cursor=next;p.seenCursorHashes.push(fxCursorHash(next));stats.pending++;}
        else{p.sinceId=maxPostId(p.sinceId,newest)!;p.upperId=null;p.cursor=null;p.seenCursorHashes=[];delete p.newestId;
          author.latestId=p.sinceId;author.pendingCursor=null;author.pendingLatestId=null;author.baselineId=null;}
        metrics.lastSaved=count;metrics.lastSuccessAt=now();metrics.successCount++;metrics.consecutiveFailures=0;
        metrics.lastOutcome=candidates.length?"success":"no_new";
        metrics.recentVideos=candidates.slice(0,10).map(v=>({id:v.x_post_id,at:v.created_at,url:v.x_url}));author.lastError=null;
      }catch(e){
        stats.failed++;metrics.failureCount++;metrics.consecutiveFailures++;metrics.lastOutcome="error";
        author.lastError=e instanceof FreeCuratedError&&e.status===429?"FxTwitter取得制限（HTTP 429）。取得位置を保持して次の投稿者へ進みます。":
          e instanceof FreeCuratedError?e.message:"FxTwitter取得・DB保存に失敗しました。取得位置を保持して次の投稿者へ進みます。";
        if(e instanceof FreeCuratedError&&e.retryAfterMs)author.nextCheckAt=Math.max(author.nextCheckAt,started+e.retryAfterMs);
      }
      metrics.lastDurationMs=Math.max(0,now()-started);stats.processed++;
      if(stats.verification)stats.verification.authors.push({username:author.username,success:metrics.lastOutcome!=="error",saved:metrics.lastSaved,error:author.lastError,publication:metrics.lastPublication??null});
      await writeFxState(fx,options.directory);await writeScheduledFreeState(state,options.directory);
    }
    if(stats.verification)stats.verification.result=stats.processed===5&&!stats.failed?"PASSED":"FAILED";
    return finish(stats.failed?"author_errors_continued":null);
  },options.directory);
}
