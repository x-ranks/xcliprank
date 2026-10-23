// Shared page/metadata policy. Pure: no DB, files, provider or model access.
import { isIndexable } from "./indexability";
export const PUBLIC_SITE = "https://twizou.net";
export const publicPostId = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{1,24}$/.test(v);
export type PublicLabel = { id: string; name: string; active: boolean };
export type PublicVideo = { id: string; authorId: string | null; handle: string | null; authorName: string | null; text: string | null; posterUrl: string | null; videoUrl: string; createdAt: string | null; sourceHash: string; eligible: boolean; views?: number | null; likes?: number | null; bookmarks?: number | null };
export type CatalogRecord = { id: string; labelIds: string[]; basis: "manual" | "model_reviewed" | "model_auto" | null; modelRevision: string | null; sourceHash: string | null; labelPublishedAt: string | null; saves: number; firstSavedAt: string | null; firstRankedAt: string | null; receipts: { id: string; expires: number }[] };
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
const compact = (value: string | null, max: number) => Array.from(value?.replace(/https?:\/\/t\.co\/\S+/gi, " ").replace(/\s+/g, " ").trim() ?? "").slice(0, max).join("");
export function videoSummary(video: PublicVideo, labels: PublicLabel[] = []) {
  const author = compact(video.authorName || (video.handle ? "@" + video.handle : null), 36) || "投稿者";
  const date = video.createdAt && Number.isFinite(Date.parse(video.createdAt))
    ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(new Date(video.createdAt)) : null;
  const tags = labels.map(label => compact(label.name, 24)).filter(Boolean).slice(0, 3);
  return `${author}のX動画です。${date ? `${date}に投稿されました。` : ""}${tags.length ? `この動画のタグは${tags.join("、")}です。` : ""}`;
}
export function videoMetadata(video: PublicVideo, record: CatalogRecord | null, labels: PublicLabel[] = []) {
  const author = compact(video.authorName || (video.handle ? "@" + video.handle : null), 36) || "投稿者";
  const labelText = labels.map(label => compact(label.name, 24)).filter(Boolean).slice(0, 2).join("・");
  const text = compact(video.text, labelText ? 42 : 58);
  const date = video.createdAt && Number.isFinite(Date.parse(video.createdAt)) ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(video.createdAt)) : null;
  // Publication permission is checked by the production adapter. A label or save is never permission.
  const observedSave = Boolean(record && record.saves > 0 && record.firstSavedAt);
  const index = isIndexable({ type: "post", permitted: video.eligible, hasAuthor: Boolean(authorHref(video)),
    hasDescription: Boolean(text || video.posterUrl || labelText) });
  const subject = text ? `「${text}」` : labelText || (date ? `${date}の投稿` : "公開投稿");
  const description = compact(video.text, 120)
    ? `${compact(video.text, 120)}${labelText ? `｜タグ：${labelText}` : ""}${date ? `｜投稿日：${date}` : ""}`
    : videoSummary(video, labels);
  return { title: `${author}のX動画 ${subject}${text && labelText ? `｜${labelText}` : ""}｜twizou`, description: compact(description, 170), canonical: PUBLIC_SITE + postHref(video.id), index, follow: true,
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
