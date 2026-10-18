import { promises as fs } from "node:fs";

// Serialize stale-PID recovery too: two workers must never remove each other's
// freshly acquired main lock. A leftover recovery lock is refused, not guessed.
export async function acquirePublicOperation(file: string, busy: string) {
  async function deadOwner() {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 1024) throw Error(busy);
    let pid: unknown;
    try { pid = JSON.parse(await fs.readFile(file, "utf8")).pid; } catch { throw Error(busy); }
    if (!Number.isSafeInteger(pid) || (pid as number) <= 0) throw Error(busy);
    try { process.kill(pid as number, 0); return false; }
    catch (e) { return (e as NodeJS.ErrnoException).code === "ESRCH"; }
  }
  let handle;
  try { handle = await fs.open(file, "wx", 0o600); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (!(await deadOwner())) throw Error(busy);
    const recoveryFile = file + ".recovery";
    let recovery;
    try { recovery = await fs.open(recoveryFile, "wx", 0o600); } catch { throw Error(busy); }
    try {
      if (!(await deadOwner())) throw Error(busy);
      await fs.unlink(file);
      try { handle = await fs.open(file, "wx", 0o600); } catch { throw Error(busy); }
    } finally { await recovery.close(); await fs.unlink(recoveryFile); }
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); }
  catch (e) { await handle.close(); await fs.unlink(file); throw e; }
  return { async release() { await handle.close(); await fs.unlink(file); } };
}
