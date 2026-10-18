import { requiresSafetyReview } from "./adult-score";

export type ContentCategory =
  | "PASS"
  | "AI_GENERATED"
  | "SOFT_GRAVURE"
  | "PROMO"
  | "OUT_OF_SCOPE"
  | "SAFETY_REVIEW";

export type ContentFilterResult = {
  category: ContentCategory;
  excluded: boolean;
  /** 除外シグナルの強さ（0〜1）。統計的な確率ではない。 */
  score: number;
  reason: string;
};

type ContentRule = {
  category: Exclude<ContentCategory, "PASS" | "SAFETY_REVIEW">;
  signals: readonly { pattern: RegExp; weight: number; reason?: string }[];
};

// 初期の本文ルール。200件の手動評価との照合・精度検証は別途必要。
// 複数該当時は SAFETY_REVIEW > AI > グラビア > 宣伝 > 対象外。
// AI / PR / 新作 / 水着 / URL / サービス名だけでは除外しない。
const CONTENT_RULES: readonly ContentRule[] = [
  {
    category: "AI_GENERATED",
    signals: [{ weight: 0.9, pattern:
      /ai\s*(?:生成|動画|画像|イラスト|美女|美少女|グラビア)|生成\s*ai|人工知能で(?:生成|作成)|\bai[\s_-]*(?:generated|art|video|image)s?\b|\bdeepfake\b/i }],
  },
  {
    category: "SOFT_GRAVURE",
    signals: [
      { pattern: /着エロ|グラビア|イメージ(?:ビデオ|dvd)|\bgravure\b/i, weight: 0.8 },
      { pattern: /作品\s*:/, weight: 0.15 },
      { pattern: /サンプル動画/, weight: 0.15 },
      {
        pattern: /^(?=[\s\S]*作品\s*:)(?=[\s\S]*サンプル動画)[\s\S]*$/,
        weight: 0.3,
        reason: "作品：＋サンプル動画",
      },
      { pattern: /チェキセット/, weight: 0.35 },
      { pattern: /数量限定/, weight: 0.15 },
    ],
  },
  {
    category: "PROMO",
    signals: [
      { pattern: /サンプル|試聴|予告編|\b(?:sample|preview|trailer)\b/i, weight: 0.25 },
      { pattern: /宣伝|告知|販売中|発売中|予約受付|購入は(?:こちら|コチラ)|\b(?:buy now|on sale)\b/i, weight: 0.4 },
      { pattern: /続きは|フル(?:動画|版)は|\bfull video (?:in|on|at)\b/i, weight: 0.4 },
      {
        pattern:
          /^(?=[\s\S]*続きが)(?=[\s\S]*https?:\/\/\S+[\s\S]*https?:\/\/\S+)[\s\S]*$/i,
        weight: 0.4,
        reason: "続きが＋URL×2以上",
      },
      { pattern: /\bfanza\b/i, weight: 0.3 },
      {
        pattern:
          /^(?=[\s\S]*\bfanza\b)(?=[\s\S]*無料\s*サンプル)(?=[\s\S]*(?:^|[\s#【\[])pr(?=$|[\s#】\]/]))[\s\S]*$/i,
        weight: 0.05,
        reason: "FANZA＋無料サンプル＋PR",
      },
      { pattern: /作品詳細/, weight: 0.3 },
      { pattern: /お得情報/, weight: 0.25 },
      { pattern: /期間限定/, weight: 0.2 },
      { pattern: /動画引用元(?:post)?/i, weight: 0.4 },
      { pattern: /閲覧必須|引用元postにいいね/i, weight: 0.25 },
      {
        pattern: /https?:\/\/\S+[\s\S]*https?:\/\/\S+/i,
        weight: 0.2,
        reason: "URL×2以上",
      },
    ],
  },
  {
    category: "OUT_OF_SCOPE",
    signals: [{ weight: 0.8, pattern:
      /ゲーム実況|ゲーム配信|プレイ動画|ゲーム攻略|アニメ切り抜き|スポーツ速報|試合ハイライト|料理レシピ|ペット動画|\b(?:gameplay|gaming stream|sports highlights|cooking tutorial|pet video)\b/i }],
  },
];

const EXCLUSION_THRESHOLD = 0.6;

/**
 * ランキング前段用の本文分類。DB・通信・スコア変更は行わない。
 * PASS は除外スコアが閾値未満であり、成人向け判定や公開許可ではない。
 * 画像・動画のみの特徴や、本文に書かれていない内容は判定できない。
 */
export function classifyContent(text: string): ContentFilterResult {
  // 必ず元の本文で既存の安全フィルターを最初に実行する。
  // 安全条件を複製・緩和せず、他カテゴリで上書きしない。
  if (requiresSafetyReview(text)) {
    return {
      category: "SAFETY_REVIEW",
      excluded: true,
      score: 1,
      reason: "既存の安全フィルターに該当。公開候補から除外し確認が必要。",
    };
  }

  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();

  // 全角英字などの正規化で判明した安全シグナルも優先する。
  if (requiresSafetyReview(normalized)) {
    return {
      category: "SAFETY_REVIEW",
      excluded: true,
      score: 1,
      reason: "正規化後の本文が既存の安全フィルターに該当。確認が必要。",
    };
  }

  let strongestScore = 0;
  for (const rule of CONTENT_RULES) {
    const matches: string[] = [];
    let total = 0;
    for (const signal of rule.signals) {
      const match = normalized.match(signal.pattern);
      if (match) {
        total += signal.weight;
        matches.push(signal.reason ?? match[0]);
      }
    }
    const score = Math.min(1, Number(total.toFixed(4)));
    strongestScore = Math.max(strongestScore, score);
    if (score >= EXCLUSION_THRESHOLD) {
      return {
        category: rule.category,
        excluded: true,
        score,
        reason: `本文の除外シグナル: ${matches.join(" / ")}`,
      };
    }
  }

  return {
    category: "PASS",
    excluded: false,
    score: strongestScore,
    reason: "除外スコアが閾値未満。既存の成人向け判定・公開条件は別途適用。",
  };
}
