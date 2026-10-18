"use client";

import { useEffect, useMemo, useState } from "react";

type ReviewTier = "S" | "A" | "OTHER" | "X";

type TrainingPost = {
  xPostId: string;
  authorUsername: string;
  text: string;
  createdAt: string | null;
  xUrl: string | null;
  previewImageUrl: string | null;
  videoUrl: string | null;
  views: number;
  likes: number;
  reposts: number;
  possiblySensitive: boolean;
  safetyReasons: string[];
  review: {
    tier: ReviewTier;
    reason: string | null;
    reviewedAt: string;
  } | null;
};

type TeacherAuthor = {
  username: string;
  expectedTier: "S" | "A";
  addedAt: string;
  refreshedAt: string;
  posts: TrainingPost[];
};

type TeacherStore = {
  version: 1;
  authors: TeacherAuthor[];
};

type TrainingStatus = {
  modelTrainedAt: string | null;
  totalReviewed: number;
  reviewsSinceTraining: number;
  threshold: number;
  remainingUntilRetraining: number;
  needsRetraining: boolean;
};

const X_REASONS = [
  ["sample", "宣伝・サンプル"],
  ["mosaic", "モザイク"],
  ["non_adult", "成人向けではない"],
  ["weak", "内容が弱い"],
  ["other", "その他X"],
] as const;

function proxyVideo(url: string) {
  return `/api/video?url=${encodeURIComponent(url)}`;
}

function proxyImage(url: string) {
  return `/api/visual-filter-image?url=${encodeURIComponent(url)}`;
}

function safePosts(author: TeacherAuthor) {
  return author.posts.filter((post) => post.safetyReasons.length === 0);
}

function pendingPosts(author: TeacherAuthor) {
  return safePosts(author).filter((post) => !post.review);
}

