import { validStoredVideoTechnical, validVideoTechnical, type VideoTechnical } from "./video-technical";
import { acquirePublicOperation } from "./public-operation-lock";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { blankCatalog, blankRecord, labelDefinition, publicPostId, type PublicCatalog, type PublicLabel } from "./public-video-core";
const MAX_RECORDS = 100000, MAX_BYTES = 64 * 1024 * 1024;
// Cache validated ledger bytes, never publication permissions. Every read still
// checks the actual file identity; callers receive independent mutable copies.
const snapshots = new Map<string, { stamp: string; value: PublicCatalog }>();
const stamp = (s: import("node:fs").BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
const iso = (s: unknown) => typeof s === "string" && /^\d{4}-\d\d-\d\dT/.test(s) && Number.isFinite(Date.parse(s));
function validate(c: PublicCatalog) {
  if (!c || c.version !== 1 || !Number.isSafeInteger(c.revision) || c.revision < 0 || !Array.isArray(c.labels) || c.labels.length > 40 || !c.labels.every(labelDefinition) || new Set(c.labels.map(l => l.id)).size !== c.labels.length || new Set(c.labels.map(l => l.name)).size !== c.labels.length || !c.records || typeof c.records !== "object" || Array.isArray(c.records) || Object.keys(c.records).length > MAX_RECORDS) throw Error("PUBLIC_CATALOG_CORRUPT");
  const ids = new Set(c.labels.map(l => l.id));
  for (const [id, r] of Object.entries(c.records)) {
    if (!publicPostId(id) || !r || (r.technical !== undefined && !validStoredVideoTechnical(r.technical)) || r.id !== id || !Array.isArray(r.labelIds) || r.labelIds.length > 40 || new Set(r.labelIds).size !== r.labelIds.length || r.labelIds.some(l => !ids.has(l)) || ![null, "manual", "model_reviewed", "model_auto"].includes(r.basis) || (r.modelRevision !== null && !/^[a-f0-9]{64}$/.test(r.modelRevision)) || (r.sourceHash !== null && !/^[a-f0-9]{64}$/.test(r.sourceHash)) || (r.labelPublishedAt !== null && !iso(r.labelPublishedAt)) || !Number.isSafeInteger(r.saves) || r.saves < 0 || (r.firstSavedAt !== null && !iso(r.firstSavedAt)) || (r.saves > 0 && !r.firstSavedAt) || (r.saves === 0 && r.firstSavedAt !== null) || (r.firstRankedAt !== null && !iso(r.firstRankedAt)) || !Array.isArray(r.receipts) || r.receipts.length > 128 || r.receipts.some(t => !/^[a-f0-9-]{36}$/.test(t.id) || !Number.isFinite(t.expires))) throw Error("PUBLIC_CATALOG_CORRUPT");
  }
}
export function createPublicCatalog(directory: string) {
  const root = path.resolve(directory), file = path.join(root, "catalog.json"), lockFile = path.join(root, "catalog.lock");
  const cwd = path.resolve(process.cwd()); if (root === cwd || root.startsWith(cwd + path.sep)) throw Error("PUBLIC_CATALOG_NEEDS_DURABLE_DIRECTORY");
  async function safeParents() {
    let p = root;
    while (true) { try { const s = await fs.lstat(p); if (!s.isDirectory() || s.isSymbolicLink()) throw Error("PUBLIC_CATALOG_UNSAFE"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const next = path.dirname(p); if (next === p) break; p = next;
    }
  }
  async function regular(p: string, max: number) { const s = await fs.lstat(p); if (!s.isFile() || s.isSymbolicLink() || s.size > max) throw Error("PUBLIC_CATALOG_UNSAFE"); }
  async function readSnapshot(): Promise<PublicCatalog> {
    await safeParents();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await fs.lstat(file, { bigint: true });
        if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_BYTES)) throw Error("PUBLIC_CATALOG_UNSAFE");
        const key = stamp(before), cached = snapshots.get(file);
        if (cached?.stamp === key) return cached.value;
        const c = JSON.parse(await fs.readFile(file, "utf8")) as PublicCatalog; validate(c);
        const after = await fs.lstat(file, { bigint: true });
        if (stamp(after) !== key) continue;
        if (before.size <= BigInt(8 * 1024 * 1024)) {
          snapshots.delete(file); snapshots.set(file, { stamp: key, value: c });
          while (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value!);
          return c;
        }
        return c;
      }
      throw Error("PUBLIC_CATALOG_CHANGED_DURING_READ");
    } catch (e) {
      snapshots.delete(file);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return blankCatalog();
      throw Error("PUBLIC_CATALOG_UNREADABLE");
    }
  }
  async function read(): Promise<PublicCatalog> { return structuredClone(await readSnapshot()); }
  // A detail page needs one record, not a clone of every video's ledger entry.
  async function readForIds(ids: string[]): Promise<PublicCatalog> {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !publicPostId(id))) throw Error("PUBLIC_INVALID_INPUT");
    const snapshot = await readSnapshot();
    return { version: 1, revision: snapshot.revision, labels: structuredClone(snapshot.labels),
      records: Object.fromEntries([...new Set(ids)].filter(id => snapshot.records[id]).map(id => [id, structuredClone(snapshot.records[id])])) };
  }
  async function mutate(work: (c: PublicCatalog) => boolean) {
    await safeParents(); await fs.mkdir(root, { recursive: true, mode: 0o700 }); await safeParents();
    const lock = await acquirePublicOperation(lockFile, "PUBLIC_CATALOG_BUSY");
    try {
      const c = await read();
      if (work(c)) {
        c.revision++; validate(c); const text = JSON.stringify(c); if (Buffer.byteLength(text) > MAX_BYTES) throw Error("PUBLIC_CATALOG_FULL");
        const temp = path.join(root, ".catalog-" + randomUUID() + ".tmp");
        try { await fs.writeFile(temp, text, { flag: "wx", mode: 0o600 }); await fs.rename(temp, file); snapshots.delete(file); } finally { await fs.unlink(temp).catch(() => undefined); }
      }
      return c;
    } finally { await lock.release(); }
  }
  function record(c: PublicCatalog, id: string) { if (!publicPostId(id)) throw Error("PUBLIC_INVALID_ID"); if (!c.records[id]) { if (Object.keys(c.records).length >= MAX_RECORDS) throw Error("PUBLIC_CATALOG_FULL"); c.records[id] = blankRecord(id); } return c.records[id]; }
  async function ranked(ids: string[], at: string) {
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => !publicPostId(id)) || !iso(at)) throw Error("PUBLIC_INVALID_INPUT");
    // Most page views only repeat known history. Avoid taking the writer lock
    // and rereading the whole ledger when there is nothing to record.
    const current = await read();
    if (ids.every(id => current.records[id]?.firstRankedAt)) return current;
    return mutate(c => { let changed = false; for (const id of new Set(ids)) { const r = record(c, id); if (!r.firstRankedAt) { r.firstRankedAt = at; changed = true; } } return changed; });
  }
  async function saved(id: string, receipt: { id: string; expires: number }, now = Date.now()) {
    if (!publicPostId(id) || !/^[a-f0-9-]{36}$/.test(receipt.id) || receipt.expires <= now || receipt.expires > now + 11 * 60 * 1000) throw Error("PUBLIC_INVALID_RECEIPT");
    return mutate(c => { const r = record(c, id); if (r.receipts.some(t => t.id === receipt.id)) return false; const used = r.receipts.filter(t => t.expires > now); if (used.length >= 128) throw Error("PUBLIC_RECEIPT_LIMIT"); r.receipts = [...used, receipt]; r.saves++; r.firstSavedAt ??= new Date(now).toISOString(); return true; });
  }
  async function labels(input: { revision: number; labels: PublicLabel[]; posts: { id: string; labelIds: string[]; basis: "manual" | "model_reviewed" | "model_auto"; sourceHash: string; modelRevision: string | null }[] }, now = Date.now()) {
    if (!Array.isArray(input.labels) || input.labels.length > 40 || !input.labels.every(labelDefinition) || new Set(input.labels.map(l => l.id)).size !== input.labels.length || new Set(input.labels.map(l => l.name)).size !== input.labels.length || !Array.isArray(input.posts) || input.posts.length > 100) throw Error("PUBLIC_INVALID_LABELS");
    const permitted = new Set(input.labels.filter(l => l.active).map(l => l.id));
    for (const p of input.posts) if (!publicPostId(p.id) || !/^[a-f0-9]{64}$/.test(p.sourceHash) || !Array.isArray(p.labelIds) || p.labelIds.length > 40 || new Set(p.labelIds).size !== p.labelIds.length || p.labelIds.some(id => !permitted.has(id)) || !["manual", "model_reviewed", "model_auto"].includes(p.basis) || (p.modelRevision !== null && !/^[a-f0-9]{64}$/.test(p.modelRevision))) throw Error("PUBLIC_INVALID_LABELS");
    return mutate(c => {
      if (c.revision !== input.revision) throw Error("PUBLIC_CATALOG_STALE");
      // Automatic predictions never overwrite human decisions, including empty labels.
      const writable = input.posts.filter(p => {
          if (p.basis !== "model_auto") return true;
          const previous = c.records[p.id];
          if (["manual", "model_reviewed"].includes(previous?.basis ?? "")) return false;
          // An uncertain empty prediction must not erase existing, still-active
          // automatic tags for the same media. Checked inside the catalog lock.
          return !(p.labelIds.length === 0 && previous?.sourceHash === p.sourceHash && previous.labelIds.some(id => permitted.has(id)));
        });
      if (!writable.length && input.posts.length) return false;
      // Existing IDs never disappear; inactive definitions remain for old receipts.
      const incoming = new Map(input.labels.map(l => [l.id, l]));
      const retained = c.labels.filter(l => !incoming.has(l.id)).map(l => ({ ...l, active: false }));
      if (retained.length + input.labels.length > 40) throw Error("PUBLIC_LABEL_LIMIT");
      c.labels = [...input.labels.map(l => ({ id: l.id, name: l.name, active: l.active })), ...retained];
      for (const p of writable) { const r = record(c, p.id); r.labelIds = p.labelIds; r.basis = p.basis; r.modelRevision = p.modelRevision; r.sourceHash = p.sourceHash; r.labelPublishedAt = new Date(now).toISOString(); }
      return true;
    });
  }
  async function technical(id: string, sourceHash: string, metadata: VideoTechnical, now = Date.now(), method: "ffprobe-range-v1" | "mp4-range-v1" = "ffprobe-range-v1") {
    if (!publicPostId(id) || !/^[a-f0-9]{64}$/.test(sourceHash) || !validVideoTechnical(metadata)) throw Error("PUBLIC_INVALID_TECHNICAL_METADATA");
    return mutate(c => {
      const r = record(c, id), old = r.technical;
      if (old?.sourceHash === sourceHash) metadata = { ...metadata, ...(metadata.width === undefined && old.width !== undefined ? { width: old.width } : {}), ...(metadata.height === undefined && old.height !== undefined ? { height: old.height } : {}) };
      if (old?.sourceHash === sourceHash && old.durationSeconds === metadata.durationSeconds && old.width === metadata.width && old.height === metadata.height) return false;
      r.technical = { ...metadata, sourceHash, observedAt: new Date(now).toISOString(), method }; return true;
    });
  }
  return { read, readForIds, ranked, saved, labels, technical };
}
