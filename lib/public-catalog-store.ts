import { acquirePublicOperation } from "./public-operation-lock";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { blankCatalog, blankRecord, labelDefinition, publicPostId, type PublicCatalog, type PublicLabel } from "./public-video-core";
const MAX_RECORDS = 25000, MAX_BYTES = 16 * 1024 * 1024;
const iso = (s: unknown) => typeof s === "string" && /^\d{4}-\d\d-\d\dT/.test(s) && Number.isFinite(Date.parse(s));
function validate(c: PublicCatalog) {
  if (!c || c.version !== 1 || !Number.isSafeInteger(c.revision) || c.revision < 0 || !Array.isArray(c.labels) || c.labels.length > 40 || !c.labels.every(labelDefinition) || new Set(c.labels.map(l => l.id)).size !== c.labels.length || new Set(c.labels.map(l => l.name)).size !== c.labels.length || !c.records || typeof c.records !== "object" || Array.isArray(c.records) || Object.keys(c.records).length > MAX_RECORDS) throw Error("PUBLIC_CATALOG_CORRUPT");
  const ids = new Set(c.labels.map(l => l.id));
  for (const [id, r] of Object.entries(c.records)) {
    if (!publicPostId(id) || !r || r.id !== id || !Array.isArray(r.labelIds) || r.labelIds.length > 40 || new Set(r.labelIds).size !== r.labelIds.length || r.labelIds.some(l => !ids.has(l)) || ![null, "manual", "model_reviewed"].includes(r.basis) || (r.modelRevision !== null && !/^[a-f0-9]{64}$/.test(r.modelRevision)) || (r.sourceHash !== null && !/^[a-f0-9]{64}$/.test(r.sourceHash)) || (r.labelPublishedAt !== null && !iso(r.labelPublishedAt)) || !Number.isSafeInteger(r.saves) || r.saves < 0 || (r.firstSavedAt !== null && !iso(r.firstSavedAt)) || (r.saves > 0 && !r.firstSavedAt) || (r.saves === 0 && r.firstSavedAt !== null) || (r.firstRankedAt !== null && !iso(r.firstRankedAt)) || !Array.isArray(r.receipts) || r.receipts.length > 128 || r.receipts.some(t => !/^[a-f0-9-]{36}$/.test(t.id) || !Number.isFinite(t.expires))) throw Error("PUBLIC_CATALOG_CORRUPT");
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
  async function read(): Promise<PublicCatalog> {
    await safeParents();
    try { await regular(file, MAX_BYTES); const c = JSON.parse(await fs.readFile(file, "utf8")) as PublicCatalog; validate(c); return c; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return blankCatalog(); throw Error("PUBLIC_CATALOG_UNREADABLE"); }
  }
  async function mutate(work: (c: PublicCatalog) => boolean) {
    await safeParents(); await fs.mkdir(root, { recursive: true, mode: 0o700 }); await safeParents();
    const lock = await acquirePublicOperation(lockFile, "PUBLIC_CATALOG_BUSY");
    try {
      const c = await read();
      if (work(c)) {
        c.revision++; validate(c); const text = JSON.stringify(c); if (Buffer.byteLength(text) > MAX_BYTES) throw Error("PUBLIC_CATALOG_FULL");
        const temp = path.join(root, ".catalog-" + randomUUID() + ".tmp");
        try { await fs.writeFile(temp, text, { flag: "wx", mode: 0o600 }); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => undefined); }
      }
      return c;
    } finally { await lock.release(); }
  }
  function record(c: PublicCatalog, id: string) { if (!publicPostId(id)) throw Error("PUBLIC_INVALID_ID"); if (!c.records[id]) { if (Object.keys(c.records).length >= MAX_RECORDS) throw Error("PUBLIC_CATALOG_FULL"); c.records[id] = blankRecord(id); } return c.records[id]; }
  async function ranked(ids: string[], at: string) {
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => !publicPostId(id)) || !iso(at)) throw Error("PUBLIC_INVALID_INPUT");
    return mutate(c => { let changed = false; for (const id of new Set(ids)) { const r = record(c, id); if (!r.firstRankedAt) { r.firstRankedAt = at; changed = true; } } return changed; });
  }
  async function saved(id: string, receipt: { id: string; expires: number }, now = Date.now()) {
    if (!publicPostId(id) || !/^[a-f0-9-]{36}$/.test(receipt.id) || receipt.expires <= now || receipt.expires > now + 11 * 60 * 1000) throw Error("PUBLIC_INVALID_RECEIPT");
    return mutate(c => { const r = record(c, id); if (r.receipts.some(t => t.id === receipt.id)) return false; const used = r.receipts.filter(t => t.expires > now); if (used.length >= 128) throw Error("PUBLIC_RECEIPT_LIMIT"); r.receipts = [...used, receipt]; r.saves++; r.firstSavedAt ??= new Date(now).toISOString(); return true; });
  }
  async function labels(input: { revision: number; labels: PublicLabel[]; posts: { id: string; labelIds: string[]; basis: "manual" | "model_reviewed"; sourceHash: string; modelRevision: string | null }[] }, now = Date.now()) {
    if (!Array.isArray(input.labels) || input.labels.length > 40 || !input.labels.every(labelDefinition) || new Set(input.labels.map(l => l.id)).size !== input.labels.length || new Set(input.labels.map(l => l.name)).size !== input.labels.length || !Array.isArray(input.posts) || input.posts.length > 100) throw Error("PUBLIC_INVALID_LABELS");
    const permitted = new Set(input.labels.filter(l => l.active).map(l => l.id));
    for (const p of input.posts) if (!publicPostId(p.id) || !/^[a-f0-9]{64}$/.test(p.sourceHash) || !Array.isArray(p.labelIds) || p.labelIds.length > 40 || new Set(p.labelIds).size !== p.labelIds.length || p.labelIds.some(id => !permitted.has(id)) || !["manual", "model_reviewed"].includes(p.basis) || (p.modelRevision !== null && !/^[a-f0-9]{64}$/.test(p.modelRevision))) throw Error("PUBLIC_INVALID_LABELS");
    return mutate(c => {
      if (c.revision !== input.revision) throw Error("PUBLIC_CATALOG_STALE");
      // Existing IDs never disappear; inactive definitions remain for old receipts.
      const incoming = new Map(input.labels.map(l => [l.id, l]));
      const retained = c.labels.filter(l => !incoming.has(l.id)).map(l => ({ ...l, active: false }));
      if (retained.length + input.labels.length > 40) throw Error("PUBLIC_LABEL_LIMIT");
      c.labels = [...input.labels.map(l => ({ id: l.id, name: l.name, active: l.active })), ...retained];
      for (const p of input.posts) { const r = record(c, p.id); r.labelIds = p.labelIds; r.basis = p.basis; r.modelRevision = p.modelRevision; r.sourceHash = p.sourceHash; r.labelPublishedAt = new Date(now).toISOString(); }
      return true;
    });
  }
  return { read, ranked, saved, labels };
}
