export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !host.includes(".") || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(":")) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

export function directMediaUrl(value: unknown): string | null {
  const href = safeExternalUrl(value);
  if (!href) return null;
  return /\.(?:mp4|m4v|webm|m3u8)$/i.test(new URL(href).pathname) ? href : null;
}
