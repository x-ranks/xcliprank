import type { StoredVideoTechnical } from "./video-technical";
// Shared page/metadata policy. Pure: no DB, files, provider or model access.
import { isIndexable } from "./indexability";
export const PUBLIC_SITE = "https://twizou.net";
export const publicPostId = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{1,24}$/.test(v);
export type PublicLabel = { id: string; name: string; active: boolean };
export type PublicVideo = { id: string; authorId: string | null; handle: string | null; authorName: string | null; text: string | null; posterUrl: string | null; videoUrl: string; createdAt: string | null; sourceHash: string; eligible: boolean; adultTier?: string | null; views?: number | null; likes?: number | null; bookmarks?: number | null };
export type CatalogRecord = { technical?: StoredVideoTechnical; id: string; labelIds: string[]; basis: "manual" | "model_reviewed" | "model_auto" | null; modelRevision: string | null; sourceHash: string | null; labelPublishedAt: string | null; saves: number; firstSavedAt: string | null; firstRankedAt: string | null; receipts: { id: string; expires: number }[] };
export type PublicCatalog = { version: 1; revision: number; labels: PublicLabel[]; records: Record<string, CatalogRecord> };
export const blankCatalog = (): PublicCatalog => ({ version: 1, revision: 0, labels: [], records: {} });
export const blankRecord = (id: string): CatalogRecord => ({ id, labelIds: [], basis: null, modelRevision: null, sourceHash: null, labelPublishedAt: null, saves: 0, firstSavedAt: null, firstRankedAt: null, receipts: [] });
export function postHref(id: string) { if (!publicPostId(id)) throw Error("PUBLIC_INVALID_ID"); return "/p/" + id; }
export function accountKey(video: PublicVideo) {
  if (video.handle && /^[A-Za-z0-9_]{1,15}$/.test(video.handle)) return video.handle.toLowerCase();
  if (video.authorId && /^[A-Za-z0-9_-]{1,64}$/.test(video.authorId)) return "id-" + video.authorId;
  return null;
}
export function authorHref(video: PublicVideo) { const key = accountKey(video); return key ? "/accounts/" + encodeURIComponent(key) : null; }
export function originalHref(video: PublicVideo) { return "https://x.com/i/status/" + video.id; }
export function tagHref(label: PublicLabel) { return "/tags/" + encodeURIComponent(label.name.normalize("NFC")); }
// Immutable formatting configuration is shared; never allocate ICU formatters per video.
const POST_DATE_FORMAT = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const SUMMARY_DATE_FORMAT = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
const PUBLIC_NUMBER_FORMAT = new Intl.NumberFormat("ja-JP");
// Short post date for list cards (JST). Same year -> "11/10", other year -> "2025/11/10". Reuses POST_DATE_FORMAT.
function jstDateParts(date: Date) {
  const out: Record<string, string> = {};
  for (const part of POST_DATE_FORMAT.formatToParts(date)) out[part.type] = part.value;
  return { year: out.year, month: String(Number(out.month)), day: String(Number(out.day)) };
}
export function cardDate(createdAt: string | null | undefined, now: Date = new Date()): { text: string; iso: string } | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  const p = jstDateParts(date);
  return { text: p.year === jstDateParts(now).year ? `${p.month}/${p.day}` : `${p.year}/${p.month}/${p.day}`, iso: date.toISOString() };
}
function durationText(value: { durationSeconds: number } | null | undefined) {
  if (!value || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0) return null;
  const seconds = Math.max(1, Math.round(value.durationSeconds));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}
const compact = (value: string | null, max: number) => Array.from(value?.replace(/https?:\/\/t\.co\/\S+/gi, " ").replace(/\s+/g, " ").trim() ?? "").slice(0, max).join("");
export function videoSummary(video: PublicVideo, labels: PublicLabel[] = []) {
  const author = compact(video.authorName || (video.handle ? "@" + video.handle : null), 36) || "投稿者";
  const date = video.createdAt && Number.isFinite(Date.parse(video.createdAt))
    ? SUMMARY_DATE_FORMAT.format(new Date(video.createdAt)) : null;
  const tags = labels.map(label => compact(label.name, 24)).filter(Boolean).slice(0, 3);
  return [`${author}のX動画`, date, tags.length ? `タグ：${tags.join("、")}` : null].filter(Boolean).join("｜");
}
// Exactly the same index policy, without generating titles, dates or fact strings.
export function publicVideoIndexable(video: PublicVideo, labels: PublicLabel[] = []) {
  return isIndexable({ type: "post", permitted: video.eligible, hasAuthor: Boolean(authorHref(video)),
    hasDescription: Boolean(compact(video.text, 58) || video.posterUrl || labels.some(label => compact(label.name, 24))) });
}
const DESCRIPTION_PILOT_IDS = new Set([
  "2096572807497060638",
  "2093153066023576024",
]);

