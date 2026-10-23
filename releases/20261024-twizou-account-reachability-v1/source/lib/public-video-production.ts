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
import { publicPostId, type PublicVideo } from "./public-video-core";
const fields = "x_post_id,author_id,author_username,author_name,text,preview_image_url,video_url,created_at,views,likes,bookmarks,is_visible,moderation_blocked,review_required,content_category,adult_tier,manual_tier";
// Cache the bounded inventory in this server process so sitemap requests do not rescan Supabase.
let indexCache: { until: number; authorFingerprint: string; value: Promise<PublicVideo[]> } | null = null;
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
    return hash.digest("hex");
  })();
  authorFingerprintCache = { until: Date.now() + 60 * 1000, value };
  value.catch(() => { if (authorFingerprintCache?.value === value) authorFingerprintCache = null; });
  return value;
}
export function productionPublicBackend() {
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
    return { active, blocked: await blockedPromise };
  }
  function query(selectFields = fields) { return supabaseAdmin().from("posts").select(selectFields).eq("is_visible", true).eq("moderation_blocked", false).eq("review_required", false).eq("content_category", "PASS"); }
  async function videos(rows: Record<string, any>[]) {
    const p = await permissions(rows);
    return rows.flatMap(row => {
      const id = String(row.x_post_id ?? "");
      if (!publicPostId(id) || !canDownloadPost(row as any) || !p.active.has(String(row.author_id)) || isUnavailablePost(row, p.blocked)) return [];
      let poster: string | null = null;
      try { const u = new URL(String(row.preview_image_url)); if (u.protocol === "https:" && !u.username && !u.password) poster = u.href; } catch { /* optional image */ }
      return [{ id, authorId: row.author_id == null ? null : String(row.author_id), handle: typeof row.author_username === "string" ? row.author_username.replace(/^@/, "") : null, authorName: typeof row.author_name === "string" ? row.author_name : null,
        text: typeof row.text === "string" ? row.text : null, posterUrl: poster, videoUrl: row.video_url as string, createdAt: typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at)) ? row.created_at : null,
        sourceHash: createHash("sha256").update(row.video_url).digest("hex"), eligible: true,
        views: Number.isFinite(row.views) && row.views >= 0 ? row.views : null,
        likes: Number.isFinite(row.likes) && row.likes >= 0 ? row.likes : null,
        bookmarks: Number.isFinite(row.bookmarks) && row.bookmarks >= 0 ? row.bookmarks : null } satisfies PublicVideo];
    });
  }
  async function posts(ids: string[]) {
    if (!ids.length) return []; if (ids.length > 100 || ids.some(id => !publicPostId(id))) throw Error("PUBLIC_INVALID_INPUT");
    const r = await query().in("x_post_id", [...new Set(ids)]).limit(100); if (r.error) throw Error("PUBLIC_DATABASE_UNAVAILABLE"); return videos(r.data ?? []);
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
  async function indexVideos() {
    const authorFingerprint = await activeAuthorFingerprint();
    if (indexCache && Date.now() < indexCache.until && indexCache.authorFingerprint === authorFingerprint) return indexCache.value;
    const value = (async () => {
      const result: PublicVideo[] = [];
      for (let offset = 0; offset < 20000; offset += 500) {
        const r = await query(fields).order("x_post_id", { ascending: false }).range(offset, offset + 499);
        if (r.error) throw Error("PUBLIC_INDEX_DATABASE_UNAVAILABLE");
        const rows = (r.data ?? []) as unknown as Record<string, any>[];
        result.push(...await videos(rows));
        if (rows.length < 500) return result;
      }
      throw Error("PUBLIC_INDEX_SCAN_LIMIT");
    })();
    indexCache = { until: Date.now() + 12 * 60 * 60 * 1000, authorFingerprint, value };
    value.catch(() => { if (indexCache?.value === value) indexCache = null; });
    return value;
  }
  async function automaticReady() {
    try { await fs.lstat(path.join(os.homedir(), ".xclip-production-deploy.lock")); return false; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; throw Error("PUBLIC_DEPLOYMENT_BUSY"); }
  }
  return { service: createPublicVideoService({ catalog, posts, authorVideos, candidates, scanPage, indexVideos, automaticReady, secret: publicSaveSecret }), catalog };
}
