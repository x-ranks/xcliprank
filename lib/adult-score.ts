/*
 * ========================================
 * 成人向け候補判定
 * ========================================
 *
 * adult_score
 *   成人向けである可能性
 *
 * creator_score
 *   本人投稿・個人制作・クリエイター系で
 *   ある可能性
 *
 * review_required
 *   公開前に確認が必要な投稿
 */

/*
 * ========================================
 * 共通
 * ========================================
 */

function normalizeText(
  text: string
) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * ========================================
 * 成人向け候補スコア
 * ========================================
 */
export function calculateAdultScore(
  text: string,
  possiblySensitive: boolean
) {
  const normalized =
    normalizeText(text);

  /*
   * 明確な成人向け表現
   */
  const strongAdultKeywords = [
    "r18",
    "r-18",
    "18+",
    "nsfw",
    "成人向け",
    "アダルト",
    "🔞"
  ];

  /*
   * 成人向け傾向はあるが
   * 単独では弱い表現
   */
  const mediumAdultKeywords = [
    "エロ",
    "セクシー",
    "sexy",
    "ero",
    "adult"
  ];

  let score = 0;

  /*
   * X側のセンシティブ判定
   *
   * これだけで成人向け確定には
   * しない。
   */
  if (possiblySensitive) {
    score += 0.42;
  }

  /*
   * 強い成人向け表現
   */
  let strongHits = 0;

  for (
    const keyword of
    strongAdultKeywords
  ) {
    if (
      normalized.includes(
        keyword.toLowerCase()
      )
    ) {
      strongHits++;
    }
  }

  if (strongHits >= 2) {
    score += 0.45;
  } else if (
    strongHits === 1
  ) {
    score += 0.32;
  }

  /*
   * 中程度の表現
   */
  let mediumHits = 0;

  for (
    const keyword of
    mediumAdultKeywords
  ) {
    if (
      normalized.includes(
        keyword.toLowerCase()
      )
    ) {
      mediumHits++;
    }
  }

  if (mediumHits >= 2) {
    score += 0.20;
  } else if (
    mediumHits === 1
  ) {
    score += 0.10;
  }

  return Math.min(
    Number(score.toFixed(4)),
    1
  );
}

/*
 * ========================================
 * Creator Score
 * ========================================
 *
 * 本人投稿・個人制作・
 * クリエイター活動らしさを評価。
 *
 * 「素人」という単語そのものより
 * 本人発信を示すシグナルを
 * 重視する。
 */
export function calculateCreatorScore(
  text: string
) {
  const normalized =
    normalizeText(text);

  /*
   * 本人発信を示す比較的強い表現
   */
  const strongCreatorKeywords = [
    "本人",
    "本人投稿",
    "自撮り",
    "セルフ撮影",
    "セルフ",
    "自主制作",
    "個人制作",
    "個人撮影",
    "撮りました",
    "撮ってみた",
    "撮影しました",
    "selfie",
    "self shot",
    "self-shot",
    "self made",
    "self-made",
    "creator"
  ];

  /*
   * 個人クリエイター活動を
   * 示す補助シグナル
   */
  const creatorKeywords = [
    "fantia",
    "fanbox",
    "fansly",
    "fanvue",
    "patreon",
    "myfans",
    "ファンクラブ",
    "限定動画",
    "限定公開",
    "作品",
    "新作",
    "撮影",
    "動画販売"
  ];

  let score = 0;

  let strongHits = 0;

  for (
    const keyword of
    strongCreatorKeywords
  ) {
    if (
      normalized.includes(
        keyword.toLowerCase()
      )
    ) {
      strongHits++;
    }
  }

  if (strongHits >= 2) {
    score += 0.7;
  } else if (
    strongHits === 1
  ) {
    score += 0.5;
  }

  let creatorHits = 0;

  for (
    const keyword of
    creatorKeywords
  ) {
    if (
      normalized.includes(
        keyword.toLowerCase()
      )
    ) {
      creatorHits++;
    }
  }

  if (creatorHits >= 3) {
    score += 0.35;
  } else if (
    creatorHits === 2
  ) {
    score += 0.25;
  } else if (
    creatorHits === 1
  ) {
    score += 0.12;
  }

  return Math.min(
    Number(score.toFixed(4)),
    1
  );
}

/*
 * ========================================
 * 公開前Safety Review
 * ========================================
 *
 * ここに該当するものは
 * 「スコアを下げる」のではなく
 * 公開候補から外す。
 */
export function requiresSafetyReview(
  text: string
) {
  const normalized =
    normalizeText(text);

  const reviewKeywords = [
    /*
     * 未成年を示唆
     */
    "未成年",
    "児童",
    "小学生",
    "中学生",
    "高校生",
    "jc",
    "jk",

    /*
     * 非合意・プライバシー侵害等
     */
    "勝手に撮影"
  ];

  return reviewKeywords.some(
    (keyword) =>
      normalized.includes(
        keyword.toLowerCase()
      )
  );
}

/*
 * ========================================
 * ランキング用Creator Boost
 * ========================================
 *
 * 成人向け候補であることを前提に、
 * 本人制作らしさをランキングへ
 * 加点するための値。
 */
export function calculateCreatorBoost(
  adultScore: number,
  creatorScore: number
) {
  /*
   * 成人向け判定が弱い投稿を
   * creator_scoreだけで成人向けに
   * 昇格させない。
   */
  if (adultScore < 0.4) {
    return 0;
  }

  if (creatorScore >= 0.7) {
    return 0.25;
  }

  if (creatorScore >= 0.5) {
    return 0.18;
  }

  if (creatorScore >= 0.25) {
    return 0.10;
  }

  return 0;
}