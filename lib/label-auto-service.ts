import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { acquirePublicOperation } from "./public-operation-lock";
import { predictLabels, validFeatures } from "./label-learning-core";
import type { LabelState } from "./label-learning-service";
import { publicPostId, type PublicLabel } from "./public-video-core";

type Candidate = { id: string; handle: string | null; videoUrl: string; sourceHash: string };
type Page = { items: Candidate[]; nextCursor: string | null; upper: string | null; done: boolean; scanned: number; protected: number; already: number; unavailable: number };
type Counts = { scanned: number; processed: number; published: number; protected: number; already: number; unavailable: number; emptyLabels: number; failed: number };
type Pending = { id: string; sourceHash: string; labelIds: string[] };
type Job = { version: 1; revision: number; id: string; phase: "running" | "paused" | "blocked" | "completed"; model: string; stamp: string; threshold: number; cursor: string | null; upper: string | null; page: Page | null; pending: Pending | null; counts: Counts; lastErrors: { id: string; code: string }[]; message: string | null; startedAt: string; updatedAt: string };
type Snapshot = { state: LabelState; stamp: string };
export type AutoLabelDeps = { snapshot: () => Promise<Snapshot>; remote: (body: object) => Promise<any>; prepare: (url: string) => Promise<{ features: number[]; frames: Buffer[]; hash: string }> };
const autoRevision = (model: string, threshold: number) => createHash("sha256").update("label-auto-v1:" + model + ":" + threshold).digest("hex");
const hash = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const counter = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 10000000;
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v);
function candidate(v: Candidate) {
  if (!v || !publicPostId(v.id) || !hash(v.sourceHash) || (v.handle !== null && (typeof v.handle !== "string" || v.handle.length > 100))) return false;
  try { const u = new URL(v.videoUrl); return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && (u.hostname === "video.twimg.com" || u.hostname.endsWith(".video.twimg.com")); } catch { return false; }
}
function pageValid(p: Page) {
  return p && Array.isArray(p.items) && p.items.length <= 50 && p.items.every(candidate) && new Set(p.items.map(v => v.id)).size === p.items.length && (p.nextCursor === null || publicPostId(p.nextCursor)) && (p.upper === null || publicPostId(p.upper)) && typeof p.done === "boolean" && [p.scanned, p.protected, p.already, p.unavailable].every(counter) && p.scanned <= 50 && p.protected + p.already + p.unavailable + p.items.length <= p.scanned && (p.done || p.nextCursor !== null);
}
export function createAutoLabels(directory: string, deps: AutoLabelDeps) {
  const root = path.resolve(directory), file = path.join(root, "job.json"), lockFile = path.join(root, "operation.lock");
  async function safe() { for (const p of [path.dirname(root), root]) { try { const s = await fs.lstat(p); if (!s.isDirectory() || s.isSymbolicLink()) throw Error("LABEL_AUTO_UNSAFE"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } } }
  async function read(): Promise<Job | null> {
    await safe();
    try {
      const s = await fs.lstat(file); if (!s.isFile() || s.isSymbolicLink() || s.size > 1024 * 1024) throw Error("LABEL_AUTO_UNSAFE");
      const j = JSON.parse(await fs.readFile(file, "utf8")) as Job;
      if (j.version !== 1 || !counter(j.revision) || !uuid(j.id) || !["running", "paused", "blocked", "completed"].includes(j.phase) || !hash(j.model) || !hash(j.stamp) || ![0.5, 0.7, 0.9].includes(j.threshold) || (j.cursor !== null && !publicPostId(j.cursor)) || (j.upper !== null && !publicPostId(j.upper)) || (j.page !== null && !pageValid(j.page)) || !j.counts || Object.keys(j.counts).sort().join() !== "already,emptyLabels,failed,processed,protected,published,scanned,unavailable" || !Object.values(j.counts).every(counter) || !Array.isArray(j.lastErrors) || j.lastErrors.length > 20 || j.lastErrors.some(x => !publicPostId(x.id) || !/^[A-Z_]{1,80}$/.test(x.code)) || (j.message !== null && !/^[A-Z_]{1,80}$/.test(j.message)) || !Number.isFinite(Date.parse(j.startedAt)) || !Number.isFinite(Date.parse(j.updatedAt))) throw Error("LABEL_AUTO_CORRUPT");
      if (j.pending && (!j.page?.items.some(v => v.id === j.pending!.id && v.sourceHash === j.pending!.sourceHash) || !Array.isArray(j.pending.labelIds) || j.pending.labelIds.length > 40 || j.pending.labelIds.some(id => !uuid(id)) || new Set(j.pending.labelIds).size !== j.pending.labelIds.length)) throw Error("LABEL_AUTO_CORRUPT");
      return j;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw Error("LABEL_AUTO_UNREADABLE"); }
  }
  async function save(j: Job) { j.updatedAt = new Date().toISOString(); const tmp = path.join(root, ".job-" + randomUUID()); try { await fs.writeFile(tmp, JSON.stringify(j), { flag: "wx", mode: 0o600 }); await fs.rename(tmp, file); } finally { await fs.unlink(tmp).catch(() => undefined); } }
  const view = (j: Job | null) => j ? { revision: j.revision, phase: j.phase, threshold: j.threshold, counts: j.counts, current: j.page?.items[0] ? { id: j.page.items[0].id, handle: j.page.items[0].handle } : null, pendingPublication: Boolean(j.pending), lastErrors: j.lastErrors, message: j.message, startedAt: j.startedAt, updatedAt: j.updatedAt } : { revision: 0, phase: "idle" as const, threshold: 0.7, counts: { scanned: 0, processed: 0, published: 0, protected: 0, already: 0, unavailable: 0, emptyLabels: 0, failed: 0 }, current: null, pendingPublication: false, lastErrors: [], message: null, startedAt: null, updatedAt: null };
  async function status() { return view(await read()); }
  function finishItem(j: Job) {
    j.pending = null; j.page!.items.shift();
    if (!j.page!.items.length) { j.cursor = j.page!.nextCursor; j.upper = j.page!.upper; if (j.page!.done) j.phase = "completed"; j.page = null; }
  }
  async function mutate(body: Record<string, unknown>) {
    await safe(); await fs.mkdir(root, { recursive: true, mode: 0o700 }); await safe(); const lock = await acquirePublicOperation(lockFile, "LABEL_AUTO_BUSY");
    try {
      let j = await read(); if (body.revision !== (j?.revision ?? 0)) throw Error("LABEL_AUTO_STALE");
      if (body.action === "pause") { if (j && j.phase === "running") { j.phase = "paused"; j.revision++; await save(j); } return view(j); }
      if (!["start", "new", "step"].includes(String(body.action))) throw Error("LABEL_AUTO_INVALID_ACTION");
      if (body.action === "step" && (!j || j.phase !== "running")) return view(j);
      const snap = await deps.snapshot(), model = snap.state.model;
      if (!model || model.head.samples < 100 || !model.head.heads.some(h => h.weights) || !hash(model.fingerprint) || !hash(snap.stamp)) throw Error("LABEL_AUTO_MODEL_NOT_READY");
      if (body.action === "start" || body.action === "new") {
        if (j && body.action !== "new" && (j.model !== model.fingerprint || j.stamp !== snap.stamp)) throw Error("LABEL_AUTO_MODEL_CHANGED");
        const remote = await deps.remote({ action: "status" }); if (remote.automaticLabelsVersion !== 1) throw Error("LABEL_AUTO_DEPLOY_FIRST");
        if (!j || body.action === "new") {
          const threshold = body.threshold ?? 0.7; if (![0.5, 0.7, 0.9].includes(threshold as number)) throw Error("LABEL_AUTO_INVALID_INPUT");
          if (j) await fs.writeFile(path.join(root, "previous-" + j.id + ".json"), JSON.stringify(j), { flag: "wx", mode: 0o600 });
          j = { version: 1, revision: (j?.revision ?? 0) + 1, id: randomUUID(), phase: "running", model: model.fingerprint, stamp: snap.stamp, threshold: threshold as number, cursor: null, upper: null, page: null, pending: null, counts: { scanned: 0, processed: 0, published: 0, protected: 0, already: 0, unavailable: 0, emptyLabels: 0, failed: 0 }, lastErrors: [], message: null, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        } else { if (j.phase === "completed") return view(j); j.phase = "running"; j.message = null; j.revision++; }
        await save(j); return view(j);
      }
      if (!j) throw Error("LABEL_AUTO_NOT_STARTED");
      if (j.model !== model.fingerprint || j.stamp !== snap.stamp) { j.phase = "blocked"; j.message = "MODEL_CHANGED"; j.revision++; await save(j); return view(j); }
      try {
        if (!j.page) {
          const p = await deps.remote({ action: "auto-page", cursor: j.cursor, upper: j.upper, modelRevision: autoRevision(j.model, j.threshold) }) as Page;
          if (!pageValid(p) || (!p.done && p.nextCursor === j.cursor) || (j.upper !== null && p.upper !== j.upper)) throw Error("LABEL_AUTO_PAGE_INVALID");
          const manualIds = new Set(snap.state.videos.filter(v => v.review).map(v => v.postId));
          const unprotected = p.items.filter(v => !manualIds.has(v.id)); p.protected += p.items.length - unprotected.length; p.items = unprotected;
          j.page = p; j.upper = p.upper; j.counts.scanned += p.scanned; j.counts.protected += p.protected; j.counts.already += p.already; j.counts.unavailable += p.unavailable; j.revision++; await save(j);
          if (!p.items.length) { j.cursor = p.nextCursor; if (p.done) j.phase = "completed"; j.page = null; j.revision++; await save(j); return view(j); }
        }
        const video = j.page.items[0];
        if (!j.pending) {
          try {
            const prepared = await deps.prepare(video.videoUrl); if (!validFeatures(prepared.features) || prepared.frames.length !== 4 || !hash(prepared.hash)) throw Error("LABEL_AUTO_INVALID_FEATURES");
            if ((await deps.snapshot()).stamp !== j.stamp) throw Error("LABEL_AUTO_MODEL_CHANGED");
            const active = new Set(snap.state.labels.filter(l => l.active).map(l => l.id));
            j.pending = { id: video.id, sourceHash: video.sourceHash, labelIds: predictLabels(model.head, prepared.features).filter(p => active.has(p.id) && p.score !== null && p.score >= j!.threshold).map(p => p.id) };
            j.revision++; await save(j); // Publication retries reuse predictions; never re-download after a lost response.
          } catch (e) {
            const code = e instanceof Error && /^[A-Z_]{1,80}$/.test(e.message) ? e.message : "VIDEO_PROCESS_FAILED";
            if (["LABEL_VIDEO_TOOLS_MISSING", "LABEL_AUTO_MODEL_CHANGED", "LABEL_AUTO_INVALID_FEATURES"].includes(code)) throw e;
            j.counts.failed++; j.counts.processed++; j.lastErrors = [...j.lastErrors, { id: video.id, code }].slice(-20); finishItem(j); j.revision++; await save(j); return view(j);
          }
        }
        if ((await deps.snapshot()).stamp !== j.stamp) throw Error("LABEL_AUTO_MODEL_CHANGED");
        const result = await deps.remote({ action: "auto-publish", input: { labels: snap.state.labels.map(l => ({ id: l.id, name: l.name, active: l.active })) as PublicLabel[], modelRevision: autoRevision(j.model, j.threshold), post: j.pending } });
        if (!["published", "protected", "unavailable"].includes(result?.result)) throw Error("LABEL_AUTO_REMOTE_INVALID");
        if (result.result === "published") { j.counts.published++; if (!j.pending.labelIds.length) j.counts.emptyLabels++; }
        else if (result.result === "protected") j.counts.protected++; else j.counts.unavailable++;
        j.counts.processed++; finishItem(j); j.revision++; await save(j); return view(j);
      } catch (e) {
        const code = e instanceof Error && /^[A-Z_]{1,80}$/.test(e.message) ? e.message : "LABEL_AUTO_PROCESS_FAILED";
        j.phase = code.includes("MODEL") || code.includes("TOOLS") || code.includes("INVALID") || code.includes("UNREADABLE") ? "blocked" : "paused";
        j.message = code; j.revision++; await save(j); return view(j);
      }
    } finally { await lock.release(); }
  }
  return { status, mutate };
}
