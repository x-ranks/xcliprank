import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { createPublicCatalog } from "./public-catalog-store";
export function publicCatalogDirectory() { const configured = process.env.XCLIP_PUBLIC_CATALOG_DIR; if (configured && !path.isAbsolute(configured)) throw Error("PUBLIC_CATALOG_UNSAFE"); return configured || path.join(os.homedir(), ".xclip-public-catalog"); }
export async function publicSaveSecret() {
  const root = publicCatalogDirectory(); await createPublicCatalog(root).read();
  await fs.mkdir(root, { recursive: true, mode: 0o700 }); const file = path.join(root, "save-receipt-secret");
  try { await fs.writeFile(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 64) throw Error("PUBLIC_SECRET_UNREADABLE");
  const secret = await fs.readFile(file, "utf8"); if (!/^[a-f0-9]{64}$/.test(secret)) throw Error("PUBLIC_SECRET_UNREADABLE"); return secret;
}
