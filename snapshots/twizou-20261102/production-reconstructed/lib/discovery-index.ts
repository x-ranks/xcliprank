import { authorHref, publicPostId, videoLabels, type PublicCatalog, type PublicVideo } from "./public-video-core";

export type DiscoveryMode = "search" | "month" | "months" | "tier" | "random";
export type DiscoveryQuery = { mode: DiscoveryMode; query?: string; month?: string; tier?: string; seed?: number; offset?: number };
type Entry = { id: string; search: string; month: string; tier: string };
export type DiscoveryIndex = { entries: Entry[]; months: string[] };
const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ja").trim();
const tierValues = new Set(["S", "A+", "A", "B+", "B", "C"]);

export function matchesDiscovery(video: PublicVideo, catalog: PublicCatalog, query: DiscoveryQuery): boolean {
  if (!video.eligible || !publicPostId(video.id) || !authorHref(video)) return false;
  const entry = makeEntry(video, catalog);
  if (query.mode === "search") {
    const words = normalize(query.query ?? "").split(/\s+/).filter(Boolean);
    return words.length > 0 && words.every(word => entry.search.includes(word));
  }
  if (query.mode === "month") return entry.month === query.month;
  if (query.mode === "tier") return entry.tier === query.tier;
  return query.mode === "random";
}

function makeEntry(video: PublicVideo, catalog: PublicCatalog): Entry {
  const date = video.createdAt ? Date.parse(video.createdAt) : NaN;
  // Month uses Japan time, independent of the server's timezone.
  const month = Number.isFinite(date) ? new Date(date + 9 * 3600000).toISOString().slice(0, 7) : "";
  return { id: video.id, month, tier: video.adultTier ?? "", search: normalize([video.text, video.handle, video.authorName, ...videoLabels(catalog, video).map(label => label.name)].filter(Boolean).join(" ")) };
}

export function buildDiscoveryIndex(videos: PublicVideo[], catalog: PublicCatalog): DiscoveryIndex {
  const seen = new Set<string>();
  const entries = videos.filter(v => v.eligible && publicPostId(v.id) && authorHref(v) && !seen.has(v.id) && !!seen.add(v.id)).map(v => makeEntry(v, catalog));
  return { entries, months: [...new Set(entries.map(e => e.month).filter(Boolean))].sort().reverse() };
}

function gcd(a: number, b: number): number { while (b) { const t = a % b; a = b; b = t; } return a; }
export function selectDiscovery(index: DiscoveryIndex, query: DiscoveryQuery) {
  const offset = query.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 20000) throw Error("INVALID_DISCOVERY_OFFSET");
  if (query.mode === "search" && (typeof query.query !== "string" || !normalize(query.query) || query.query.length > 80)) throw Error("INVALID_DISCOVERY_QUERY");
  if (query.mode === "month" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.month ?? "")) throw Error("INVALID_DISCOVERY_MONTH");
  if (query.mode === "tier" && !tierValues.has(query.tier ?? "")) throw Error("INVALID_DISCOVERY_TIER");
  if (query.mode === "random" && (!Number.isSafeInteger(query.seed) || query.seed! < 0 || query.seed! > 0xffffffff)) throw Error("INVALID_DISCOVERY_SEED");
  if (query.mode === "months") return { ids: [], nextOffset: null };
  const words = normalize(query.query ?? "").split(/\s+/).filter(Boolean);
  const entries = query.mode === "random" ? index.entries : index.entries.filter(entry => query.mode === "month" ? entry.month === query.month : query.mode === "tier" ? entry.tier === query.tier : words.every(word => entry.search.includes(word)));
  const total = entries.length;
  let step = total ? ((query.seed ?? 0) % total) || 1 : 1;
  while (total && gcd(step, total) !== 1) step = (step + 1) % total || 1;
  const start = total ? ((query.seed ?? 0) >>> 0) % total : 0;
  const ids = entries.slice(offset, offset + 50).map((entry, i) => query.mode === "random" ? entries[(start + (offset + i) * step) % total].id : entry.id);
  return { ids, nextOffset: offset + ids.length < total ? offset + ids.length : null };
}
