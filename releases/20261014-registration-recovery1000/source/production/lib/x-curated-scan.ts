import { registrationLeaseActive } from "./registration-lease";
import { newFreeMetrics } from "./free-curated-metrics";
import { supabaseAdmin } from "./supabase-admin";
import { publishFreeCandidates } from "./free-curated-publish";
import { importLegacyAuthors } from "./free-curated-scan";
import { withScheduledFreeState, writeScheduledFreeState } from "./free-curated-server-store";
import { readXState, writeXState, activeReservations, X_DAY, X_DAILY_AUTHORS, type XPosition } from "./x-curated-state";
import { maxPostId, snowflakeTime, searchXCurated, XCollectionError } from "./x-curated-search";
import { unavailableKeys } from "./post-status-store";

export async function scanXCurated(options:{directory?:string;database?:ReturnType<typeof supabaseAdmin>;now?:()=>number;
  fetcher?:typeof fetch;token?:string;pause?:()=>Promise<void>;publish?:typeof publishFreeCandidates;blocked?:()=>Promise<Set<string>>}={}) {
  const now=options.now??Date.now;
  return withScheduledFreeState(async state=>{
    const x=await readXState(options.directory),at=now();
    x.reservations=activeReservations(x,at);
    // This provider now records individual errors and continues. Never reset reservations or positions.
    x.cooldownUntil=0;
    const stats={feature:"x_api_curated_collection",provider:"x_api",processed:0,saved:0,fetched:0,new_posts:0,failed:0,pending:0,empty:0,
      skipped:false,stopped:false,skip_reason:null as string|null,paid_x_requests:0,daily_limit:X_DAILY_AUTHORS,quota_used:x.reservations.length};
    state.lastRun={at,finishedAt:0,outcome:"running",reason:null,processed:0,fetched:0,saved:0,failed:0,empty:0};
    const finish=async(reason:string|null=null)=>{
      stats.skip_reason=reason;stats.quota_used=x.reservations.length;
      Object.assign(state.lastRun!,{finishedAt:now(),outcome:stats.stopped?"paused":stats.skipped?"skipped":"completed",reason,
        processed:stats.processed,saved:stats.saved,fetched:stats.fetched,failed:stats.failed});
      await writeXState(x,options.directory);await writeScheduledFreeState(state,options.directory);return stats;
    };
    if(state.nextBatchAt>at){stats.skipped=true;return finish("interval");}
    if(x.reservations.length>=X_DAILY_AUTHORS){stats.skipped=true;return finish("daily_author_limit");}
    const db=options.database??supabaseAdmin();await importLegacyAuthors(state,db,at);
    const blocked=await(options.blocked??unavailableKeys)();
    state.nextBatchAt=at+3*3600000-5*60000;await writeScheduledFreeState(state,options.directory);
    // Reservation is written before each external request; a crash consumes a slot, never grants an extra request.
    const due=state.authors.filter(a=>!a.paused&&!a.initialPending&&!registrationLeaseActive(a,at)&&a.nextCheckAt<=at&&
      !blocked.has("id:"+a.id)&&!blocked.has("name:"+a.username.toLowerCase())&&
      !x.reservations.some(r=>r.id===a.id)).sort((a,b)=>a.checkedAt-b.checkedAt||a.id.localeCompare(b.id)).slice(0,Math.min(8,X_DAILY_AUTHORS-x.reservations.length));
    for(const author of due){
      const started=now();
      const metrics=author.metrics??newFreeMetrics(started);author.metrics=metrics;
      Object.assign(metrics,{lastOutcome:"running",lastFetched:null,lastNew:null,lastSaved:null,lastDurationMs:null});
      // Count the selected author's attempt even if baseline lookup, authentication or publication fails.
      // Durable writes must succeed before work; a broken quota store must not permit extra requests.
      author.checkedAt=started;author.nextCheckAt=started+X_DAY;
      x.reservations.push({id:author.id,at:started});x.requests++;
      await writeXState(x,options.directory);await writeScheduledFreeState(state,options.directory);
      let p=x.positions[author.id];
      try{
      if(!p){
        // A legacy FxTwitter continuation must start from its LOWER boundary, never its pending newest ID.
        let base=author.pendingCursor?author.baselineId:author.latestId;
        if(!base)base=author.initialBaselineId??null;
        if(!base){const {data,error}=await db.from("posts").select("x_post_id").eq("author_id",author.id).order("created_at",{ascending:false}).limit(1);
          if(error)throw new XCollectionError(503,"取得基準のDB確認に失敗しました。取得位置を保持しています。");base=data?.[0]?.x_post_id?String(data[0].x_post_id):null;}
        if(!base||!/^\d{2,20}$/.test(base))throw new XCollectionError(422,"取得基準がありません。登録画面で一括取得を完了してください。");
        p={sinceId:base,nextToken:null,endTime:null,startTime:null,newestId:null,warning:null,checkedAt:0,savedTotal:0,rawTotal:0};x.positions[author.id]=p;
      }
      const old=p.sinceId,earliest=started-7*X_DAY+60000;
      if(p.nextToken&&p.startTime&&Date.parse(p.startTime)<earliest||p.nextToken&&snowflakeTime(p.sinceId)<earliest&&!p.startTime){
        p.nextToken=null;p.endTime=null;p.newestId=null;p.startTime=null;p.warning="検索可能な7日を越えた未取得範囲があります。古い分は無料一括取得で補完してください。";
      }
      if(!p.nextToken){
        p.endTime=new Date(started-30000).toISOString();p.newestId=null;
        p.startTime=snowflakeTime(p.sinceId)<earliest?new Date(earliest).toISOString():null;
        if(p.startTime)p.warning="7日より前の取得漏れはX API新着検索では確認できません。必要に応じて無料一括取得で補完してください。";
      }
      // Protect synthetic/future watermarks and a just-completed bulk import from invalid bounds.
      if(snowflakeTime(p.sinceId)>=Date.parse(p.endTime!))throw new XCollectionError(422,"取得基準が検索終了時刻以降です。次回の巡回を待ちます。");
      p.checkedAt=started;
      await writeXState(x,options.directory);await writeScheduledFreeState(state,options.directory);
        await(options.pause??(()=>new Promise<void>(r=>setTimeout(r,5000))))();
        if(!(options.token??process.env.X_BEARER_TOKEN))throw new XCollectionError(401,"X API認証が未設定です。取得位置を保持して次の投稿者へ進みます。");
        stats.paid_x_requests++;
        const page=await searchXCurated(author,p,{now:started,fetcher:options.fetcher,token:options.token});
        p.rawTotal+=page.rawCount;x.rawPosts+=page.rawCount;stats.fetched+=page.rawCount;metrics.fetchedTotal+=page.rawCount;
        metrics.lastFetched=page.rawCount;metrics.lastNew=page.posts.length;metrics.newTotal+=page.posts.length;stats.new_posts+=page.posts.length;
        if(page.nextToken&&page.nextToken===p.nextToken)throw new XCollectionError(502,"X APIのページ送りが進みません。");
        const saved=page.posts.length?await(options.publish??publishFreeCandidates)(author,page.posts,{database:db}):{saved:0,promoted:0};
        const count=saved.saved+saved.promoted;author.savedTotal+=count;p.savedTotal+=count;stats.saved+=count;
        p.newestId=maxPostId(p.newestId,page.newestId);
        if(page.nextToken){p.nextToken=page.nextToken;stats.pending++;}
        else{p.sinceId=maxPostId(old,p.newestId)!;p.nextToken=null;p.newestId=null;p.startTime=null;p.endTime=null;author.latestId=p.sinceId;
          author.pendingCursor=null;author.pendingLatestId=null;author.baselineId=null;}
        metrics.lastSaved=count;metrics.lastSuccessAt=now();metrics.successCount++;metrics.consecutiveFailures=0;metrics.lastOutcome=page.rawCount?"success":"no_new";
        metrics.recentVideos=page.posts.slice(0,10).map(v=>({id:v.x_post_id,at:v.created_at,url:v.x_url}));author.lastError=null;
      }catch(e){
        stats.failed++;metrics.failureCount++;metrics.consecutiveFailures++;metrics.lastOutcome="error";
        author.lastError=e instanceof XCollectionError?e.message:"X API取得・DB保存に失敗しました。取得位置を保持しています。";
        if(e instanceof XCollectionError&&e.status===400&&p?.nextToken){p.nextToken=null;p.endTime=null;p.startTime=null;p.newestId=null;}
        // No same-run retry or global cooldown, including 401/402/403/429 and transport errors.
        // The next author has a separate durable reservation and failed authors remain counted for 24h.
      }
      metrics.lastDurationMs=Math.max(0,now()-started);
      stats.processed++;await writeXState(x,options.directory);await writeScheduledFreeState(state,options.directory);
    }
    return finish(stats.failed?"author_errors_continued":null);
  },options.directory);
}
