"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NSFWJS } from "nsfwjs/core";

type RankingPost = {
  id: number;
  x_post_id: string;
  author_username: string | null;
  preview_image_url: string | null;
  video_url: string | null;
  adult_tier: string | null;
  effective_adult_score: number | null;
  score: number | null;
  ranking_value: number | null;
  x_url: string | null;
};

type StoredModel = {
  trainedAt: string;
  normalization: { mean: number[]; std: number[] };
  weights: number[];
  evaluation: { pairAccuracy: number | null };
};

type ScoredPost = RankingPost & {
  currentRank: number;
  visualScore: number;
  visualPercentile: number;
  basePercentile: number;
  combinedScore: number;
  combinedRank: number;
};

const FRAME_POSITIONS = [0.1, 0.35, 0.65, 0.9] as const;
const TIER_WEIGHT: Record<string, number> = { S: 5, "A+": 4, A: 3, B: 2, C: 1 };
const TARGET_COUNT = 100;

function videoProxyUrl(url: string) {
  return `/api/video?url=${encodeURIComponent(url)}`;
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked", timeoutMs = 20000) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error(`${eventName} timeout`)); }, timeoutMs);
    const success = () => { cleanup(); resolve(); };
    const failure = () => { cleanup(); reject(new Error("video load error")); };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, success);
      video.removeEventListener("error", failure);
    };
    video.addEventListener(eventName, success, { once: true });
    video.addEventListener("error", failure, { once: true });
  });
}

async function openVideo(url: string) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoProxyUrl(url);
  const ready = waitForVideoEvent(video, "loadedmetadata");
  video.load();
  await ready;
  if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("invalid video duration");
  return video;
}

async function captureFrame(video: HTMLVideoElement, position: number) {
  const target = Math.min(Math.max(0.05, video.duration * position), Math.max(0.05, video.duration - 0.05));
  const seeked = waitForVideoEvent(video, "seeked");
  video.currentTime = target;
  await seeked;
  const maxWidth = 448;
  const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function frameStatistics(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0, 0];
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;
  let luminanceTotal = 0;
  let luminanceSquared = 0;
  let saturationTotal = 0;
  let edgeTotal = 0;
  let samples = 0;
  for (let y = 2; y < height; y += 4) {
    for (let x = 2; x < width; x += 4) {
      const index = (y * width + x) * 4;
      const previous = (y * width + x - 1) * 4;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      const previousLum = pixels[previous] * 0.299 + pixels[previous + 1] * 0.587 + pixels[previous + 2] * 0.114;
      luminanceTotal += lum;
      luminanceSquared += lum * lum;
      saturationTotal += Math.max(r, g, b) - Math.min(r, g, b);
      edgeTotal += Math.abs(lum - previousLum);
      samples += 1;
    }
  }
  const mean = luminanceTotal / Math.max(1, samples);
  const variance = Math.max(0, luminanceSquared / Math.max(1, samples) - mean * mean);
  return [mean / 255, Math.sqrt(variance) / 128, saturationTotal / Math.max(1, samples) / 255, edgeTotal / Math.max(1, samples) / 128];
}

