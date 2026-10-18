"use client";

import { useEffect, useMemo, useState } from "react";

type ReviewPost = {
  id: number;
  x_post_id: string;
  author_username: string | null;
  author_name: string | null;
  text: string | null;
  created_at: string | null;
  x_url: string | null;
  preview_image_url: string | null;
  video_url: string | null;

  views: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;

  adult_score: number | null;
  creator_score: number | null;
  effective_adult_score: number | null;
  adult_tier: string | null;

  manual_tier: string | null;
};

type ReviewResponse = {
  success: boolean;
  count: number;
  posts: ReviewPost[];
};

const NORMAL_TIERS = ["S", "A", "B", "C", "D"] as const;

const REVIEWABLE_AUTO_TIERS = [
  "S",
  "A+",
  "A",
  "B+",
  "B",
  "C",
  "D+",
  "D",
] as const;

const PREFERENCE_FEATURES = [
  {
    value: "personal_shot",
    label: "個人撮影",
  },
  {
    value: "uncensored",
    label: "無修正",
  },
  {
    value: "neither",
    label: "どちらでもない",
  },
] as const;

const X_REASONS = [
  {
    value: "ai_generated",
    label: "AI生成",
  },
  {
    value: "soft_gravure",
    label: "着エロ・グラビア",
  },
  {
    value: "out_of_scope",
    label: "サイト対象外",
  },
  {
    value: "promo_sample",
    label: "宣伝・サンプル",
  },
  {
    value: "weak_content",
    label: "内容が弱い",
  },
  {
    value: "repost_duplicate",
    label: "重複・転載系",
  },
  {
    value: "other",
    label: "その他",
  },
] as const;

