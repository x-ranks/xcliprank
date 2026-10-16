"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NSFWJS, PredictionType } from "nsfwjs/core";

type SafetyItem = {
  id: number;
  xPostId: string;
  authorUsername: string | null;
  createdAt: string | null;
  textExcerpt: string;
  reasons: string[];
};

type MediaItem = {
  id: number;
  xPostId: string;
  authorUsername: string | null;
  createdAt: string | null;
  textExcerpt: string;
  previewImageUrl: string | null;
  videoUrl?: string | null;
  adultTier: string | null;
  contentCategory: string | null;
  possiblySensitive?: boolean | null;
  contentFilterScore?: number | null;
  contentFilterReason?: string | null;
  reasons?: string[];
};

type PreviewResponse = {
  success: boolean;
  scannedCount: number;
  safetyCount: number;
  sampleCandidateCount: number;
  visualCandidateCount: number;
  safety: SafetyItem[];
  samples: MediaItem[];
  visual: MediaItem[];
  error?: string;
};

type VisualDecision =
  | "待機中"
  | "解析中"
  | "通過候補"
  | "成人向け度が低い"
  | "モザイク候補"
  | "解析失敗";

type VisualResult = {
  decision: VisualDecision;
  adultScore?: number;
  mosaicScore?: number;
  frames?: FrameResult[];
  error?: string;
};

type FrameResult = {
  position: number;
  preview: string;
  adultScore: number;
  mosaicScore: number;
  predictions: PredictionType[];
};

const ADULT_THRESHOLD = 0.45;
const MOSAIC_THRESHOLD = 0.45;
const FRAME_POSITIONS = [0.1, 0.35, 0.65, 0.9] as const;

function imageProxyUrl(url: string) {
  return `/api/visual-filter-image?url=${encodeURIComponent(url)}`;
}

