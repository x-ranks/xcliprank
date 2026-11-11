import { PUBLIC_SITE, type PublicLabel, type PublicVideo, type videoMetadata } from "./public-video-core";
import { publicVideoSchema } from "./public-video-schema";

export const PILOT_VIDEO_IDS = [
  "2119291393604825164",
  "2119283592186720558",
  "2119040167981780998",
  "2118938795194425555",
  "2118889607140118664",
] as const;

export type VideoSitemapEntry = {
  video: PublicVideo;
  metadata: ReturnType<typeof videoMetadata>;
  labels: PublicLabel[];
};

function xml(value: string) {
  return value
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function mediaUrl(value: string, host: string) {
  try {
    const url = new URL(value);
    return url.origin === "https://" + host && !url.username && !url.password && !url.hash ? url : null;
  } catch {
    return null;
  }
}

export function renderVideoSitemap(entries: readonly (VideoSitemapEntry | null)[]) {
  const byId = new Map(entries.filter(entry => entry !== null).map(entry => [entry.video.id, entry]));
  const urls = PILOT_VIDEO_IDS.flatMap(id => {
    const entry = byId.get(id);
    if (!entry?.metadata.index || entry.metadata.canonical !== PUBLIC_SITE + "/p/" + id) return [];
    const schema = publicVideoSchema(entry.video, entry.metadata, entry.labels);
    if (!schema) return [];
    const thumbnail = mediaUrl(schema.thumbnailUrl, "pbs.twimg.com");
    const content = mediaUrl(schema.contentUrl, "video.twimg.com");
    if (!thumbnail || !content?.pathname.endsWith(".mp4") || (content.search && !/^\?tag=\d{1,4}$/.test(content.search))) return [];
    const title = xml(schema.name).trim();
    const description = xml(schema.description).trim();
    if (!title || !description) return [];
    return [`<url>
<loc>${xml(schema.url)}</loc>
<video:video>
<video:thumbnail_loc>${xml(thumbnail.href)}</video:thumbnail_loc>
<video:title>${title}</video:title>
<video:description>${description}</video:description>
<video:content_loc>${xml(content.href)}</video:content_loc>
<video:publication_date>${new Date(schema.uploadDate).toISOString()}</video:publication_date>
<video:family_friendly>${schema.isFamilyFriendly ? "yes" : "no"}</video:family_friendly>
</video:video>
</url>`];
  });
  if (!urls.length) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urls.join("\n")}
</urlset>
`;
}