export default function TeacherAuthorsPage() {
  const [store, setStore] = useState<TeacherStore>({ version: 1, authors: [] });
  const [trainingAuthors, setTrainingAuthors] = useState<TeacherAuthor[]>([]);
  const [legacyAuthorCount, setLegacyAuthorCount] = useState(0);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus | null>(null);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showReviewed, setShowReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadStore();
  }, []);

  const visibleAuthors = store.authors.filter(
    (author) => showReviewed || pendingPosts(author).length > 0
  );
  const selectedAuthor = visibleAuthors.find(
    (author) => author.username === selectedUsername
  ) ?? null;
  const allReviewablePosts = selectedAuthor ? safePosts(selectedAuthor) : [];
  const reviewablePosts = allReviewablePosts.filter(
    (post) => showReviewed || !post.review
  );
  const quarantinedPosts = selectedAuthor?.posts.filter(
    (post) => post.safetyReasons.length > 0
  ) ?? [];
  const currentPost = reviewablePosts[currentIndex] ?? null;
  const pendingAuthorCount = store.authors.filter((author) => pendingPosts(author).length > 0).length;
  const pendingVideoCount = store.authors.reduce((total, author) => total + pendingPosts(author).length, 0);

  const authorStats = useMemo(() => {
    if (!selectedAuthor) return { reviewed: 0, s: 0, a: 0, other: 0, x: 0 };
    const reviews = selectedAuthor.posts.map((post) => post.review).filter(Boolean);
    return {
      reviewed: reviews.length,
      s: reviews.filter((review) => review?.tier === "S").length,
      a: reviews.filter((review) => review?.tier === "A").length,
      other: reviews.filter((review) => review?.tier === "OTHER").length,
      x: reviews.filter((review) => review?.tier === "X").length,
    };
  }, [selectedAuthor]);

  async function loadStore(preferUsername?: string) {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/teacher-authors", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "取得に失敗しました");
      setStore(payload.store);
      setTrainingAuthors(payload.trainingAuthors ?? payload.store.authors);
      setLegacyAuthorCount(Number(payload.legacyAuthorCount ?? 0));
      setTrainingStatus(payload.trainingStatus ?? null);
      const candidates = (payload.store.authors as TeacherAuthor[]).filter(
        (author) => showReviewed || pendingPosts(author).length > 0
      );
      const requestedUsername = preferUsername ?? selectedUsername;
      const nextUsername = candidates.some((author) => author.username === requestedUsername)
        ? requestedUsername ?? null
        : candidates[0]?.username ?? null;
      setSelectedUsername(nextUsername);
      const author = candidates.find((item) => item.username === nextUsername);
      const firstUnreviewed = author ? safePosts(author).findIndex((post) => !post.review) : 0;
      setCurrentIndex(showReviewed ? Math.max(0, firstUnreviewed) : 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function syncCuratedAuthors() {
    if (working) return;
    try {
      setWorking(true);
      setError(null);
      setMessage("選別投稿者と保存済み動画を同期しています…");
      await loadStore(selectedAuthor?.username);
      setMessage("選別投稿者との同期が完了しました。");
    } catch (caught) {
      setMessage(null);
      setError(caught instanceof Error ? caught.message : "同期に失敗しました");
    } finally {
      setWorking(false);
    }
  }

  async function saveReview(tier: ReviewTier, reason: string | null = null) {
    if (!selectedAuthor || !currentPost || working) return;
    try {
      setWorking(true);
      setError(null);
      const response = await fetch("/api/teacher-authors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          username: selectedAuthor.username,
          xPostId: currentPost.xPostId,
          tier,
          reason,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "評価保存に失敗しました");
      setTrainingStatus(payload.trainingStatus ?? null);
      const updatedAuthors = store.authors.map((author) =>
        author.username !== selectedAuthor.username
          ? author
          : {
              ...author,
              posts: author.posts.map((post) =>
                post.xPostId === currentPost.xPostId
                  ? { ...post, review: payload.review }
                  : post
              ),
            }
      );
      setStore({
        ...store,
        authors: updatedAuthors,
      });
      setTrainingAuthors((previous) => previous.map((author) =>
        author.username !== selectedAuthor.username
          ? author
          : {
              ...author,
              posts: author.posts.map((post) =>
                post.xPostId === currentPost.xPostId
                  ? { ...post, review: payload.review }
                  : post
              ),
            }
      ));

      if (showReviewed) {
        if (currentIndex < reviewablePosts.length - 1) setCurrentIndex((index) => index + 1);
      } else {
        const updatedCurrent = updatedAuthors.find((author) => author.username === selectedAuthor.username);
        if (updatedCurrent && pendingPosts(updatedCurrent).length > 0) {
          setCurrentIndex(0);
        } else {
          const currentAuthorIndex = updatedAuthors.findIndex((author) => author.username === selectedAuthor.username);
          const nextAuthor = [
            ...updatedAuthors.slice(currentAuthorIndex + 1),
            ...updatedAuthors.slice(0, currentAuthorIndex),
          ].find((author) => pendingPosts(author).length > 0);
          setSelectedUsername(nextAuthor?.username ?? null);
          setCurrentIndex(0);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "評価保存に失敗しました");
    } finally {
      setWorking(false);
    }
  }

  function reportPolicyViolation() {
    if (!currentPost || working) return;
    if (!window.confirm("この動画を規約違反としてランキングから即時除外します。よろしいですか？")) return;
    void saveReview("X", "policy_violation");
  }

  function download() {
    const blob = new Blob([JSON.stringify({ version: 1, authors: trainingAuthors }, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "teacher-authors-review.json";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function changeReviewedVisibility(checked: boolean) {
    setShowReviewed(checked);
    const candidates = store.authors.filter(
      (author) => checked || pendingPosts(author).length > 0
    );
    const nextAuthor = candidates.find((author) => author.username === selectedUsername) ?? candidates[0] ?? null;
    setSelectedUsername(nextAuthor?.username ?? null);
    const firstUnreviewed = nextAuthor ? safePosts(nextAuthor).findIndex((post) => !post.review) : 0;
    setCurrentIndex(checked ? Math.max(0, firstUnreviewed) : 0);
  }

  if (loading) return <main style={{ padding: 30 }}>参考アカウントを読み込み中...</main>;

  return (
    <main style={{ maxWidth: 1380, margin: "0 auto", padding: 22, color: "#171717" }}>
      <a href="/learning-tools" style={{ display: "inline-block", marginBottom: 12, color: "#177d70", fontWeight: 800, textDecoration: "none" }}>← 学習・レビュー管理へ戻る</a>
      <h1 style={{ marginBottom: 6 }}>参考アカウント教師レビュー</h1>
      <p style={{ marginTop: 0 }}>登録済みの選別投稿者とSupabaseに保存済みの動画を読み込み、S・A・その他・Xで教師データ化します。Xからの再取得や投稿者の二重登録は行いません。</p>

      {error && <div style={{ padding: 12, marginBottom: 12, background: "#fff0f0", color: "#9b1c1c" }}>{error}</div>}
      {message && <div style={{ padding: 12, marginBottom: 12, background: "#edf8ef", color: "#175b2d" }}>{message}</div>}

      {trainingStatus && (
        <section style={{ padding: 16, marginBottom: 16, border: trainingStatus.needsRetraining ? "2px solid #d98b00" : "1px solid #b9ddd4", borderRadius: 10, background: trainingStatus.needsRetraining ? "#fff5d8" : "#f4faf8", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <strong>{trainingStatus.needsRetraining ? `視覚モデルの再学習を推奨します（未反映 ${trainingStatus.reviewsSinceTraining}件）` : `次の再学習まであと ${trainingStatus.remainingUntilRetraining}件`}</strong>
            <div style={{ marginTop: 4, color: "#5c6874", fontSize: 13 }}>前回のモデル学習後に追加・更新された評価：{trainingStatus.reviewsSinceTraining} / {trainingStatus.threshold}件</div>
          </div>
          <a href="/preference-model" style={{ padding: "10px 15px", borderRadius: 8, background: trainingStatus.needsRetraining ? "#a85f00" : "#177d70", color: "white", fontWeight: 800, textDecoration: "none" }}>視覚モデル学習を開く</a>
        </section>
      )}

      <section style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: 16, background: "#eef8f5", border: "1px solid #b9ddd4", borderRadius: 10, marginBottom: 20 }}>
        <div><strong>未評価 {pendingVideoCount}動画 / {pendingAuthorCount}投稿者</strong><div style={{ marginTop: 4, color: "#49645d", fontSize: 13 }}>選別投稿者 {store.authors.length}件。過去の教師投稿者 {legacyAuthorCount}件分の評価も学習用に保持しています。</div></div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 7, alignItems: "center", fontWeight: 700 }}><input type="checkbox" checked={showReviewed} onChange={(event) => changeReviewedVisibility(event.target.checked)} />評価済みも表示</label>
          <button onClick={syncCuratedAuthors} disabled={working} style={{ padding: "11px 18px", fontWeight: 700 }}>{working ? "同期中…" : "選別投稿者を再読込"}</button>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 20 }}>
        <aside>
          <h2 style={{ fontSize: 18 }}>{showReviewed ? "すべての選別投稿者" : "未完了の投稿者"}（{visibleAuthors.length}）</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {visibleAuthors.map((author) => {
              const reviewed = author.posts.filter((post) => post.review).length;
              const pending = pendingPosts(author).length;
              return (
                <button key={author.username} onClick={() => { setSelectedUsername(author.username); setCurrentIndex(showReviewed ? Math.max(0, safePosts(author).findIndex((post) => !post.review)) : 0); }} style={{ padding: 12, textAlign: "left", border: author.username === selectedUsername ? "2px solid #111" : "1px solid #ccc", borderRadius: 8, background: "white" }}>
                  <strong>@{author.username}</strong> <span style={{ float: "right" }}>想定{author.expectedTier}</span>
                  <div style={{ marginTop: 5, fontSize: 12, color: "#666" }}>未評価 {pending} / 評価済み {reviewed}</div>
                </button>
              );
            })}
            {visibleAuthors.length === 0 && <p style={{ color: "#666" }}>{store.authors.length === 0 ? "選別投稿者管理画面で投稿者を登録してください。" : "未評価の投稿者はありません。"}</p>}
          </div>
        </aside>

        <section>
          {selectedAuthor ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <h2 style={{ margin: 0 }}>@{selectedAuthor.username} <small>想定Tier {selectedAuthor.expectedTier}</small></h2>
                  <div style={{ marginTop: 5 }}>評価 {authorStats.reviewed}/{allReviewablePosts.length}　未評価 {pendingPosts(selectedAuthor).length}　S {authorStats.s} / A {authorStats.a} / その他 {authorStats.other} / X {authorStats.x}　安全隔離 {quarantinedPosts.length}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={syncCuratedAuthors} disabled={working}>保存済み動画を再読込</button>
                  <button onClick={download}>JSON保存</button>
                </div>
              </div>

              {currentPost ? (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.7fr) minmax(310px, 1fr)", gap: 20 }}>
                  <div>
                    {currentPost.videoUrl ? (
                      <video key={currentPost.xPostId} src={proxyVideo(currentPost.videoUrl)} poster={currentPost.previewImageUrl ? proxyImage(currentPost.previewImageUrl) : undefined} controls autoPlay muted playsInline preload="metadata" style={{ width: "100%", maxHeight: "72vh", background: "#000" }} />
                    ) : <div style={{ minHeight: 400, background: "#111", color: "white", display: "grid", placeItems: "center" }}>動画なし</div>}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                      <button onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))} disabled={currentIndex === 0}>← 前</button>
                      <span>{currentIndex + 1} / {reviewablePosts.length}</span>
                      <button onClick={() => setCurrentIndex((index) => Math.min(reviewablePosts.length - 1, index + 1))} disabled={currentIndex >= reviewablePosts.length - 1}>次 →</button>
                    </div>
                  </div>

                  <aside>
                    <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 8, marginBottom: 12 }}>
                      <strong>@{currentPost.authorUsername}</strong>
                      <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55 }}>{currentPost.text}</p>
                      <div style={{ fontSize: 13 }}>Views {currentPost.views} / Likes {currentPost.likes} / Reposts {currentPost.reposts}</div>
                      {currentPost.review && <p style={{ color: "#175b2d", fontWeight: 700 }}>保存済み: {currentPost.review.tier} {currentPost.review.reason ? `/ ${currentPost.review.reason}` : ""}</p>}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
                      <button onClick={() => saveReview("S")} disabled={working} style={{ padding: 18, fontSize: 24, fontWeight: 800, background: "#ffe8a3" }}>S</button>
                      <button onClick={() => saveReview("A")} disabled={working} style={{ padding: 18, fontSize: 24, fontWeight: 800, background: "#d9f0ff" }}>A</button>
                      <button onClick={() => saveReview("OTHER", "lower_tier")} disabled={working} style={{ gridColumn: "1 / -1", padding: 13, fontWeight: 700 }}>成人向けだがS/A未満</button>
                    </div>

                    <div style={{ padding: 12, border: "1px solid #e2a6a6", borderRadius: 8 }}>
                      <strong>Xにする理由</strong>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 9 }}>
                        {X_REASONS.map(([value, label]) => <button key={value} onClick={() => saveReview("X", value)} disabled={working} style={{ padding: 10 }}>{label}</button>)}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={reportPolicyViolation}
                      disabled={working}
                      style={{ width: "100%", marginTop: 12, padding: 15, border: 0, borderRadius: 8, background: "#a30d20", color: "white", fontSize: 17, fontWeight: 900 }}
                    >
                      規約違反（ランキングから即時除外）
                    </button>
                    <p style={{ margin: "7px 0 0", color: "#8b1b28", fontSize: 12, lineHeight: 1.5 }}>
                      未成年と思われる内容、盗撮、同意のない撮影など、掲載してはいけない動画に使用します。好みモデルの教師データにも使用されません。
                    </p>
                  </aside>
                </div>
              ) : <p>レビューできる保存済み動画がありません。選別投稿者管理画面で収集状態を確認してください。</p>}

              {quarantinedPosts.length > 0 && (
                <details style={{ marginTop: 28, padding: 14, border: "1px solid #b42318" }}>
                  <summary style={{ color: "#b42318", fontWeight: 700 }}>安全NG隔離 {quarantinedPosts.length}件（メディア・Xリンクなし）</summary>
                  {quarantinedPosts.map((post) => <div key={post.xPostId} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}><strong>{post.safetyReasons.join(" / ")}</strong><p>{post.text}</p></div>)}
                </details>
              )}
            </>
          ) : store.authors.length > 0 ? (
            <div style={{ padding: 30, textAlign: "center", background: "#eef8f5", border: "1px solid #b9ddd4", borderRadius: 12 }}>
              <h2 style={{ marginTop: 0 }}>すべての評価が完了しました</h2>
              <p>新着動画が収集されると、この未評価一覧へ自動的に戻ります。</p>
              <button onClick={() => changeReviewedVisibility(true)} style={{ padding: "11px 18px", fontWeight: 700 }}>評価済みを確認</button>
            </div>
          ) : <p>選別投稿者を登録すると、ここにレビュー画面が表示されます。</p>}
        </section>
      </div>
    </main>
  );
}
