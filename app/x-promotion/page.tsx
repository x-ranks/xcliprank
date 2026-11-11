"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { X_PROMOTION_PLAN_STORAGE_KEY, readPromotionPlans, refreshPlanTarget, type PromotionPlan } from "../../lib/x-promotion-planner";
import { X_PROMOTION_METRICS_STORAGE_KEY, postMetricsSummary, readPostMetrics, summarizeCopyStyles, type PostMetrics } from "../../lib/x-promotion-analysis";
import { createKitCopy, extractKitAttribution, kitTextWarnings, type KitCandidate } from "../../lib/x-promotion-kit";
import { X_PROMOTION_MANUAL_POSTS_KEY, readManualPosts, validXPostUrl, type ManualPostRecord } from "../../lib/x-promotion-manual-posts";

const SECRET_KEY = "x-promotion-cron-secret";
const LOCAL_DEVELOPMENT = process.env.NODE_ENV !== "production";
const LOCAL_AUTH_VALUE = "local-development";

type MediaPreview = {
  rank: number;
  xPostId: string;
  imageUrl: string;
  author: string;
  tier: string;
};

type DraftVariant = {
  id: "a" | "b" | "c";
  label: string;
  text: string;
  characterCount: number;
  targetUrl: string;
  utmContent: string;
};
type Trend = { name: string; postCount: number | null };

type PromotionHistory = {
  id: number;
  created_at: string;
  status: "publishing" | "success" | "failed" | "skipped";
  trigger_source: "manual" | "cron";
  variant: "a" | "b" | "c";
  ranking_date: string;
  utm_content: string;
  x_post_url: string | null;
  media_count: number;
  error_message: string | null;
  draft_text: string | null;
};

const STATUS_LABELS: Record<PromotionHistory["status"], string> = {
  publishing: "処理中",
  success: "成功",
  failed: "失敗",
  skipped: "スキップ",
};

