import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { MANUAL_IMAGE_OUTPUT_BYTES } from "./manual-thumbnail";

const PUBLIC_PREFIX = "https://twizou.net/api/public-video?type=manual-thumbnail&value=";
function thumbnailRoot() {
  const root = path.resolve(process.env.XCLIP_MANUAL_RANKING_DIR || path.join(os.homedir(), ".xclip-manual-ranking"));
  const cwd = path.resolve(process.cwd());
  if (root === cwd || root.startsWith(cwd + path.sep)) throw Error("MANUAL_STATE_MUST_BE_DURABLE");
  return root;
}
async function checkedDir(create: boolean) {
  const root = thumbnailRoot(), dir = path.join(root, "thumbnails");
  if (create) await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error("MANUAL_IMAGE_STORE_UNSAFE");
  if (create) await fs.mkdir(dir, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("MANUAL_IMAGE_STORE_UNSAFE");
  return dir;
}
export function manualThumbnailUrl(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("MANUAL_IMAGE_INVALID");
  return PUBLIC_PREFIX + hash;
}
// Writes content-addressed image before state commit. It is never publicly
// served unless the current placement state references the exact URL.
export async function storeManualThumbnail(bytes: Buffer, hash: string) {
  manualThumbnailUrl(hash);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MANUAL_IMAGE_OUTPUT_BYTES ||
      createHash("sha256").update(bytes).digest("hex") !== hash) throw Error("MANUAL_IMAGE_INVALID");
  const dir = await checkedDir(true), dest = path.join(dir, hash + ".webp");
  // Bound disk use even if repeated failed registrations leave unreferenced files.
  // Existing hashes remain reusable when the bound is reached.
  const names = await fs.readdir(dir);
  if (!names.includes(hash + ".webp") && names.filter(name => /^[a-f0-9]{64}\.webp$/.test(name)).length >= 200)
    throw Error("MANUAL_IMAGE_STORAGE_FULL");
  const temp = path.join(dir, ".upload-" + randomUUID() + ".tmp");
  try {
    await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    try { await fs.link(temp, dest); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readManualThumbnailFile(hash);
      if (!existing || !existing.equals(bytes)) throw Error("MANUAL_IMAGE_STORE_UNSAFE");
    }
  } finally { await fs.unlink(temp).catch(() => undefined); }
  return manualThumbnailUrl(hash);
}
async function readManualThumbnailFile(hash: string) {
  manualThumbnailUrl(hash);
  try {
    const dir = await checkedDir(false), file = path.join(dir, hash + ".webp");
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MANUAL_IMAGE_OUTPUT_BYTES)
      throw Error("MANUAL_IMAGE_STORE_UNSAFE");
    const bytes = await fs.readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== hash) throw Error("MANUAL_IMAGE_STORE_UNSAFE");
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function readPublishedManualThumbnail(hash: string, entries: ReadonlyArray<{ posterUrl: string | null }>) {
  const url = manualThumbnailUrl(hash);
  if (!entries.some(entry => entry.posterUrl === url)) return null;
  return readManualThumbnailFile(hash);
}
