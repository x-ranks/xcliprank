// One policy for both sitemap membership and page robots metadata.
export type IndexableKind =
  | { type: "post"; permitted: boolean; hasAuthor: boolean; hasDescription: boolean }
  | { type: "account"; permittedVideos: number }
  | { type: "tag"; permittedVideos: number; hasImage: boolean }
  | { type: "tag-hub"; activeTags: number };

export function isIndexable(value: IndexableKind): boolean {
  switch (value.type) {
    case "post": return value.permitted && value.hasAuthor && value.hasDescription;
    case "account": return value.permittedVideos >= 1;
    case "tag": return value.permittedVideos >= 3 && value.hasImage;
    case "tag-hub": return value.activeTags > 0;
  }
}
