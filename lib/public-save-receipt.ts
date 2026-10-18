import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { publicPostId } from "./public-video-core";
const ttl = 10 * 60 * 1000;
export function issueSaveReceipt(id: string, secret: string | null | undefined, now = Date.now()) {
  if (!publicPostId(id) || !secret || secret.length < 24) return null;
  const value = Buffer.from(JSON.stringify({ v: 1, postId: id, nonce: randomUUID(), issued: now, expires: now + ttl })).toString("base64url");
  const signature = createHmac("sha256", secret).update("xclip-save-v1:" + value).digest("base64url"); return value + "." + signature;
}
export function verifySaveReceipt(token: unknown, id: string, secret: string | null | undefined, now = Date.now()) {
  if (typeof token !== "string" || token.length > 1024 || !publicPostId(id) || !secret || secret.length < 24) return null;
  const parts = token.split("."); if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  const expected = createHmac("sha256", secret).update("xclip-save-v1:" + parts[0]).digest(), given = Buffer.from(parts[1], "base64url");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try { const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return p.v === 1 && p.postId === id && /^[a-f0-9-]{36}$/.test(p.nonce) && Number.isFinite(p.issued) && Number.isFinite(p.expires) && p.issued <= now && p.expires > now && p.expires - p.issued === ttl ? { id: p.nonce as string, expires: p.expires as number } : null;
  } catch { return null; }
}
