import { matchingVideoTechnical, validVideoTechnical, type VideoTechnical } from "./video-technical";
import { createPublicCatalog } from "./public-catalog-store";
import { accountKey, accountProfile, authorHref, labelDefinition, publicPostId, relatedIds, videoLabels, videoMetadata, publicVideoIndexable, type PublicVideo } from "./public-video-core";
import { verifySaveReceipt } from "./public-save-receipt";
import { isIndexable } from "./indexability";
import { canonicalTagName } from "./tag-aliases";
import { buildDiscoveryIndex, matchesDiscovery, selectDiscovery, type DiscoveryIndex, type DiscoveryQuery } from "./discovery-index";
export type PublicVideoDeps = {
  catalog: ReturnType<typeof createPublicCatalog>;
  posts: (ids: string[]) => Promise<PublicVideo[]>;
  authorVideos: (key: string, limit: number) => Promise<PublicVideo[]>;
  candidates: (skip: string[], limit: number) => Promise<PublicVideo[]>;
  automaticReady?: () => Promise<boolean>;
  scanPage?: (cursor: string | null, upper: string | null) => Promise<{ videos: PublicVideo[]; nextCursor: string | null; upper: string | null; done: boolean; scanned: number }>;
  indexVideos?: () => Promise<PublicVideo[]>;
  tierPage?: (tier: string, offset: number) => Promise<{ videos: PublicVideo[]; hasMore: boolean }>;
  secret: () => Promise<string>;
};
// Only the ordered browse IDs are cached. Each page still rechecks its posts.
let browseIndexCache: { rows: PublicVideo[]; revision: number; until: number; ids: string[] } | null = null;
let discoveryCache: { rows: PublicVideo[]; revision: number; index: DiscoveryIndex } | null = null;
// Follow feed: a short per-account cache keeps repeated visits from re-reading the database.
const FOLLOW_CACHE_MS = 120000, FOLLOW_CACHE_MAX = 400, FOLLOW_PER_ACCOUNT = 8, FOLLOW_FEED_LIMIT = 48;
const followCache = new Map<string, { until: number; rows: PublicVideo[] }>();
function discoveryCard(v: PublicVideo) {
  return { id: v.id, handle: v.handle, authorName: v.authorName, text: v.text ? Array.from(v.text).slice(0, 240).join("") : null, posterUrl: v.posterUrl, createdAt: v.createdAt };
}
export function createPublicVideoService(deps: PublicVideoDeps, options: { readOnlyRender?: boolean } = {}) {
  // This promise belongs to one render only. Admin writers always read fresh state.
  let catalogRead: ReturnType<PublicVideoDeps["catalog"]["read"]> | undefined;
  const readCatalog = () => options.readOnlyRender ? (catalogRead ??= deps.catalog.read()) : deps.catalog.read();
  async function detailCore(id: string) {
    if (!publicPostId(id)) return null;
    const [catalog, rows] = await Promise.all([options.readOnlyRender && deps.catalog.readForIds ? deps.catalog.readForIds([id]) : readCatalog(), deps.posts([id])]);
    const video = rows.find(p => p.id === id && p.eligible);
    if (!video || !authorHref(video)) return null;
    const labels = videoLabels(catalog, video);
    return { video, technical: matchingVideoTechnical(catalog.records[id]?.technical, video.sourceHash),
      labelBasis: catalog.records[id]?.sourceHash === video.sourceHash ? catalog.records[id]?.basis ?? null : null,
      labels, metadata: videoMetadata(video, catalog.records[id] ?? null, labels) };
  }
  async function detailRelated(core: NonNullable<Awaited<ReturnType<typeof detailCore>>>) {
    const video = core.video, id = video.id, catalog = await readCatalog();
    const [sameRows, relatedRows] = await Promise.all([deps.authorVideos(authorHref(video)!.split("/").at(-1)!, 13), deps.posts(relatedIds(catalog, id, 36))]);
    const sameAuthor = sameRows.filter(v => v.eligible && v.id !== id && authorHref(v)).slice(0, 12);
    const excluded = new Set([id, ...sameAuthor.map(v => v.id)]), currentLabels = new Set(videoLabels(catalog, video).map(l => l.id));
    const related = relatedRows.filter(v => v.eligible && !excluded.has(v.id) && authorHref(v) && videoLabels(catalog, v).some(l => currentLabels.has(l.id))).slice(0, 12);
    // When no labelled match exists, keep the user on a valid, published video.
    // Prefer the same adult tier before falling back to the popular pool.
    const fallback = related.length ? [] : (await deps.candidates([...excluded], 100))
      .filter(v => v.eligible && !excluded.has(v.id) && authorHref(v))
      .sort((a, b) => Number(Boolean(video.adultTier) && a.adultTier === video.adultTier) - Number(Boolean(video.adultTier) && b.adultTier === video.adultTier)
        || (a.views ?? 0) - (b.views ?? 0) || (a.likes ?? 0) - (b.likes ?? 0) || b.id.localeCompare(a.id))
      .reverse().slice(0, 12);
    return { sameAuthor, related, recommended: fallback };
  }
  async function detail(id: string) {
    const core = await detailCore(id);
    return core ? { ...core, ...await detailRelated(core) } : null;
  }
  function hubFacts(rows: PublicVideo[], catalog: Awaited<ReturnType<typeof readCatalog>>, omitted: string[] = []) {
    const tags = new Map<string, { id: string; name: string; count: number }>();
    const authors = new Set<string>(); let latestAt: string | null = null;
    const seen = new Set<string>();
    for (const video of rows) {
      if (seen.has(video.id) || !video.eligible || !authorHref(video)) continue;
      seen.add(video.id);
      const key = accountKey(video); if (key) authors.add(key);
      if (video.createdAt && Number.isFinite(Date.parse(video.createdAt)) && (!latestAt || Date.parse(video.createdAt) > Date.parse(latestAt))) latestAt = video.createdAt;
      for (const name of new Set(videoLabels(catalog, video).map(label => canonicalTagName(label.name)))) {
        if (omitted.includes(name)) continue;
        const label = videoLabels(catalog, video).find(label => canonicalTagName(label.name) === name)!;
        const stat = tags.get(name) ?? { id: label.id, name, count: 0 }; stat.count++; tags.set(name, stat);
      }
    }
    return { authorCount: authors.size, latestAt, tags: [...tags.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja")).slice(0, 6) };
  }
  // Authors whose videos carry the same tags as this author's newest tagged videos. Optional: any failure shows nothing.
  async function relatedAuthors(catalog: Awaited<ReturnType<typeof readCatalog>>, matches: PublicVideo[], self: string) {
    try {
      const seeds = matches.filter(v => videoLabels(catalog, v).length).slice(0, 3);
      const ids = [...new Set(seeds.flatMap(v => relatedIds(catalog, v.id, 30)))].slice(0, 90);
      if (!ids.length) return [];
      const own = new Set(matches.map(v => v.id)), tally = new Map<string, { key: string; name: string; count: number }>();
      for (const v of await deps.posts(ids)) {
        const key = accountKey(v); if (!key || key.toLowerCase() === self.toLowerCase() || own.has(v.id) || !v.eligible) continue;
        // Only link to author pages that are allowed to be indexed (at least one permitted video).
        if (!publicVideoIndexable(v, videoLabels(catalog, v))) continue;
        const row = tally.get(key) ?? { key, name: v.authorName ?? v.handle ?? key, count: 0 }; row.count++; tally.set(key, row);
      }
      const rows = [...tally.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 6);
      return rows.length >= 2 ? rows : [];
    } catch { return []; }
  }
  async function account(key: string, page = 1) {
    if (!/^(?:[a-zA-Z0-9_]{1,15}|id-[A-Za-z0-9_-]{1,64})$/.test(key) || !Number.isInteger(page) || page < 1) return null;
    // Resolve an account from its own current videos. The site-wide inventory can
    // be cached while a newly approved author is already visible on post pages.
    const [all, catalog] = await Promise.all([deps.authorVideos(key, 500), readCatalog()]);
    const matches = all.filter(v => v.eligible && accountKey(v)?.toLowerCase() === key.toLowerCase())
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id));
    const permittedVideos = matches.filter(v => publicVideoIndexable(v, videoLabels(catalog, v))).length;
    const totalPages = Math.max(1, Math.ceil(matches.length / 24));
    if (!matches.length || page > totalPages) return null;
    const profile = accountProfile(matches), byId = new Map(matches.map(v => [v.id, v]));
    return { facts: hubFacts(matches, catalog), profile, relatedAuthors: page === 1 ? await relatedAuthors(catalog, matches, key) : [], topVideos: profile.top.flatMap(t => { const v = byId.get(t.id); return v ? [{ video: v, views: t.views }] : []; }),
      handle: matches[0].handle, key, canonicalKey: accountKey(matches[0])!, name: matches[0].authorName ?? matches[0].handle ?? key,
      videos: matches.slice((page - 1) * 24, page * 24), page, totalPages, totalCount: matches.length,
      index: isIndexable({ type: "account", permittedVideos }) };
  }
  async function tag(name: string, page = 1) {
    if (!Number.isInteger(page) || page < 1) return null;
    const c = await readCatalog();
    const names = [name.normalize("NFC")];
    if (name.includes("%")) { try { names.push(decodeURIComponent(name).normalize("NFC")); } catch { /* malformed route remains unmatched */ } }
    const requested = new Set(names.map(canonicalTagName));
    const matching = c.labels.filter(l => l.active && requested.has(canonicalTagName(l.name)));
    if (!matching.length) return null;
    const label = { ...matching[0], name: canonicalTagName(matching[0].name) }, labelIds = new Set(matching.map(l => l.id));
    const ids = Object.values(c.records).filter(r => r.labelIds.some(id => labelIds.has(id))).map(r => r.id);
    // Read only this tag's IDs through the current permission adapter. Cached inventory
    // must not resurrect excluded videos or inflate the new aggregates.
    if (ids.length > 20000) throw Error("PUBLIC_TAG_SCAN_LIMIT");
    const rows: PublicVideo[] = [];
    for (let start = 0; start < ids.length; start += 400) {
      const chunks = [0, 100, 200, 300].map(offset => ids.slice(start + offset, start + offset + 100)).filter(chunk => chunk.length);
      rows.push(...(await Promise.all(chunks.map(chunk => deps.posts(chunk)))).flat());
    }
    const matches = rows.filter(v => v.eligible && authorHref(v) && videoLabels(c, v).some(l => labelIds.has(l.id)))
      .sort((a, b) => (c.records[b.id]?.labelPublishedAt ?? "").localeCompare(c.records[a.id]?.labelPublishedAt ?? "") || b.id.localeCompare(a.id));
    const permittedVideos = matches.filter(v => publicVideoIndexable(v, videoLabels(c, v))).length;
    const totalPages = Math.max(1, Math.ceil(matches.length / 100));
    if (page > totalPages) return null;
    const profile = accountProfile(matches), byId = new Map(matches.map(v => [v.id, v])), authors = new Map<string, { key: string; name: string; count: number }>();
    for (const v of matches) { const key = accountKey(v); if (!key) continue; const row = authors.get(key) ?? { key, name: v.authorName ?? v.handle ?? key, count: 0 }; row.count++; authors.set(key, row); }
    const topAuthors = [...authors.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 5);
    return { facts: hubFacts(matches, c, [label.name]), profile, topAuthors: topAuthors.length >= 2 ? topAuthors : [], topVideos: profile.top.flatMap(t => { const v = byId.get(t.id); return v ? [{ video: v, views: t.views }] : []; }),
      label, videos: matches.slice((page - 1) * 100, page * 100), page, totalPages, totalCount: matches.length,
      index: isIndexable({ type: "tag", permittedVideos, hasImage: matches.some(v => Boolean(v.posterUrl)) }) };
  }
  // When a post page last changed: label publication, first save or first ranking, else its own creation time.
  function videoModified(catalog: Awaited<ReturnType<typeof readCatalog>>, video: PublicVideo) {
    const record = catalog.records[video.id] ?? null;
    const recorded = record?.sourceHash === video.sourceHash ? record.labelPublishedAt ?? record.firstSavedAt ?? record.firstRankedAt ?? undefined : undefined;
    return recorded ?? (video.createdAt && Number.isFinite(Date.parse(video.createdAt)) ? video.createdAt : undefined);
  }
  const newer = (a?: string, b?: string) => !b ? a : !a || Date.parse(b) > Date.parse(a) ? b : a;
  function labelStats(catalog: Awaited<ReturnType<PublicVideoDeps["catalog"]["read"]>>, rows: PublicVideo[]) {
    const groups = new Map<string, { id: string; name: string; count: number; hasImage: boolean; modifiedAt?: string }>();
    for (const label of catalog.labels.filter(label => label.active)) {
      const name = canonicalTagName(label.name);
      if (!groups.has(name)) groups.set(name, { id: label.id, name, count: 0, hasImage: false });
    }
    for (const video of rows) {
      const labels = videoLabels(catalog, video);
      if (!publicVideoIndexable(video, labels)) continue;
      for (const name of new Set(labels.map(label => canonicalTagName(label.name)))) {
        const group = groups.get(name); if (group) { group.count++; group.hasImage ||= Boolean(video.posterUrl); group.modifiedAt = newer(group.modifiedAt, videoModified(catalog, video)); }
      }
    }
    return [...groups.values()].map(group => ({ ...group, index: isIndexable({ type: "tag", permittedVideos: group.count, hasImage: group.hasImage }) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }
  async function activeLabels() {
    const [catalog, rows] = await Promise.all([readCatalog(), deps.indexVideos ? deps.indexVideos() : deps.posts([])]);
    return labelStats(catalog, rows);
  }
  async function indexable() {
    const c = await readCatalog();
    const rows = deps.indexVideos ? await deps.indexVideos() : await deps.posts(Object.values(c.records).slice(0, 100).map(r => r.id));
    const posts: { id: string; modifiedAt?: string }[] = [], accounts = new Map<string, { key: string; count: number; modifiedAt?: string }>();
    for (const video of rows) {
      const key = accountKey(video); if (!key) continue;
      const labels = videoLabels(c, video);
      if (!publicVideoIndexable(video, labels)) continue;
      const modifiedAt = videoModified(c, video);
      posts.push({ id: video.id, ...(modifiedAt ? { modifiedAt } : {}) });
      const account = accounts.get(key) ?? { key, count: 0 };
      account.count++;
      if (modifiedAt && (!account.modifiedAt || modifiedAt > account.modifiedAt)) account.modifiedAt = modifiedAt;
      accounts.set(key, account);
    }
    posts.sort((a, b) => b.id.localeCompare(a.id));
    const tags = labelStats(c, rows);
    return { posts, accounts: [...accounts.values()].filter(a => isIndexable({ type: "account", permittedVideos: a.count }))
      .map(({ key, modifiedAt }) => ({ key, ...(modifiedAt ? { modifiedAt } : {}) })).sort((a, b) => a.key.localeCompare(b.key)), tags };
  }
  // Monthly pages: built only from the site's own indexable posts (Japan-time month) and their recorded X view counts.
  const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
  const monthOf = (video: PublicVideo) => { const t = video.createdAt ? Date.parse(video.createdAt) : NaN; return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 7) : null; };
  async function monthGroups() {
    const [catalog, rows] = await Promise.all([readCatalog(), deps.indexVideos ? deps.indexVideos() : deps.posts([])]);
    const groups = new Map<string, PublicVideo[]>(), seen = new Set<string>();
    for (const video of rows) {
      if (seen.has(video.id) || !authorHref(video) || !publicVideoIndexable(video, videoLabels(catalog, video))) continue;
      seen.add(video.id);
      const month = monthOf(video); if (!month) continue;
      const group = groups.get(month); if (group) group.push(video); else groups.set(month, [video]);
    }
    const listed = [...groups.keys()].filter(key => isIndexable({ type: "month", permittedVideos: groups.get(key)!.length })).sort();
    return { catalog, groups, listed };
  }
  async function months() {
    const { catalog, groups, listed } = await monthGroups();
    return listed.map(month => {
      const rows = groups.get(month)!; let modifiedAt: string | undefined;
      for (const video of rows) modifiedAt = newer(modifiedAt, videoModified(catalog, video));
      return { month, count: rows.length, ...(modifiedAt ? { modifiedAt } : {}) };
    }).reverse();
  }
  async function month(key: string) {
    if (!MONTH_PATTERN.test(key)) return null;
    const { catalog, groups, listed } = await monthGroups();
    const rows = groups.get(key); if (!rows) return null;
    const known = rows.filter(v => typeof v.views === "number" && Number.isFinite(v.views) && v.views >= 0);
    const byViews = known.length >= 5;
    const ranked = byViews ? [...known].sort((a, b) => (b.views as number) - (a.views as number) || b.id.localeCompare(a.id)).slice(0, 24)
      : [...rows].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id)).slice(0, 24);
    const authors = new Map<string, { key: string; name: string; count: number }>();
    for (const v of rows) { const k = accountKey(v); if (!k) continue; const row = authors.get(k) ?? { key: k, name: v.authorName ?? v.handle ?? k, count: 0 }; row.count++; authors.set(k, row); }
    const topAuthors = [...authors.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 5);
    const facts = hubFacts(rows, catalog), at = listed.indexOf(key);
    let modifiedAt: string | undefined; for (const v of rows) modifiedAt = newer(modifiedAt, videoModified(catalog, v));
    return { month: key, total: rows.length, authorCount: authors.size, topAuthors: topAuthors.length >= 2 ? topAuthors : [], tags: facts.tags, byViews, measured: byViews ? known.length : 0,
      viewsTotal: byViews ? known.reduce((sum, v) => sum + (v.views as number), 0) : 0, ranked, prev: at > 0 ? listed[at - 1] : null, next: at >= 0 && at < listed.length - 1 ? listed[at + 1] : null,
      index: at >= 0, ...(modifiedAt ? { modifiedAt } : {}) };
  }
  async function browse(page = 1) {
    if (!Number.isSafeInteger(page) || page < 1) return null;
    const [catalog, indexedRows] = await Promise.all([readCatalog(), deps.indexVideos ? deps.indexVideos() : deps.posts([])]);
    let orderedIds: string[];
    if (browseIndexCache && browseIndexCache.rows === indexedRows && browseIndexCache.revision === catalog.revision && Date.now() < browseIndexCache.until) orderedIds = browseIndexCache.ids;
    else {
      orderedIds = indexedRows.filter(video => publicVideoIndexable(video, videoLabels(catalog, video))).map(video => video.id).sort((a, b) => b.localeCompare(a));
      browseIndexCache = { rows: indexedRows, revision: catalog.revision, until: Date.now() + 15000, ids: orderedIds };
    }
    const totalPages = Math.max(1, Math.ceil(orderedIds.length / 100));
    if (page > totalPages) return null;
    const ids = orderedIds.slice((page - 1) * 100, page * 100);
    const rows = ids.length ? await deps.posts(ids) : [];
    const visible = new Map(rows.filter(video => video.eligible && authorHref(video)).map(video => [video.id, video]));
    return { videos: ids.flatMap(id => { const video = visible.get(id); return video ? [video] : []; }), totalCount: orderedIds.length, totalPages, page };
  }
  async function discovery(query: DiscoveryQuery) {
    if (query.mode === "tier" && deps.tierPage) {
      selectDiscovery({ entries: [], months: [] }, query);
      const result = await deps.tierPage(query.tier!, query.offset ?? 0);
      return { videos: result.videos.filter(v => v.eligible && authorHref(v) && v.adultTier === query.tier).map(discoveryCard), nextOffset: result.hasMore ? (query.offset ?? 0) + 50 : null, months: [] as string[] };
    }
    if (!deps.indexVideos) throw Error("PUBLIC_INDEX_UNAVAILABLE");
    const [catalog, indexedRows] = await Promise.all([readCatalog(), deps.indexVideos()]);
    if (!discoveryCache || discoveryCache.rows !== indexedRows || discoveryCache.revision !== catalog.revision)
      discoveryCache = { rows: indexedRows, revision: catalog.revision, index: buildDiscoveryIndex(indexedRows, catalog) };
    const index = discoveryCache.index;
    const selected = selectDiscovery(index, query);
    const fresh = selected.ids.length ? await deps.posts(selected.ids) : [];
    const visible = new Map(fresh.filter(v => matchesDiscovery(v, catalog, query)).map(v => [v.id, v]));
    return { videos: selected.ids.flatMap(id => { const video = visible.get(id); return video ? [discoveryCard(video)] : []; }), nextOffset: selected.nextOffset, months: index.months };
  }
  async function personalVideos(ids: string[]) {
    if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => !publicPostId(id))) throw Error("PUBLIC_INVALID_INPUT");
    const unique = [...new Set(ids)], fresh = await deps.posts(unique);
    const visible = new Map(fresh.filter(v => v.eligible && authorHref(v)).map(v => [v.id, v]));
    return unique.flatMap(id => { const v = visible.get(id); return v ? [discoveryCard(v)] : []; });
  }
  /** Latest videos of the followed accounts, newest first. Only currently visible videos are returned. */
  async function followFeed(keys: string[]) {
    if (!Array.isArray(keys) || keys.length > 30 || keys.some(key => typeof key !== "string" || !/^(?:[a-z0-9_]{1,15}|id-[A-Za-z0-9_-]{1,64})$/.test(key))) throw Error("PUBLIC_INVALID_INPUT");
    const unique = [...new Set(keys)], now = Date.now(), failed: string[] = [];
    const groups = await Promise.all(unique.map(async key => {
      const hit = followCache.get(key);
      if (hit && hit.until > now) return hit.rows;
      try {
        const rows = await deps.authorVideos(key, FOLLOW_PER_ACCOUNT);
        if (followCache.size >= FOLLOW_CACHE_MAX) followCache.delete(followCache.keys().next().value as string);
        followCache.set(key, { until: now + FOLLOW_CACHE_MS, rows });
        return rows;
      } catch { failed.push(key); return hit?.rows ?? []; }
    }));
    const wanted = new Set(unique), seen = new Set<string>();
    const videos = groups.flat().filter(v => v.eligible && publicPostId(v.id) && wanted.has(accountKey(v) ?? "") && !seen.has(v.id) && !!seen.add(v.id))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id))
      .slice(0, FOLLOW_FEED_LIMIT).map(discoveryCard);
    return { videos, failedKeys: failed };
  }
  async function publish(input: Parameters<PublicVideoDeps["catalog"]["labels"]>[0]) {
    if (!input || !Array.isArray(input.posts) || input.posts.length > 100 || new Set(input.posts.map(p => p.id)).size !== input.posts.length || input.posts.some(p => !publicPostId(p.id) || p.basis === "model_auto")) throw Error("PUBLIC_INVALID_INPUT");
    const rows = await deps.posts(input.posts.map(p => p.id)), allowed = new Map(rows.filter(v => v.eligible).map(v => [v.id, v]));
    if (input.posts.some(p => !allowed.has(p.id) || allowed.get(p.id)!.sourceHash !== p.sourceHash)) throw Error("PUBLIC_SOURCE_CHANGED");
    const c = await deps.catalog.labels(input); return { revision: c.revision, published: input.posts.length };
  }
  async function saved(id: string, token: unknown) {
    if (!publicPostId(id)) throw Error("PUBLIC_INVALID_ID");
    const receipt = verifySaveReceipt(token, id, await deps.secret()); if (!receipt) throw Error("PUBLIC_INVALID_RECEIPT");
    const rows = await deps.posts([id]); if (!rows.some(v => v.id === id && v.eligible)) throw Error("PUBLIC_NOT_FOUND");
    await deps.catalog.saved(id, receipt); return { ok: true };
  }
  async function inspect(ids: string[]) { if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !publicPostId(id))) throw Error("PUBLIC_INVALID_INPUT"); return deps.posts(ids); }
  async function status() { const c = await deps.catalog.read(); return { featureVersion: 1, automaticLabelsVersion: deps.scanPage ? 1 : 0, emptyLabelRetryVersion: deps.scanPage ? 1 : 0, technicalMetadataVersion: deps.scanPage ? 1 : 0, revision: c.revision, labels: c.labels, labelledPosts: Object.values(c.records).filter(r => r.basis).length, rankedPosts: Object.values(c.records).filter(r => r.firstRankedAt).length, savedPosts: Object.values(c.records).filter(r => r.saves).length }; }
  async function candidates(excludeIds: string[] = []) { if (!Array.isArray(excludeIds) || excludeIds.length > 2000 || excludeIds.some(id => !publicPostId(id))) throw Error("PUBLIC_INVALID_INPUT"); const c = await deps.catalog.read(); return (await deps.candidates([...new Set([...excludeIds, ...Object.values(c.records).filter(r => r.basis).map(r => r.id)])], 20)).filter(v => v.eligible).slice(0, 20); }
  async function autoPage(cursor: string | null, upper: string | null, modelRevision: string, scope: "all" | "empty" = "all") {
    if (!["all", "empty"].includes(scope)) throw Error("PUBLIC_INVALID_SCAN");
    if (deps.automaticReady && !(await deps.automaticReady())) throw Error("PUBLIC_DEPLOYMENT_BUSY");
    if ((cursor !== null && !publicPostId(cursor)) || (upper !== null && !publicPostId(upper)) || !/^[a-f0-9]{64}$/.test(modelRevision) || (cursor !== null && upper === null) || !deps.scanPage) throw Error("PUBLIC_INVALID_SCAN");
    const [page, c] = await Promise.all([deps.scanPage(cursor, upper), deps.catalog.read()]);
    if (page.scanned > 50 || page.videos.length > page.scanned || !Number.isSafeInteger(page.scanned) || page.scanned < 0 || (page.nextCursor !== null && !publicPostId(page.nextCursor)) || (page.upper !== null && !publicPostId(page.upper)) || (!page.done && (page.nextCursor === null || page.nextCursor === cursor))) throw Error("PUBLIC_INVALID_SCAN");
    let protectedCount = 0, already = 0; const items: { id: string; handle: string | null; videoUrl: string; sourceHash: string }[] = [];
    const videos = page.videos.filter(v => v.eligible);
    for (const v of videos) {
      const r = c.records[v.id];
      if (r && ["manual", "model_reviewed"].includes(r.basis ?? "")) protectedCount++;
      else if (scope === "empty" && videoLabels(c, v).length > 0) already++;
      else if (scope !== "empty" && r?.basis === "model_auto" && r.modelRevision === modelRevision && r.sourceHash === v.sourceHash) already++;
      else items.push({ id: v.id, handle: v.handle, videoUrl: v.videoUrl, sourceHash: v.sourceHash });
    }
    return { items, nextCursor: page.nextCursor, upper: page.upper, done: page.done, scanned: page.scanned, protected: protectedCount, already, unavailable: page.scanned - videos.length };
  }
  async function autoPublish(input: { labels: Parameters<PublicVideoDeps["catalog"]["labels"]>[0]["labels"]; modelRevision: string; post: { id: string; sourceHash: string; labelIds: string[]; technical?: VideoTechnical } }) {
    if (deps.automaticReady && !(await deps.automaticReady())) throw Error("PUBLIC_DEPLOYMENT_BUSY");
    if (!input || !input.post || !publicPostId(input.post.id) || !/^[a-f0-9]{64}$/.test(input.post.sourceHash) || !/^[a-f0-9]{64}$/.test(input.modelRevision)) throw Error("PUBLIC_INVALID_LABELS");
    if (input.post.technical !== undefined) {
      if (!validVideoTechnical(input.post.technical)) throw Error("PUBLIC_INVALID_TECHNICAL_METADATA");
      if (!Array.isArray(input.labels) || input.labels.length > 40 || !input.labels.every(labelDefinition) || new Set(input.labels.map(label => label.id)).size !== input.labels.length || new Set(input.labels.map(label => label.name)).size !== input.labels.length || !Array.isArray(input.post.labelIds) || input.post.labelIds.length > 40 || new Set(input.post.labelIds).size !== input.post.labelIds.length || input.post.labelIds.some(id => !input.labels.some(label => label.id === id && label.active))) throw Error("PUBLIC_INVALID_LABELS");
    }
    const rows = await deps.posts([input.post.id]), video = rows.find(v => v.id === input.post.id && v.eligible && v.sourceHash === input.post.sourceHash);
    if (!video) return { result: "unavailable" };
    if (input.post.technical) await deps.catalog.technical(input.post.id, input.post.sourceHash, input.post.technical);
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await deps.catalog.read();
      try {
        const updated = await deps.catalog.labels({ revision: c.revision, labels: input.labels, posts: [{ ...input.post, basis: "model_auto", modelRevision: input.modelRevision }] });
        const r = updated.records[input.post.id];
        if (input.post.labelIds.length === 0 && r?.basis === "model_auto" && r.sourceHash === input.post.sourceHash && r.labelIds.some(id => input.labels.some(label => label.id === id && label.active))) return { result: "protected", reason: "empty_prediction_preserved" };
        return { result: r && ["manual", "model_reviewed"].includes(r.basis ?? "") ? "protected" : "published" };
      } catch (e) { if (!(e instanceof Error) || e.message !== "PUBLIC_CATALOG_STALE" || attempt === 2) throw e; }
    }
    throw Error("PUBLIC_CATALOG_STALE");
  }
  async function technicalPage(cursor: string | null, upper: string | null) {
    if ((cursor !== null && !publicPostId(cursor)) || (upper !== null && !publicPostId(upper)) || (cursor !== null && upper === null) || !deps.scanPage) throw Error("PUBLIC_INVALID_SCAN");
    const [page, catalog] = await Promise.all([deps.scanPage(cursor, upper), deps.catalog.read()]);
    if (!Number.isSafeInteger(page.scanned) || page.scanned < 0 || page.scanned > 50 || page.videos.length > page.scanned || (page.nextCursor !== null && !publicPostId(page.nextCursor)) || (page.upper !== null && !publicPostId(page.upper)) || (!page.done && (page.nextCursor === null || page.nextCursor === cursor))) throw Error("PUBLIC_INVALID_SCAN");
    return { items: page.videos.filter(video => video.eligible && !matchingVideoTechnical(catalog.records[video.id]?.technical, video.sourceHash)).map(video => ({ id: video.id, videoUrl: video.videoUrl, sourceHash: video.sourceHash })), nextCursor: page.nextCursor, upper: page.upper, done: page.done };
  }
  async function technicalPublish(input: { id: string; sourceHash: string; metadata: VideoTechnical }) {
    if (deps.automaticReady && !(await deps.automaticReady())) throw Error("PUBLIC_DEPLOYMENT_BUSY");
    if (!input || !publicPostId(input.id) || !/^[a-f0-9]{64}$/.test(input.sourceHash) || !validVideoTechnical(input.metadata)) throw Error("PUBLIC_INVALID_TECHNICAL_METADATA");
    const rows = await deps.posts([input.id]);
    if (!rows.some(video => video.id === input.id && video.eligible && video.sourceHash === input.sourceHash)) return { result: "unavailable" };
    await deps.catalog.technical(input.id, input.sourceHash, input.metadata, Date.now(), "mp4-range-v1"); return { result: "published" };
  }
  return { technicalPage, technicalPublish, detailCore, detailRelated, detail, account, tag, activeLabels, indexable, months, month, browse, discovery, personalVideos, followFeed, publish, saved, inspect, status, candidates, autoPage, autoPublish };
}
