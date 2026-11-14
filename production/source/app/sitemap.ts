import { readPublicIndex, readPublicMonths, readPublicPopular } from "../lib/public-video-server";
export const dynamic = "force-dynamic";
import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";
import { browsePageCount, browseHref, accountPageCount, accountListHref } from "../lib/public-list-pages";
import { isIndexable } from "../lib/indexability";
import { tagHref } from "../lib/public-video-core";

// Only a real catalog timestamp is used; a missing, unparsable or future value yields no lastmod.
function lastmod(value?: string): { lastModified?: string } {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time <= Date.now() ? { lastModified: new Date(time).toISOString() } : {};
}

// Newest valid modifiedAt among entries; undefined when none has one.
function newest(rows: { modifiedAt?: string }[]): string | undefined {
  let best: string | undefined, bestTime = -Infinity;
  for (const row of rows) { const time = row.modifiedAt ? Date.parse(row.modifiedAt) : NaN; if (Number.isFinite(time) && time <= Date.now() && time > bestTime) { best = row.modifiedAt; bestTime = time; } }
  return best;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Fail visibly on a database error; an empty sitemap would falsely signal removals.
  // Newest pagination is linked from the listing. Building its ranking here
  // would make every sitemap fetch wait for a separate ranking hydration.
  const [index, months, popular30, popularAll] = await Promise.all([readPublicIndex(), readPublicMonths(), readPublicPopular("30days"), readPublicPopular("all")]);
  return [
    { url: SITE_URL },
    { url: `${SITE_URL}/ranking/daily` },
    { url: `${SITE_URL}/ranking/weekly` },
    ...(popular30?.index ? [{ url: `${SITE_URL}/ranking/30days`, ...lastmod(popular30.modifiedAt) }] : []),
    ...(popularAll?.index ? [{ url: `${SITE_URL}/ranking/all`, ...lastmod(popularAll.modifiedAt) }] : []),
    { url: `${SITE_URL}/rising` },
    { url: `${SITE_URL}/download` },
    { url: `${SITE_URL}/download/iphone` },
    { url: `${SITE_URL}/download/android` },
    ...(months.length ? [{ url: `${SITE_URL}/months`, ...lastmod(newest(months)) }] : []),
    ...months.map(m => ({ url: `${SITE_URL}/months/${m.month}`, ...lastmod(m.modifiedAt) })),
    ...(isIndexable({ type: "tag-hub", activeTags: index.tags.filter(tag => tag.count > 0).length }) ? [{ url: `${SITE_URL}/tags`, ...lastmod(newest(index.tags.filter(tag => tag.count > 0))) }] : []),
    // List pages: the newest change among the entries they show (same page sizes as the pages themselves).
    ...Array.from({ length: browsePageCount(index.posts.length) }, (_, i) => ({ url: SITE_URL + browseHref(i + 1), ...lastmod(newest(index.posts.slice(i * 100, (i + 1) * 100))) })),
    ...Array.from({ length: accountPageCount(index.accounts.length) }, (_, i) => ({ url: SITE_URL + accountListHref(i + 1), ...lastmod(newest(index.accounts.slice(i * 40, (i + 1) * 40))) })),
    // lastmod = when the post was first saved/published or its labels last published. A post page
    // does not otherwise change, so this is when its own content last changed. Account pages take
    // the newest of their posts. Related/ranking blocks on a page change constantly and are ignored.
    ...index.posts.map(p => ({ url: `${SITE_URL}/p/${p.id}`, ...lastmod(p.modifiedAt) })),
    ...index.accounts.map(a => ({ url: `${SITE_URL}/accounts/${encodeURIComponent(a.key)}`, ...lastmod(a.modifiedAt) }))
    ,...index.tags.filter(tag => tag.index).map(tag => ({ url: SITE_URL + tagHref({ ...tag, active: true }), ...lastmod(tag.modifiedAt) }))
  ];
}
