import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { crossCheckLabels, Decisions, fitLabels, LabelDefinition, LabelModel, LabelSample, LABEL_FEATURE_SPEC, predictLabels, scoreLabels, validFeatures } from "./label-learning-core";
export type LabelCandidate = { postId: string; author: string | null; authorKey?: string | null; url: string };
type Review = { decisions: Decisions; role: "train" | "test"; blinded: boolean };
type Video = LabelCandidate & { hash: string; features: number[]; times: number[]; review: Review | null; predictionSeen: boolean; prediction: ReturnType<typeof predictLabels> | null };
type Bundle = { id: string; fingerprint: string; trainedAt: string; head: LabelModel; crossCheck: ReturnType<typeof crossCheckLabels> };
export type LabelState = { version: 1; revision: number; labels: LabelDefinition[]; videos: Video[]; attempted: string[]; everTrained: string[]; everTrainedAuthors: string[]; model: Bundle | null; testReport: ReturnType<typeof scoreLabels> | null };
export type LabelDeps = { candidates: () => Promise<LabelCandidate[]>; find: (id: string) => Promise<LabelCandidate | null>; prepare: (url: string) => Promise<{ frames: Buffer[]; features: number[]; times: number[]; hash: string }> };
const uuid = /^[a-f0-9-]{36}$/, post = /^[0-9]{1,25}$/, sha = /^[a-f0-9]{64}$/;
const initial = (): LabelState => ({ version: 1, revision: 0, labels: [], videos: [], attempted: [], everTrained: [], everTrainedAuthors: [], model: null, testReport: null });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(code: string): never { throw Error(code); }
function validCandidate(c: LabelCandidate) { return post.test(c.postId) && (c.author === null || typeof c.author === "string") && typeof c.url === "string"; }
function validate(s: LabelState) {
  if (!s || s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Array.isArray(s.labels) || s.labels.length > 40 || !Array.isArray(s.videos) || s.videos.length > 300 || !Array.isArray(s.attempted) || s.attempted.length > 2000 || !s.attempted.every(v => post.test(v)) || !Array.isArray(s.everTrained) || !s.everTrained.every(v => sha.test(v)) || !Array.isArray(s.everTrainedAuthors) || !s.everTrainedAuthors.every(v => typeof v === "string")) fail("LABEL_STATE_CORRUPT");
  const ids = new Set<string>(), names = new Set<string>(), posts = new Set<string>();
  for (const l of s.labels) { if (!l || !uuid.test(l.id) || typeof l.name !== "string" || !l.name.trim() || l.name.length > 40 || typeof l.active !== "boolean" || ids.has(l.id) || names.has(l.name)) fail("LABEL_STATE_CORRUPT"); ids.add(l.id); names.add(l.name); }
  for (const v of s.videos) {
    if (!v || !validCandidate(v) || posts.has(v.postId) || !sha.test(v.hash) || !validFeatures(v.features) || !Array.isArray(v.times) || v.times.length !== 4 || !v.times.every(t => Number.isFinite(t) && t >= 0) || typeof v.predictionSeen !== "boolean") fail("LABEL_STATE_CORRUPT"); posts.add(v.postId);
    if (v.review && (!["train", "test"].includes(v.review.role) || typeof v.review.blinded !== "boolean" || !v.review.decisions || typeof v.review.decisions !== "object" || Array.isArray(v.review.decisions) || Object.entries(v.review.decisions).some(([k, value]) => !ids.has(k) || (value !== null && typeof value !== "boolean")))) fail("LABEL_STATE_CORRUPT");
  }
  if (s.model) {
    const m = s.model.head;
    if (!uuid.test(s.model.id) || !sha.test(s.model.fingerprint) || !m || m.spec !== LABEL_FEATURE_SPEC || !validFeatures(m.mean) || !validFeatures(m.scale) || m.scale.some(v => v <= 0) || !Array.isArray(m.heads) || m.heads.some(h => !ids.has(h.id) || !Number.isFinite(h.bias) || (h.weights !== null && !validFeatures(h.weights)))) fail("LABEL_STATE_CORRUPT");
  }
}
function authorKey(v: LabelCandidate) { return v.authorKey ?? v.author?.toLowerCase() ?? null; }
function asSample(v: Video): LabelSample { return { postId: v.postId, hash: v.hash, author: authorKey(v), features: v.features, decisions: v.review!.decisions }; }
function training(s: LabelState) { return s.videos.filter(v => v.review?.role === "train" && Object.values(v.review.decisions).some(v => typeof v === "boolean")).map(asSample); }
function fingerprint(s: LabelState) { return hash({ labels: s.labels.filter(l => l.active), samples: training(s) }); }
export function createLabelService(root: string, deps: LabelDeps) {
  const directory = path.resolve(root), stateFile = path.join(directory, "state.json"), lockFile = path.join(directory, "mutation.lock");
  async function parentSafe() { try { const stat = await lstat(path.dirname(directory)); if (stat.isSymbolicLink() || !stat.isDirectory()) fail("LABEL_UNSAFE_FILE"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
  async function regular(file: string, optional = true) {
    try { const stat = await lstat(file); if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 20 * 1024 * 1024) fail("LABEL_UNSAFE_FILE"); }
    catch (e) { if (optional && (e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  }
  async function folder(file: string) { await parentSafe(); await mkdir(file, { recursive: true, mode: 0o700 }); const stat = await lstat(file); if (stat.isSymbolicLink() || !stat.isDirectory()) fail("LABEL_UNSAFE_FILE"); }
  async function read(): Promise<LabelState> {
    // GET on a new installation does not create state or contact the DB.
    try { await parentSafe(); const stat = await lstat(directory); if (stat.isSymbolicLink() || !stat.isDirectory()) fail("LABEL_UNSAFE_FILE"); await regular(stateFile, false); const s = JSON.parse(await readFile(stateFile, "utf8")) as LabelState; validate(s); return s; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return initial(); if (e instanceof SyntaxError) fail("LABEL_STATE_CORRUPT"); throw e; }
  }
  async function save(s: LabelState) {
    validate(s); const text = JSON.stringify(s); if (Buffer.byteLength(text) > 20 * 1024 * 1024) fail("LABEL_STATE_FULL");
    await regular(stateFile); const temp = path.join(directory, ".state-" + randomUUID() + ".tmp");
    try { await writeFile(temp, text, { flag: "wx", mode: 0o600 }); await rename(temp, stateFile); } finally { await unlink(temp).catch(() => undefined); }
  }
  async function locked<T>(work: () => Promise<T>): Promise<T> {
    await folder(directory); let lock;
    try { lock = await open(lockFile, "wx", 0o600); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      await regular(lockFile, false);
      let pid: number; try { pid = JSON.parse(await readFile(lockFile, "utf8")).pid; } catch { return fail("LABEL_BUSY"); }
      if (!Number.isSafeInteger(pid) || pid <= 0) return fail("LABEL_BUSY");
      try { process.kill(pid, 0); return fail("LABEL_BUSY"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return fail("LABEL_BUSY"); }
      await unlink(lockFile); try { lock = await open(lockFile, "wx", 0o600); } catch { return fail("LABEL_BUSY"); }
    }
    try { await lock.writeFile(JSON.stringify({ pid: process.pid })); return await work(); } finally { await lock.close(); await unlink(lockFile); }
  }
  function summary(s: LabelState) {
    const stale = Boolean(s.model && s.model.fingerprint !== fingerprint(s));
    return { revision: s.revision, labels: s.labels, videos: s.videos.map(v => ({ postId: v.postId, author: v.author, times: v.times, review: v.review, prediction: stale ? null : v.prediction, everTrained: s.everTrained.includes(v.hash) || s.everTrainedAuthors.includes(authorKey(v) ?? ""), frames: v.times.map((_, i) => `/api/label-learning/frame?postId=${v.postId}&index=${i}`) })),
      trainingCount: training(s).length, model: s.model ? { id: s.model.id, trainedAt: s.model.trainedAt, samples: s.model.head.samples, stale, heads: s.model.head.heads.map(({ weights: _weights, bias: _bias, ...h }) => ({ ...h, ready: Boolean(_weights) })), crossCheck: s.model.crossCheck } : null, testReport: stale ? null : s.testReport };
  }
  async function frame(postId: string, index: number) {
    if (!post.test(postId) || !Number.isInteger(index) || index < 0 || index > 3) fail("LABEL_INVALID_INPUT");
    const s = await read(), v = s.videos.find(v => v.postId === postId); if (!v) fail("LABEL_VIDEO_NOT_FOUND");
    const frames = path.join(directory, "frames"); const stat = await lstat(frames); if (stat.isSymbolicLink() || !stat.isDirectory()) fail("LABEL_UNSAFE_FILE");
    const file = path.join(frames, `${v.postId}-${v.hash}-${index}.jpg`); await regular(file, false); const bytes = await readFile(file); if (bytes.length > 1024 * 1024) fail("LABEL_UNSAFE_FILE"); return bytes;
  }
  async function mutate(body: Record<string, unknown>) {
    return locked(async () => {
      const s = await read(); if (body.revision !== s.revision) fail("LABEL_STALE_SCREEN");
      const id = typeof body.id === "string" ? body.id : "";
      if (body.action === "create-label" || body.action === "edit-label") {
        const name = typeof body.name === "string" ? body.name.normalize("NFC").trim() : "";
        if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) fail("LABEL_INVALID_NAME");
        if (s.labels.some(l => l.id !== id && l.name === name)) fail("LABEL_DUPLICATE_NAME");
        if (body.action === "create-label") { if (s.labels.length >= 40) fail("LABEL_LABEL_LIMIT"); s.labels.push({ id: randomUUID(), name, active: true }); }
        else { const l = s.labels.find(l => l.id === id); if (!l || typeof body.active !== "boolean") fail("LABEL_INVALID_INPUT"); l.name = name; l.active = body.active; }
      } else if (body.action === "prepare") {
        if (!s.labels.some(l => l.active)) fail("LABEL_CREATE_FIRST");
        if (s.videos.length >= 300) fail("LABEL_VIDEO_LIMIT");
        let candidate: LabelCandidate | null;
        if (body.postId !== undefined) { if (typeof body.postId !== "string" || !post.test(body.postId)) fail("LABEL_INVALID_INPUT"); candidate = await deps.find(body.postId); }
        else {
          const candidates = await deps.candidates();
          const available = candidates.filter(c => validCandidate(c) && !s.videos.some(v => v.postId === c.postId) && !s.attempted.includes(c.postId));
          const authors = new Set(s.videos.map(v => v.author));
          const pool = available.filter(c => !authors.has(c.author)); candidate = (pool.length ? pool : available)[0] ?? null;
        }
        if (!candidate || !validCandidate(candidate)) fail("LABEL_NO_CANDIDATES");
        if (s.videos.some(v => v.postId === candidate!.postId)) fail("LABEL_ALREADY_PREPARED");
        // Store a bounded attempt receipt even on download failure, so a batch advances.
        if (!s.attempted.includes(candidate.postId)) s.attempted.push(candidate.postId); if (s.attempted.length > 2000) s.attempted.shift();
        try {
          const prepared = await deps.prepare(candidate.url);
          if (!validFeatures(prepared.features) || !sha.test(prepared.hash) || prepared.frames.length !== 4 || prepared.times.length !== 4 || !prepared.times.every(t => Number.isFinite(t) && t >= 0) || prepared.frames.some(f => f.length > 1024 * 1024 || f.length < 2 || f[0] !== 0xff || f[1] !== 0xd8)) fail("LABEL_INVALID_FRAMES");
          if (s.videos.some(v => v.hash === prepared.hash)) fail("LABEL_DUPLICATE_VIDEO");
          const current = await deps.find(candidate.postId); if (!current || current.url !== candidate.url) fail("LABEL_SOURCE_CHANGED");
          const folderPath = path.join(directory, "frames"); await folder(folderPath);
          for (let i = 0; i < 4; i++) {
            const p = path.join(folderPath, `${candidate.postId}-${prepared.hash}-${i}.jpg`); await regular(p);
            try { await writeFile(p, prepared.frames[i], { flag: "wx", mode: 0o600 }); }
            catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; if (!prepared.frames[i].equals(await readFile(p))) fail("LABEL_FRAME_CONFLICT"); }
          }
          s.videos.push({ ...candidate, ...prepared, review: null, predictionSeen: false, prediction: null } as Video);
          // Frames are files, never Base64 in status or model JSON.
          delete (s.videos.at(-1) as Video & { frames?: Buffer[] }).frames;
        } catch (e) { s.revision++; await save(s); throw e; }
      } else if (body.action === "review") {
        const v = s.videos.find(v => v.postId === body.postId); if (!v || !["train", "test"].includes(String(body.role))) fail("LABEL_INVALID_INPUT");
        const values = body.decisions; if (!values || typeof values !== "object" || Array.isArray(values)) fail("LABEL_INVALID_INPUT");
        const decisions: Decisions = {};
        for (const l of s.labels) {
          const value = (values as Decisions)[l.id]; if (value !== undefined && value !== null && typeof value !== "boolean") fail("LABEL_INVALID_INPUT");
          decisions[l.id] = value === undefined ? null : value;
        }
        if (Object.keys(values).some(id => !s.labels.some(l => l.id === id)) || !Object.values(decisions).some(v => typeof v === "boolean")) fail("LABEL_INVALID_INPUT");
        v.review = { decisions, role: body.role as "train" | "test", blinded: !v.predictionSeen }; s.testReport = null;
      } else if (body.action === "train") {
        const samples = training(s); if (new Set(samples.map(x => x.hash)).size < 10) fail("LABEL_NEEDS_TEN");
        const ids = s.labels.filter(l => l.active).map(l => l.id), head = fitLabels(samples, ids);
        if (!head.heads.some(h => h.weights)) fail("LABEL_EXAMPLES_MISSING");
        s.model = { id: randomUUID(), fingerprint: fingerprint(s), trainedAt: new Date().toISOString(), head, crossCheck: crossCheckLabels(samples, ids) };
        s.everTrained = [...new Set([...s.everTrained, ...samples.map(s => s.hash)])];
        s.everTrainedAuthors = [...new Set([...s.everTrainedAuthors, ...samples.flatMap(s => s.author ? [s.author] : [])])]; s.testReport = null;
        for (const v of s.videos) v.prediction = null;
      } else if (body.action === "predict" || body.action === "check") {
        if (!s.model || s.model.fingerprint !== fingerprint(s)) fail("LABEL_RETRAIN_REQUIRED");
        if (body.action === "predict") {
          const v = s.videos.find(v => v.postId === body.postId); if (!v) fail("LABEL_VIDEO_NOT_FOUND");
          v.prediction = predictLabels(s.model.head, v.features); v.predictionSeen = true;
        } else {
          const videos = s.videos.filter(v => v.review?.role === "test" && v.review.blinded && !s.everTrained.includes(v.hash) && !s.everTrainedAuthors.includes(authorKey(v) ?? ""));
          if (!videos.length) fail("LABEL_BLIND_TEST_NEEDED");
          s.testReport = scoreLabels(videos.map(v => ({ sample: asSample(v), predictions: predictLabels(s.model!.head, v.features) })), s.model.head.heads.map(h => h.id));
          for (const v of videos) { v.prediction = predictLabels(s.model.head, v.features); v.predictionSeen = true; }
        }
      } else fail("LABEL_INVALID_ACTION");
      s.revision++; await save(s); return summary(s);
    });
  }
  return { status: async () => summary(await read()), mutate, frame };
}
