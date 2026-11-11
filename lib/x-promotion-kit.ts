export type KitCandidate = {
  id: string;
  rank: number;
  handle: string | null;
  text: string;
  posterUrl: string;
  views: number | null;
  likes: number | null;
  createdAt: string | null;
  detailUrl: string;
};

export type KitCopy = { text: string; targetUrl: string; utmContent: string };

function japanDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now).replaceAll("-", "");
}

export function createKitCopy(candidate: KitCandidate, style: "curiosity" | "ranking" | "creator", now = new Date()): KitCopy {
  if (!/^\d{1,25}$/.test(candidate.id)) throw Error("INVALID_KIT_ID");
  const utmContent = `kit_${candidate.id}_${japanDay(now)}`;
  const targetUrl = `https://twizou.net/p/${candidate.id}?utm_source=x&utm_medium=social&utm_campaign=post_kit&utm_content=${utmContent}`;
  const creator = candidate.handle && /^[a-zA-Z0-9_]{1,15}$/.test(candidate.handle) ? `@${candidate.handle}` : "この投稿者";
  const lead = style === "ranking"
    ? `今日の24時間ランキング${candidate.rank}位。注目の1本を紹介します。`
    : style === "creator"
      ? `${creator}の動画を紹介。気になった場面から見てみてください。`
      : "続きが気になる1本。あなたはどの場面が印象に残りましたか？";
  const text = `${lead}\n\n▶ ${targetUrl}`;
  if (text.length > 280) throw Error("KIT_TEXT_TOO_LONG");
  return { text, targetUrl, utmContent };
}

export function extractKitAttribution(text: string, sourceId: string): string | null {
  if (!/^\d{1,25}$/.test(sourceId)) return null;
  for (const match of text.match(/https:\/\/twizou\.net\/p\/\d+\?[^\s]+/g) ?? []) {
    try {
      const url = new URL(match);
      const content = url.searchParams.get("utm_content") ?? "";
      if (url.pathname === `/p/${sourceId}` && url.searchParams.get("utm_source") === "x" &&
          url.searchParams.get("utm_campaign") === "post_kit" &&
          new RegExp(`^kit_${sourceId}_\\d{8}$`).test(content)) return content;
    } catch { /* Try the next URL. */ }
  }
  return null;
}

export function kitTextWarnings(text: string, previousTexts: string[]): string[] {
  const warnings: string[] = [];
  const normalize = (value: string) => value.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, "").toLowerCase();
  if (previousTexts.some((value) => normalize(value) === normalize(text))) warnings.push("過去の投稿と文章が同じです。内容を見直してください。");
  if ((text.match(/#[^\s#]+/g) ?? []).length > 2) warnings.push("ハッシュタグが多いため、関連性を確認してください。");
  if (!/https:\/\/twizou\.net\/p\/\d+/.test(text)) warnings.push("動画ページへのリンクを確認してください。");
  return warnings;
}
