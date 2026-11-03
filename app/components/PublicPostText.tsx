import type { ReactNode } from "react";

export default function PublicPostText({ text, tags }: { text: string; tags: { name: string; href: string }[] }) {
  const destinations = new Map(tags.filter(tag => /^\/tags\/[^?#]+$/.test(tag.href))
    .map(tag => [tag.name.normalize("NFC").toLowerCase(), tag.href]));
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/[#＃]([\p{L}\p{N}\p{M}_]{1,40})/gu)) {
    const start = match.index!, end = start + match[0].length;
    if ((start > 0 && /[\p{L}\p{N}\p{M}_/=&]/u.test(text[start - 1])) ||
      (end < text.length && /[\p{L}\p{N}\p{M}_]/u.test(text[end]))) continue;
    const href = destinations.get(match[1].normalize("NFC").toLowerCase());
    if (!href) continue;
    parts.push(text.slice(cursor, start), <a key={start} href={href}>{match[0]}</a>);
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return <p className="public-post-copy" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{parts}</p>;
}
