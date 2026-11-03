import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquirePublicOperation } from "./public-operation-lock";
import { allowedRangeVideo } from "./video-range-session";
import { validVideoTechnical, type VideoTechnical } from "./video-technical";
type Item = { id: string; sourceHash: string; videoUrl: string };
type Job = { version: 1; cursor: string | null; upper: string | null; page: { items: Item[]; nextCursor: string | null; upper: string | null; done: boolean } | null; pending: { id: string; metadata: VideoTechnical } | null; completed: boolean; published: number; failed: number; unavailable: number; updatedAt: string | null };
const id = (v: unknown) => typeof v === "string" && /^[1-9][0-9]{1,24}$/.test(v);
const initial = (): Job => ({ version: 1, cursor: null, upper: null, page: null, pending: null, completed: false, published: 0, failed: 0, unavailable: 0, updatedAt: null });
export function createTechnicalBackfill(root: string, deps: { remote: (body: object) => Promise<any>; probe: (url: string) => Promise<VideoTechnical | null> }) {
  const dir = path.resolve(root), file = path.join(dir, "job.json");
  async function safe() { for (const at of [path.dirname(dir), dir]) try { const st = await fs.lstat(at); if (!st.isDirectory() || st.isSymbolicLink()) throw Error("TECHNICAL_BACKFILL_UNSAFE"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  function pageValid(page: Job["page"]): boolean { return !!page && Array.isArray(page.items) && page.items.length <= 50 && new Set(page.items.map(item => item.id)).size === page.items.length && page.items.every(item => id(item.id) && /^[a-f0-9]{64}$/.test(item.sourceHash) && allowedRangeVideo(item.videoUrl)) && (page.nextCursor === null || id(page.nextCursor)) && (page.upper === null || id(page.upper)) && typeof page.done === "boolean" && (page.done || page.nextCursor !== null); }
  async function read(): Promise<Job> {
    await safe();
    try { const st = await fs.lstat(file); if (!st.isFile() || st.isSymbolicLink() || st.size > 512 * 1024) throw Error("TECHNICAL_BACKFILL_UNSAFE"); const job = JSON.parse(await fs.readFile(file, "utf8")) as Job;
      if (job.version !== 1 || (job.cursor !== null && !id(job.cursor)) || (job.upper !== null && !id(job.upper)) || (job.page !== null && !pageValid(job.page)) || typeof job.completed !== "boolean" || ![job.published, job.failed, job.unavailable].every(n => Number.isSafeInteger(n) && n >= 0) || (job.pending !== null && (!job.page?.items.some(item => item.id === job.pending!.id) || !validVideoTechnical(job.pending.metadata)))) throw Error("TECHNICAL_BACKFILL_CORRUPT"); return job;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return initial(); throw error; }
  }
  async function save(job: Job) { job.updatedAt = new Date().toISOString(); const temp = path.join(dir, ".job-" + randomUUID()); try { await fs.writeFile(temp, JSON.stringify(job), { flag: "wx", mode: 0o600 }); await fs.rename(temp, file); } finally { await fs.unlink(temp).catch(() => undefined); } }
  const view = (job: Job) => ({ completed: job.completed, published: job.published, failed: job.failed, unavailable: job.unavailable, pendingPublication: !!job.pending, updatedAt: job.updatedAt });
  async function run(limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw Error("TECHNICAL_BACKFILL_INVALID_LIMIT");
    await safe(); await fs.mkdir(dir, { recursive: true, mode: 0o700 }); await safe(); const lock = await acquirePublicOperation(path.join(dir, "operation.lock"), "TECHNICAL_BACKFILL_BUSY");
    try {
      const job = await read(); let processed = 0, pages = 0;
      if (job.completed) return view(job);
      const status = await deps.remote({ action: "status" }); if (status.technicalMetadataVersion !== 1) throw Error("TECHNICAL_BACKFILL_DEPLOY_FIRST");
      while (!job.completed && processed < limit && pages < 10) {
        if (!job.page) {
          const page = await deps.remote({ action: "technical-page", cursor: job.cursor, upper: job.upper }); pages++;
          if (!pageValid(page) || (job.upper !== null && page.upper !== job.upper) || (!page.done && page.nextCursor === job.cursor)) throw Error("TECHNICAL_BACKFILL_INVALID_PAGE"); job.page = page; job.upper = page.upper; await save(job);
        }
        if (!job.page!.items.length) { job.cursor = job.page!.nextCursor; job.completed = job.page!.done; job.page = null; await save(job); continue; }
        const item = job.page!.items[0];
        if (!job.pending) { const metadata = await deps.probe(item.videoUrl).catch(() => null); if (!metadata || !validVideoTechnical(metadata)) { job.failed++; job.page!.items.shift(); processed++; await save(job); continue; } job.pending = { id: item.id, metadata }; await save(job); }
        const result = await deps.remote({ action: "technical-publish", input: { id: item.id, sourceHash: item.sourceHash, metadata: job.pending.metadata } });
        if (result?.result === "published") job.published++; else if (result?.result === "unavailable") job.unavailable++; else throw Error("TECHNICAL_BACKFILL_INVALID_RESULT");
        job.pending = null; job.page!.items.shift(); processed++; await save(job);
      }
      return view(job);
    } finally { await lock.release(); }
  }
  return { status: async () => view(await read()), run };
}
