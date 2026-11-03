import { extractRangeVideoFrames } from "./video-range-frames";
import { allowedRangeVideo } from "./video-range-session";
import { extractPersonalFrame } from "./tier-personal-image";
import { combinePersonalFrames } from "./tier-personal-core";
export const allowedLabelVideo = allowedRangeVideo;
export async function prepareLabelVideo(url: string, options: { maxBytes?: number } = {}) {
  if (!allowedLabelVideo(url)) throw Error("LABEL_VIDEO_URL_REFUSED");
  if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 256 * 1024 || options.maxBytes > 1024 * 1024 * 1024)) throw Error("LABEL_VIDEO_INVALID_LIMIT");
  try {
    const extracted = await extractRangeVideoFrames(url, { maxBytes: Math.min(options.maxBytes ?? 32 * 1024 * 1024, 32 * 1024 * 1024) });
    const vectors: number[][] = [];
    for (const frame of extracted.frames) vectors.push(await extractPersonalFrame(frame));
    return { ...extracted, features: combinePersonalFrames(vectors) };
  } catch (error) {
    const code = error instanceof Error ? error.message : "VIDEO_RANGE_FETCH_FAILED";
    const map: Record<string, string> = { VIDEO_TOOLS_MISSING: "LABEL_VIDEO_TOOLS_MISSING", VIDEO_HTTP_403: "LABEL_VIDEO_HTTP_FORBIDDEN", VIDEO_HTTP_404: "LABEL_VIDEO_HTTP_NOT_FOUND", VIDEO_HTTP_410: "LABEL_VIDEO_HTTP_GONE", VIDEO_HTTP_429: "LABEL_VIDEO_HTTP_RATE_LIMIT", VIDEO_RANGE_BUDGET_EXCEEDED: "LABEL_VIDEO_RANGE_BUDGET_EXCEEDED", VIDEO_RANGE_UNAVAILABLE: "LABEL_VIDEO_RANGE_UNAVAILABLE", INVALID_VIDEO_DURATION: "LABEL_VIDEO_INVALID_DURATION" };
    throw Error(map[code] ?? (code.startsWith("VIDEO_HTTP_5") ? "LABEL_VIDEO_HTTP_SERVER_ERROR" : "LABEL_VIDEO_FETCH_FAILED"));
  }
}
