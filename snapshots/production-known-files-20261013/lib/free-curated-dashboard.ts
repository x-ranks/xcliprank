import { supabaseAdmin } from "./supabase-admin";
import { readScheduledFreeState, type ScheduledFreeAuthor } from "./free-curated-server-store";
import { readAuthorState } from "./author-status-store";
import { readPostState } from "./post-status-store";
import { importLegacyAuthors } from "./free-curated-scan";

import { readFxState } from "./fx-curated-state";
import { readXState, activeReservations, X_DAILY_AUTHORS } from "./x-curated-state";

const countsCache=new Map<string,{at:number;value:number}>();
export async function freeCuratedDashboard(options:{directory?:string;database?:ReturnType<typeof supabaseAdmin>;now?:()=>number;availabilityCooldown?:()=>Promise<number>}={}) {
  const time=(options.now??Date.now)(),state=await readScheduledFreeState(options.directory),database=options.database??supabaseAdmin();
  // Build a read-only preview of active legacy authors even while the collector is cooling down.
  const registeredIds=new Set(state.authors.map(a=>a.id));
  let legacyError=false;
  try{await importLegacyAuthors(state,database,time);}catch{legacyError=true;}
  const blockedUntil=options.availabilityCooldown?await options.availabilityCooldown():Math.max((await readAuthorState()).cooldownUntil,(await readPostState()).cooldownUntil);
  const x=await readXState(options.directory),fx=await readFxState(options.directory),quota=activeReservations(x,time);
  const quotaUntil=quota.length>=X_DAILY_AUTHORS?Math.min(...quota.map(r=>r.at))+86400000:0;
  const waitUntil=Math.max(state.nextBatchAt,quotaUntil);
  const countResults=new Map<string,number|null>();let index=0;
  async function worker(){while(index<state.authors.length){const a=state.authors[index++],key=`${process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??""}:${a.id}`;
    const cached=countsCache.get(key);if(cached&&time-cached.at<300000){countResults.set(a.id,cached.value);continue;}
    try{const {count,error}=await database.from("posts").select("x_post_id",{count:"exact",head:true}).eq("author_id",a.id);
      if(error||!Number.isSafeInteger(count)||count===null||count<0)throw Error();
      if(countsCache.size>=200)countsCache.delete(countsCache.keys().next().value!);
      countsCache.set(key,{at:time,value:count});countResults.set(a.id,count);
    }catch{countResults.set(a.id,null);}
  }}
  await Promise.all(Array.from({length:Math.min(4,state.authors.length)},()=>worker()));
  const row=(a:ScheduledFreeAuthor)=>({id:a.id,username:a.username,name:a.name,source:a.source,paused:a.paused,expectedTier:a.expectedTier,
    lastAttemptAt:a.checkedAt||null,nextEligibleAt:Math.max(a.nextCheckAt,waitUntil)||null,pendingPages:!!fx.positions[a.id]?.cursor||(!fx.positions[a.id]&&(!!x.positions[a.id]?.nextToken||!!a.pendingCursor)),
    initialPending:a.initialPending??false,xApiWarning:null,
    savedTotalSinceFree:a.savedTotal,databaseVideoTotal:countResults.get(a.id)??null,lastError:a.lastError,
    metrics:a.metrics??null,awaitingLegacyImport:!registeredIds.has(a.id)&&a.source==="legacy"});
  return {feature:"free_curated_dashboard",generatedAt:time,nextCronNote:"47 */3（サーバーのCron時刻）",intervalHours:3,authorMinHours:24,batchLimit:8,
    provider:"fxtwitter",requestSpacingSeconds:5,fxAttemptsTotal:fx.attempts,fxRequestsTotal:fx.requests,fxPostReadsTotal:fx.rawPosts,errorPolicy:"continue_next_author",dailyAuthorLimit:X_DAILY_AUTHORS,dailyAuthorsUsed:quota.length,quotaNextAt:quotaUntil,
    xApiRequestsTotal:x.requests,xApiPostReadsTotal:x.rawPosts,collectorCooldownUntil:0,availabilityCooldownUntil:0,nextBatchAt:state.nextBatchAt,
    lastRun:state.lastRun??null,nextPossibleAt:waitUntil,legacyPreviewError:legacyError,authors:state.authors.map(row),paid_x_requests:0};
}
