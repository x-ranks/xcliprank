import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { directMediaUrl, safeExternalUrl } from "./manual-url";
import { acquirePublicOperation } from "./public-operation-lock";
export { directMediaUrl, safeExternalUrl } from "./manual-url";

export type ManualRange = "trending" | "daily" | "weekly";
export type ManualPlacement = {
  id: string; url: string; title: string; posterUrl: string | null;
  mediaUrl: string | null; playback: "auto" | "video" | "link"; positions: Record<ManualRange, number | null>;
  updatedAt: string;
};
export type ManualState = { version: 1; revision: number; entries: ManualPlacement[] };
const LIMITS: Record<ManualRange, number> = { trending: 500, daily: 100, weekly: 100 };
const EMPTY = (): ManualState => ({ version: 1, revision: 0, entries: [] });

export function parseManualPlacement(value: unknown, id: string = randomUUID()): ManualPlacement {
  const row = value as Partial<ManualPlacement> | null;
  const url = safeExternalUrl(row?.url);
  const title = typeof row?.title === "string" ? row.title.trim() : "";
  const posterUrl = row?.posterUrl ? safeExternalUrl(row.posterUrl) : null;
  const playback = row?.playback ?? "auto";
  if (!url || !title || title.length > 120 || (row?.posterUrl && !posterUrl)) throw Error("MANUAL_INPUT_INVALID");
  if (!["auto", "video", "link"].includes(playback)) throw Error("MANUAL_PLAYBACK_INVALID");
  const positions = {} as ManualPlacement["positions"];
  for (const range of ["trending", "daily", "weekly"] as const) {
    const position = row?.positions?.[range] ?? null;
    if (position !== null && (!Number.isInteger(position) || position < 1 || position > LIMITS[range])) throw Error("MANUAL_POSITION_INVALID");
    positions[range] = position;
  }
  if (Object.values(positions).every(value => value === null)) throw Error("MANUAL_POSITION_REQUIRED");
  return { id, url, title, posterUrl, playback,
    mediaUrl: playback === "link" ? null : playback === "video" ? url : directMediaUrl(url), positions, updatedAt: new Date().toISOString() };
}

function validateState(raw: unknown): ManualState {
  const state = raw as ManualState;
  if (state?.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Array.isArray(state.entries) || state.entries.length > 100) throw Error("MANUAL_STATE_INVALID");
  const ids = new Set<string>(), urls = new Set<string>();
  const slots = { trending: new Set<number>(), daily: new Set<number>(), weekly: new Set<number>() };
  for (const row of state.entries) {
    if (!/^[a-f0-9-]{36}$/.test(row.id) || ids.has(row.id) || urls.has(row.url) ||
      !Number.isFinite(Date.parse(row.updatedAt))) throw Error("MANUAL_STATE_INVALID");
    const parsed = parseManualPlacement(row, row.id);
    if (JSON.stringify(parsed.positions) !== JSON.stringify(row.positions) || parsed.url !== row.url ||
      parsed.mediaUrl !== row.mediaUrl || parsed.posterUrl !== row.posterUrl || parsed.playback !== row.playback) throw Error("MANUAL_STATE_INVALID");
    ids.add(row.id); urls.add(row.url);
    for (const range of ["trending", "daily", "weekly"] as const) {
      const position = row.positions[range];
      if (position !== null) {
        if (slots[range].has(position)) throw Error("MANUAL_POSITION_OCCUPIED");
        slots[range].add(position);
      }
    }
  }
  return state;
}

function statePath() {
  const root = path.resolve(process.env.XCLIP_MANUAL_RANKING_DIR || path.join(os.homedir(), ".xclip-manual-ranking"));
  const cwd = path.resolve(process.cwd());
  if (root === cwd || root.startsWith(cwd + path.sep)) throw Error("MANUAL_STATE_MUST_BE_DURABLE");
  return { root, file: path.join(root, "placements.json") };
}

export async function readManualState(): Promise<ManualState> {
  const { root, file } = statePath();
  try {
    const dir = await fs.lstat(root), stat = await fs.lstat(file);
    if (!dir.isDirectory() || dir.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw Error("MANUAL_STATE_UNSAFE");
    return validateState(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY();
    throw error;
  }
}

export async function writeManualState(expectedRevision: number, action: "save" | "remove", input: unknown): Promise<ManualState> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error("MANUAL_REVISION_INVALID");
  const { root, file } = statePath();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await fs.lstat(root);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error("MANUAL_STATE_UNSAFE");
  const lock = path.join(root, "placements.lock");
  const handle = await acquirePublicOperation(lock, "MANUAL_UPDATE_BUSY");
  try {
    const state = await readManualState();
    if (state.revision !== expectedRevision) throw Error("MANUAL_REVISION_CHANGED");
    const entries = [...state.entries];
    if (action === "save") {
      const existingId = typeof (input as { id?: unknown })?.id === "string" ? (input as { id: string }).id : null;
      if (existingId && !entries.some(row => row.id === existingId)) throw Error("MANUAL_ENTRY_NOT_FOUND");
      const row = parseManualPlacement(input, existingId ?? randomUUID());
      const sameUrl = entries.find(other => other.url === row.url && other.id !== row.id);
      if (sameUrl) throw Error("MANUAL_URL_EXISTS");
      const index = entries.findIndex(other => other.id === row.id);
      if (index >= 0) entries[index] = row; else entries.push(row);
    } else if (action === "remove") {
      const id = (input as { id?: unknown })?.id;
      const index = entries.findIndex(row => row.id === id);
      if (index < 0) throw Error("MANUAL_ENTRY_NOT_FOUND");
      entries.splice(index, 1);
    } else throw Error("MANUAL_ACTION_INVALID");
    const next = validateState({ version: 1, revision: state.revision + 1, entries });
    const temp = path.join(root, ".placements-" + randomUUID() + ".tmp");
    try { await fs.writeFile(temp, JSON.stringify(next), { flag: "wx", mode: 0o600 }); await fs.rename(temp, file); }
    finally { await fs.unlink(temp).catch(() => undefined); }
    return next;
  } finally { await handle.release(); }
}

export function applyManualPlacements<T extends { x_post_id: string; ranking_position?: number }>(
  posts: T[], entries: ManualPlacement[], range: ManualRange, limit: number, blocked = new Set<string>()
): Array<T | (ManualPlacement & { x_post_id: string; ranking_position: number })> {
  const pinned = entries.filter(row => {
    const id = row.url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/)?.[1];
    return row.positions[range] !== null && (!id || !blocked.has("post:" + id));
  }).sort((a, b) => a.positions[range]! - b.positions[range]!);
  const positioned = posts.filter(post => !pinned.some(row => row.url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/)?.[1] === post.x_post_id));
  for (const row of pinned) {
    const existingId = row.url.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/)?.[1];
    const existing = posts.find(post => post.x_post_id === existingId);
    const item = existing ?? { ...row, x_post_id: "manual:" + row.id };
    positioned.splice(Math.min(row.positions[range]! - 1, positioned.length), 0, item as T);
  }
  return positioned.slice(0, limit).map((post, index) => ({ ...post, ranking_position: index + 1 }));
}
