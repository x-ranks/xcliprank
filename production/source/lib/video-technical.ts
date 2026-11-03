export type VideoTechnical = { durationSeconds: number; width?: number; height?: number };
export type StoredVideoTechnical = VideoTechnical & { sourceHash: string; observedAt: string; method: "ffprobe-range-v1" | "mp4-range-v1" };
export function validVideoTechnical(value: unknown): value is VideoTechnical {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).every(key => ["durationSeconds", "width", "height"].includes(key)) && typeof v.durationSeconds === "number" && Number.isFinite(v.durationSeconds) && v.durationSeconds > 0 && v.durationSeconds <= 86400 &&
    [v.width, v.height].every(n => n === undefined || Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 16384);
}
export function validStoredVideoTechnical(value: unknown): value is StoredVideoTechnical {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as StoredVideoTechnical, { sourceHash, observedAt, method, ...technical } = v;
  return /^[a-f0-9]{64}$/.test(sourceHash) && typeof observedAt === "string" && /^\d{4}-\d\d-\d\dT/.test(observedAt) && Number.isFinite(Date.parse(observedAt)) && ["ffprobe-range-v1", "mp4-range-v1"].includes(method) && validVideoTechnical(technical);
}
export function matchingVideoTechnical(value: unknown, sourceHash: string): StoredVideoTechnical | null {
  return validStoredVideoTechnical(value) && value.sourceHash === sourceHash ? value : null;
}
export function isoVideoDuration(seconds: number) {
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86400 ? `PT${Math.max(0.001, Math.round(seconds * 1000) / 1000)}S` : null;
}