export default function XPromotionPage() {
  const [secret, setSecret] = useState(
    LOCAL_DEVELOPMENT ? LOCAL_AUTH_VALUE : ""
  );
  const [secretInput, setSecretInput] = useState("");
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<"a" | "b" | "c">("a");
  const [draft, setDraft] = useState("");
  const [account, setAccount] = useState("");
  const [rankingCount, setRankingCount] = useState(0);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview[]>([]);
  const [history, setHistory] = useState<PromotionHistory[]>([]);
  const [historyReady, setHistoryReady] = useState(true);
  const [xContentSessions, setXContentSessions] = useState<Record<string, number>>({});
  const [statsReady, setStatsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [postedUrl, setPostedUrl] = useState("");
  const [plans, setPlans] = useState<PromotionPlan[]>([]);
  const [planTitle, setPlanTitle] = useState("");
  const [planTime, setPlanTime] = useState("");
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PostMetrics[]>([]);
  const [metricPostUrl, setMetricPostUrl] = useState("");
  const [metricInput, setMetricInput] = useState({ impressions: "", likes: "", reposts: "", replies: "", profileVisits: "", linkClicks: "" });
  const [kitCandidates, setKitCandidates] = useState<KitCandidate[]>([]);
  const [kitCheckedAt, setKitCheckedAt] = useState("");
  const [kitSelectedId, setKitSelectedId] = useState("");
  const [kitStyle, setKitStyle] = useState<"curiosity" | "ranking" | "creator">("curiosity");
  const [kitText, setKitText] = useState("");
  const [kitVideoUrl, setKitVideoUrl] = useState("");
  const [kitBusy, setKitBusy] = useState(false);
  const [manualPosts, setManualPosts] = useState<ManualPostRecord[]>([]);
  const [kitPostedUrl, setKitPostedUrl] = useState("");
  const [trends, setTrends] = useState<Trend[]>([]);
  const [trendState, setTrendState] = useState("");
  const [trendBusy, setTrendBusy] = useState(false);

  useEffect(() => {
    if (LOCAL_DEVELOPMENT) return;
    const stored = window.sessionStorage.getItem(SECRET_KEY) ?? "";
    if (stored) {
      setSecret(stored);
      setSecretInput(stored);
    }
  }, []);

  useEffect(() => {
    if (secret) void loadDraft(secret);
  }, [secret]);

  useEffect(() => {
    setPlans(readPromotionPlans(window.localStorage.getItem(X_PROMOTION_PLAN_STORAGE_KEY)));
    setMetrics(readPostMetrics(window.localStorage.getItem(X_PROMOTION_METRICS_STORAGE_KEY)));
    setManualPosts(readManualPosts(window.localStorage.getItem(X_PROMOTION_MANUAL_POSTS_KEY)));
  }, []);

  function savePlans(next: PromotionPlan[]) {
    try {
      window.localStorage.setItem(X_PROMOTION_PLAN_STORAGE_KEY, JSON.stringify(next));
      setPlans(next);
      return true;
    } catch {
      setError("予定をこの端末に保存できませんでした。ブラウザーの保存領域を確認してください。");
      return false;
    }
  }

  function saveMetrics(next: PostMetrics[]) {
    try {
      window.localStorage.setItem(X_PROMOTION_METRICS_STORAGE_KEY, JSON.stringify(next));
      setMetrics(next);
      return true;
    } catch {
      setError("分析数値をこの端末に保存できませんでした。ブラウザーの保存領域を確認してください。");
      return false;
    }
  }

  function recordManualKitPost() {
    if (!kitSelectedId || !validXPostUrl(kitPostedUrl.trim())) {
      setError("Xで投稿したURLを確認してください。");
      return;
    }
    const utmContent = extractKitAttribution(kitText, kitSelectedId);
    if (!utmContent) {
      setError("投稿文の識別リンクを確認してください。実際に投稿した文章との一致も確認してください。");
      return;
    }
    const record: ManualPostRecord = {
      postUrl: kitPostedUrl.trim(), sourceId: kitSelectedId, text: kitText,
      utmContent, createdAt: new Date().toISOString(), style: kitStyle,
    };
    const next = [record, ...manualPosts.filter((item) => item.postUrl !== record.postUrl)].slice(0, 100);
    try {
      window.localStorage.setItem(X_PROMOTION_MANUAL_POSTS_KEY, JSON.stringify(next));
      setManualPosts(next);
      setKitPostedUrl("");
      setMessage("手動投稿のURLと識別リンクをこの端末に記録しました。");
      setError("");
    } catch {
      setError("投稿記録をこの端末に保存できませんでした。");
    }
  }

  async function loadKitCandidates() {
    setKitBusy(true);
    setKitVideoUrl("");
    setError("");
    try {
      const response = await fetch("/api/x-promotion?mode=kit", { headers: headers(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok || result.ok !== true || !Array.isArray(result.candidates)) throw Error(result.error ?? "候補を取得できませんでした");
      setKitCandidates(result.candidates as KitCandidate[]);
      setKitCheckedAt(result.checkedAt ?? "");
      setKitSelectedId("");
      setKitText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "候補を取得できませんでした");
    } finally {
      setKitBusy(false);
    }
  }

  async function loadTrends() {
    setTrendBusy(true);
    setTrendState("");
    try {
      const response = await fetch("/api/x-promotion?mode=trends", { headers: headers(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw Error(result.error ?? "Xトレンドを取得できませんでした");
      if (result.available !== true) {
        setTrendState(result.reason ?? "XトレンドAPIを利用できません");
        setTrends([]);
      } else {
        setTrends(Array.isArray(result.trends) ? result.trends : []);
        setTrendState(result.cached ? "Xトレンドの保存済み結果" : "Xトレンドの最新取得結果");
      }
    } catch (caught) {
      setTrendState(caught instanceof Error ? caught.message : "Xトレンドを取得できませんでした");
    } finally {
      setTrendBusy(false);
    }
  }

  async function downloadKitImage() {
    if (!kitSelectedId) return;
    setKitBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/x-promotion?mode=kit-image&postId=${encodeURIComponent(kitSelectedId)}`, { headers: headers(), cache: "no-store" });
      if (!response.ok || response.headers.get("content-type") !== "image/jpeg") throw Error("画像を取得できませんでした。掲載状態を確認してください。");
      const blob = await response.blob();
      if (!blob.size || blob.size > 5 * 1024 * 1024) throw Error("画像サイズを確認してください。");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `twizou-${kitSelectedId}-mosaic.jpg`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "画像を取得できませんでした");
    } finally {
      setKitBusy(false);
    }
  }

  async function prepareKitVideo() {
    if (!kitSelectedId) return;
    setKitBusy(true);
    setError("");
    setKitVideoUrl("");
    try {
      const response = await fetch(`/api/x-promotion?mode=kit-video&postId=${encodeURIComponent(kitSelectedId)}`, { headers: headers(), cache: "no-store" });
      const result = await response.json();
      if (!response.ok || result.ok !== true || typeof result.url !== "string") throw Error(result.error ?? "動画を用意できませんでした");
      const media = new URL(result.url);
      if (media.protocol !== "https:" || !(media.hostname === "video.twimg.com" || media.hostname.endsWith(".video.twimg.com"))) throw Error("動画の取得先を確認できませんでした");
      setKitVideoUrl(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "動画を用意できませんでした");
    } finally {
      setKitBusy(false);
    }
  }

  function chooseKitCandidate(candidate: KitCandidate, style = kitStyle) {
    setKitSelectedId(candidate.id);
    setKitStyle(style);
    setKitText(createKitCopy(candidate, style).text);
    setKitVideoUrl("");
    setError("");
  }

  function headers(value = secret) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${value}`,
    };
  }

  async function loadDraft(value = secret) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/x-promotion", {
        headers: headers(value),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "下書きの取得に失敗しました");
      }

      const nextVariants = Array.isArray(payload.variants)
        ? (payload.variants as DraftVariant[])
        : [];
      setVariants(nextVariants);
      setSelectedVariant(payload.selectedVariant ?? "a");
      setDraft(nextVariants[0]?.text ?? payload.draft ?? "");
      setRankingCount(payload.rankingCount ?? 0);
      setMediaPreview(
        Array.isArray(payload.mediaPreview) ? payload.mediaPreview : []
      );
      setHistory(Array.isArray(payload.history) ? payload.history : []);
      setHistoryReady(payload.historyReady !== false);

      const statsResponse = await fetch("/api/engagement-stats?days=30", {
        headers: headers(value),
        cache: "no-store",
      });
      const stats = await statsResponse.json();
      setStatsReady(Boolean(statsResponse.ok && stats.ok && stats.xContentSessions));
      setXContentSessions(
        statsResponse.ok && stats.ok && stats.xContentSessions
          ? stats.xContentSessions
          : {}
      );
    } catch (caught) {
      setStatsReady(false);
      setError(
        caught instanceof Error
          ? caught.message
          : "下書きの取得に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }

  function chooseVariant(variant: DraftVariant) {
    setSelectedVariant(variant.id);
    setDraft(variant.text);
    setActivePlanId(null);
    setPostedUrl("");
    setMessage("");
    setError("");
  }

  function addPlan() {
    const title = planTitle.trim();
    const selected = variants.find((item) => item.id === selectedVariant);
    const date = new Date(planTime);
    if (!title || title.length > 100 || !planTime || !Number.isFinite(date.getTime()) ||
        !selected || !draft.trim() || draft.length > 280 || !draft.includes(selected.targetUrl)) {
      setError("予定名・日時・現在の投稿文を確認してください。本文には現在の流入識別URLが必要です。");
      return;
    }
    const next: PromotionPlan = {
      id: crypto.randomUUID(), title, text: draft, variant: selectedVariant,
      targetUrl: selected.targetUrl, scheduledAt: date.toISOString(), createdAt: new Date().toISOString(),
      status: "planned", postedUrl: null,
    };
    if (!savePlans([...plans, next].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 100))) return;
    setPlanTitle("");
    setPlanTime("");
    setMessage("予定をこの端末に保存しました。時刻になっても自動投稿はしません。");
    setError("");
  }

  function openPlan(plan: PromotionPlan) {
    const current = variants.find((item) => item.id === plan.variant);
    if (!current) {
      setError("現在の投稿案を取得してから予定を開いてください。");
      return;
    }
    setSelectedVariant(plan.variant);
    setDraft(refreshPlanTarget(plan, current.targetUrl));
    setActivePlanId(plan.id);
    setMessage("予定を編集欄に読み込みました。リンクは現在の流入識別URLに更新しています。内容と画像を確認してから投稿してください。");
    setError("");
  }

  function recordMetrics() {
    const optional = [metricInput.likes, metricInput.reposts, metricInput.replies, metricInput.profileVisits, metricInput.linkClicks];
    const valid = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 1_000_000_000;
    if (!metricPostUrl || !valid(metricInput.impressions) || optional.some((value) => value !== "" && !valid(value))) {
      setError("投稿と表示回数を入力してください。未確認の反応指標は空欄にできます。");
      return;
    }
    const optionalCount = (value: string) => value === "" ? null : Number(value);
    const next: PostMetrics = {
      postUrl: metricPostUrl, impressions: Number(metricInput.impressions),
      likes: optionalCount(metricInput.likes), reposts: optionalCount(metricInput.reposts),
      replies: optionalCount(metricInput.replies), profileVisits: optionalCount(metricInput.profileVisits),
      linkClicks: optionalCount(metricInput.linkClicks),
      capturedAt: new Date().toISOString(),
    };
    if (!saveMetrics([...metrics.filter((item) => item.postUrl !== metricPostUrl), next])) return;
    setMessage("Xで確認した数値をこの端末に記録しました。");
    setError("");
  }

  function unlock() {
    const value = secretInput.trim();
    if (!value) return;
    window.sessionStorage.setItem(SECRET_KEY, value);
    setSecret(value);
  }

  async function verifyAccount() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/x-promotion?mode=verify", {
        headers: headers(),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Xアカウントの確認に失敗しました");
      }
      setAccount(`@${payload.account.username}（${payload.account.name}）`);
      setMessage("投稿用の認証を確認できました。");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Xアカウントの確認に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (
      !window.confirm(
        `パターン${selectedVariant.toUpperCase()}の文章とランキングTOP3画像をXへ投稿します。よろしいですか？`
      )
    ) {
      return;
    }

    setLoading(true);
    setError("");
    setMessage("Xへ投稿しています…");
    setPostedUrl("");
    try {
      const response = await fetch("/api/x-promotion", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          text: draft,
          variant: selectedVariant,
          confirmation: "POST_TO_X",
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Xへの投稿に失敗しました");
      }
      setPostedUrl(payload.post.url);
      if (activePlanId) {
        savePlans(plans.map((plan) => plan.id === activePlanId ? { ...plan, status: "posted", postedUrl: payload.post.url } : plan));
        setActivePlanId(null);
      }
      setMessage(
        payload.loggingWarning
          ? `Xへの投稿は完了しました。${payload.loggingWarning}`
          : "Xへの投稿と履歴保存が完了しました。"
      );
      await loadDraft();
      setPostedUrl(payload.post.url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Xへの投稿に失敗しました"
      );
      setMessage("");
    } finally {
      setLoading(false);
    }
  }

  const selected = useMemo(
    () => variants.find((variant) => variant.id === selectedVariant) ?? null,
    [variants, selectedVariant]
  );

  const measuredPosts = useMemo(() => [...history.flatMap((row) => {
    const metric = metrics.find((item) => item.postUrl === row.x_post_url);
    return row.status === "success" && row.x_post_url && metric ? [{ postUrl: row.x_post_url, createdAt: row.created_at, metric, visits: statsReady ? xContentSessions[row.utm_content] ?? 0 : null }] : [];
  }), ...manualPosts.flatMap((row) => {
    const metric = metrics.find((item) => item.postUrl === row.postUrl);
    return metric ? [{ postUrl: row.postUrl, createdAt: row.createdAt, metric, visits: statsReady ? xContentSessions[row.utmContent] ?? 0 : null }] : [];
  })].sort((a, b) => b.metric.impressions - a.metric.impressions), [history, manualPosts, metrics, xContentSessions, statsReady]);

  const totalImpressions = measuredPosts.reduce((sum, item) => sum + item.metric.impressions, 0);
  const styleSummary = summarizeCopyStyles(manualPosts.flatMap((row) => {
    const metric = metrics.find((item) => item.postUrl === row.postUrl);
    return metric ? [{ style: row.style, impressions: metric.impressions, visits: xContentSessions[row.utmContent] ?? 0 }] : [];
  }));
  const recommendedStyle = styleSummary.length >= 2 ? styleSummary[0].style as "curiosity" | "ranking" | "creator" : null;
  const kitSelected = kitCandidates.find((candidate) => candidate.id === kitSelectedId) ?? null;
  const matchingTrends = kitSelected ? trends.filter((item) => item.name.replace(/^#/, "").length >= 3 && kitSelected.text.toLocaleLowerCase().includes(item.name.replace(/^#/, "").toLocaleLowerCase())) : [];
  const kitWarnings = kitTextWarnings(kitText, [...history.map((row) => row.draft_text ?? ""), ...plans.map((plan) => plan.text)].filter(Boolean));
  if (kitSelected && !extractKitAttribution(kitText, kitSelected.id)) kitWarnings.push("選んだ動画の流入識別リンクを本文に残してください。");

  if (!secret) {
    return (
      <main style={{ maxWidth: 540, margin: "60px auto", padding: 24 }}>
        <h1>X宣伝管理</h1>
        <p>
          CRON_SECRETを入力してください。このタブを閉じると入力内容は消えます。
        </p>
        <input
          type="password"
          value={secretInput}
          onChange={(event) => setSecretInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") unlock();
          }}
          style={{ width: "100%", padding: 12 }}
        />
        <button
          type="button"
          onClick={unlock}
          style={{ marginTop: 12, padding: "11px 18px" }}
        >
          管理画面を開く
        </button>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <Link href="/learning-tools" style={{ color: "#86e1ca" }}>
        ← 学習・レビュー管理へ戻る
      </Link>
      <h1>X宣伝管理</h1>
      <p>
        3種類の投稿文と固有UTMで流入を比較します。現在は投稿前に確認する手動送信です。
      </p>
      <p style={{ color: "#f0c36a" }}>
        TOP3画像は投稿時にモザイクを自動適用します。Xアカウント側の「投稿するメディアをセンシティブな内容として設定する」も有効にしてください。
      </p>

      {!historyReady && (
        <div style={{ padding: 13, marginBottom: 14, background: "#453713", color: "#ffe3a2" }}>
          投稿履歴テーブルがありません。先に同梱のSupabase SQLを実行してください。
        </div>
      )}
      {error && (
        <div style={{ padding: 13, marginBottom: 14, background: "#39151a", color: "#ffc7cc" }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ padding: 13, marginBottom: 14, background: "#11311e", color: "#b9f2d1" }}>
          {message}
        </div>
      )}

      <section style={{ padding: 20, border: "1px solid #303946", borderRadius: 14, background: "#11161d" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between", marginBottom: 16 }}>
          <span>24時間ランキング：{rankingCount}件</span>
          <span>{account || "投稿アカウント未確認"}</span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {variants.map((variant) => (
            <button
              key={variant.id}
              type="button"
              onClick={() => chooseVariant(variant)}
              disabled={loading}
              style={{
                padding: "10px 13px",
                borderRadius: 9,
                border: selectedVariant === variant.id ? "2px solid #7ce3c8" : "1px solid #53606d",
                background: selectedVariant === variant.id ? "#173e37" : "#171d25",
                color: "#fff",
                fontWeight: 800,
              }}
            >
              {variant.label}
            </button>
          ))}
        </div>

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={280}
          style={{ width: "100%", minHeight: 190, padding: 14, borderRadius: 10, background: "#090c11", color: "#fff" }}
        />
        <div style={{ marginTop: 7, color: draft.length > 280 ? "#ff5365" : "#9aa6b2", textAlign: "right" }}>
          {draft.length}/280
        </div>
        {selected && (
          <p style={{ color: "#8fa0ae", fontSize: 12, overflowWrap: "anywhere" }}>
            流入識別：{selected.utmContent}
          </p>
        )}

        <div style={{ marginTop: 18 }}>
          <strong>投稿に添付するランキングTOP3</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
            {mediaPreview.map((item) => (
              <figure key={`${item.rank}-${item.xPostId}`} style={{ margin: 0, minWidth: 0 }}>
                <img
                  src={item.imageUrl}
                  alt={`${item.rank}位のサムネイル`}
                  style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 9, background: "#080b10", filter: "blur(3px)" }}
                />
                <figcaption style={{ marginTop: 5, color: "#b7c0ca", fontSize: 13 }}>
                  #{item.rank} {item.tier ? `${item.tier} ` : ""}
                  {item.author ? `@${item.author}` : ""}
                </figcaption>
              </figure>
            ))}
          </div>
          {mediaPreview.length !== 3 && (
            <p style={{ color: "#ffc7cc" }}>
              TOP3画像を3枚取得できないため、この状態では投稿できません。
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button type="button" disabled={loading} onClick={verifyAccount} style={{ padding: "11px 17px" }}>
            投稿アカウントを確認
          </button>
          <button type="button" disabled={loading} onClick={() => loadDraft()} style={{ padding: "11px 17px" }}>
            下書きと履歴を更新
          </button>
          <button
            type="button"
            disabled={loading || !draft || draft.length > 280 || mediaPreview.length !== 3 || !historyReady}
            onClick={publish}
            style={{ padding: "11px 20px", background: "#e1263e", color: "#fff", border: 0, fontWeight: 900 }}
          >
            TOP3画像付きでXに投稿する
          </button>
        </div>
        {postedUrl && (
          <p>
            <a href={postedUrl} target="_blank" rel="noreferrer" style={{ color: "#fff" }}>
              投稿をXで確認する ↗
            </a>
          </p>
        )}
      </section>

      <section style={{ marginTop: 24, padding: 20, border: "1px solid #303946", borderRadius: 14, background: "#11161d" }}>
        <h2>今日の投稿セットを作る</h2>
        <p style={{ color: "#9aa6b2" }}>24時間ランキングから候補を探し、現在の掲載許可・停止状態を再確認します。ランキング順位は候補選びの参考であり、Xでの表示回数を予測するものではありません。</p>
        <button type="button" onClick={loadKitCandidates} disabled={kitBusy || !secret} style={{ padding: "10px 15px" }}>掲載可能な候補を確認</button>
        {kitCheckedAt && <p style={{ color: "#9aa6b2", fontSize: 13 }}>確認日時：{new Date(kitCheckedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}。画像・動画の取得時にも再確認します。</p>}
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={loadTrends} disabled={trendBusy} style={{ padding: "10px 15px" }}>日本のXトレンドを確認</button>
          <span style={{ marginLeft: 9, color: "#9aa6b2" }}>{trendState || "管理者が明示操作した時だけ取得します。API利用設定が必要です。"}</span>
          {trends.length > 0 && <p style={{ fontSize: 13, color: "#9aa6b2" }}>上位の話題：{trends.slice(0, 10).map((item) => item.name).join("、")}。無関係な話題は投稿文に使いません。</p>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 14 }}>
          {kitCandidates.map((candidate) => <button key={candidate.id} type="button" onClick={() => chooseKitCandidate(candidate, recommendedStyle ?? "curiosity")} style={{ textAlign: "left", padding: 9, borderRadius: 10, border: kitSelectedId === candidate.id ? "2px solid #7ce3c8" : "1px solid #53606d", background: "#171d25", color: "#fff" }}>
            <img src={candidate.posterUrl} alt={`${candidate.rank}位の候補画像`} loading="lazy" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 6, filter: "blur(5px)" }} />
            <strong>#{candidate.rank} {candidate.handle ? `@${candidate.handle}` : "投稿者"}</strong>
            <span style={{ display: "block", fontSize: 12, color: "#9aa6b2" }}>{candidate.views === null ? "閲覧数不明" : `${candidate.views.toLocaleString()}閲覧`} · {candidate.likes === null ? "いいね数不明" : `${candidate.likes.toLocaleString()}いいね`}</span>
          </button>)}
        </div>
        {kitSelected && <div style={{ marginTop: 20, borderTop: "1px solid #303946", paddingTop: 16 }}>
          <strong>選択中：ランキング{kitSelected.rank}位</strong>
          <p style={{ color: "#9aa6b2", overflowWrap: "anywhere" }}>元投稿の本文：{kitSelected.text || "本文なし"}</p>
          {trends.length > 0 && <p style={{ color: "#9aa6b2" }}>本文と一致するXトレンド：{matchingTrends.length ? matchingTrends.map((item) => item.name).join("、") : "なし"}。一致は関連性の証明ではありません。</p>}
          <a href={kitSelected.detailUrl} target="_blank" rel="noreferrer" style={{ color: "#86e1ca" }}>twizouの掲載ページを確認 ↗</a>
          {recommendedStyle && <p style={{ color: "#9aa6b2" }}>初期案は、記録済みの投稿形式別中央値が最も高い「{recommendedStyle === "curiosity" ? "問いかけ" : recommendedStyle === "ranking" ? "ランキング" : "投稿者紹介"}」を使用。結果は素材や時刻にも左右されます。</p>}
          <div style={{ marginTop: 14 }}>
            <label>文章の切り口　<select value={kitStyle} onChange={(event) => chooseKitCandidate(kitSelected, event.target.value as "curiosity" | "ranking" | "creator")} style={{ padding: 9 }}>
              <option value="curiosity">問いかけ</option><option value="ranking">ランキング</option><option value="creator">投稿者紹介</option>
            </select></label>
          </div>
          <textarea aria-label="X投稿用の文章" value={kitText} onChange={(event) => setKitText(event.target.value)} maxLength={280} style={{ display: "block", width: "100%", minHeight: 130, marginTop: 10, padding: 12, borderRadius: 9, background: "#090c11", color: "#fff" }} />
          <p style={{ color: "#9aa6b2" }}>{kitText.length}/280。文章を確認・編集してからXへ貼り付けてください。</p>
          {kitWarnings.map((warning) => <p key={warning} style={{ color: "#f0c36a" }}>確認：{warning}</p>)}
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button type="button" disabled={!kitText || kitWarnings.length > 0} onClick={() => void navigator.clipboard.writeText(kitText).then(() => setMessage("文章をコピーしました。Xで内容を最終確認してください。"), () => setError("コピーに失敗しました。文章欄から手動でコピーしてください。"))} style={{ padding: "10px 15px" }}>文章をコピー</button>
            <button type="button" disabled={kitBusy} onClick={downloadKitImage} style={{ padding: "10px 15px" }}>モザイク画像を保存</button>
            <button type="button" disabled={kitBusy} onClick={prepareKitVideo} style={{ padding: "10px 15px" }}>動画の保存先を確認</button>
          </div>
          {kitVideoUrl && <p><a href={kitVideoUrl} target="_blank" rel="noreferrer" style={{ color: "#86e1ca" }}>動画を開いて端末に保存 ↗</a> <span style={{ color: "#9aa6b2" }}>Xの動画配信先が開きます。保存できない場合はtwizouの動画ページから保存してください。</span></p>}
          <p style={{ color: "#f0c36a", fontSize: 13 }}>Xへの投稿前に、投稿内容と画像・動画の掲載許可、センシティブメディア設定を確認してください。送信操作はここでは行いません。</p>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #303946" }}>
            <label>手動投稿が終わったらXの投稿URLを記録<br /><input type="url" placeholder="https://x.com/…/status/…" value={kitPostedUrl} onChange={(event) => setKitPostedUrl(event.target.value)} style={{ width: "min(100%, 480px)", padding: 10, marginTop: 6 }} /></label>
            <button type="button" disabled={!kitPostedUrl} onClick={recordManualKitPost} style={{ padding: "10px 15px", marginLeft: 8 }}>投稿URLを記録</button>
          </div>
        </div>}
      </section>

      <section style={{ marginTop: 24, padding: 20, border: "1px solid #303946", borderRadius: 14, background: "#11161d" }}>
        <h2>投稿予定</h2>
        <p style={{ color: "#9aa6b2" }}>予定はこの端末だけに保存します。予定時刻が来てもXには自動投稿しません。</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="予定名" placeholder="予定名" maxLength={100} value={planTitle} onChange={(event) => setPlanTitle(event.target.value)} style={{ padding: 10, flex: "1 1 200px" }} />
          <input aria-label="予定日時" type="datetime-local" value={planTime} onChange={(event) => setPlanTime(event.target.value)} style={{ padding: 10 }} />
          <button type="button" onClick={addPlan} disabled={loading || !variants.length} style={{ padding: "10px 15px" }}>現在の文章を予定に保存</button>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {plans.filter((plan) => plan.status === "planned").map((plan) => (
            <div key={plan.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #303946", paddingTop: 10 }}>
              <strong>{plan.title}</strong>
              <span>{new Date(plan.scheduledAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
              <span style={{ color: new Date(plan.scheduledAt).getTime() <= Date.now() ? "#f0c36a" : "#9aa6b2" }}>{new Date(plan.scheduledAt).getTime() <= Date.now() ? "予定時刻を過ぎています" : "予定"}</span>
              <button type="button" onClick={() => openPlan(plan)}>文章を開く</button>
              <button type="button" onClick={() => savePlans(plans.filter((item) => item.id !== plan.id))}>削除</button>
            </div>
          ))}
          {plans.every((plan) => plan.status !== "planned") && <p style={{ color: "#9aa6b2" }}>予定はありません。</p>}
        </div>
      </section>

      <section style={{ marginTop: 24, padding: 20, border: "1px solid #303946", borderRadius: 14, background: "#11161d" }}>
        <h2>X表示回数の分析</h2>
        <p style={{ color: "#9aa6b2" }}>Xの投稿分析画面で確認した累計値を入力します。数値はこの端末だけに保存され、更新時に前の値を置き換えます。twizou訪問は既存の流入計測から取得します。</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label>投稿<br /><select value={metricPostUrl} onChange={(event) => {
            const url = event.target.value;
            const saved = metrics.find((item) => item.postUrl === url);
            setMetricPostUrl(url);
            setMetricInput(saved ? {
              impressions: String(saved.impressions), likes: saved.likes === null ? "" : String(saved.likes), reposts: saved.reposts === null ? "" : String(saved.reposts),
              replies: saved.replies === null ? "" : String(saved.replies), profileVisits: saved.profileVisits === null ? "" : String(saved.profileVisits), linkClicks: typeof saved.linkClicks === "number" ? String(saved.linkClicks) : "",
            } : { impressions: "", likes: "", reposts: "", replies: "", profileVisits: "", linkClicks: "" });
          }} style={{ padding: 10, maxWidth: 250 }}>
            <option value="">投稿を選択</option>
            {history.filter((item) => item.status === "success" && item.x_post_url).map((item) => <option key={item.id} value={item.x_post_url ?? ""}>{new Date(item.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} · {item.variant.toUpperCase()}</option>)}
            {manualPosts.map((item) => <option key={item.postUrl} value={item.postUrl}>{new Date(item.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} · 投稿セット {item.sourceId}</option>)}
          </select></label>
          {([ ["impressions", "表示回数"], ["likes", "いいね"], ["reposts", "リポスト"], ["replies", "返信"], ["profileVisits", "プロフィールクリック"], ["linkClicks", "Xリンククリック"] ] as const).map(([key, label]) => (
            <label key={key}>{label}<br /><input type="number" min="0" step="1" inputMode="numeric" value={metricInput[key]} onChange={(event) => setMetricInput({ ...metricInput, [key]: event.target.value })} style={{ width: 110, padding: 10 }} /></label>
          ))}
          <button type="button" onClick={recordMetrics} style={{ padding: "10px 15px" }}>数値を記録</button>
        </div>
        <p style={{ color: "#9aa6b2", fontSize: 13 }}>未確認の指標は空欄にします。反応率＝いいね・リポスト・返信÷表示回数。Xリンククリック率＝Xリンククリック÷表示回数。twizou訪問率＝計測訪問÷表示回数で、Xのリンククリック率とは異なります。</p>
        <p><strong>記録済み {measuredPosts.length}投稿 · 表示回数合計 {totalImpressions.toLocaleString()}</strong></p>
        {measuredPosts.length > 0 && <div>
          <strong>表示回数が多い投稿</strong>
          <ol>
            {measuredPosts.slice(0, 3).map(({ postUrl, createdAt, metric, visits }) => <li key={postUrl}>
              <a href={postUrl} target="_blank" rel="noreferrer" style={{ color: "#86e1ca" }}>
                {new Date(createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}の投稿
              </a>
              {` · ${metric.impressions.toLocaleString()}表示 · ${visits === null ? "訪問未取得" : `${visits}訪問`} · 反応率${postMetricsSummary(metric, visits ?? 0).reactionRate === null ? "未記録" : `${((postMetricsSummary(metric, visits ?? 0).reactionRate ?? 0) * 100).toFixed(1)}%`}`}
            </li>)}
          </ol>
          {measuredPosts.length < 5 && <p style={{ color: "#f0c36a" }}>記録が少ないため、投稿時刻や文面の勝ちパターンはまだ判断しません。</p>}
        </div>}
        {styleSummary.length > 0 && <div style={{ marginTop: 16 }}>
          <strong>文章の切り口別（各3件以上の記録）</strong>
          <ul>{styleSummary.map((item) => <li key={item.style}>{item.style === "curiosity" ? "問いかけ" : item.style === "ranking" ? "ランキング" : "投稿者紹介"}：{item.samples}件、表示回数の中央値 {item.medianImpressions.toLocaleString()}、twizou訪問の中央値 {statsReady ? item.medianVisits.toLocaleString() : "未取得"}</li>)}</ul>
          <p style={{ color: "#9aa6b2", fontSize: 13 }}>投稿時刻や素材の違いも結果に影響します。形式だけの効果と断定しません。</p>
        </div>}
        {manualPosts.length > 0 && <div style={{ marginTop: 16 }}>
          <strong>自分で投稿したセット</strong>
          <ul>{manualPosts.map((item) => {
            const metric = metrics.find((row) => row.postUrl === item.postUrl);
            return <li key={item.postUrl}><a href={item.postUrl} target="_blank" rel="noreferrer" style={{ color: "#86e1ca" }}>{new Date(item.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}の投稿 ↗</a>{` · X表示${metric ? metric.impressions.toLocaleString() : "未記録"} · twizou ${statsReady ? `${xContentSessions[item.utmContent] ?? 0}訪問` : "訪問未取得"}`}</li>;
          })}</ul>
        </div>}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>投稿履歴と流入（直近30日）</h2>
        <p style={{ color: "#9aa6b2" }}>
          投稿日時は日本時間で表示します。X流入は計測できた重複なしの訪問数です。
        </p>
        <div style={{ overflowX: "auto", border: "1px solid #303946", borderRadius: 12 }}>
          <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", background: "#11161d" }}>
            <thead>
              <tr>
                {[
                  "投稿日時",
                  "文面",
                  "結果",
                  "X表示回数",
                  "反応率",
                  "Xリンク",
                  "X流入",
                  "訪問率",
                  "メディア",
                  "投稿",
                ].map((label) => (
                  <th key={label} style={{ padding: 11, textAlign: "left", color: "#9aa6b2" }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid #303946" }}>
                  <td style={{ padding: 11, whiteSpace: "nowrap" }}>
                    {new Date(row.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </td>
                  <td style={{ padding: 11 }}>パターン{row.variant.toUpperCase()}</td>
                  <td style={{ padding: 11 }} title={row.error_message ?? undefined}>
                    {STATUS_LABELS[row.status]}
                  </td>
                  <td style={{ padding: 11 }}>{metrics.find((item) => item.postUrl === row.x_post_url)?.impressions.toLocaleString() ?? "未記録"}</td>
                  <td style={{ padding: 11 }}>{(() => { const metric = metrics.find((item) => item.postUrl === row.x_post_url); const rate = metric ? postMetricsSummary(metric, xContentSessions[row.utm_content] ?? 0).reactionRate : null; return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`; })()}</td>
                  <td style={{ padding: 11 }}>{(() => { const metric = metrics.find((item) => item.postUrl === row.x_post_url); return typeof metric?.linkClicks === "number" ? `${metric.linkClicks}回` : "—"; })()}</td>
                  <td style={{ padding: 11 }}>{statsReady ? `${xContentSessions[row.utm_content] ?? 0}訪問` : "未取得"}</td>
                  <td style={{ padding: 11 }}>{(() => { const metric = metrics.find((item) => item.postUrl === row.x_post_url); const rate = statsReady && metric ? postMetricsSummary(metric, xContentSessions[row.utm_content] ?? 0).siteVisitRate : null; return rate === null ? "—" : `${(rate * 100).toFixed(2)}%`; })()}</td>
                  <td style={{ padding: 11 }}>{row.media_count}件</td>
                  <td style={{ padding: 11 }}>
                    {row.x_post_url ? (
                      <a href={row.x_post_url} target="_blank" rel="noreferrer" style={{ color: "#86e1ca" }}>
                        Xで確認 ↗
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 22, color: "#9aa6b2", textAlign: "center" }}>
                    投稿履歴はまだありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
