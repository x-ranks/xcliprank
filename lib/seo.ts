import type { RankPost } from "../app/components/RankingClient";

export const SITE_URL = "https://xcliprank.com";
export const SITE_NAME = "X CLIP RANK";

export function rankingItemList(
  name: string,
  path: string,
  posts: RankPost[]
) {
  return {
    "@type": "ItemList",
    "@id": `${SITE_URL}${path}#ranking`,
    name,
    url: `${SITE_URL}${path}`,
    numberOfItems: posts.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: posts.slice(0, 100).map((post, index) => ({
      "@type": "ListItem",
      position: post.ranking_position ?? index + 1,
      name: `${post.ranking_position ?? index + 1}位 ${
        post.author_name ?? post.author_username ?? "X投稿者"
      }`,
      url: post.x_url
    }))
  };
}

export function rankingBreadcrumb(
  name: string,
  path: string
) {
  return {
    "@type": "BreadcrumbList",
    "@id": `${SITE_URL}${path}#breadcrumb`,
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE_NAME,
        item: SITE_URL
      },
      {
        "@type": "ListItem",
        position: 2,
        name,
        item: `${SITE_URL}${path}`
      }
    ]
  };
}
