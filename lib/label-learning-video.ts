import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureVideoTools, extractLocalVideoFrames } from "./tier-personal-video";
import { extractPersonalFrame } from "./tier-personal-image";
import { combinePersonalFrames } from "./tier-personal-core";
export function allowedLabelVideo(raw: string) {
  try { const u = new URL(raw); return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") && (u.hostname === "video.twimg.com" || u.hostname.endsWith(".video.twimg.com")); } catch { return false; }
}
export async function prepareLabelVideo(url: string) {
  if (!allowedLabelVideo(url)) throw Error("LABEL_VIDEO_URL_REFUSED");
  try { await ensureVideoTools(); } catch { throw Error("LABEL_VIDEO_TOOLS_MISSING"); }
  const directory = await mkdtemp(path.join(tmpdir(), "xclip-label-video-")), filename = path.join(directory, "video.mp4");
  try {
    const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60000) });
    const max = 96 * 1024 * 1024;
    if (!response.ok || !response.body) { await response.body?.cancel(); throw Error("LABEL_VIDEO_FETCH_FAILED"); }
    if (Number(response.headers.get("content-length") || 0) > max) { await response.body.cancel(); throw Error("LABEL_VIDEO_TOO_LARGE"); }
    const file = await open(filename, "wx", 0o600), reader = response.body.getReader(), hash = createHash("sha256"); let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length; if (bytes > max) throw Error("LABEL_VIDEO_TOO_LARGE"); hash.update(value);
        let offset = 0; while (offset < value.length) { const written = await file.write(value, offset, value.length - offset); if (!written.bytesWritten) throw Error("LABEL_VIDEO_WRITE_FAILED"); offset += written.bytesWritten; }
      }
    } finally { await file.close(); await reader.cancel(); }
    const extracted = await extractLocalVideoFrames(filename), vectors: number[][] = [];
    for (const frame of extracted.frames) vectors.push(await extractPersonalFrame(frame));
    return { frames: extracted.frames, times: extracted.times, features: combinePersonalFrames(vectors), hash: hash.digest("hex") };
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
}
