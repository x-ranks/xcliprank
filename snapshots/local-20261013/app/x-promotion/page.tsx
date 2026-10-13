"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [postedUrl, setPostedUrl] = useState("");

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
      setXContentSessions(
        statsResponse.ok && stats.ok && stats.xContentSessions
          ? stats.xContentSessions
          : {}
      );
    } catch (caught) {
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
    setPostedUrl("");
    setMessage("");
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
                  "X流入",
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
                  <td style={{ padding: 11 }}>{xContentSessions[row.utm_content] ?? 0}訪問</td>
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
                  <td colSpan={6} style={{ padding: 22, color: "#9aa6b2", textAlign: "center" }}>
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