function videoProxyUrl(url: string) {
  return `/api/video?url=${encodeURIComponent(url)}`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "seeked",
  timeoutMs = 20000
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${eventName}の待機がタイムアウトしました`));
    }, timeoutMs);

    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("動画を読み込めませんでした"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener("error", onError);
    };

    video.addEventListener(eventName, onSuccess, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function openVideo(url: string) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoProxyUrl(url);
  const metadataReady = waitForVideoEvent(video, "loadedmetadata");
  video.load();
  await metadataReady;

  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error("動画の長さを取得できませんでした");
  }

  return video;
}

async function captureFrame(video: HTMLVideoElement, position: number) {
  const target = Math.min(
    Math.max(0.05, video.duration * position),
    Math.max(0.05, video.duration - 0.05)
  );
  const seeked = waitForVideoEvent(video, "seeked");
  video.currentTime = target;
  await seeked;

  const maxWidth = 448;
  const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("フレームを作成できませんでした");
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function mosaicScore(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return 0;
  }

  const width = canvas.width;
  const height = canvas.height;
  const pixels = context.getImageData(0, 0, width, height).data;

  const luminance = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    return (
      pixels[index] * 0.299 +
      pixels[index + 1] * 0.587 +
      pixels[index + 2] * 0.114
    );
  };

  const tileSize = 80;
  let strongest = 0;

  // 画面全体ではなく小領域ごとに、規則的な四角い画素境界を探す。
  for (let top = 0; top < height - 32; top += tileSize) {
    for (let left = 0; left < width - 32; left += tileSize) {
      const right = Math.min(width, left + tileSize);
      const bottom = Math.min(height, top + tileSize);

      for (const blockSize of [4, 6, 8, 10, 12, 16]) {
        const horizontalBuckets = Array(blockSize).fill(0) as number[];
        const horizontalCounts = Array(blockSize).fill(0) as number[];
        const verticalBuckets = Array(blockSize).fill(0) as number[];
        const verticalCounts = Array(blockSize).fill(0) as number[];
        let horizontalTotal = 0;
        let horizontalCount = 0;
        let verticalTotal = 0;
        let verticalCount = 0;

        for (let y = top + 1; y < bottom; y += 2) {
          for (let x = left + 1; x < right; x += 2) {
            const horizontal = Math.abs(luminance(x, y) - luminance(x - 1, y));
            const vertical = Math.abs(luminance(x, y) - luminance(x, y - 1));
            const xBucket = x % blockSize;
            const yBucket = y % blockSize;

            horizontalBuckets[xBucket] += horizontal;
            horizontalCounts[xBucket] += 1;
            verticalBuckets[yBucket] += vertical;
            verticalCounts[yBucket] += 1;
            horizontalTotal += horizontal;
            horizontalCount += 1;
            verticalTotal += vertical;
            verticalCount += 1;
          }
        }

        const horizontalMean = horizontalTotal / Math.max(1, horizontalCount);
        const verticalMean = verticalTotal / Math.max(1, verticalCount);
        const strongestHorizontal = Math.max(
          ...horizontalBuckets.map(
            (total, index) => total / Math.max(1, horizontalCounts[index])
          )
        );
        const strongestVertical = Math.max(
          ...verticalBuckets.map(
            (total, index) => total / Math.max(1, verticalCounts[index])
          )
        );
        const horizontalRatio = strongestHorizontal / Math.max(1, horizontalMean);
        const verticalRatio = strongestVertical / Math.max(1, verticalMean);
        const gridRatio = Math.sqrt(horizontalRatio * verticalRatio);
        const boundaryStrength = Math.sqrt(
          strongestHorizontal * strongestVertical
        );
        const score =
          clamp((gridRatio - 1.3) / 1.4) *
          clamp((boundaryStrength - 4) / 20);

        strongest = Math.max(strongest, score);
      }
    }
  }

  return clamp(strongest);
}

function adultScore(predictions: PredictionType[]) {
  const probability = (name: string) =>
    predictions.find((prediction) => prediction.className === name)?.probability ?? 0;

  return clamp(
    probability("Porn") + probability("Hentai") + probability("Sexy") * 0.5
  );
}

function percent(value?: number) {
  return value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

function decisionColor(decision: VisualDecision) {
  if (decision === "通過候補") return "#237a43";
  if (decision === "待機中" || decision === "解析中") return "#766a12";
  if (decision === "解析失敗") return "#6b7280";
  return "#b42318";
}

export default function VisualFilterPreviewPage() {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<number, VisualResult>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const modelRef = useRef<NSFWJS | null>(null);

  useEffect(() => {
    void loadPreview();
    return () => modelRef.current?.dispose();
  }, []);

  async function loadPreview() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/visual-filter-preview", { cache: "no-store" });
      const payload = (await response.json()) as PreviewResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "プレビュー対象の取得に失敗しました");
      }
      setData(payload);
      setResults(
        Object.fromEntries(
          payload.visual.map((post) => [post.id, { decision: "待機中" }])
        )
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis() {
    if (!data || running) return;

    setRunning(true);
    setProgress(0);
    setError(null);

    try {
      if (!modelRef.current) {
        const nsfwjs = await import("nsfwjs/core");
        modelRef.current = await nsfwjs.load("/api/visual-filter-model/");
      }

      for (let index = 0; index < data.visual.length; index += 1) {
        const post = data.visual[index];
        setResults((previous) => ({
          ...previous,
          [post.id]: { decision: "解析中" },
        }));

        try {
          if (!post.videoUrl) {
            throw new Error("動画URLがありません");
          }
          const video = await openVideo(post.videoUrl);
          const frames: FrameResult[] = [];

          try {
            for (const position of FRAME_POSITIONS) {
              const canvas = await captureFrame(video, position);
              const predictions = await modelRef.current.classify(canvas, 5);
              frames.push({
                position,
                preview: canvas.toDataURL("image/jpeg", 0.76),
                adultScore: adultScore(predictions),
                mosaicScore: mosaicScore(canvas),
                predictions,
              });
            }
          } finally {
            video.pause();
            video.removeAttribute("src");
            video.load();
          }

          const visualAdultScore = Math.max(
            ...frames.map((frame) => frame.adultScore)
          );
          const visualMosaicScore = Math.max(
            0,
            // モザイクにより成人向けモデルの点数が下がる場合があるため、
            // 成人向けと判定されたフレームだけには限定しない。
            ...frames.map((frame) => frame.mosaicScore)
          );
          const decision: VisualDecision =
            visualAdultScore < ADULT_THRESHOLD
              ? "成人向け度が低い"
              : visualMosaicScore >= MOSAIC_THRESHOLD
                ? "モザイク候補"
                : "通過候補";

          setResults((previous) => ({
            ...previous,
            [post.id]: {
              decision,
              adultScore: visualAdultScore,
              mosaicScore: visualMosaicScore,
              frames,
            },
          }));
        } catch (caught) {
          setResults((previous) => ({
            ...previous,
            [post.id]: {
              decision: "解析失敗",
              error: caught instanceof Error ? caught.message : "解析に失敗しました",
            },
          }));
        }

        setProgress(index + 1);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "画像モデルの起動に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  const visualCounts = useMemo(() => {
    const values = Object.values(results);
    return {
      pass: values.filter((result) => result.decision === "通過候補").length,
      nonAdult: values.filter((result) => result.decision === "成人向け度が低い").length,
      mosaic: values.filter((result) => result.decision === "モザイク候補").length,
      errors: values.filter((result) => result.decision === "解析失敗").length,
    };
  }, [results]);

  if (loading) {
    return <main style={{ padding: 32 }}>視覚フィルター候補を読み込み中...</main>;
  }

  if (error && !data) {
    return (
      <main style={{ padding: 32 }}>
        <h1>視覚フィルター確認</h1>
        <p>{error}</p>
        <button onClick={loadPreview}>再読み込み</button>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main style={{ maxWidth: 1320, margin: "0 auto", padding: 24, color: "#171717" }}>
      <h1 style={{ marginBottom: 8 }}>視覚フィルター確認（ローカル専用）</h1>
      <p style={{ marginTop: 0, lineHeight: 1.7 }}>
        DBは更新しません。動画の10%・35%・65%・90%地点で成人向け度とモザイクらしさを試算します。
        サンプルは既存の本文分類です。結果は除外候補であり、自動確定ではありません。
      </p>

      {error && <div style={{ padding: 12, background: "#fff0f0", color: "#9b1c1c" }}>{error}</div>}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, margin: "20px 0" }}>
        {[
          ["DB確認件数", data.scannedCount],
          ["安全隔離", data.safetyCount],
          ["サンプル候補", data.sampleCandidateCount],
          ["成人向け度が低い", visualCounts.nonAdult],
          ["モザイク候補", visualCounts.mosaic],
          ["通過候補", visualCounts.pass],
        ].map(([label, value]) => (
          <div key={String(label)} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14, background: "#fff" }}>
            <div style={{ fontSize: 13, color: "#666" }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
          </div>
        ))}
      </section>

      <button
        onClick={runAnalysis}
        disabled={running}
        style={{ padding: "13px 22px", border: 0, borderRadius: 8, background: "#111", color: "#fff", fontWeight: 700, cursor: running ? "wait" : "pointer" }}
      >
        {running ? `4フレーム解析中 ${progress} / ${data.visual.length}` : "4フレーム解析を開始"}
      </button>
      <span style={{ marginLeft: 12, fontSize: 13, color: "#666" }}>
        判定目安: 成人向け45%以上、モザイク45%以上
      </span>

      <section style={{ marginTop: 36 }}>
        <h2>安全NGワード隔離（{data.safety.length}件表示）</h2>
        <p style={{ color: "#8b1d18" }}>
          「未成年・流出・盗撮」該当分です。この欄では安全のため画像・動画・Xリンクを読み込みません。
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
          {data.safety.map((post) => (
            <article key={post.id} style={{ border: "2px solid #b42318", borderRadius: 10, padding: 16, background: "#fff7f6" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {post.reasons.map((reason) => (
                  <strong key={reason} style={{ padding: "4px 9px", borderRadius: 999, background: "#b42318", color: "white" }}>{reason}</strong>
                ))}
              </div>
              <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.55 }}>{post.textExcerpt}</p>
              <div style={{ fontSize: 12, color: "#666" }}>@{post.authorUsername ?? "unknown"} / ID {post.xPostId}</div>
            </article>
          ))}
          {data.safety.length === 0 && <p>該当投稿はありません。</p>}
        </div>
      </section>

      <section style={{ marginTop: 42 }}>
        <h2>宣伝・サンプル除去候補（{data.samples.length}件）</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {data.samples.map((post) => (
            <article key={post.id} style={{ border: "1px solid #e0a100", borderRadius: 10, overflow: "hidden", background: "#fffdf3" }}>
              {post.previewImageUrl && <img src={imageProxyUrl(post.previewImageUrl)} alt="サンプル候補のサムネイル" loading="lazy" style={{ width: "100%", height: 190, objectFit: "contain", background: "#111" }} />}
              <div style={{ padding: 14 }}>
                <strong style={{ color: "#8a5b00" }}>サンプル候補</strong>
                <div style={{ marginTop: 7 }}>{post.reasons?.join(" / ")}</div>
                <p style={{ fontSize: 13, lineHeight: 1.5 }}>{post.textExcerpt}</p>
                <div style={{ fontSize: 12, color: "#666" }}>現在: {post.contentCategory ?? "-"} / Tier {post.adultTier ?? "-"}</div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 42 }}>
        <h2>画像判定対象（{data.visual.length}件）</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {data.visual.map((post) => {
            const result = results[post.id] ?? { decision: "待機中" as const };
            return (
              <article key={post.id} style={{ border: `2px solid ${decisionColor(result.decision)}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                {result.frames ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#111" }}>
                    {result.frames.map((frame) => (
                      <figure key={frame.position} style={{ margin: 0, position: "relative", border: "1px solid #333" }}>
                        <img src={frame.preview} alt={`${Math.round(frame.position * 100)}%地点`} style={{ width: "100%", height: 130, objectFit: "contain", display: "block" }} />
                        <figcaption style={{ position: "absolute", left: 5, bottom: 5, padding: "2px 5px", background: "rgba(0,0,0,.72)", color: "white", fontSize: 11 }}>
                          {Math.round(frame.position * 100)}% / 成人 {percent(frame.adultScore)} / モザイク {percent(frame.mosaicScore)}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : post.previewImageUrl ? (
                  <img src={imageProxyUrl(post.previewImageUrl)} alt="解析前のサムネイル" loading="lazy" style={{ width: "100%", height: 210, objectFit: "contain", background: "#111" }} />
                ) : null}
                <div style={{ padding: 14 }}>
                  <strong style={{ color: decisionColor(result.decision) }}>{result.decision}</strong>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 9, fontSize: 13 }}>
                    <span>成人向け度: {percent(result.adultScore)}</span>
                    <span>モザイク度: {percent(result.mosaicScore)}</span>
                  </div>
                  {result.frames && <div style={{ marginTop: 7, fontSize: 11, color: "#666" }}>成人向け度・モザイク度は4フレーム中の最大値</div>}
                  {result.error && <div style={{ color: "#a00", fontSize: 12 }}>{result.error}</div>}
                  <p style={{ fontSize: 13, lineHeight: 1.5 }}>{post.textExcerpt}</p>
                  <div style={{ fontSize: 12, color: "#666" }}>現在: {post.contentCategory ?? "-"} / Tier {post.adultTier ?? "-"}</div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <p style={{ marginTop: 38, padding: 14, background: "#f4f4f4", fontSize: 13, lineHeight: 1.6 }}>
        注意: 画像モデルは裸体・性的表現の一般分類で、無修正かどうかを確定するモデルではありません。
        モザイク度は各フレーム内の小領域にある規則的な画素境界の簡易推定です。4地点以外の場面は見逃す可能性があります。
      </p>
    </main>
  );
}
