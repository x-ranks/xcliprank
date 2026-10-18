import { acquirePublicOperation } from "./public-operation-lock";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID, randomInt } from "node:crypto";
import { predictLabels, validFeatures } from "./label-learning-core";
import type { LabelState } from "./label-learning-service";
import { publicPostId, type PublicVideo, type PublicLabel } from "./public-video-core";
type QueueRow = { id: string; author: string | null; sourceHash: string; videoHash: string; modelRevision: string; labelIds: string[]; scores: { id: string; score: number | null }[]; origin: "manual" | "inferred"; approved: boolean; published: boolean; error: string | null };
type Queue = { version: 1; revision: number; rows: QueueRow[] };
type Snapshot = { state: LabelState; stamp: string };
type Remote = { featureVersion?: number; revision?: number; labelledPosts?: number };
export type PublicationDeps = { snapshot: () => Promise<Snapshot>; remote: (body: object) => Promise<any>; prepare: (url: string) => Promise<{ frames: Buffer[]; features: number[]; times: number[]; hash: string }> };
export function createLabelPublication(root: string, deps: PublicationDeps) {
  const directory = path.resolve(root), file = path.join(directory, "queue.json"), lockFile = path.join(directory, "mutation.lock");
  let candidates: PublicVideo[] = [];
  async function safeDir(p: string) { try { const st = await fs.lstat(p); if (!st.isDirectory() || st.isSymbolicLink()) throw Error("LABEL_PUBLIC_UNSAFE"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
  async function read(): Promise<Queue> {
    await safeDir(path.dirname(directory)); await safeDir(directory);
    try { const st = await fs.lstat(file); if (!st.isFile() || st.isSymbolicLink() || st.size > 2 * 1024 * 1024) throw Error("LABEL_PUBLIC_UNSAFE");
      const q = JSON.parse(await fs.readFile(file, "utf8")) as Queue;
      if (q.version !== 1 || !Number.isSafeInteger(q.revision) || q.revision < 0 || !Array.isArray(q.rows) || q.rows.length > 200 || new Set(q.rows.map(r => r.id)).size !== q.rows.length || q.rows.some(r => !publicPostId(r.id) || !/^[a-f0-9]{64}$/.test(r.sourceHash) || !/^[a-f0-9]{64}$/.test(r.modelRevision) || !/^[a-f0-9]{64}$/.test(r.videoHash) || !Array.isArray(r.labelIds) || r.labelIds.length > 40 || !r.labelIds.every(id => /^[a-f0-9-]{36}$/.test(id)) || !Array.isArray(r.scores) || r.scores.length > 40 || r.scores.some(p => !/^[a-f0-9-]{36}$/.test(p.id) || (p.score !== null && (!Number.isFinite(p.score) || p.score < 0 || p.score > 1))) || (r.author !== null && (typeof r.author !== "string" || r.author.length > 100)) || (r.error !== null && (typeof r.error !== "string" || r.error.length > 300)) || new Set(r.labelIds).size !== r.labelIds.length || (r.published && !r.approved) || typeof r.approved !== "boolean" || typeof r.published !== "boolean" || !["manual", "inferred"].includes(r.origin))) throw Error("LABEL_PUBLIC_CORRUPT"); return q;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, revision: 0, rows: [] }; throw Error("LABEL_PUBLIC_UNREADABLE"); }
  }
  async function save(q: Queue) { const temp = path.join(directory, ".queue-" + randomUUID() + ".tmp"); try { await fs.writeFile(temp, JSON.stringify(q), { flag: "wx", mode: 0o600 }); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => undefined); } }
  async function lock<T>(work: () => Promise<T>) {
    await safeDir(path.dirname(directory)); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); await safeDir(directory);
    const h = await acquirePublicOperation(lockFile, "LABEL_PUBLIC_BUSY");
    try { return await work(); } finally { await h.release(); }
  }
  function summary(q: Queue, snap: Snapshot) {
    return { revision: q.revision, labels: snap.state.labels, modelSamples: snap.state.model?.head.samples ?? 0, modelRevision: snap.state.model?.fingerprint ?? null, independentTestVideos: snap.state.testReport?.videos ?? 0,
      manualCount: snap.state.videos.filter(v => v.review).length,
      rows: q.rows.map(r => ({ ...r, stale: r.modelRevision !== snap.state.model?.fingerprint, frames: Array.from({ length: 4 }, (_, i) => r.origin === "manual" ? `/api/label-learning/frame?postId=${r.id}&index=${i}` : `/api/label-publication/frame?postId=${r.id}&index=${i}`) })) };
  }
  async function status() { const [q, snap] = await Promise.all([read(), deps.snapshot()]); return summary(q, snap); }
  async function mutate(body: Record<string, unknown>) {
    return lock(async () => {
      const q = await read(); if (body.revision !== q.revision) throw Error("LABEL_PUBLIC_STALE");
      const snap = await deps.snapshot(), model = snap.state.model; if (!model || model.head.samples < 100) throw Error("LABEL_PUBLIC_TRAIN_FIRST");
      const active = snap.state.labels.filter(l => l.active), ids = new Set(active.map(l => l.id));
      if (body.action === "stage-manual") {
        for (const v of snap.state.videos.filter(v => v.review)) {
          const row: QueueRow = { id: v.postId, author: v.author, sourceHash: createHash("sha256").update(v.url).digest("hex"), videoHash: v.hash, modelRevision: model.fingerprint, labelIds: active.filter(l => v.review!.decisions[l.id] === true).map(l => l.id), scores: [], origin: "manual", approved: true, published: false, error: null };
          const at = q.rows.findIndex(r => r.id === v.postId); if (at >= 0) { const previous = q.rows[at]; row.published = previous.published && previous.sourceHash === row.sourceHash && previous.modelRevision === row.modelRevision && JSON.stringify(previous.labelIds) === JSON.stringify(row.labelIds); q.rows[at] = row; } else { if (q.rows.length >= 200) throw Error("LABEL_PUBLIC_QUEUE_FULL"); q.rows.push(row); }
        }
      } else if (body.action === "clear-published") {
        q.rows = q.rows.filter(r => !r.published);
      } else if (body.action === "infer") {
        if (q.rows.length >= 200) throw Error("LABEL_PUBLIC_QUEUE_FULL");
        const preflight = await deps.remote({ action: "status" }) as Remote; if (preflight.featureVersion !== 1) throw Error("LABEL_PUBLIC_DEPLOY_FIRST");
        const excluded = new Set([...q.rows.map(r => r.id), ...snap.state.videos.map(v => v.postId)]);
        let video = candidates.find(v => !excluded.has(v.id));
        if (!video) { candidates = await deps.remote({ action: "candidates", excludeIds: [...excluded] }) as PublicVideo[]; for (let i = candidates.length - 1; i > 0; i--) { const j = randomInt(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; } video = candidates.find(v => v.eligible && !excluded.has(v.id)); }
        if (!video) throw Error("LABEL_PUBLIC_NO_CANDIDATES");
        const prepared = await deps.prepare(video.videoUrl); if (!validFeatures(prepared.features) || !/^[a-f0-9]{64}$/.test(prepared.hash) || prepared.frames.length !== 4 || prepared.frames.some(b => b.length > 1024 * 1024 || b[0] !== 255 || b[1] !== 216)) throw Error("LABEL_PUBLIC_FRAME_FAILED");
        const fresh = await deps.remote({ action: "inspect", ids: [video.id] }) as PublicVideo[];
        if (!fresh.some(v => v.id === video!.id && v.eligible && v.sourceHash === video!.sourceHash) || (await deps.snapshot()).stamp !== snap.stamp) throw Error("LABEL_PUBLIC_SOURCE_CHANGED");
        const predictions = predictLabels(model.head, prepared.features), frameDir = path.join(directory, "frames"); await fs.mkdir(frameDir, { recursive: true, mode: 0o700 }); await safeDir(frameDir);
        for (let i = 0; i < 4; i++) { const name = path.join(frameDir, `${video.id}-${prepared.hash}-${i}.jpg`); try { await fs.writeFile(name, prepared.frames[i], { flag: "wx", mode: 0o600 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; const st = await fs.lstat(name); if (!st.isFile() || st.isSymbolicLink() || !(await fs.readFile(name)).equals(prepared.frames[i])) throw Error("LABEL_PUBLIC_UNSAFE"); } }
        q.rows.push({ id: video.id, author: video.handle, sourceHash: video.sourceHash, videoHash: prepared.hash, modelRevision: model.fingerprint, labelIds: predictions.filter(p => p.score !== null && p.score >= 0.9).map(p => p.id), scores: predictions.map(p => ({ id: p.id, score: p.score })), origin: "inferred", approved: false, published: false, error: null });
      } else if (body.action === "approve") {
        const row = q.rows.find(r => r.id === body.id); if (!row || row.modelRevision !== model.fingerprint || row.published || !Array.isArray(body.labelIds) || body.labelIds.length > 40 || body.labelIds.some(id => typeof id !== "string" || !ids.has(id)) || new Set(body.labelIds).size !== body.labelIds.length) throw Error("LABEL_PUBLIC_INVALID_INPUT");
        row.labelIds = body.labelIds as string[]; row.approved = true; row.error = null;
      } else if (body.action === "publish") {
        const rows = q.rows.filter(r => r.approved && !r.published && r.modelRevision === model.fingerprint).slice(0, 100); if (!rows.length) throw Error("LABEL_PUBLIC_NOTHING_APPROVED");
        const remote = await deps.remote({ action: "status" }) as Remote; if (remote.featureVersion !== 1 || !Number.isSafeInteger(remote.revision)) throw Error("LABEL_PUBLIC_DEPLOY_FIRST");
        const current = await deps.remote({ action: "inspect", ids: rows.map(r => r.id) }) as PublicVideo[];
        const allowed = rows.filter(r => current.some(v => v.id === r.id && v.eligible && v.sourceHash === r.sourceHash));
        for (const r of rows) if (!allowed.includes(r)) { r.approved = false; r.error = "掲載対象外、または動画URLが変わったため反映を見送りました。"; }
        if (allowed.length) {
          if ((await deps.snapshot()).stamp !== snap.stamp) throw Error("LABEL_PUBLIC_SOURCE_CHANGED");
          await deps.remote({ action: "publish", input: { revision: remote.revision, labels: snap.state.labels.map(l => ({ id: l.id, name: l.name, active: l.active })) as PublicLabel[], posts: allowed.map(r => ({ id: r.id, sourceHash: r.sourceHash, labelIds: r.labelIds, basis: r.origin === "manual" ? "manual" : "model_reviewed", modelRevision: r.modelRevision })) } });
          for (const r of allowed) r.published = true;
        }
      } else throw Error("LABEL_PUBLIC_INVALID_ACTION");
      q.revision++; await save(q); return summary(q, snap);
    });
  }
  async function frame(id: string, index: number) {
    if (!publicPostId(id) || !Number.isInteger(index) || index < 0 || index > 3) throw Error("LABEL_PUBLIC_INVALID_INPUT");
    const q = await read(), row = q.rows.find(r => r.id === id && r.origin === "inferred"); if (!row) throw Error("LABEL_PUBLIC_NOT_FOUND");
    const dir = path.join(directory, "frames"); await safeDir(dir); const p = path.join(dir, `${row.id}-${row.videoHash}-${index}.jpg`), st = await fs.lstat(p); if (!st.isFile() || st.isSymbolicLink() || st.size > 1024 * 1024) throw Error("LABEL_PUBLIC_UNSAFE"); return fs.readFile(p);
  }
  return { status, mutate, frame };
}
