import { isAllowedDownloadUrl } from "./video-download";

// A Blob keeps video bytes on the user's device, never on the Xclip server.
export const DIRECT_DOWNLOAD_LIMIT = 128 * 1024 * 1024;
export class DirectDownloadError extends Error {}

export async function fetchDirectVideo(rawUrl: string, options: {
  signal: AbortSignal;
  fetcher?: typeof fetch;
  onProgress?: (received: number, total: number | null) => void;
}): Promise<Blob> {
  if (!isAllowedDownloadUrl(rawUrl)) throw new DirectDownloadError("動画の取得先が正しくありません。");
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(rawUrl, {
      mode: "cors", credentials: "omit", redirect: "error", cache: "no-store",
      referrerPolicy: "no-referrer", signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new DirectDownloadError("Xから直接取得できませんでした。通信制限・URL失効・通信障害の可能性があります。時間をおいて再試行してください。");
  }
  if (response.status !== 200 || response.type === "opaque" ||
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "video/mp4" || !response.body ||
      (response.url && !isAllowedDownloadUrl(response.url))) {
    await response.body?.cancel();
    throw new DirectDownloadError("X側で動画を取得できません。投稿の削除や動画URLの失効を確認してください。");
  }
  const length = response.headers.get("content-length");
  const total = length && /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) ? Number(length) : null;
  if (total !== null && total > DIRECT_DOWNLOAD_LIMIT) {
    await response.body.cancel();
    throw new DirectDownloadError("この動画は128MBを超えるため、この直接保存版では保存できません。");
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  let completed = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const part = await reader.read();
      if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (part.done) break;
      received += part.value.byteLength;
      if (received > DIRECT_DOWNLOAD_LIMIT) throw new DirectDownloadError("この動画は128MBを超えるため、この直接保存版では保存できません。");
      // Copy only this chunk to an ArrayBuffer with unambiguous BlobPart typing.
      chunks.push(new Uint8Array(part.value).buffer);
      options.onProgress?.(received, total);
    }
    if (!received || (total !== null && received !== total)) {
      throw new DirectDownloadError("動画を最後まで受信できませんでした。再試行してください。");
    }
    completed = true;
    return new Blob(chunks, { type: "video/mp4" });
  } finally {
    options.signal.removeEventListener("abort", abort);
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
