"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NSFWJS } from "nsfwjs/core";

type ReviewTier = "S" | "A" | "OTHER" | "X";

type TeacherPost = {
  xPostId: string;
  videoUrl: string | null;
  safetyReasons: string[];
  review: { tier: ReviewTier } | null;
};

type TeacherAuthor = {
  username: string;
  posts: TeacherPost[];
};

type FeatureSample = {
  author: string;
  xPostId: string;
  label: ReviewTier;
  labelValue: number;
  features: number[];
};

type FoldResult = {
  author: string;
  pairCount: number;
  correct: number;
  accuracy: number | null;
};

type StoredModel = {
  version: 1;
  trainedAt: string;
  featureSpec: {
    endpoint: "flatten_1";
    framePositions: number[];
    embeddingAggregation: "mean";
    extras: string[];
    authorIdentityUsed: false;
    engagementUsed: false;
  };
  training: {
    authors: number;
    samples: number;
    extracted: number;
    failed: number;
    tierCounts: Record<string, number>;
    pairCount: number;
  };
  evaluation: {
    method: "leave-one-author-out";
    pairAccuracy: number | null;
    evaluatedPairs: number;
    folds: FoldResult[];
  };
  normalization: { mean: number[]; std: number[] };
  weights: number[];
  scoreByTier: Record<string, { count: number; average: number }>;
  trainingItems: Array<{
    author: string;
    xPostId: string;
    label: ReviewTier;
    score: number;
  }>;
};

const FRAME_POSITIONS = [0.1, 0.35, 0.65, 0.9] as const;
const LABEL_VALUES: Record<ReviewTier, number> = { S: 3, A: 2, OTHER: 1, X: 0 };
const FEATURE_CACHE_SPEC = "nsfwjs-flatten_1-four-frames-v1";
const FEATURE_CACHE_BATCH_SIZE = 5;

type FeatureCacheWrite = {
  xPostId: string;
  kind: "success" | "failure";
  featuresBase64?: string;
  dimension?: number;
  error?: string;
};

