import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { type AuthorOutcome } from "./author-status";

export type AuthorEntry = { status: AuthorOutcome; checkedAt: number; confirmedAt: number; nextCheckAt: number };
export type AuthorState = { version: 1; entries: Record<string, AuthorEntry>; cooldownUntil: number };
export const authorStateDirectory = () => process.env.XCLIP_AUTHOR_STATE_DIR || path.join(homedir(), ".xclip-author-status");
const validKey = (key: string) => /^(?:id:\d{2,20}|name:[a-z0-9_]{1,15})$/.test(key);
export async function readAuthorState(directory = authorStateDirectory()): Promise<AuthorState> {
  try {
    const file = path.join(directory, "state-v1.json");
    if ((await fs.stat(file)).size > 2 * 1024 * 1024) throw Error("AUTHOR_STATE_TOO_LARGE");
    const state = JSON.parse(await fs.readFile(file, "utf8"));
    if (state?.version !== 1 || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries) ||
        Object.keys(state.entries).length > 5000 || !Number.isFinite(state.cooldownUntil) || state.cooldownUntil < 0) throw Error("AUTHOR_STATE_INVALID");
    for (const [key, entry] of Object.entries(state.entries) as [string, AuthorEntry][]) {
      if (!validKey(key) || !["public", "suspended", "unknown"].includes(entry?.status) ||
          [entry.checkedAt, entry.confirmedAt, entry.nextCheckAt].some(n => !Number.isFinite(n) || n < 0)) throw Error("AUTHOR_STATE_INVALID");
    }
    return state;
  } catch (error: any) {
    if (error.code === "ENOENT") return { version: 1, entries: {}, cooldownUntil: 0 };
    // Never reinterpret a corrupt record as an empty block list.
    throw Error("AUTHOR_STATE_UNREADABLE");
  }
}
export async function writeAuthorState(state: AuthorState, directory = authorStateDirectory()) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, "state-v1.json");
  const temp = target + "." + randomBytes(8).toString("hex") + ".tmp";
  try { await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" }); await fs.rename(temp, target); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
export async function suspendedAuthorKeys(directory = authorStateDirectory()) {
  const state = await readAuthorState(directory);
  return new Set(Object.keys(state.entries).filter(key => state.entries[key].status === "suspended"));
}
