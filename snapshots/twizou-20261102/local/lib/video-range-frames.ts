import { createHash } from "node:crypto";
import { createRangeVideoSession } from "./video-range-session";
import { ensureVideoTools, runVideoTool } from "./video-tools";
import { PERSONAL_FRAME_POSITIONS } from "./tier-personal-core";
export function labelFrameHash(frames: Buffer[]) {
  const hash = createHash("sha256").update("label-jpeg-sequence-v1\0");
  for (const frame of frames) { const length = Buffer.alloc(4); length.writeUInt32BE(frame.length); hash.update(length).update(frame); }
  return hash.digest("hex");
}
export async function extractRangeVideoFrames(source: string, options: { fetcher?: typeof fetch; maxBytes?: number } = {}) {
  try { await ensureVideoTools(); } catch { throw Error("VIDEO_TOOLS_MISSING"); }
  const session = await createRangeVideoSession(source, options);
  const input = ["-protocol_whitelist", "http,tcp", "-rw_timeout", "10000000", "-seekable", "1", "-f", "mov"];
  try {
    const raw = await runVideoTool("ffprobe", ["-v", "error", ...input, "-probesize", "1048576", "-analyzeduration", "1000000", "-select_streams", "v:0", "-show_entries", "format=duration:stream=duration,width,height", "-of", "json", session.url], 15000);
    const info = JSON.parse(raw.toString()), video = info.streams?.[0];
    const duration = Number(info.format?.duration ?? video?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw Error("INVALID_VIDEO_DURATION");
    const frames: Buffer[] = [];
    for (const position of PERSONAL_FRAME_POSITIONS) {
      const frame = await runVideoTool("ffmpeg", ["-nostdin", "-v", "error", ...input, "-ss", String(duration * position), "-i", session.url, "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1", "-vf", "scale=224:224:force_original_aspect_ratio=decrease,pad=224:224:(ow-iw)/2:(oh-ih)/2", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], 20000);
      if (frame.length < 2 || frame[0] !== 255 || frame[1] !== 216) throw Error("VIDEO_FRAME_MISSING"); frames.push(frame);
    }
    const width = Number(video?.width), height = Number(video?.height);
    return { frames, times: PERSONAL_FRAME_POSITIONS.map(p => p * duration), duration,
      technical: { durationSeconds: duration, ...(Number.isInteger(width) && width > 0 && width <= 16384 ? { width } : {}), ...(Number.isInteger(height) && height > 0 && height <= 16384 ? { height } : {}) },
      hash: labelFrameHash(frames), frameHash: labelFrameHash(frames), hashKind: "frames-v1" as const, transfer: session.metrics() };
  } catch (error) { throw session.failure() ?? error; }
  finally { await session.close(); }
}
