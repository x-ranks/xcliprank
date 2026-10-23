import { createPublicCatalog } from "./public-catalog-store";
import { accountKey, authorHref, publicPostId, relatedIds, videoLabels, videoMetadata, type PublicVideo } from "./public-video-core";
import { verifySaveReceipt } from "./public-save-receipt";
import { isIndexable } from "./indexability";
import { canonicalTagName } from "./tag-aliases";
export type PublicVideoDeps = {
  catalog: ReturnType<typeof createPublicCatalog>;
  posts: (ids: string[]) => Promise<PublicVideo[]>;
  authorVideos: (key: string, limit: number) => Promise<PublicVideo[]>;
  candidates: (skip: string[], limit: number) => Promise<PublicVideo[]>;
  automaticReady?: () => Promise<boolean>;
  scanPage?: (cursor: string | null, upper: string | null) => Promise<{ videos: PublicVideo[]; nextCursor: string | null; upper: string | null; done: boolean; scanned: number }>;
  indexVideos?: () => Promise<PublicVideo[]>;
  secret: () => Promise<string>;
};
export function createPublicVideoService(deps: PublicVideoDeps) {
  async function detail(id: string) {
    if (!publicPostId(id)) return null;
    const [catalog, rows] = await Promise.all([deps.catalog.read(), deps.posts([id])]);
    const video = rows.find(p => p.id === id && p.eligible); if (!video || !authorHref(video)) return null;
    const [sameRows, relatedRows] = await Promise.all([deps.authorVideos(authorHref(video)!.split("/").at(-1)!, 13), deps.posts(relatedIds(catalog, id, 36))]);
    const sameAuthor = sameRows.filter(v => v.eligible && v.id !== id && authorHref(v)).slice(0, 12);
    const excluded = new Set([id, ...sameAuthor.map(v => v.id)]), currentLabels = new Set(videoLabels(catalog, video).map(l => l.id));
    const related = relatedRows.filter(v => v.eligible && !excluded.has(v.id) && authorHref(v) && videoLabels(catalog, v).some(l => currentLabels.has(l.id))).slice(0, 12);
    const labels = videoLabels(catalog, video);
    return { video, labelBasis: catalog.records[id]?.sourceHash === video.sourceHash ? catalog.records[id]?.basis ?? null : null, labels, metadata: videoMetadata(video, catalog.records[id] ?? null, labels), sameAuthor, related };
  }
  async function account(key: string, page = 1) {
    if (!/^(?:[a-zA-Z0-9_]{1,15}|id-[A-Za-z0-9_-]{1,64})$/.test(key) || !Number.isInteger(page) || page < 1) return null;
    // Resolve an account from its own current videos. The site-wide inventory can
    // be cached while a newly approved author is already visible on post pages.
    const [all, catalog] = await Promise.all([deps.authorVideos(key, 500), deps.catalog.read()]);
    const matches = all.filter(v => v.eligible && accountKey(v)?.toLowerCase() === key.toLowerCase())
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id));
    const permittedVideos = matches.filter(v => videoMetadata(v, catalog.records[v.id] ?? null, videoLabels(catalog, v)).index).length;
    const totalPages = Math.max(1, Math.ceil(matches.length / 24));
    if (!matches.length || page > totalPages) return null;
    return { key, canonicalKey: accountKey(matches[0])!, name: matches[0].authorName ?? matches[0].handle ?? key,
      videos: matches.slice((page - 1) * 24, page * 24), page, totalPages, totalCount: matches.length,
      index: isIndexable({ type: "account", permittedVideos }) };
  }
  async function tag(name: string, page = 1) {
    if (!Number.isInteger(page) || page < 1) return null;
    const c = await deps.catalog.read();
    const names = [name.normalize("NFC")];
    if (name.includes("%")) { try { names.push(decodeURIComponent(name).normalize("NFC")); } catch { /* malformed route remains unmatched */ } }
    const requested = new Set(names.map(canonicalTagName));
    const matching = c.labels.filter(l => l.active && requested.has(canonicalTagName(l.name)));
    if (!matching.length) return null;
    const label = { ...matching[0], name: canonicalTagName(matching[0].name) }, labelIds = new Set(matching.map(l => l.id));
    const ids = Object.values(c.records).filter(r => r.labelIds.some(id => labelIds.has(id))).map(r => r.id);
    const rows = deps.indexVideos ? await deps.indexVideos() : await deps.posts(ids.slice(0, 100));
    const matches = rows.filter(v => v.eligible && authorHref(v) && videoLabels(c, v).some(l => labelIds.has(l.id)))
      .sort((a, b) => (c.records[b.id]?.labelPublishedAt ?? "").localeCompare(c.records[a.id]?.labelPublishedAt ?? "") || b.id.localeCompare(a.id));
    const permittedVideos = matches.filter(v => videoMetadata(v, c.records[v.id] ?? null, videoLabels(c, v)).index).length;
    const totalPages = Math.max(1, Math.ceil(matches.length / 100));
    if (page > totalPages) return null;
    return { label, videos: matches.slice((page - 1) * 100, page * 100), page, totalPages, totalCount: matches.length,
      index: isIndexable({ type: "tag", permittedVideos, hasImage: matches.some(v => Boolean(v.posterUrl)) }) };
  }
  function labelStats(catalog: Awaited<ReturnType<PublicVideoDeps["catalog"]["read"]>>, rows: PublicVideo[]) {
    const groups = new Map<string, { id: string; name: string; count: number; hasImage: boolean }>();
    for (const label of catalog.labels.filter(label => label.active)) {
      const name = canonicalTagName(label.name);
      if (!groups.has(name)) groups.set(name, { id: label.id, name, count: 0, hasImage: false });
    }
    for (const video of rows) {
      const labels = videoLabels(catalog, video);
      if (!videoMetadata(video, catalog.records[video.id] ?? null, labels).index) continue;
      for (const name of new Set(labels.map(label => canonicalTagName(label.name)))) {
        const group = groups.get(name); if (group) { group.count++; group.hasImage ||= Boolean(video.posterUrl); }
      }
    }
    return [...groups.values()].map(group => ({ ...group, index: isIndexable({ type: "tag", permittedVideos: group.count, hasImage: group.hasImage }) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }
  async function activeLabels() {
    const [catalog, rows] = await Promise.all([deps.catalog.read(), deps.indexVideos ? deps.indexVideos() : deps.posts([])]);
    return labelStats(catalog, rows);
  }
  async function indexable() {
    const c = await deps.catalog.read();
    const rows = deps.indexVideos ? await deps.indexVideos() : await deps.posts(Object.values(c.records).slice(0, 100).map(r => r.id));
    const posts: { id: string; modifiedAt?: string }[] = [], accounts = new Map<string, { key: string; count: number; modifiedAt?: string }>();
    for (const video of rows) {
      const key = accountKey(video); if (!key) continue;
      const record = c.records[video.id] ?? null, labels = videoLabels(c, video);
      if (!videoMetadata(video, record, labels).index) continue;
      const modifiedAt = record?.sourceHash === video.sourceHash ? record.labelPublishedAt ?? record.firstSavedAt ?? record.firstRankedAt ?? undefined : undefined;
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
  async function status() { const c = await deps.catalog.read(); return { featureVersion: 1, automaticLabelsVersion: deps.scanPage ? 1 : 0, revision: c.revision, labels: c.labels, labelledPosts: Object.values(c.records).filter(r => r.basis).length, rankedPosts: Object.values(c.records).filter(r => r.firstRankedAt).length, savedPosts: Object.values(c.records).filter(r => r.saves).length }; }
  async function candidates(excludeIds: string[] = []) { if (!Array.isArray(excludeIds) || excludeIds.length > 2000 || excludeIds.some(id => !publicPostId(id))) throw Error("PUBLIC_INVALID_INPUT"); const c = await deps.catalog.read(); return (await deps.candidates([...new Set([...excludeIds, ...Object.values(c.records).filter(r => r.basis).map(r => r.id)])], 20)).filter(v => v.eligible).slice(0, 20); }
  async function autoPage(cursor: string | null, upper: string | null, modelRevision: string) {
    if (deps.automaticReady && !(await deps.automaticReady())) throw Error("PUBLIC_DEPLOYMENT_BUSY");
    if ((cursor !== null && !publicPostId(cursor)) || (upper !== null && !publicPostId(upper)) || !/^[a-f0-9]{64}$/.test(modelRevision) || (cursor !== null && upper === null) || !deps.scanPage) throw Error("PUBLIC_INVALID_SCAN");
    const [page, c] = await Promise.all([deps.scanPage(cursor, upper), deps.catalog.read()]);
    if (page.scanned > 50 || page.videos.length > page.scanned || !Number.isSafeInteger(page.scanned) || page.scanned < 0 || (page.nextCursor !== null && !publicPostId(page.nextCursor)) || (page.upper !== null && !publicPostId(page.upper)) || (!page.done && (page.nextCursor === null || page.nextCursor === cursor))) throw Error("PUBLIC_INVALID_SCAN");
    let protectedCount = 0, already = 0; const items: { id: string; handle: string | null; videoUrl: string; sourceHash: string }[] = [];
    const videos = page.videos.filter(v => v.eligible);
    for (const v of videos) {
      const r = c.records[v.id];
      if (r && ["manual", "model_reviewed"].includes(r.basis ?? "")) protectedCount++;
      else if (r?.basis === "model_auto" && r.modelRevision === modelRevision && r.sourceHash === v.sourceHash) already++;
      else items.push({ id: v.id, handle: v.handle, videoUrl: v.videoUrl, sourceHash: v.sourceHash });
    }
    return { items, nextCursor: page.nextCursor, upper: page.upper, done: page.done, scanned: page.scanned, protected: protectedCount, already, unavailable: page.scanned - videos.length };
  }
  async function autoPublish(input: { labels: Parameters<PublicVideoDeps["catalog"]["labels"]>[0]["labels"]; modelRevision: string; post: { id: string; sourceHash: string; labelIds: string[] } }) {
    if (deps.automaticReady && !(await deps.automaticReady())) throw Error("PUBLIC_DEPLOYMENT_BUSY");
    if (!input || !input.post || !publicPostId(input.post.id) || !/^[a-f0-9]{64}$/.test(input.post.sourceHash) || !/^[a-f0-9]{64}$/.test(input.modelRevision)) throw Error("PUBLIC_INVALID_LABELS");
    const rows = await deps.posts([input.post.id]), video = rows.find(v => v.id === input.post.id && v.eligible && v.sourceHash === input.post.sourceHash);
    if (!video) return { result: "unavailable" };
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await deps.catalog.read();
      try {
        const updated = await deps.catalog.labels({ revision: c.revision, labels: input.labels, posts: [{ ...input.post, basis: "model_auto", modelRevision: input.modelRevision }] });
        const r = updated.records[input.post.id]; return { result: r && ["manual", "model_reviewed"].includes(r.basis ?? "") ? "protected" : "published" };
      } catch (e) { if (!(e instanceof Error) || e.message !== "PUBLIC_CATALOG_STALE" || attempt === 2) throw e; }
    }
    throw Error("PUBLIC_CATALOG_STALE");
  }
  return { detail, account, tag, activeLabels, indexable, publish, saved, inspect, status, candidates, autoPage, autoPublish };
}
