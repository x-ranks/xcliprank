import { FREE_CURATED_AUTHOR_LIMIT } from "./free-curated-limits";
import { newFreeMetrics } from "./free-curated-metrics";
import { supabaseAdmin } from "./supabase-admin";
import { fetchFreeProfile, fetchFreeMediaPage, FreeCuratedError, type FreeAuthor } from "./fxtwitter-curated";
import { publishFreeCandidates } from "./free-curated-publish";
import { withScheduledFreeState, writeScheduledFreeState, type ScheduledFreeAuthor, type ScheduledFreeState } from "./free-curated-server-store";
import { readAuthorState } from "./author-status-store";
import { readPostState } from "./post-status-store";

const HOUR = 3600000, DAY = 24 * HOUR;
export const FREE_COLLECTION_INTERVAL = 3 * HOUR, FREE_COLLECTION_BATCH = 8, FREE_COLLECTION_SPACING = 5000;
const maxId = (ids: (string | null)[]) => ids.filter((s): s is string => !!s).reduce<string | null>((a,b) => !a || BigInt(b) > BigInt(a) ? b : a,null);
export function newScheduledAuthor(a: FreeAuthor, source: "legacy" | "free", now: number): ScheduledFreeAuthor {
  return {...a,source,paused:false,addedAt:now,checkedAt:0,nextCheckAt:0,latestId:null,pendingCursor:null,
    pendingLatestId:null,baselineId:null,savedTotal:0,lastError:null};
}
export async function importLegacyAuthors(state: ScheduledFreeState, database = supabaseAdmin(), now = Date.now()) {
  const {data,error} = await database.from("authors").select("x_author_id,username,name,curated_expected_tier,curated_status,curated_backfill_status,curated_last_post_id")
    .eq("is_curated",true).limit(FREE_CURATED_AUTHOR_LIMIT + 1);
  if (error || !Array.isArray(data)) throw new FreeCuratedError(503,"従来投稿者のDB確認に失敗しました。無料巡回を停止しました。");
  const legacy = new Map<string, any>(data.map(a=>[String(a.x_author_id),a]));
  for (const a of state.authors) {
    const row=legacy.get(a.id); a.paused=!row || row.curated_status !== "active";
    if(row){a.username=row.username;a.name=String(row.name??row.username).slice(0,256);a.expectedTier=row.curated_expected_tier==="A"?"A":"S";}
  }
  for (const row of data) {
    const id=String(row.x_author_id), username=String(row.username??"");
    if (row.curated_status !== "active" || !/^\d{2,20}$/.test(id) || !/^[a-z0-9_]{1,15}$/i.test(username) || state.authors.some(a=>a.id===id)) continue;
    if (state.authors.length>=FREE_CURATED_AUTHOR_LIMIT) throw new FreeCuratedError(409,`本番登録の上限${FREE_CURATED_AUTHOR_LIMIT}投稿者です。`);
    const added=newScheduledAuthor({id,username,name:String(row.name??username).slice(0,256),expectedTier:row.curated_expected_tier === "A" ? "A":"S"},"legacy",now);
    if(/^\d{2,20}$/.test(String(row.curated_last_post_id??"")))added.latestId=String(row.curated_last_post_id);
    state.authors.push(added);
  }
}
// Keep the existing Cron entry point; there is exactly one scheduled collection path.
export async function scanFreeCurated(options: import("./fx-curated-scan").FxScanOptions = {}) {
  return (await import("./fx-curated-scan")).scanFxCurated(options);
}