async function extractFeatures(model: NSFWJS, url: string) {
  const video = await openVideo(url);
  const embeddings: number[][] = [];
  const probabilities: number[][] = [];
  const statistics: number[][] = [];
  try {
    for (const position of FRAME_POSITIONS) {
      const canvas = await captureFrame(video, position);
      const embeddingTensor = model.infer(canvas, "flatten_1");
      const probabilityTensor = model.infer(canvas);
      embeddings.push(Array.from(await embeddingTensor.data()));
      probabilities.push(Array.from(await probabilityTensor.data()));
      statistics.push(frameStatistics(canvas));
      embeddingTensor.dispose();
      probabilityTensor.dispose();
    }
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  const average = (vectors: number[][], index: number) => vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length;
  const maximum = (vectors: number[][], index: number) => Math.max(...vectors.map((vector) => vector[index]));
  return [
    ...embeddings[0].map((_, index) => average(embeddings, index)),
    ...probabilities[0].map((_, index) => average(probabilities, index)),
    ...probabilities[0].map((_, index) => maximum(probabilities, index)),
    ...statistics[0].map((_, index) => average(statistics, index)),
    ...statistics[0].map((_, index) => maximum(statistics, index)),
  ];
}

function modelScore(features: number[], model: StoredModel) {
  return model.weights.reduce(
    (sum, weight, index) => sum + weight * ((features[index] - model.normalization.mean[index]) / model.normalization.std[index]),
    0
  );
}

function percentile(index: number, length: number) {
  return length <= 1 ? 1 : 1 - index / (length - 1);
}

function combine(posts: RankingPost[], visualScores: Record<string, number>, visualWeight: number): ScoredPost[] {
  const current = posts.map((post, index) => ({ ...post, currentRank: index + 1 }));
  const tierGroups = new Map<string, typeof current>();
  for (const post of current) {
    const tier = post.adult_tier ?? "";
    tierGroups.set(tier, [...(tierGroups.get(tier) ?? []), post]);
  }
  const prepared: Omit<ScoredPost, "combinedRank">[] = [];
  for (const group of tierGroups.values()) {
    const visualOrder = [...group].sort((a, b) => visualScores[b.x_post_id] - visualScores[a.x_post_id]);
    const visualRanks = new Map(visualOrder.map((post, index) => [post.x_post_id, percentile(index, group.length)]));
    group.forEach((post, index) => {
      const basePercentile = percentile(index, group.length);
      const visualPercentile = visualRanks.get(post.x_post_id) ?? 0;
      prepared.push({
        ...post,
        visualScore: visualScores[post.x_post_id],
        visualPercentile,
        basePercentile,
        combinedScore: basePercentile * (1 - visualWeight) + visualPercentile * visualWeight,
      });
    });
  }
  return prepared
    .sort((a, b) => (TIER_WEIGHT[b.adult_tier ?? ""] ?? 0) - (TIER_WEIGHT[a.adult_tier ?? ""] ?? 0) || b.combinedScore - a.combinedScore || a.currentRank - b.currentRank)
    .map((post, index) => ({ ...post, combinedRank: index + 1 }));
}

export default function CombinedRankingPreviewPage() {
  const [posts, setPosts] = useState<RankingPost[]>([]);
  const [storedModel, setStoredModel] = useState<StoredModel | null>(null);
  const [visualScores, setVisualScores] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failedPostIds, setFailedPostIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visualWeight, setVisualWeight] = useState(0.2);
  const modelRef = useRef<NSFWJS | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/rankings?range=weekly&visual=0", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/preference-model", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([ranking, model]) => {
      if (!ranking.ok) throw new Error(ranking.error ?? "ランキング取得に失敗しました");
      if (!model.success || !model.model) throw new Error(model.error ?? "学習モデル取得に失敗しました");
      setPosts((ranking.data as RankingPost[]).filter((post) => post.video_url).slice(0, TARGET_COUNT));
      setStoredModel(model.model as StoredModel);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
    return () => modelRef.current?.dispose();
  }, []);

  const combined = useMemo(
    () => Object.keys(visualScores).length === posts.length ? combine(posts, visualScores, visualWeight) : [],
    [posts, visualScores, visualWeight]
  );
  const failures = failedPostIds.length;
  const successfulScoreCount = Math.max(0, posts.length - failures);

  async function analyze() {
    if (!storedModel || running) return;
    setRunning(true);
    setError(null);
    setSaveMessage(null);
    setFailedPostIds([]);
    setVisualScores({});
    setProgress(0);
    const scores: Record<string, number> = {};
    const failedIds: string[] = [];
    try {
      if (!modelRef.current) {
        const nsfwjs = await import("nsfwjs/core");
        modelRef.current = await nsfwjs.load("/api/visual-filter-model/");
      }
      for (let index = 0; index < posts.length; index += 1) {
        const post = posts[index];
        try {
          scores[post.x_post_id] = modelScore(await extractFeatures(modelRef.current, post.video_url!), storedModel);
        } catch {
          failedIds.push(post.x_post_id);
          setFailedPostIds([...failedIds]);
          scores[post.x_post_id] = 0;
        }
        setProgress(index + 1);
      }
      setVisualScores(scores);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "解析に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  async function saveScores() {
    if (!storedModel || Object.keys(visualScores).length !== posts.length || saving) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const failedSet = new Set(failedPostIds);
      const scoresToSave = posts
        .filter((post) => !failedSet.has(post.x_post_id))
        .map((post) => ({ xPostId: post.x_post_id, score: visualScores[post.x_post_id] }));
      if (scoresToSave.length === 0) throw new Error("保存できる視覚スコアがありません。");
      const response = await fetch("/api/visual-preference-scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelTrainedAt: storedModel.trainedAt,
          scores: scoresToSave,
        }),
      });
      const raw = await response.text();
      let payload: { success?: boolean; error?: string; updatedCount?: number } | null = null;
      try { payload = JSON.parse(raw); } catch { payload = null; }
      if (!response.ok || !payload?.success) throw new Error(payload?.error ?? "保存に失敗しました");
      setSaveMessage(`本番用の視覚スコアを${payload.updatedCount ?? 0}件保存しました。${failures > 0 ? ` 解析失敗${failures}件は変更していません。` : ""}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main style={{ padding: 30 }}>比較データを読み込み中...</main>;

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: 24, color: "#171717" }}>
      <h1>現行＋視覚モデル ランキング比較</h1>
      <p>安全判定・除外・Tier順は現行のまま。同じTier内で、現行順位{Math.round((1 - visualWeight) * 100)}%＋視覚好み{Math.round(visualWeight * 100)}%を使います。</p>
      {error && <div style={{ padding: 12, background: "#fff0f0", color: "#9b1c1c", marginBottom: 14 }}>{error}</div>}
      {saveMessage && <div style={{ padding: 12, background: "#edf8ef", color: "#175b2d", marginBottom: 14 }}>{saveMessage}</div>}
      <section style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "18px 0" }}>
        <button onClick={analyze} disabled={running || posts.length === 0} style={{ padding: "12px 18px", fontWeight: 800 }}>
          {running ? `動画を解析中 ${progress}/${posts.length}` : `${posts.length}件を視覚モデルで比較`}
        </button>
        <label>視覚モデルの比率 <strong>{Math.round(visualWeight * 100)}%</strong> <input type="range" min="0" max="1" step="0.05" value={visualWeight} onChange={(event) => setVisualWeight(Number(event.target.value))} /></label>
        <span>失敗 {failures}件</span>
        <span>モデル精度 {storedModel?.evaluation.pairAccuracy == null ? "-" : `${(storedModel.evaluation.pairAccuracy * 100).toFixed(1)}%`}</span>
        {combined.length > 0 && <button onClick={saveScores} disabled={saving || successfulScoreCount === 0} style={{ padding: "12px 18px", fontWeight: 800, background: "#177d70", color: "white", border: 0, borderRadius: 6 }}>{saving ? "保存中…" : `成功した${successfulScoreCount}件を本番用に保存`}</button>}
      </section>
      {combined.length > 0 && failures > 0 && <p style={{ padding: 11, background: "#fff8dc", color: "#6b5200" }}>解析に失敗した{failures}件は保存対象から外し、既存スコアがある場合も上書きしません。</p>}
      {combined.length === 0 ? (
        <p>比較ボタンを押すと、現在の上位{posts.length}件を並べ替えます。</p>
      ) : (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
          {combined.slice(0, 30).map((post) => {
            const movement = post.currentRank - post.combinedRank;
            return (
              <article key={post.x_post_id} style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden", background: "white" }}>
                <video controls preload="none" poster={post.preview_image_url ?? undefined} src={post.video_url ? videoProxyUrl(post.video_url) : undefined} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", background: "#111" }} />
                <div style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>新 {post.combinedRank}位</strong><span style={{ color: movement > 0 ? "#16733d" : movement < 0 ? "#a12622" : "#666" }}>{movement > 0 ? `↑${movement}` : movement < 0 ? `↓${Math.abs(movement)}` : "→"}（現 {post.currentRank}位）</span></div>
                  <div style={{ marginTop: 8 }}>Tier {post.adult_tier} ／ 視覚順位 {Math.round(post.visualPercentile * 100)}点</div>
                  <div style={{ color: "#666", marginTop: 4 }}>@{post.author_username ?? "unknown"}</div>
                  {post.x_url && <a href={post.x_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8 }}>X投稿を開く</a>}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
