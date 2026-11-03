import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const RISING_REFRESH_MS = 4 * 60 * 60 * 1000;
const MAX_STALE_MS = 8 * 60 * 60 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const WAIT_MS = 45 * 1000;
const active = new Map<string, Promise<unknown>>();

export function risingBucket(now: number) {
  return Math.floor(now / RISING_REFRESH_MS);
}

type Snapshot<T> = { version: 1; bucket: number; updatedAt: string; value: T };

async function readSnapshot<T>(file: string, valid: (value: unknown) => value is T): Promise<Snapshot<T> | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3_000_000) return null;
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Partial<Snapshot<unknown>>;
    if (row.version !== 1 || !Number.isSafeInteger(row.bucket) ||
      typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt)) ||
      !valid(row.value)) return null;
    return row as Snapshot<T>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function fourHourSnapshot<T>(directory: string, name: string,
  collect: () => Promise<T>, valid: (value: unknown) => value is T,
  now: () => number = Date.now,
  options: { deferRefresh?: (refresh: () => Promise<void>) => void } = {}): Promise<Snapshot<T>> {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error("RISING_SNAPSHOT_NAME_INVALID");
  const file = path.join(directory, `${name}.json`);
  const lock = path.join(directory, `${name}.lock`);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const current = await readSnapshot(file, valid);
  if (current?.bucket === risingBucket(now())) return current;
  // Render a bounded previous snapshot, then refresh after the response. Cron
  // omits this option and still waits for the four-hour collection to finish.
  const age = current ? now() - Date.parse(current.updatedAt) : Infinity;
  if (current && age >= 0 && age < MAX_STALE_MS && options.deferRefresh) {
    options.deferRefresh(async () => {
      try { await fourHourSnapshot(directory, name, collect, valid, now); }
      catch { console.error("RISING_BACKGROUND_REFRESH_FAILED"); }
    });
    return current;
  }
  const running = active.get(file) as Promise<Snapshot<T>> | undefined;
  if (running) return running;
  const refresh = (async () => {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    const deadline = Date.now() + WAIT_MS;
    while (!handle) {
      try { handle = await fs.open(lock, "wx", 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const newer = await readSnapshot(file, valid);
        if (newer?.bucket === risingBucket(now())) return newer;
        const lockStat = await fs.lstat(lock).catch(() => null);
        if (lockStat?.isFile() && !lockStat.isSymbolicLink() && Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(lock).catch(() => undefined);
        }
        if (Date.now() >= deadline) {
          if (current && now() - Date.parse(current.updatedAt) < MAX_STALE_MS) return current;
          throw Error("RISING_REFRESH_BUSY");
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    try {
      const newer = await readSnapshot(file, valid);
      if (newer?.bucket === risingBucket(now())) return newer;
      const value = await collect();
      if (!valid(value)) throw Error("RISING_SNAPSHOT_INVALID");
      const snapshot: Snapshot<T> = { version: 1, bucket: risingBucket(now()),
        updatedAt: new Date(now()).toISOString(), value };
      const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, JSON.stringify(snapshot), { flag: "wx", mode: 0o600 });
        await fs.rename(temp, file);
      } finally { await fs.unlink(temp).catch(() => undefined); }
      return snapshot;
    } catch (error) {
      if (current && now() - Date.parse(current.updatedAt) < MAX_STALE_MS) return current;
      throw error;
    } finally {
      const mine = await handle.stat();
      await handle.close();
      const existing = await fs.lstat(lock).catch(() => null);
      if (existing?.ino === mine.ino) await fs.unlink(lock).catch(() => undefined);
    }
  })();
  active.set(file, refresh);
  try { return await refresh; }
  finally { if (active.get(file) === refresh) active.delete(file); }
}
