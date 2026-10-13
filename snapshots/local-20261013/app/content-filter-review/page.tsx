"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const API_PATH = "/api/content-filter-review";
const SECRET_STORAGE_KEY = "content-filter-review-secret";
const CATEGORIES = [
  "AI_GENERATED",
  "SOFT_GRAVURE",
  "PROMO",
  "OUT_OF_SCOPE",
] as const;
const KEEP_TIERS = ["S", "A", "B", "C", "D"] as const;

type Category = (typeof CATEGORIES)[number];
type KeepTier = (typeof KEEP_TIERS)[number];
type Verdict = "correct" | "false_positive";

type ReviewPost = {
  id: number;
  x_post_id: string;
  author_username: string | null;
  text: string | null;
  created_at: string | null;
  x_url: string | null;
  preview_image_url: string | null;
  poster_image_url?: string | null;
  image_url?: string | null;
  video_url: string | null;
  content_category: Category;
  content_filter_score: number | null;
  content_filter_reason: string | null;
  possibly_sensitive: boolean | null;
  adult_tier: string | null;
};

type ReviewResponse = {
  success: boolean;
  count: number;
  distribution: Partial<Record<Category, number>>;
  remaining_by_category: Partial<Record<Category, number>>;
  posts: ReviewPost[];
  error?: string;
};

type CategoryStats = Record<Category, { correct: number; falsePositive: number }>;

const CATEGORY_LABELS: Record<Category, string> = {
  AI_GENERATED: "AI生成",
  SOFT_GRAVURE: "着エロ・グラビア",
  PROMO: "宣伝・サンプル",
  OUT_OF_SCOPE: "対象外",
};

function emptyCategoryStats(): CategoryStats {
  return Object.fromEntries(
    CATEGORIES.map((category) => [category, { correct: 0, falsePositive: 0 }]),
  ) as CategoryStats;
}

function readableDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export default function ContentFilterReviewPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState("");
  const [restoringSecret, setRestoringSecret] = useState(true);
  const [posts, setPosts] = useState<ReviewPost[]>([]);
  const [remaining, setRemaining] = useState<Partial<Record<Category, number>>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [falsePositiveMode, setFalsePositiveMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [falsePositiveCount, setFalsePositiveCount] = useState(0);
  const [holdCount, setHoldCount] = useState(0);
  const [categoryStats, setCategoryStats] = useState<CategoryStats>(emptyCategoryStats);

  const clearSecret = useCallback(() => {
    sessionStorage.removeItem(SECRET_STORAGE_KEY);
    setSecret(null);
    setSecretInput("");
    setPosts([]);
    setCurrentIndex(0);
    setFalsePositiveMode(false);
  }, []);

  const loadPosts = useCallback(async (authorizationSecret: string) => {
    if (!authorizationSecret) return;
    setLoading(true);
    setError(null);
    setFalsePositiveMode(false);
    try {
      const response = await fetch(API_PATH, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${authorizationSecret}` },
      });
      if (response.status === 401) {
        clearSecret();
        setError("認証に失敗しました。secretを再入力してください。");
        return;
      }
      const data = (await response.json()) as ReviewResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "レビュー対象を取得できませんでした。");
      }
      setPosts(data.posts);
      setRemaining(data.remaining_by_category ?? {});
      setCurrentIndex(0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "レビュー対象を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, [clearSecret]);

  useEffect(() => {
    const storedSecret = sessionStorage.getItem(SECRET_STORAGE_KEY);
    setRestoringSecret(false);
    if (storedSecret) {
      setSecret(storedSecret);
      void loadPosts(storedSecret);
    }
  }, [loadPosts]);

  const currentPost = posts[currentIndex];
  const finished = posts.length > 0 && currentIndex >= posts.length;
  const processedCount = correctCount + falsePositiveCount + holdCount;
  const savedCount = correctCount + falsePositiveCount;
  const accuracy = savedCount === 0 ? null : Math.round((correctCount / savedCount) * 1000) / 10;
  const progress = posts.length === 0 ? 0 : Math.min(100, Math.round((currentIndex / posts.length) * 100));

  const proxyVideoUrl = useMemo(
    () => currentPost?.video_url
      ? `/api/video?url=${encodeURIComponent(currentPost.video_url)}`
      : null,
    [currentPost],
  );
  const posterUrl = currentPost?.preview_image_url
    ?? currentPost?.poster_image_url
    ?? currentPost?.image_url
    ?? null;

  function resetSessionCounts() {
    setCorrectCount(0);
    setFalsePositiveCount(0);
    setHoldCount(0);
    setCategoryStats(emptyCategoryStats());
  }

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = secretInput.trim();
    if (!value) {
      setError("CRON_SECRETを入力してください。");
      return;
    }
    sessionStorage.setItem(SECRET_STORAGE_KEY, value);
    setSecret(value);
    setSecretInput("");
    resetSessionCounts();
    void loadPosts(value);
  }

  const advance = useCallback(() => {
    setFalsePositiveMode(false);
    setError(null);
    setCurrentIndex((index) => index + 1);
  }, []);

  const saveVerdict = useCallback(async (verdict: Verdict, keepTier?: KeepTier) => {
    if (!secret || !currentPost || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(API_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          postId: currentPost.id,
          verdict,
          ...(verdict === "false_positive" ? { keepTier } : {}),
        }),
      });
      if (response.status === 401) {
        clearSecret();
        setError("認証の有効期限が切れました。secretを再入力してください。");
        return;
      }
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "判定を保存できませんでした。");
      }
      if (verdict === "correct") setCorrectCount((count) => count + 1);
      else setFalsePositiveCount((count) => count + 1);
      setCategoryStats((stats) => ({
        ...stats,
        [currentPost.content_category]: {
          ...stats[currentPost.content_category],
          ...(verdict === "correct"
            ? { correct: stats[currentPost.content_category].correct + 1 }
            : { falsePositive: stats[currentPost.content_category].falsePositive + 1 }),
        },
      }));
      advance();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "判定を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }, [advance, clearSecret, currentPost, saving, secret]);

  const hold = useCallback(() => {
    if (!currentPost || saving) return;
    setHoldCount((count) => count + 1);
    advance();
  }, [advance, currentPost, saving]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!currentPost || saving) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      const key = event.key.toUpperCase();
      if (event.key === "Escape") {
        setFalsePositiveMode(false);
        return;
      }
      if (falsePositiveMode && KEEP_TIERS.includes(key as KeepTier)) {
        void saveVerdict("false_positive", key as KeepTier);
        return;
      }
      if (falsePositiveMode) return;
      if (event.key === "1") void saveVerdict("correct");
      if (event.key === "2") setFalsePositiveMode(true);
      if (event.key === "3") hold();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPost, falsePositiveMode, hold, saveVerdict, saving]);

  if (restoringSecret) {
    return <main className="shell"><p>準備中...</p><PageStyles /></main>;
  }

  if (!secret) {
    return (
      <main className="loginShell">
        <form className="loginCard" onSubmit={handleLogin}>
          <p className="eyebrow">CONTENT FILTER</p>
          <h1>専用レビュー</h1>
          <p className="muted">続行するにはCRON_SECRETを入力してください。この画面のセッション内だけに保存されます。</p>
          {error && <div className="error" role="alert">{error}</div>}
          <label htmlFor="cron-secret">CRON_SECRET</label>
          <input id="cron-secret" type="password" value={secretInput} onChange={(event) => setSecretInput(event.target.value)} autoComplete="off" autoFocus />
          <button className="primary full" type="submit" disabled={!secretInput.trim() || loading}>{loading ? "確認中..." : "レビューを開始"}</button>
        </form>
        <PageStyles />
      </main>
    );
  }

  if (loading && posts.length === 0) {
    return <main className="shell"><h1>専用レビュー</h1><p>レビュー対象を読み込み中...</p><PageStyles /></main>;
  }

  if (finished || (!loading && posts.length === 0 && !error)) {
    return (
      <main className="shell summaryShell">
        <p className="eyebrow">SESSION COMPLETE</p>
        <h1>レビュー集計</h1>
        <Summary correct={correctCount} falsePositive={falsePositiveCount} hold={holdCount} accuracy={accuracy} categoryStats={categoryStats} remaining={remaining} />
        <button className="primary" onClick={() => { resetSessionCounts(); void loadPosts(secret); }}>次のサンプルを取得</button>
        <PageStyles />
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="header">
        <div><p className="eyebrow">CONTENT FILTER REVIEW</p><h1>除外判定を確認</h1></div>
        <button className="quiet" onClick={clearSecret}>ログアウト</button>
      </header>
      <div className="progressMeta"><span>{Math.min(currentIndex + 1, posts.length)} / {posts.length}</span><span>{progress}%</span></div>
      <div className="progress"><div style={{ width: `${progress}%` }} /></div>
      <div className="sessionStrip">
        <span>正しい <strong>{correctCount}</strong></span><span>誤検出 <strong>{falsePositiveCount}</strong></span><span>保留 <strong>{holdCount}</strong></span><span>正解率 <strong>{accuracy === null ? "-" : `${accuracy}%`}</strong></span>
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      {currentPost && (
        <div className="reviewGrid">
          <section className="mediaPanel">
            {proxyVideoUrl ? (
              <video key={currentPost.id} src={proxyVideoUrl} poster={posterUrl ?? undefined} controls playsInline preload="metadata" />
            ) : posterUrl ? (
              <img src={posterUrl} alt="投稿のプレビュー" />
            ) : (
              <div className="mediaEmpty">プレビューはありません</div>
            )}
          </section>

          <aside className="detailPanel">
            <div className="categoryRow">
              <span className={`category category-${currentPost.content_category}`}>{CATEGORY_LABELS[currentPost.content_category]}</span>
              <strong className="score">score {currentPost.content_filter_score ?? "-"}</strong>
            </div>
            <div className="reason"><span>判定理由</span><p>{currentPost.content_filter_reason ?? "-"}</p></div>
            <dl className="facts">
              <div><dt>adult tier</dt><dd>{currentPost.adult_tier ?? "-"}</dd></div>
              <div><dt>sensitive</dt><dd>{currentPost.possibly_sensitive === null ? "-" : currentPost.possibly_sensitive ? "true" : "false"}</dd></div>
              <div><dt>投稿者</dt><dd>@{currentPost.author_username ?? "unknown"}</dd></div>
              <div><dt>投稿日</dt><dd>{readableDate(currentPost.created_at)}</dd></div>
            </dl>
            <p className="postText">{currentPost.text ?? "（本文なし）"}</p>
            {currentPost.x_url && <a className="xLink" href={currentPost.x_url} target="_blank" rel="noreferrer">Xで投稿を開く ↗</a>}

            {!falsePositiveMode ? (
              <div className="actions">
                <button className="correct" disabled={saving} onClick={() => void saveVerdict("correct")}><kbd>1</kbd> 除外で正しい</button>
                <button className="falsePositive" disabled={saving} onClick={() => setFalsePositiveMode(true)}><kbd>2</kbd> 誤検出</button>
                <button className="hold" disabled={saving} onClick={hold}><kbd>3</kbd> 保留</button>
              </div>
            ) : (
              <div className="tierPicker">
                <div><strong>残すTierを選択</strong><button className="cancel" onClick={() => setFalsePositiveMode(false)} disabled={saving}>Esc キャンセル</button></div>
                <div className="tiers">{KEEP_TIERS.map((tier) => <button key={tier} disabled={saving} onClick={() => void saveVerdict("false_positive", tier)}>{tier}</button>)}</div>
              </div>
            )}
            {saving && <p className="saving">保存中...</p>}
          </aside>
        </div>
      )}
      <section className="bottomStats"><Summary correct={correctCount} falsePositive={falsePositiveCount} hold={holdCount} accuracy={accuracy} categoryStats={categoryStats} remaining={remaining} compact /></section>
      <PageStyles />
    </main>
  );
}

function Summary({ correct, falsePositive, hold, accuracy, categoryStats, remaining, compact = false }: { correct: number; falsePositive: number; hold: number; accuracy: number | null; categoryStats: CategoryStats; remaining: Partial<Record<Category, number>>; compact?: boolean }) {
  return (
    <div className={compact ? "summary compact" : "summary"}>
      {!compact && <div className="summaryCards"><div><strong>{correct}</strong><span>除外で正しい</span></div><div><strong>{falsePositive}</strong><span>誤検出</span></div><div><strong>{hold}</strong><span>保留</span></div><div><strong>{accuracy === null ? "-" : `${accuracy}%`}</strong><span>保存済み判断の正解率</span></div></div>}
      <div className="statsTable" role="table" aria-label="カテゴリ別集計">
        <div className="statsHead" role="row"><span>カテゴリ</span><span>正しい</span><span>誤検出</span><span>未レビュー</span></div>
        {CATEGORIES.map((category) => <div role="row" key={category}><span>{CATEGORY_LABELS[category]}</span><span>{categoryStats[category].correct}</span><span>{categoryStats[category].falsePositive}</span><span>{remaining[category] ?? "-"}</span></div>)}
      </div>
    </div>
  );
}

function PageStyles() {
  return <style jsx global>{`
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f5f7; color: #17191c; }
    button, input { font: inherit; }
    .shell { max-width: 1280px; margin: 0 auto; padding: 28px 24px 56px; }
    .loginShell { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #fff 0, #eef0f4 70%); }
    .loginCard { width: min(440px, 100%); padding: 36px; border: 1px solid #d8dbe2; border-radius: 18px; background: #fff; box-shadow: 0 18px 55px rgba(28,35,48,.1); }
    .loginCard h1, .header h1 { margin: 4px 0 12px; }
    .loginCard label { display: block; margin: 24px 0 8px; font-size: 13px; font-weight: 700; }
    .loginCard input { width: 100%; padding: 13px 14px; border: 1px solid #b9bec8; border-radius: 9px; }
    .eyebrow { margin: 0; color: #687082; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
    .muted { color: #616977; line-height: 1.65; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .quiet, .cancel { border: 0; background: transparent; color: #5c6370; cursor: pointer; text-decoration: underline; }
    .progressMeta { display: flex; justify-content: space-between; margin-top: 22px; font-size: 13px; font-weight: 700; }
    .progress { height: 8px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: #dfe2e8; }
    .progress div { height: 100%; border-radius: inherit; background: #222a35; transition: width .2s ease; }
    .sessionStrip { display: flex; flex-wrap: wrap; gap: 18px; margin: 14px 0 20px; color: #606775; font-size: 13px; }
    .sessionStrip strong { color: #17191c; }
    .error { margin: 14px 0; padding: 12px 14px; border: 1px solid #e2a1a1; border-radius: 8px; background: #fff0f0; color: #8b2020; }
    .reviewGrid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(360px, .8fr); gap: 22px; align-items: start; }
    .mediaPanel, .detailPanel { overflow: hidden; border: 1px solid #d8dbe2; border-radius: 14px; background: #fff; }
    .mediaPanel { display: grid; min-height: 560px; place-items: center; background: #090a0c; }
    .mediaPanel video, .mediaPanel img { display: block; width: 100%; max-height: 75vh; object-fit: contain; }
    .mediaEmpty { color: #aeb3bd; }
    .detailPanel { padding: 22px; }
    .categoryRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .category { padding: 7px 10px; border-radius: 7px; color: #fff; font-size: 13px; font-weight: 800; }
    .category-AI_GENERATED { background: #6651a6; } .category-SOFT_GRAVURE { background: #a44e73; } .category-PROMO { background: #9a6328; } .category-OUT_OF_SCOPE { background: #52606b; }
    .score { font-size: 14px; }
    .reason { margin-top: 16px; padding: 13px; border-radius: 9px; background: #f2f3f6; }
    .reason span { color: #687082; font-size: 11px; font-weight: 800; }
    .reason p { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .facts { margin: 16px 0; border-top: 1px solid #e4e6ea; }
    .facts div { display: grid; grid-template-columns: 90px 1fr; gap: 10px; padding: 8px 0; border-bottom: 1px solid #e4e6ea; }
    .facts dt { color: #737a86; font-size: 12px; } .facts dd { margin: 0; overflow-wrap: anywhere; font-size: 13px; font-weight: 650; }
    .postText { max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; }
    .xLink { display: inline-block; margin-bottom: 18px; color: #1d5caa; font-weight: 700; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .actions button, .tiers button, .primary { border: 0; border-radius: 9px; padding: 13px 12px; color: #fff; cursor: pointer; font-weight: 800; }
    .actions button:disabled, .tiers button:disabled, .primary:disabled { cursor: wait; opacity: .55; }
    .actions .correct { grid-column: 1 / -1; background: #23724b; } .actions .falsePositive { background: #a74646; } .actions .hold { background: #626a76; }
    kbd { margin-right: 6px; padding: 2px 6px; border: 1px solid rgba(255,255,255,.5); border-radius: 4px; font-family: inherit; }
    .tierPicker { padding: 14px; border: 2px solid #a74646; border-radius: 10px; }
    .tierPicker > div:first-child { display: flex; justify-content: space-between; gap: 10px; }
    .tiers { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin-top: 14px; }
    .tiers button { background: #a74646; font-size: 20px; }
    .saving { text-align: center; color: #626a76; }
    .bottomStats { margin-top: 24px; }
    .statsTable { overflow: hidden; border: 1px solid #d8dbe2; border-radius: 10px; background: #fff; }
    .statsTable > div { display: grid; grid-template-columns: minmax(150px, 1fr) repeat(3, 80px); padding: 9px 12px; border-top: 1px solid #e7e9ed; font-size: 13px; }
    .statsTable > div:first-child { border-top: 0; }
    .statsTable span:not(:first-child) { text-align: right; }
    .statsHead { background: #eef0f4; color: #656d7a; font-size: 11px !important; font-weight: 800; }
    .summaryShell { max-width: 850px; text-align: center; }
    .summaryCards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 24px 0; }
    .summaryCards div { padding: 20px 10px; border: 1px solid #d8dbe2; border-radius: 10px; background: #fff; }
    .summaryCards strong, .summaryCards span { display: block; } .summaryCards strong { font-size: 26px; } .summaryCards span { margin-top: 5px; color: #687082; font-size: 11px; }
    .primary { margin-top: 20px; background: #222a35; } .primary.full { width: 100%; }
    @media (max-width: 780px) {
      .shell { padding: 18px 12px 42px; }
      .reviewGrid { grid-template-columns: 1fr; }
      .mediaPanel { min-height: 360px; }
      .detailPanel { padding: 16px; }
      .summaryCards { grid-template-columns: 1fr 1fr; }
      .statsTable > div { grid-template-columns: minmax(110px, 1fr) repeat(3, 58px); padding: 8px; }
      .bottomStats { overflow-x: auto; }
    }
  `}</style>;
}
