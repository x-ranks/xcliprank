import { readCuratedReferences, eligibleCuratedReferences, referencePermitsPost } from "./curated-video-references";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
// Production adapter: must be checked against the actual exported live source.
import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import { unavailableKeys } from "./post-status-store";
import { isUnavailablePost } from "./post-status";
import { canDownloadPost } from "./video-download";
import { createPublicCatalog } from "./public-catalog-store";
import { publicCatalogDirectory, publicSaveSecret } from "./public-save-secret";
import { createPublicVideoService } from "./public-video-service";
import { createStaleCache } from "./stale-cache";
import { createRankHistoryStore } from "./rank-history-store";
import { publicPostId, type PublicVideo } from "./public-video-core";
import { eligibleManualXIds } from "./manual-x-permissions";
import { readManualState } from "./manual-ranking";
const fields = "x_post_id,author_id,author_username,author_name,text,preview_image_url,video_url,created_at,views,likes,bookmarks,is_visible,moderation_blocked,review_required,content_category,adult_tier,manual_tier";
// Cache the bounded inventory in this server process so sitemap requests do not rescan Supabase.
// An outdated index is served at once while one background rebuild runs, so no visitor or crawler waits for the full scan.
const indexCache = createStaleCache<PublicVideo[]>({ freshMs: 12 * 60 * 60 * 1000, staleMaxMs: 24 * 60 * 60 * 1000, retryMs: 30 * 1000 });
let authorFingerprintCache: { until: number; value: Promise<string> } | null = null;
async function activeAuthorFingerprint() {
  if (authorFingerprintCache && Date.now() < authorFingerprintCache.until) return authorFingerprintCache.value;
  const value = (async () => {
    const hash = createHash("sha256");
    let complete = false;
    for (let offset = 0; offset < 10000; offset += 500) {
      const r = await supabaseAdmin().from("authors").select("x_author_id")
        .eq("is_curated", true).eq("curated_status", "active")
        .order("x_author_id", { ascending: true }).range(offset, offset + 499);
      if (r.error) throw Error("PUBLIC_AUTHOR_INDEX_UNAVAILABLE");
      const rows = r.data ?? [];
      for (const row of rows) hash.update(String(row.x_author_id)).update("\0");
      if (rows.length < 500) { complete = true; break; }
    }
    if (!complete) throw Error("PUBLIC_AUTHOR_INDEX_LIMIT");
    // Newly imported posts can arrive after their author is already active.
    const latest = await supabaseAdmin().from("posts").select("id")
      .order("id", { ascending: false }).limit(1);
    if (latest.error) throw Error("PUBLIC_POST_INDEX_UNAVAILABLE");
    hash.update("posts:").update(String(latest.data?.[0]?.id ?? ""));
    const references=await supabaseAdmin().from("curated_video_references").select("observed_at").order("observed_at",{ascending:false}).limit(1);
    if(references.error)throw Error("PUBLIC_REFERENCE_INDEX_UNAVAILABLE");
    hash.update("references:").update(String(references.data?.[0]?.observed_at??""));
    hash.update("manual:").update(String((await readManualState()).revision));
    return hash.digest("hex");
  })();
  authorFingerprintCache = { until: Date.now() + 60 * 1000, value };
  value.catch(() => { if (authorFingerprintCache?.value === value) authorFingerprintCache = null; });
  return value;
}
let rankHistoryStore: ReturnType<typeof createRankHistoryStore> | undefined;
export function productionPublicBackend(options: { readOnlyRender?: boolean } = {}) {
  const catalog = createPublicCatalog(publicCatalogDirectory());
  const active = new Set<string>(), checked = new Set<string>();
  let blockedPromise: Promise<Set<string>> | null = null;
  async function permissions(rows: Record<string, any>[]) {
    const ids = [...new Set(rows.map(r => String(r.author_id)).filter(id => !checked.has(id)))];
    blockedPromise ??= unavailableKeys();
    for (let start = 0; start < ids.length; start += 100) {
      const chunk = ids.slice(start, start + 100);
      const result = await supabaseAdmin().from("authors").select("x_author_id").in("x_author_id", chunk).eq("is_curated", true).eq("curated_status", "active").limit(100);
      if (result.error) throw Error("PUBLIC_DATABASE_UNAVAILABLE");
      for (const id of chunk) checked.add(id);
      for (const row of result.data ?? []) active.add(String(row.x_author_id));
    }
    const nonCurated=rows.filter(row=>!active.has(String(row.author_id)));
    const refs=nonCurated.length?await eligibleCuratedReferences(supabaseAdmin(),await readCuratedReferences(supabaseAdmin(),nonCurated.map(row=>String(row.x_post_id)))):[];
    const referenced=new Set(nonCurated.filter(row=>referencePermitsPost(row,refs)).map(row=>String(row.x_post_id)));
    const blocked = await blockedPromise;
    const manual = await eligibleManualXIds(nonCurated.filter(row => !referenced.has(String(row.x_post_id))), blocked);
    return { active, referenced, manual, blocked };
  }
  function query(selectFields = fields) { return supabaseAdmin().from("posts").select(selectFields).eq("is_visible", true).eq("moderation_blocked", false).eq("review_required", false).eq("content_category", "PASS"); }
  async function videos(rows: Record<string, any>[]) {
    const p = await permissions(rows);
    return rows.flatMap(row => {
      const id = String(row.x_post_id ?? "");
      if (!publicPostId(id) || !canDownloadPost(row as any) || (!p.active.has(String(row.author_id))&&!p.referenced.has(id)&&!p.manual.has(id)) || isUnavailablePost(row, p.blocked)) return [];
      let poster: string | null = null;
      try { const u = new URL(String(row.preview_image_url)); if (u.protocol === "https:" && !u.username && !u.password) poster = u.href; } catch { /* optional image */ }
      return [{ id, authorId: row.author_id == null ? null : String(row.author_id), handle: typeof row.author_username === "string" ? row.author_username.replace(/^@/, "") : null, authorName: typeof row.author_name === "string" ? row.author_name : null,
        text: typeof row.text === "string" ? row.text : null, posterUrl: poster, videoUrl: row.video_url as string, createdAt: typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at)) ? row.created_at : null,
        adultTier: typeof row.manual_tier === "string" && row.manual_tier ? row.manual_tier : typeof row.adult_tier === "string" ? row.adult_tier : null,
        sourceHash: createHash("sha256").update(row.video_url).digest("hex"), eligible: true,
        views: Number.isFinite(row.views) && row.views >= 0 ? row.views : null,
        likes: Number.isFinite(row.likes) && row.likes >= 0 ? row.likes : null,
        bookmarks: Number.isFinite(row.bookmarks) && row.bookmarks >= 0 ? row.bookmarks : null } satisfies PublicVideo];
    });
  }
  async function posts(ids: string[]) {
    if (!ids.length) return []; if (ids.length > 100 || ids.some(id => !publicPostId(id))) throw Error("PUBLIC_INVALID_INPUT");
    // Current active authors can be read alongside a single detail row. No
    // publication decision is reused between requests or trusted from the client.
    const primedAuthors = options.readOnlyRender && ids.length === 1
      ? supabaseAdmin().from("authors").select("x_author_id").eq("is_curated", true).eq("curated_status", "active").limit(1000)
      : null;
    blockedPromise ??= unavailableKeys();
    const [r, authors] = await Promise.all([query().in("x_post_id", [...new Set(ids)]).limit(100), primedAuthors]);
    if (r.error || authors?.error) throw Error("PUBLIC_DATABASE_UNAVAILABLE");
    const rows = (r.data ?? []) as unknown as Record<string, any>[];
    if (authors && (authors.data?.length ?? 0) < 1000) {
      const permitted = new Set((authors.data ?? []).map(row => String(row.x_author_id)));
      for (const row of rows) { const id = String(row.author_id); checked.add(id); if (permitted.has(id)) active.add(id); }
    }
    // A full page of authors is not proof of completeness: retain the exact-ID
    // permission query in that case. Curated-reference checks also remain live.
    return videos(rows);
  }
  async function authorVideos(key: string, limit: number) {
    if (!/^(?:id-[A-Za-z0-9_-]{1,64}|[a-z0-9_]{1,15})$/i.test(key)) return [];
    const result: PublicVideo[] = [];
    for (let offset = 0; offset < 500 && result.length < limit; offset += 100) {
      let q = query();
      if (key.startsWith("id-")) q = q.eq("author_id", key.slice(3));
      else q = q.ilike("author_username", key.replace(/_/g, "\\_"));
      const r = await q.order("created_at", { ascending: false }).range(offset, offset + 99);
      if (r.error) throw Error("PUBLIC_DATABASE_UNAVAILABLE");
      result.push(...(await videos(r.data ?? [])).filter(v => key.startsWith("id-") ? v.authorId === key.slice(3) : v.handle?.toLowerCase() === key.toLowerCase()));
      if ((r.data?.length ?? 0) < 100) break;
    }
    return result.slice(0, limit);
  }
  async function candidates(skip: string[], limit: number) {
    const seen = new Set(skip), result: PublicVideo[] = [];
    for (let start = 0; start < 2000 && result.length < limit; start += 200) {
      const r = await query().order("id", { ascending: false }).range(start, start + 199); if (r.error) throw Error("PUBLIC_DATABASE_UNAVAILABLE");
      result.push(...(await videos(r.data ?? [])).filter(v => !seen.has(v.id))); if ((r.data?.length ?? 0) < 200) break;
    }
    return result.slice(0, limit);
  }
  async function scanPage(cursor: string | null, upper: string | null) {
    const selectFields = "x_post_id,author_id,author_username,video_url,is_visible,moderation_blocked,review_required,content_category,adult_tier,manual_tier";
    let q = query(selectFields).order("x_post_id", { ascending: false }).limit(50);
    if (cursor !== null) q = q.lt("x_post_id", cursor);
    if (upper !== null) q = q.lte("x_post_id", upper);
    const r = await q; if (r.error) throw Error("PUBLIC_DATABASE_UNAVAILABLE");
    const rows = (r.data ?? []) as unknown as Record<string, any>[];
    if (rows.some(row => !publicPostId(row.x_post_id))) throw Error("PUBLIC_INVALID_SCAN");
    return { videos: await videos(rows), nextCursor: rows.length ? String(rows.at(-1)!.x_post_id) : cursor, upper: upper ?? (rows.length ? String(rows[0].x_post_id) : null), done: rows.length < 50, scanned: rows.length };
  }
  async function tierPage(tier: string, offset: number) {
    if (!["S", "A+", "A", "B+", "B", "C"].includes(tier) || !Number.isSafeInteger(offset) || offset < 0 || offset > 20000) throw Error("INVALID_DISCOVERY_TIER");
    const r = await query(fields).or(`manual_tier.eq.${tier},and(manual_tier.is.null,adult_tier.eq.${tier})`).order("x_post_id", { ascending: false }).range(offset, offset + 49);
    if (r.error) throw Error("PUBLIC_DATABASE_UNAVAILABLE");
    const rows = (r.data ?? []) as unknown as Record<string, any>[];
    return { videos: await videos(rows), hasMore: rows.length === 50 && offset + 50 <= 20000 };
  }
  async function indexVideos() {
    // If the change marker cannot be read right now, keep serving the cached index instead of failing the page.
    let fingerprintError: unknown = null;
    const authorFingerprint = await activeAuthorFingerprint().catch(error => { fingerprintError = error; return null; });
    return indexCache.get(authorFingerprint, async () => {
      const result: PublicVideo[] = [];
      for (let offset = 0; offset < 20000; offset += 500) {
        const r = await query(fields).order("x_post_id", { ascending: false }).range(offset, offset + 499);
        if (r.error) throw Error("PUBLIC_INDEX_DATABASE_UNAVAILABLE");
        const rows = (r.data ?? []) as unknown as Record<string, any>[];
        result.push(...await videos(rows));
        if (rows.length < 500) return result;
      }
      throw Error("PUBLIC_INDEX_SCAN_LIMIT");
    }).catch(error => { throw fingerprintError ?? error; });
  }
  async function automaticReady() {
    try { await fs.lstat(path.join(os.homedir(), ".xclip-production-deploy.lock")); return false; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw Error("PUBLIC_DEPLOYMENT_BUSY"); }
  }
  return { service: createPublicVideoService({ catalog, posts, authorVideos, candidates, scanPage, indexVideos, tierPage, automaticReady, rankHistory: () => (rankHistoryStore ??= createRankHistoryStore(publicCatalogDirectory())).read(), secret: publicSaveSecret }, options), catalog };
}