export function videoMetadata(video: PublicVideo, record: CatalogRecord | null, labels: PublicLabel[] = []) {
  const author = compact(video.authorName || (video.handle ? "@" + video.handle : null), 36) || "投稿者";
  const labelText = labels.map(label => compact(label.name, 24)).filter(Boolean).slice(0, 2).join("・");
  const text = compact(video.text, labelText ? 42 : 58);
  const date = video.createdAt && Number.isFinite(Date.parse(video.createdAt)) ? POST_DATE_FORMAT.format(new Date(video.createdAt)) : null;
  // Publication permission is checked by the production adapter. A label or save is never permission.
  const observedSave = Boolean(record && record.saves > 0 && record.firstSavedAt);
  const index = publicVideoIndexable(video, labels);
  const subject = text ? `「${text}」` : [labelText, date ? `${date}の投稿` : null].filter(Boolean).join("｜") || "公開投稿";
  const description = compact(video.text, 120)
    ? `${compact(video.text, 120)}${labelText ? `｜タグ：${labelText}` : ""}${date ? `｜投稿日：${date}` : ""}`
    : videoSummary(video, labels);
  const excerpt = DESCRIPTION_PILOT_IDS.has(video.id) && index ? compact(video.text, 70) : "";
  const searchDescription = excerpt ? [videoSummary(video, labels), "元の投稿文：" + excerpt].join("｜") : description;
  const technical = record?.technical?.sourceHash === video.sourceHash ? record.technical : null;
  const duration = durationText(technical);
  return { title: `${author}のTwitter動画 ${subject}${text && labelText ? `｜${labelText}` : ""}｜twizou`, description: compact([searchDescription, duration ? `再生時間：${duration}` : null].filter(Boolean).join("｜"), 170), canonical: PUBLIC_SITE + postHref(video.id), index, follow: true,
    saveCount: observedSave ? record!.saves : null, firstSavedAt: observedSave ? record!.firstSavedAt : null };
}
export function visibleLabels(catalog: PublicCatalog, id: string) {
  const ids = new Set(catalog.records[id]?.labelIds ?? []); return catalog.labels.filter(l => l.active && ids.has(l.id));
}
export function relatedIds(catalog: PublicCatalog, id: string, limit = 24) {
  const labels = new Set(visibleLabels(catalog, id).map(l => l.id)); if (!labels.size) return [];
  return Object.values(catalog.records).filter(r => r.id !== id).map(r => ({ id: r.id, score: visibleLabels(catalog, r.id).filter(l => labels.has(l.id)).length }))
    .filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit).map(r => r.id);
}
export function labelDefinition(value: unknown): value is PublicLabel {
  if (!value || typeof value !== "object") return false;
  const v = value as PublicLabel; if (Object.keys(v).some(k => !["id", "name", "active"].includes(k))) return false; return /^[a-f0-9-]{36}$/.test(v.id) && typeof v.name === "string" && !!v.name.trim() && v.name === v.name.normalize("NFC").trim() && v.name.length <= 40 && !/[\u0000-\u001f\u007f]/.test(v.name) && typeof v.active === "boolean";
}

export function videoLabels(catalog: PublicCatalog, video: PublicVideo) { return catalog.records[video.id]?.sourceHash === video.sourceHash ? visibleLabels(catalog, video.id) : []; }

