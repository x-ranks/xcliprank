import { loadRankingPage } from "../lib/initial-ranking";
import { newestPageHref } from "../lib/ranking-pagination";
import { readPublicIndex } from "../lib/public-video-server";
export const dynamic = "force-dynamic";
import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo";
import { browsePageCount, browseHref, accountPageCount, accountListHref } from "../lib/public-list-pages";
import { isIndexable } from "../lib/indexability";
import { tagHref } from "../lib/public-video-core";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Fail visibly on a database error; an empty sitemap would falsely signal removals.
  const [index, newest] = await Promise.all([
    readPublicIndex(), loadRankingPage("trending", 1).catch(() => null),
  ]);
  const reportedPages = newest?.status === 200 ? newest.pagination?.totalPages : undefined;
  const newestPages = typeof reportedPages === "number" && Number.isInteger(reportedPages) && reportedPages > 0
    ? Math.min(10, reportedPages) : 1;
  return [
    { url: SITE_URL },
    ...Array.from({ length: newestPages - 1 }, (_, i) => ({ url: SITE_URL + newestPageHref(i + 2) })),
    { url: `${SITE_URL}/ranking/daily` },
    { url: `${SITE_URL}/ranking/weekly` },
    { url: `${SITE_URL}/rising` },
    { url: `${SITE_URL}/download` },
    ...(isIndexable({ type: "tag-hub", activeTags: index.tags.filter(tag => tag.count > 0).length }) ? [{ url: `${SITE_URL}/tags` }] : []),
    ...Array.from({ length: browsePageCount(index.posts.length) }, (_, i) => ({ url: SITE_URL + browseHref(i + 1) })),
    ...Array.from({ length: accountPageCount(index.accounts.length) }, (_, i) => ({ url: SITE_URL + accountListHref(i + 1) })),
    // The catalog records first-observed events and label publication, not the
    // last meaningful change to the full page. Omit lastmod until reliable.
    ...index.posts.map(p => ({ url: `${SITE_URL}/p/${p.id}` })),
    ...index.accounts.map(a => ({ url: `${SITE_URL}/accounts/${encodeURIComponent(a.key)}` }))
    ,...index.tags.filter(tag => tag.index).map(tag => ({ url: SITE_URL + tagHref({ ...tag, active: true }) }))
  ];
}
