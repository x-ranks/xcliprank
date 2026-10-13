import { ensureCommonAuthor } from "./curated-common";
import { supabaseAdmin } from "./supabase-admin";
import { unavailableKeys } from "./post-status-store";
import { isUnavailablePost } from "./post-status";
import { calculateAdultScore, calculateCreatorScore, requiresSafetyReview } from "./adult-score";
import { classifyContent } from "./content-filter";
import { rankingScore } from "./ranking";
import { loadTierLearningModel, predictLearnedTier, blendRuleAndLearnedTier } from "./tier-learning";
import { calculateTier, applyCuratedTierFloor, type FreeTierAuthor } from "./fxtwitter-curated-tier";
import { FreeCuratedError, type FreeAuthor, type FreeCandidate } from "./fxtwitter-curated";

export const FREE_DISPLAY_TIERS = new Set(["S", "A+", "A", "B+", "B", "C"]);
export const emptyPublicationOutcomes=()=>({unavailable:0,contentOrReview:0,tier:0,knownPostOrMedia:0,batchDuplicate:0,insertRace:0});
export async function publishFreeCandidates(author: FreeAuthor, candidates: FreeCandidate[], options: {
  database?: ReturnType<typeof supabaseAdmin>; blocked?: Set<string>; modelLoader?: typeof loadTierLearningModel;
  previousHiddenSaveAt?: string | null;
} = {}) {
  const database = options.database ?? supabaseAdmin(), blocked = options.blocked ?? await unavailableKeys();
  if(blocked.has("id:"+author.id)||blocked.has("name:"+author.username.toLowerCase()))throw new FreeCuratedError(409,"除外中の投稿者は掲載できません。");
  if(await ensureCommonAuthor(author,database)!=="active")throw new FreeCuratedError(409,"停止中の投稿者は掲載できません。");
  const {data: knownAuthor, error: authorError} = await database.from("authors").select("*").eq("x_author_id", author.id).maybeSingle();
  if (authorError) throw new FreeCuratedError(503, "投稿者のDB確認に失敗しました。");
  const context: FreeTierAuthor = { ...(knownAuthor ?? {}), curated_expected_tier: author.expectedTier };
  const duplicateIds = new Set<string>(), existing = new Map<string, any>();
  for (const column of ["x_post_id", "media_key", "video_url"] as const) {
    const values = [...new Set(candidates.map(p => p[column]).filter((v): v is string => !!v))];
    const batches:string[][]=[];let batch:string[]=[],size=0;
    for(const value of values){const length=encodeURIComponent(value).length+12;
      if(length>3500)throw new FreeCuratedError(503,"重複確認のURL長が上限を超えました。");
      if(batch.length&&(batch.length>=20||size+length>3500)){batches.push(batch);batch=[];size=0;}
      batch.push(value);size+=length;}
    if(batch.length)batches.push(batch);
    for (const values of batches) {
      const {data, error} = await database.from("posts").select("*").in(column, values);
      if (error) throw new FreeCuratedError(503, "重複確認に失敗しました。既存動画を保護して停止しました。");
      for (const row of data ?? []) for (const p of candidates) if (p[column] === (row as any)[column]) {
        duplicateIds.add(p.x_post_id); if (p.x_post_id === row.x_post_id) existing.set(p.x_post_id,row);
      }
    }
  }
  const model = await (options.modelLoader ?? loadTierLearningModel)();
  const now = new Date().toISOString(), media = new Set<string>(), videos = new Set<string>(); let excluded = 0;
  const outcomes=emptyPublicationOutcomes();
  const rows: any[] = [], oldHidden: {candidate: FreeCandidate; row: any}[] = [];
  for (const p of candidates) {
    if (p.author_id !== author.id || isUnavailablePost(p, blocked)) { excluded++;outcomes.unavailable++; continue; }
    const content = classifyContent(p.text), review = requiresSafetyReview(p.text);
    if (content.category !== "PASS" || review || context.review_required) { excluded++;outcomes.contentOrReview++; continue; }
    if (duplicateIds.has(p.x_post_id)) {
      outcomes.knownPostOrMedia++;
      const row = existing.get(p.x_post_id), savedAt = Date.parse(options.previousHiddenSaveAt ?? "");
      const seenAt = Date.parse(row?.last_seen_at ?? "");
      // One-time promotion of the currently selected page saved by v2. Unrelated hidden,
      // manually rated, removed, or previously published records are never republished by Cron.
      if (row && Number.isFinite(savedAt) && Number.isFinite(seenAt) && seenAt <= savedAt && seenAt >= savedAt - 10 * 60000 &&
        row.author_id === author.id && row.collection_source === "curated" && row.author_stats_counted === false &&
        row.is_visible === false && row.moderation_blocked === false && row.review_required === false && row.manual_tier == null &&
        row.manual_category == null && row.manual_reviewed_at == null && row.moderated_at == null && row.moderation_source == null &&
        row.video_url === p.video_url && row.text === p.text && Date.parse(row.created_at) === Date.parse(p.created_at) &&
        FREE_DISPLAY_TIERS.has(row.adult_tier) && row.content_category === "PASS") oldHidden.push({candidate:p,row});
      continue;
    }
    if ((p.media_key && media.has(p.media_key)) || (p.video_url && videos.has(p.video_url))) {outcomes.batchDuplicate++;continue;}
    if (p.media_key) media.add(p.media_key); if (p.video_url) videos.add(p.video_url);
    const adultScore = calculateAdultScore(p.text,p.possibly_sensitive), creatorScore = calculateCreatorScore(p.text);
    const rule = applyCuratedTierFloor(calculateTier({possibly_sensitive:p.possibly_sensitive,adult_score:adultScore,
      creator_score:creatorScore,review_required:review},context),context,content.category);
    const learned = predictLearnedTier(model,{authorId:author.id,adultScore,creatorScore,possiblySensitive:p.possibly_sensitive});
    const tier = blendRuleAndLearnedTier(rule,learned);
    if (!FREE_DISPLAY_TIERS.has(tier.tier)) { excluded++;outcomes.tier++; continue; }
    const {durationSeconds: _d,videoCount: _c,...post}=p;
    rows.push({...post,adult_score:adultScore,creator_score:creatorScore,review_required:false,author_stats_counted:false,
      effective_adult_score:tier.score,adult_tier:tier.tier,content_category:content.category,content_filter_score:content.score,
      content_filter_reason:content.reason,collection_source:"curated",last_seen_at:now,is_visible:true,moderation_blocked:false,
      score:rankingScore({views:p.views,likes:p.likes,reposts:p.reposts,replies:p.replies,createdAt:p.created_at})});
  }
  let saved = 0, promoted = 0;
  if (rows.length) {
    const {error} = await database.from("authors").upsert({x_author_id:author.id,username:author.username,name:author.name,
      is_curated:true,curated_status:"active",last_seen_at:now},{onConflict:"x_author_id",ignoreDuplicates:true});
    if (error) throw new FreeCuratedError(503,"投稿者のDB保存に失敗しました。");
    const inserted = await database.from("posts").upsert(rows,{onConflict:"x_post_id",ignoreDuplicates:true}).select("x_post_id");
    if (inserted.error) throw new FreeCuratedError(503,"本番動画のDB保存に失敗しました。");
    saved=(inserted.data??[]).length;
  }
  for (const {candidate:p,row} of oldHidden) {
    // Check all conditions again in the UPDATE to preserve concurrent reviews/removals.
    const {data,error} = await database.from("posts").update({is_visible:true})
      .eq("x_post_id",p.x_post_id).eq("author_id",author.id).eq("collection_source","curated")
      .eq("is_visible",false).eq("moderation_blocked",false).eq("review_required",false).is("manual_tier",null)
      .is("manual_category",null).is("manual_reviewed_at",null).is("moderated_at",null).is("moderation_source",null)
      .eq("author_stats_counted",false).eq("last_seen_at",row.last_seen_at).eq("adult_tier",row.adult_tier)
      .eq("content_category","PASS").select("x_post_id");
    if (error) throw new FreeCuratedError(503,"非公開候補の掲載更新に失敗しました。既存評価は変更していません。");
    promoted+=(data??[]).length;
  }
  outcomes.knownPostOrMedia-=promoted;outcomes.insertRace=rows.length-saved;
  return {saved,promoted,excluded,duplicates:duplicateIds.size,outcomes,paid_x_requests:0};
}