function videoProxyUrl(url: string) {
  return `/api/video?url=${encodeURIComponent(url)}`;
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadedmetadata" | "seeked",
  timeoutMs = 20000
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${eventName} timeout`));
    }, timeoutMs);
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
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error("invalid video duration");
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
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function frameStatistics(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0, 0];
  const width = canvas.width;
  const height = canvas.height;
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
  return [
    mean / 255,
    Math.sqrt(variance) / 128,
    saturationTotal / Math.max(1, samples) / 255,
    edgeTotal / Math.max(1, samples) / 128,
  ];
}

async function extractPostFeatures(model: NSFWJS, videoUrl: string) {
  const video = await openVideo(videoUrl);
  const embeddings: number[][] = [];
  const probabilityVectors: number[][] = [];
  const statistics: number[][] = [];

  try {
    for (const position of FRAME_POSITIONS) {
      const canvas = await captureFrame(video, position);
      const embeddingTensor = model.infer(canvas, "flatten_1");
      const probabilityTensor = model.infer(canvas);
      const embedding = Array.from(await embeddingTensor.data());
      const probabilities = Array.from(await probabilityTensor.data());
      embeddingTensor.dispose();
      probabilityTensor.dispose();
      embeddings.push(embedding);
      probabilityVectors.push(probabilities);
      statistics.push(frameStatistics(canvas));
    }
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  const average = (vectors: number[][], index: number) =>
    vectors.reduce((total, vector) => total + vector[index], 0) / vectors.length;
  const maximum = (vectors: number[][], index: number) =>
    Math.max(...vectors.map((vector) => vector[index]));

  const embeddingMean = embeddings[0].map((_, index) => average(embeddings, index));
  const probabilityMean = probabilityVectors[0].map((_, index) => average(probabilityVectors, index));
  const probabilityMax = probabilityVectors[0].map((_, index) => maximum(probabilityVectors, index));
  const statisticMean = statistics[0].map((_, index) => average(statistics, index));
  const statisticMax = statistics[0].map((_, index) => maximum(statistics, index));

  return [...embeddingMean, ...probabilityMean, ...probabilityMax, ...statisticMean, ...statisticMax];
}

function normalization(samples: FeatureSample[]) {
  const dimension = samples[0].features.length;
  const mean = Array(dimension).fill(0) as number[];
  const std = Array(dimension).fill(0) as number[];
  for (const sample of samples) {
    for (let index = 0; index < dimension; index += 1) mean[index] += sample.features[index];
  }
  for (let index = 0; index < dimension; index += 1) mean[index] /= samples.length;
  for (const sample of samples) {
    for (let index = 0; index < dimension; index += 1) {
      const difference = sample.features[index] - mean[index];
      std[index] += difference * difference;
    }
  }
  for (let index = 0; index < dimension; index += 1) {
    std[index] = Math.sqrt(std[index] / samples.length);
    if (std[index] < 1e-6) std[index] = 1;
  }
  return { mean, std };
}

function normalizedFeatures(sample: FeatureSample, mean: number[], std: number[]) {
  return sample.features.map((value, index) => (value - mean[index]) / std[index]);
}

function buildPairs(samples: FeatureSample[]) {
  const pairs: Array<[number, number]> = [];
  const indexesByAuthor = new Map<string, number[]>();
  samples.forEach((sample, index) => {
    const indexes = indexesByAuthor.get(sample.author) ?? [];
    indexes.push(index);
    indexesByAuthor.set(sample.author, indexes);
  });
  for (const indexes of indexesByAuthor.values()) {
    for (let firstOffset = 0; firstOffset < indexes.length; firstOffset += 1) {
      for (let secondOffset = firstOffset + 1; secondOffset < indexes.length; secondOffset += 1) {
        const first = indexes[firstOffset];
        const second = indexes[secondOffset];
        if (samples[first].labelValue === samples[second].labelValue) continue;
      pairs.push(
        samples[first].labelValue > samples[second].labelValue
          ? [first, second]
          : [second, first]
      );
      }
    }
  }
  return pairs;
}

function trainRanker(samples: FeatureSample[], epochs: number) {
  const { mean, std } = normalization(samples);
  const vectors = samples.map((sample) => normalizedFeatures(sample, mean, std));
  const pairs = buildPairs(samples);
  const weights = Array(vectors[0].length).fill(0) as number[];
  let seed = 1729;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const order = pairs.map((_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    const learningRate = 0.018 / Math.sqrt(1 + epoch * 0.18);
    const decay = 1 - learningRate * 0.002;
    for (const pairIndex of order) {
      const [higher, lower] = pairs[pairIndex];
      let margin = 0;
      for (let feature = 0; feature < weights.length; feature += 1) {
        margin += weights[feature] * (vectors[higher][feature] - vectors[lower][feature]);
      }
      const gain = 1 / (1 + Math.exp(Math.max(-30, Math.min(30, margin))));
      for (let feature = 0; feature < weights.length; feature += 1) {
        weights[feature] = weights[feature] * decay + learningRate * gain * (vectors[higher][feature] - vectors[lower][feature]);
      }
    }
  }
  return { mean, std, weights, pairCount: pairs.length };
}

function score(features: number[], model: { mean: number[]; std: number[]; weights: number[] }) {
  let result = 0;
  for (let index = 0; index < model.weights.length; index += 1) {
    result += model.weights[index] * ((features[index] - model.mean[index]) / model.std[index]);
  }
  return result;
}

function evaluateHoldout(samples: FeatureSample[], author: string): FoldResult {
  const training = samples.filter((sample) => sample.author !== author);
  const holdout = samples.filter((sample) => sample.author === author);
  if (training.length < 10 || holdout.length < 2) return { author, pairCount: 0, correct: 0, accuracy: null };
  const model = trainRanker(training, 18);
  let pairCount = 0;
  let correct = 0;
  for (let first = 0; first < holdout.length; first += 1) {
    for (let second = first + 1; second < holdout.length; second += 1) {
      if (holdout[first].labelValue === holdout[second].labelValue) continue;
      pairCount += 1;
      const expected = holdout[first].labelValue > holdout[second].labelValue;
      const predicted = score(holdout[first].features, model) > score(holdout[second].features, model);
      if (expected === predicted) correct += 1;
    }
  }
  return { author, pairCount, correct, accuracy: pairCount ? correct / pairCount : null };
}

function rounded(values: number[]) {
  return values.map((value) => Number(value.toFixed(8)));
}

async function saveStoredModel(model: StoredModel) {
  let lastError = "モデル保存に失敗しました";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("/api/preference-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model),
      });
      const raw = await response.text();
      let payload: { success?: boolean; error?: string } | null = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }

      if (response.ok && payload?.success) return;
      lastError = payload?.error
        ?? `保存サーバーから正しい応答がありませんでした（HTTP ${response.status}）`;
      if (response.status < 500) break;
    } catch (caught) {
      lastError = caught instanceof Error ? caught.message : lastError;
    }

    if (attempt < 2) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
  }

  throw new Error(`${lastError}。学習結果の保存を再試行しましたが完了できませんでした。`);
}

function encodeFeatureVector(features: number[]) {
  const bytes = new Uint8Array(features.length * 4);
  const view = new DataView(bytes.buffer);
  features.forEach((value, index) => view.setFloat32(index * 4, value, true));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function decodeFeatureVector(featuresBase64: string, dimension: number) {
  const binary = atob(featuresBase64);
  if (binary.length !== dimension * 4) throw new Error("保存済みの視覚特徴が破損しています");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  return Array.from({ length: dimension }, (_, index) => view.getFloat32(index * 4, true));
}

async function cacheRequest(body: Record<string, unknown>) {
  let lastError = "視覚特徴キャッシュに接続できません";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("/api/preference-feature-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, featureSpec: FEATURE_CACHE_SPEC }),
      });
      const raw = await response.text();
      let payload: Record<string, unknown> | null = null;
      try { payload = JSON.parse(raw); } catch { payload = null; }
      if (response.ok && payload?.success) return payload;
      lastError = typeof payload?.error === "string"
        ? payload.error
        : `視覚特徴キャッシュから正しい応答がありませんでした（HTTP ${response.status}）`;
      if (response.status < 500) break;
    } catch (caught) {
      lastError = caught instanceof Error ? caught.message : lastError;
    }
    if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 800));
  }
  throw new Error(lastError);
}

async function loadFeatureCache(xPostIds: string[]) {
  return cacheRequest({ action: "load", xPostIds }) as Promise<{
    success: true;
    items: Array<{ xPostId: string; featuresBase64: string; dimension: number }>;
    deferredFailures: Array<{ xPostId: string; error?: string; retryAfter?: string }>;
  }>;
}

async function storeFeatureCache(items: FeatureCacheWrite[]) {
  if (items.length === 0) return;
  await cacheRequest({ action: "store", items });
}

export default function PreferenceModelPage() {
  const [authors, setAuthors] = useState<TeacherAuthor[]>([]);
  const [existingModel, setExistingModel] = useState<StoredModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, stage: "" });
  const [failures, setFailures] = useState<Array<{ xPostId: string; error: string }>>([]);
  const [result, setResult] = useState<StoredModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cacheStats, setCacheStats] = useState({ reused: 0, newlyExtracted: 0, deferredFailures: 0 });
  const modelRef = useRef<NSFWJS | null>(null);

  useEffect(() => {
    void loadData();
    return () => modelRef.current?.dispose();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [teacherResponse, modelResponse] = await Promise.all([
        fetch("/api/teacher-authors", { cache: "no-store" }),
        fetch("/api/preference-model", { cache: "no-store" }),
      ]);
      const teacherPayload = await teacherResponse.json();
      const modelPayload = await modelResponse.json();
      if (!teacherResponse.ok || !teacherPayload.success) throw new Error(teacherPayload.error ?? "教師データ取得に失敗しました");
      setAuthors(teacherPayload.trainingAuthors ?? teacherPayload.store.authors);
      if (modelResponse.ok && modelPayload.success) setExistingModel(modelPayload.model);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }

  const targets = useMemo(() => {
    const seenVideoUrls = new Set<string>();

    return authors.flatMap((author) => author.posts
      .filter((post) => {
        if (!post.review || !post.videoUrl || post.safetyReasons.length > 0) return false;
        if (seenVideoUrls.has(post.videoUrl)) return false;
        seenVideoUrls.add(post.videoUrl);
        return true;
      })
      .map((post) => ({ author: author.username, post })));
  }, [authors]);

  async function extractAndTrain() {
    if (running || targets.length < 10) return;
    setRunning(true);
    setError(null);
    setFailures([]);
    setResult(null);
    setCacheStats({ reused: 0, newlyExtracted: 0, deferredFailures: 0 });
    setProgress({ done: 0, total: targets.length, stage: "保存済みの視覚特徴を確認中" });

    try {
      const cache = await loadFeatureCache(targets.map(({ post }) => post.xPostId));
      const targetById = new Map(targets.map((target) => [target.post.xPostId, target]));
      const samples: FeatureSample[] = [];
      const cachedIds = new Set<string>();
      for (const item of cache.items) {
        const target = targetById.get(item.xPostId);
        if (!target) continue;
        try {
          samples.push({
            author: target.author,
            xPostId: item.xPostId,
            label: target.post.review!.tier,
            labelValue: LABEL_VALUES[target.post.review!.tier],
            features: decodeFeatureVector(item.featuresBase64, item.dimension),
          });
          cachedIds.add(item.xPostId);
        } catch {
          // A damaged cache entry is extracted again below and replaced.
        }
      }
      const deferredIds = new Set(cache.deferredFailures.map((item) => item.xPostId));
      const failed: Array<{ xPostId: string; error: string }> = cache.deferredFailures.map((item) => ({
        xPostId: item.xPostId,
        error: item.error ?? "前回の特徴抽出に失敗したため再試行待ちです",
      }));
      setCacheStats({ reused: samples.length, newlyExtracted: 0, deferredFailures: failed.length });
      setProgress({ done: samples.length + failed.length, total: targets.length, stage: "視覚モデルを準備中" });

      if (!modelRef.current) {
        const nsfwjs = await import("nsfwjs/core");
        modelRef.current = await nsfwjs.load("/api/visual-filter-model/");
      }
      if (!modelRef.current.endpoints.includes("flatten_1")) {
        throw new Error("視覚特徴層 flatten_1 が利用できません");
      }

      const pendingCache: FeatureCacheWrite[] = [];
      let processed = samples.length + failed.length;
      for (let index = 0; index < targets.length; index += 1) {
        const { author, post } = targets[index];
        if (cachedIds.has(post.xPostId) || deferredIds.has(post.xPostId)) continue;
        setProgress({ done: processed, total: targets.length, stage: `@${author} の新規動画を解析中` });
        try {
          const features = await extractPostFeatures(modelRef.current, post.videoUrl!);
          samples.push({
            author,
            xPostId: post.xPostId,
            label: post.review!.tier,
            labelValue: LABEL_VALUES[post.review!.tier],
            features,
          });
          pendingCache.push({
            xPostId: post.xPostId,
            kind: "success",
            featuresBase64: encodeFeatureVector(features),
            dimension: features.length,
          });
          setCacheStats((current) => ({ ...current, newlyExtracted: current.newlyExtracted + 1 }));
        } catch (caught) {
          const failure = { xPostId: post.xPostId, error: caught instanceof Error ? caught.message : "抽出失敗" };
          failed.push(failure);
          pendingCache.push({ xPostId: post.xPostId, kind: "failure", error: failure.error });
        }
        processed += 1;
        if (pendingCache.length >= FEATURE_CACHE_BATCH_SIZE) {
          await storeFeatureCache(pendingCache.splice(0, pendingCache.length));
        }
        setProgress({ done: processed, total: targets.length, stage: `@${author} の新規動画を解析中` });
      }
      await storeFeatureCache(pendingCache);
      setFailures(failed);
      if (samples.length < 20) throw new Error("特徴抽出に成功した教師データが不足しています");

      setProgress({ done: samples.length, total: targets.length, stage: "投稿者分離テストを実行中" });
      const uniqueAuthors = Array.from(new Set(samples.map((sample) => sample.author)));
      const folds = uniqueAuthors.map((author) => evaluateHoldout(samples, author));
      const evaluatedPairs = folds.reduce((total, fold) => total + fold.pairCount, 0);
      const correctPairs = folds.reduce((total, fold) => total + fold.correct, 0);

      setProgress({ done: samples.length, total: targets.length, stage: "最終モデルを学習中" });
      const final = trainRanker(samples, 35);
      const scored = samples.map((sample) => ({ sample, value: score(sample.features, final) }));
      const scoreByTier: StoredModel["scoreByTier"] = {};
      for (const tier of ["S", "A", "OTHER", "X"] as const) {
        const values = scored.filter(({ sample }) => sample.label === tier).map(({ value }) => value);
        scoreByTier[tier] = { count: values.length, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
      }
      const tierCounts = Object.fromEntries(
        (["S", "A", "OTHER", "X"] as const).map((tier) => [tier, samples.filter((sample) => sample.label === tier).length])
      );
      const stored: StoredModel = {
        version: 1,
        trainedAt: new Date().toISOString(),
        featureSpec: {
          endpoint: "flatten_1",
          framePositions: [...FRAME_POSITIONS],
          embeddingAggregation: "mean",
          extras: ["nsfw_probabilities_mean", "nsfw_probabilities_max", "luminance", "contrast", "saturation", "edge"],
          authorIdentityUsed: false,
          engagementUsed: false,
        },
        training: {
          authors: uniqueAuthors.length,
          samples: targets.length,
          extracted: samples.length,
          failed: failed.length,
          tierCounts,
          pairCount: final.pairCount,
        },
        evaluation: {
          method: "leave-one-author-out",
          pairAccuracy: evaluatedPairs ? correctPairs / evaluatedPairs : null,
          evaluatedPairs,
          folds,
        },
        normalization: { mean: rounded(final.mean), std: rounded(final.std) },
        weights: rounded(final.weights),
        scoreByTier: Object.fromEntries(Object.entries(scoreByTier).map(([tier, item]) => [tier, { count: item.count, average: Number(item.average.toFixed(4)) }])),
        trainingItems: scored.map(({ sample, value }) => ({ author: sample.author, xPostId: sample.xPostId, label: sample.label, score: Number(value.toFixed(4)) })),
      };

      setProgress({ done: samples.length, total: targets.length, stage: "学習モデルを保存中" });
      await saveStoredModel(stored);
      setResult(stored);
      setExistingModel(stored);
      setProgress({ done: samples.length, total: targets.length, stage: "完了" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "学習に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <main style={{ padding: 30 }}>教師データを読み込み中...</main>;
  const shown = result ?? existingModel;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, color: "#171717" }}>
      <h1>視覚好みモデル学習（ローカル専用）</h1>
      <p>投稿者名・閲覧数・いいね数を使わず、各動画の10%・35%・65%・90%地点から視覚特徴を抽出します。安全隔離投稿は対象外です。</p>
      {error && <div style={{ padding: 12, background: "#fff0f0", color: "#9b1c1c", marginBottom: 14 }}>{error}</div>}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, margin: "20px 0" }}>
        {[["投稿者", authors.length], ["評価済み動画", targets.length], ["キャッシュ利用", cacheStats.reused], ["新規解析", cacheStats.newlyExtracted], ["処理済み", progress.done], ["失敗・再試行待ち", failures.length]].map(([label, value]) => (
          <div key={String(label)} style={{ border: "1px solid #ddd", borderRadius: 9, padding: 14 }}><small>{label}</small><div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div></div>
        ))}
      </section>

      <button onClick={extractAndTrain} disabled={running || targets.length < 10} style={{ padding: "13px 22px", fontWeight: 800, background: "#111", color: "white", border: 0, borderRadius: 8, cursor: running ? "wait" : "pointer" }}>
        {running ? `${progress.stage} ${progress.done}/${progress.total}` : `${targets.length}件から視覚特徴を抽出して学習`}
      </button>
      <p style={{ fontSize: 13, color: "#666" }}>動画本体やフレーム画像は保存しません。視覚特徴の数値だけを再利用し、次回から新規動画を中心に解析します。取得失敗は7日後に再試行します。</p>

      {shown && (
        <section style={{ marginTop: 30 }}>
          <h2>最新の学習結果</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
            <div style={{ padding: 14, background: "#f4f4f4" }}><small>特徴抽出成功</small><div style={{ fontSize: 26, fontWeight: 800 }}>{shown.training.extracted}/{shown.training.samples}</div></div>
            <div style={{ padding: 14, background: "#f4f4f4" }}><small>投稿者分離テスト</small><div style={{ fontSize: 26, fontWeight: 800 }}>{shown.evaluation.pairAccuracy === null ? "-" : `${Math.round(shown.evaluation.pairAccuracy * 100)}%`}</div></div>
            <div style={{ padding: 14, background: "#f4f4f4" }}><small>評価ペア</small><div style={{ fontSize: 26, fontWeight: 800 }}>{shown.evaluation.evaluatedPairs}</div></div>
            <div style={{ padding: 14, background: "#f4f4f4" }}><small>学習ペア</small><div style={{ fontSize: 26, fontWeight: 800 }}>{shown.training.pairCount}</div></div>
          </div>

          <h3>Tier別の平均好みスコア</h3>
          <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr><th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #aaa" }}>Tier</th><th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #aaa" }}>件数</th><th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #aaa" }}>平均スコア</th></tr></thead><tbody>
            {(["S", "A", "OTHER", "X"] as const).map((tier) => <tr key={tier}><td style={{ padding: 8, borderBottom: "1px solid #ddd" }}>{tier}</td><td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #ddd" }}>{shown.scoreByTier[tier]?.count ?? 0}</td><td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #ddd" }}>{shown.scoreByTier[tier]?.average ?? 0}</td></tr>)}
          </tbody></table>

          <h3>投稿者ごとの未知データテスト</h3>
          <div style={{ display: "grid", gap: 6 }}>
            {shown.evaluation.folds.map((fold) => <div key={fold.author} style={{ display: "flex", justifyContent: "space-between", padding: 9, background: "#fafafa" }}><span>@{fold.author}</span><span>{fold.accuracy === null ? "評価不能" : `${Math.round(fold.accuracy * 100)}%`}（{fold.pairCount}組）</span></div>)}
          </div>
          <p style={{ marginTop: 18, padding: 12, background: "#fff8dc" }}>この精度は同じ教師投稿の暗記結果ではなく、投稿者を1人ずつ学習から外して測った順位精度です。まだ本番ランキングには使用していません。</p>
        </section>
      )}
    </main>
  );
}