// Facts use the current record only. Missing/invalid counts are not zeroes.
export function publicVideoFacts(video: PublicVideo, technical?: { durationSeconds: number; width?: number; height?: number } | null) {
  const facts: { label: string; value: string; dateTime?: string }[] = [];
  if (video.createdAt && Number.isFinite(Date.parse(video.createdAt))) facts.push({ label: "投稿日", value: POST_DATE_FORMAT.format(new Date(video.createdAt)), dateTime: video.createdAt });
  if (technical && Number.isFinite(technical.durationSeconds) && technical.durationSeconds > 0) {
    facts.push({ label: "再生時間", value: durationText(technical)! });
    if (Number.isSafeInteger(technical.width) && Number.isSafeInteger(technical.height) && technical.width! > 0 && technical.height! > 0) facts.push({ label: "サイズ", value: technical.width + "×" + technical.height + "（" + (technical.width! < technical.height! ? "縦" : technical.width! > technical.height! ? "横" : "正方形") + "）" });
  }
  for (const [key, label, unit] of [["views", "X表示", "回"], ["likes", "Xいいね", "件"], ["bookmarks", "Xブックマーク", "件"]] as const) {
    const value = video[key]; if (Number.isSafeInteger(value) && value! >= 0) facts.push({ label, value: PUBLIC_NUMBER_FORMAT.format(value!) + unit });
  }
  return facts;
}

// Ranking facts for one video: recorded positions in twizou's own 24-hour ranking, and the first day it was listed.
export type PublicRankStats = { best: number; days: number; firstDay: string; lastDay: string };
const rankDayText = (day: string) => `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
export function publicRankFacts(rank: PublicRankStats | null | undefined, firstRankedAt?: string | null) {
  const facts: { label: string; value: string; dateTime?: string }[] = [];
  if (rank && Number.isSafeInteger(rank.best) && rank.best >= 1 && Number.isSafeInteger(rank.days) && rank.days >= 1) {
    facts.push({ label: "twizou 24時間ランキング最高順位", value: `${rank.best}位（${rankDayText(rank.firstDay)}以降の記録）` });
    facts.push({ label: "ランクイン日数", value: `${PUBLIC_NUMBER_FORMAT.format(rank.days)}日` });
  }
  const t = firstRankedAt ? Date.parse(firstRankedAt) : NaN;
  if (Number.isFinite(t)) facts.push({ label: "twizouのランキング初掲載", value: POST_DATE_FORMAT.format(new Date(t)), dateTime: new Date(t).toISOString() });
  return facts;
}

// Account page facts (computed only from the videos already shown; nothing is estimated).
export type AccountProfile = {
  total: number;
  firstAt: string | null;
  latestAt: string | null;
  /** Videos whose view count is known, their sum and the most viewed ones. Empty when fewer than two are known. */
  measured: number;
  viewsTotal: number;
  top: { id: string; views: number }[];
  /** Posts per month in Japan time, newest month first, last six months that have at least one post. */
  months: { month: string; count: number }[];
};

const profileTime = (value: string | null) => { const t = value ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : null; };
const jstMonth = (t: number) => new Date(t + 9 * 3600000).toISOString().slice(0, 7);

/** Facts computed only from the videos already shown on the account; nothing is estimated. */
export function accountProfile(videos: PublicVideo[]): AccountProfile {
  const seen = new Set<string>();
  const rows = videos.filter(v => !seen.has(v.id) && !!seen.add(v.id));
  const times = rows.map(v => profileTime(v.createdAt)).filter((t): t is number => t !== null);
  const known = rows.filter(v => typeof v.views === "number" && Number.isFinite(v.views) && v.views >= 0);
  const months = new Map<string, number>();
  for (const t of times) months.set(jstMonth(t), (months.get(jstMonth(t)) ?? 0) + 1);
  const enough = known.length >= 2;
  return {
    total: rows.length,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    latestAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    measured: enough ? known.length : 0,
    viewsTotal: enough ? known.reduce((sum, v) => sum + (v.views as number), 0) : 0,
    top: enough ? [...known].sort((a, b) => (b.views as number) - (a.views as number) || b.id.localeCompare(a.id)).slice(0, 3).map(v => ({ id: v.id, views: v.views as number })) : [],
    months: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).map(([month, count]) => ({ month, count })),
  };
}

// Formatters are created on first use so importing this module allocates none.
let jstDate: Intl.DateTimeFormat | undefined, plainNumber: Intl.NumberFormat | undefined;
export const profileDate = (value: string | null) => { const t = profileTime(value); return t === null ? null : (jstDate ??= new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" })).format(t); };
export const profileNumber = (value: number) => (plainNumber ??= new Intl.NumberFormat("ja-JP")).format(value);
