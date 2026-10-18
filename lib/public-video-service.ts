import { createPublicCatalog } from "./public-catalog-store";
import { authorHref, publicPostId, relatedIds, videoLabels, videoMetadata, type PublicVideo } from "./public-video-core";
import { verifySaveReceipt } from "./public-save-receipt";
export type PublicVideoDeps = {
  catalog: ReturnType<typeof createPublicCatalog>;
  posts: (ids: string[]) => Promise<PublicVideo[]>;
  authorVideos: (key: string, limit: number) => Promise<PublicVideo[]>;
  candidates: (skip: string[], limit: number) => Promise<PublicVideo[]>;
  automaticReady?: () => Promise<boolean>;
  scanPage?: (cursor: string | null, upper: string | null) => Promise<{ videos: PublicVideo[]; nextCursor: string | null; upper: string | null; done: boolean; scanned: number }>;
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
    return { video, labelBasis: catalog.records[id]?.sourceHash === video.sourceHash ? catalog.records[id]?.basis ?? null : null, labels: videoLabels(catalog, video), metadata: videoMetadata(video, catalog.records[id] ?? null), sameAuthor, related };
  }
  async function account(key: string) {
    if (!/^(?:[a-zA-Z0-9_]{1,15}|id-[A-Za-z0-9_-]{1,64})$/.test(key)) return null;
    const videos = (await deps.authorVideos(key, 24)).filter(v => v.eligible && authorHref(v));
    return videos.length ? { key, name: videos[0].authorName ?? videos[0].handle ?? key, videos } : null;
  }
  async function tag(name: string) {
    const c = await deps.catalog.read(), label = c.labels.find(l => l.active && l.name === name.normalize("NFC")); if (!label) return null;
    const ids = Object.values(c.records).filter(r => r.labelIds.includes(label.id)).sort((a, b) => (b.labelPublishedAt ?? "").localeCompare(a.labelPublishedAt ?? "")).slice(0, 100).map(r => r.id);
    const videos = (await deps.posts(ids)).filter(v => v.eligible && authorHref(v) && videoLabels(c, v).some(l => l.id === label.id));
    return { label, videos };
  }
  async function indexable(limit = 200) {
    const c = await deps.catalog.read();
    const ids = Object.values(c.records).filter(r => r.saves > 0 || r.firstRankedAt).sort((a, b) => (b.firstSavedAt ?? b.firstRankedAt ?? "").localeCompare(a.firstSavedAt ?? a.firstRankedAt ?? "")).slice(0, Math.max(0, Math.min(500, limit))).map(r => r.id);
    const rows: PublicVideo[] = []; for (let i = 0; i < ids.length; i += 50) rows.push(...await deps.posts(ids.slice(i, i + 50)));
    return rows.filter(v => videoMetadata(v, c.records[v.id] ?? null).index).map(v => ({ id: v.id, modifiedAt: c.records[v.id].labelPublishedAt ?? c.records[v.id].firstSavedAt ?? c.records[v.id].firstRankedAt }));
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
  return { detail, account, tag, indexable, publish, saved, inspect, status, candidates, autoPage, autoPublish };
}