export default function ReviewPage() {
  const [posts, setPosts] = useState<ReviewPost[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [reviewedCount, setReviewedCount] = useState(0);

  const [selectedFeatures, setSelectedFeatures] =
    useState<string[]>([]);

  /*
    Xを押したときだけtrue。
    理由選択画面を表示する。
  */
  const [showXReasons, setShowXReasons] = useState(false);

  const currentPost = posts[currentIndex];

  const progress = useMemo(() => {
    if (posts.length === 0) {
      return 0;
    }

    return Math.round(
      (reviewedCount / posts.length) * 100
    );
  }, [reviewedCount, posts.length]);

  useEffect(() => {
    loadPosts();
  }, []);

  async function loadPosts() {
    try {
      setLoading(true);
      setError(null);
      setShowXReasons(false);
      setSelectedFeatures([]);

      const response = await fetch("/api/review", {
        cache: "no-store",
      });

      const data: ReviewResponse = await response.json();

      if (!data.success) {
        throw new Error(
          "レビュー対象の取得に失敗しました"
        );
      }

      setPosts(
        data.posts.filter(
          (post) =>
            post.adult_tier !== null &&
            (REVIEWABLE_AUTO_TIERS as readonly string[]).includes(
              post.adult_tier
            )
        )
      );
      setCurrentIndex(0);
      setReviewedCount(0);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "レビュー対象の取得に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveReview(
    tier: string,
    category: string | null = null
  ) {
    if (!currentPost || saving) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const response = await fetch("/api/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          postId: currentPost.id,
          manualTier: tier,
          manualCategory: category,
          manualReviewNote:
            selectedFeatures.length > 0
              ? `preference_tags:${selectedFeatures.join(",")}`
              : null,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(
          data.error ?? "評価の保存に失敗しました"
        );
      }

      setReviewedCount((previous) => previous + 1);
      setShowXReasons(false);
      setSelectedFeatures([]);

      if (currentIndex < posts.length - 1) {
        setCurrentIndex((previous) => previous + 1);
      } else {
        setCurrentIndex(posts.length);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "評価の保存に失敗しました"
      );
    } finally {
      setSaving(false);
    }
  }

  function selectTier(tier: string) {
    if (saving) {
      return;
    }

    if (tier === "X") {
      setShowXReasons(true);
      return;
    }

    saveReview(tier);
  }

  function toggleFeature(feature: string) {
    if (saving) {
      return;
    }

    setSelectedFeatures((previous) => {
      if (feature === "neither") {
        return previous.includes("neither")
          ? []
          : ["neither"];
      }

      const withoutNeither = previous.filter(
        (value) => value !== "neither"
      );

      return withoutNeither.includes(feature)
        ? withoutNeither.filter(
            (value) => value !== feature
          )
        : [...withoutNeither, feature];
    });
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (saving || !currentPost) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }

      /*
        X理由選択中は、
        S/A/B/C/D等を誤入力しないようにする。

        Escapeだけキャンセルとして許可。
      */
      if (showXReasons) {
        if (event.key === "Escape") {
          setShowXReasons(false);
        }

        return;
      }

      const key = event.key.toLowerCase();

      if (key === "s") {
        selectTier("S");
      }

      if (key === "a") {
        selectTier("A");
      }

      if (key === "b") {
        selectTier("B");
      }

      if (key === "c") {
        selectTier("C");
      }

      if (key === "d") {
        selectTier("D");
      }

      if (key === "x") {
        selectTier("X");
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentPost, saving, showXReasons]);

  if (loading) {
    return (
      <main style={{ padding: 30 }}>
        <h1>動画レビュー</h1>
        <p>レビュー対象を読み込み中...</p>
      </main>
    );
  }

  if (error && posts.length === 0) {
    return (
      <main style={{ padding: 30 }}>
        <h1>動画レビュー</h1>

        <p>{error}</p>

        <button
          onClick={loadPosts}
          style={{
            padding: "12px 24px",
            cursor: "pointer",
          }}
        >
          再読み込み
        </button>
      </main>
    );
  }

  if (!currentPost) {
    return (
      <main
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: 30,
          textAlign: "center",
        }}
      >
        <h1>レビュー完了</h1>

        <p style={{ fontSize: 24 }}>
          {reviewedCount} 件の評価が完了しました。
        </p>

        <button
          onClick={loadPosts}
          style={{
            padding: "12px 24px",
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          次の100件を取得
        </button>
      </main>
    );
  }

  /*
    video.twimg.comへ直接アクセスせず、
    既存の動画Proxyを利用。
  */
  const proxyVideoUrl = currentPost.video_url
    ? `/api/video?url=${encodeURIComponent(
        currentPost.video_url
      )}`
    : null;

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: 20,
      }}
    >
      {/* ヘッダー */}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h1 style={{ margin: 0 }}>動画レビュー</h1>

        <div
          style={{
            fontSize: 18,
            fontWeight: "bold",
          }}
        >
          {reviewedCount} / {posts.length}
        </div>
      </div>

      {/* 進捗 */}

      <div
        style={{
          height: 10,
          background: "#ddd",
          borderRadius: 999,
          overflow: "hidden",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "#333",
            transition: "width 0.2s",
          }}
        />
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            border: "1px solid #d33",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 2fr) minmax(280px, 1fr)",
          gap: 24,
        }}
      >
        {/* 動画 */}

        <section>
          {proxyVideoUrl ? (
            <video
              key={currentPost.id}
              src={proxyVideoUrl}
              controls
              autoPlay
              muted
              playsInline
              preload="metadata"
              poster={
                currentPost.preview_image_url ?? undefined
              }
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;

                /*
                  冒頭黒画面対策。
                */
                if (
                  Number.isFinite(video.duration) &&
                  video.duration > 2
                ) {
                  try {
                    video.currentTime = 1;
                  } catch {
                    // シーク不可ならそのまま
                  }
                }
              }}
              onSeeked={(event) => {
                const video = event.currentTarget;

                video.play().catch(() => {
                  // autoplay不可なら手動再生
                });
              }}
              onError={() => {
                console.error(
                  "Review video playback error:",
                  proxyVideoUrl
                );
              }}
              style={{
                width: "100%",
                maxHeight: "70vh",
                background: "#000",
              }}
            />
          ) : currentPost.preview_image_url ? (
            <img
              src={currentPost.preview_image_url}
              alt=""
              style={{
                width: "100%",
                maxHeight: "70vh",
                objectFit: "contain",
                background: "#000",
              }}
            />
          ) : (
            <div
              style={{
                minHeight: 400,
                display: "grid",
                placeItems: "center",
                background: "#111",
                color: "#fff",
              }}
            >
              動画なし
            </div>
          )}
        </section>

        {/* 右側 */}

        <aside>
          {/* 現行アルゴリズム情報 */}

          <div
            style={{
              border: "1px solid #ddd",
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <strong>現在の自動Tier:</strong>{" "}
              {currentPost.adult_tier ?? "-"}
            </div>

            <div>
              <strong>effective:</strong>{" "}
              {currentPost.effective_adult_score ?? "-"}
            </div>

            <div>
              <strong>adult:</strong>{" "}
              {currentPost.adult_score ?? "-"}
            </div>

            <div>
              <strong>creator:</strong>{" "}
              {currentPost.creator_score ?? "-"}
            </div>
          </div>

          {/* 投稿情報 */}

          <div
            style={{
              border: "1px solid #ddd",
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: "bold" }}>
              @{currentPost.author_username ?? "unknown"}
            </div>

            <p
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {currentPost.text}
            </p>

            <div>Views: {currentPost.views ?? 0}</div>
            <div>Likes: {currentPost.likes ?? 0}</div>
            <div>Reposts: {currentPost.reposts ?? 0}</div>
            <div>Replies: {currentPost.replies ?? 0}</div>

            {currentPost.x_url && (
              <p>
                <a
                  href={currentPost.x_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Xで開く
                </a>
              </p>
            )}
          </div>

          {/* 好みの特徴 */}

          <div
            style={{
              border: "1px solid #ddd",
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontWeight: "bold",
                marginBottom: 6,
              }}
            >
              好みの特徴（任意・複数可）
            </div>

            <p
              style={{
                margin: "0 0 12px",
                fontSize: 13,
                opacity: 0.7,
              }}
            >
              映像から判断できる場合だけ選んでください。
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              {PREFERENCE_FEATURES.map((feature) => {
                const selected =
                  selectedFeatures.includes(feature.value);

                return (
                  <button
                    key={feature.value}
                    type="button"
                    onClick={() =>
                      toggleFeature(feature.value)
                    }
                    disabled={saving}
                    aria-pressed={selected}
                    style={{
                      padding: "12px 6px",
                      border: selected
                        ? "2px solid #245b3c"
                        : "1px solid #bbb",
                      background: selected
                        ? "#e3f3e9"
                        : "#fff",
                      color: selected
                        ? "#17452c"
                        : "#222",
                      fontWeight: "bold",
                      cursor: saving ? "wait" : "pointer",
                    }}
                  >
                    {selected ? "✓ " : ""}
                    {feature.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 通常Tier */}

          {!showXReasons && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 10,
                }}
              >
                {NORMAL_TIERS.map((tier) => (
                  <button
                    key={tier}
                    onClick={() => selectTier(tier)}
                    disabled={saving}
                    style={{
                      padding: "18px 10px",
                      fontSize: 24,
                      fontWeight: "bold",
                      cursor: saving ? "wait" : "pointer",
                    }}
                  >
                    {tier}
                  </button>
                ))}

                <button
                  onClick={() => selectTier("X")}
                  disabled={saving}
                  style={{
                    padding: "18px 10px",
                    fontSize: 24,
                    fontWeight: "bold",
                    cursor: saving ? "wait" : "pointer",
                  }}
                >
                  X
                </button>
              </div>

              <p
                style={{
                  marginTop: 16,
                  fontSize: 13,
                  opacity: 0.7,
                }}
              >
                S / A / B / C / D / X キーでも評価できます。
              </p>
            </>
          )}

          {/* X理由選択 */}

          {showXReasons && (
            <div
              style={{
                border: "2px solid #888",
                padding: 16,
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  fontSize: 20,
                }}
              >
                Xにした理由
              </h2>

              <p
                style={{
                  fontSize: 13,
                  opacity: 0.75,
                }}
              >
                最も大きな理由を1つ選んでください。
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {X_REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    onClick={() =>
                      saveReview("X", reason.value)
                    }
                    disabled={saving}
                    style={{
                      padding: "14px 8px",
                      fontSize: 15,
                      fontWeight: "bold",
                      cursor: saving ? "wait" : "pointer",
                    }}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowXReasons(false)}
                disabled={saving}
                style={{
                  width: "100%",
                  marginTop: 12,
                  padding: 10,
                  cursor: "pointer",
                }}
              >
                キャンセル
              </button>

              <p
                style={{
                  marginBottom: 0,
                  fontSize: 12,
                  opacity: 0.6,
                }}
              >
                Escキーでもキャンセルできます。
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
