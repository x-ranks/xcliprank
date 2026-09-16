"use client";

import { useEffect, useMemo, useState } from "react";

type CuratedAuthor = {
  x_author_id: string;
  username: string;
  name: string | null;
  curated_status: "active" | "paused" | "unavailable" | null;
  curated_expected_tier: "S" | "A" | null;
  curated_added_at: string | null;
  curated_backfill_status: "pending" | "running" | "completed" | "failed" | null;
  curated_last_collected_at: string | null;
  curated_total_fetched: number | null;
  curated_total_saved: number | null;
  curated_total_duplicates: number | null;
  curated_total_safety_excluded: number | null;
  curated_total_content_excluded: number | null;
  curated_total_accepted: number | null;
  curated_last_error: string | null;
  curated_unavailable_failure_count: number | null;
  curated_unavailable_since: string | null;
};

const SECRET_KEY = "curated-authors-cron-secret";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ja-JP") : "未実行";
}

export default function CuratedAuthorsPage() {
  const [secret, setSecret] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [authors, setAuthors] = useState<CuratedAuthor[]>([]);
  const [username, setUsername] = useState("");
  const [expectedTier, setExpectedTier] = useState<"S" | "A">("S");
  const [initialLimit, setInitialLimit] = useState<50 | 100 | 200 | 500>(100);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const stored = window.sessionStorage.getItem(SECRET_KEY) ?? "";
    if (stored) {
      setSecret(stored);
      setSecretInput(stored);
    }
  }, []);

  useEffect(() => {
    if (secret) void loadAuthors(secret);
  }, [secret]);

  const summary = useMemo(() => ({
    total: authors.length,
    active: authors.filter((author) => author.curated_status === "active").length,
    unavailable: authors.filter((author) => author.curated_status === "unavailable").length,
    pending: authors.filter((author) => author.curated_backfill_status !== "completed").length,
    fetched: authors.reduce((sum, author) => sum + Number(author.curated_total_fetched ?? 0), 0),
    accepted: authors.reduce((sum, author) => sum + Number(author.curated_total_accepted ?? 0), 0),
  }), [authors]);

  function headers(value = secret) {
    return { "Content-Type": "application/json", Authorization: `Bearer ${value}` };
  }

  async function loadAuthors(value = secret) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/curated-authors", { headers: headers(value), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "取得に失敗しました");
      setAuthors(payload.authors);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  function unlock() {
    const value = secretInput.trim();
    if (!value) return;
    window.sessionStorage.setItem(SECRET_KEY, value);
    setSecret(value);
  }

  async function addAuthor(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || loading) return;
    setLoading(true);
    setError("");
    setMessage("投稿者を登録しています...");
    try {
      const response = await fetch("/api/curated-authors", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "add", username, expectedTier }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "登録に失敗しました");
      setMessage(`@${payload.author.username} の動画を最大${initialLimit}件、品質を見ながら取得しています...`);
      const collectResponse = await fetch("/api/collect-curated-author", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ xAuthorId: payload.author.x_author_id, initialLimit }),
      });
      const collectPayload = await collectResponse.json();
      if (!collectResponse.ok || !collectPayload.ok) throw new Error(collectPayload.error ?? "初回収集に失敗しました");
      const rate = collectPayload.result.initialHighTierRate == null
        ? ""
        : `、S〜A推定率${Math.round(collectPayload.result.initialHighTierRate * 100)}%`;
      const fallback = collectPayload.result.recentSearchFallback
        ? "（全期間検索が利用できないため直近検索で取得）"
        : "";
      setMessage(`登録完了：取得${collectPayload.result.fetched}件、採用${collectPayload.result.accepted}件、重複${collectPayload.result.duplicates}件${rate}${fallback}`);
      setUsername("");
      await loadAuthors();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登録に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function collectOne(author: CuratedAuthor) {
    setLoading(true);
    setError("");
    setMessage(`@${author.username} を収集中...`);
    try {
      const response = await fetch("/api/collect-curated-author", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ xAuthorId: author.x_author_id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "収集に失敗しました");
      setMessage(`@${author.username}：新規保存${payload.result.saved}件、重複${payload.result.duplicates}件、採用${payload.result.accepted}件`);
      await loadAuthors();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "収集に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(author: CuratedAuthor) {
    setLoading(true);
    setError("");
    try {
      const action = author.curated_status === "active" ? "pause" : "resume";
      const response = await fetch("/api/curated-authors", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action, xAuthorId: author.x_author_id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "変更に失敗しました");
      await loadAuthors();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "変更に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function collectBatch() {
    setLoading(true);
    setError("");
    setMessage("選別投稿者を順番に収集しています...");
    try {
      const response = await fetch("/api/collect-curated-batch", { headers: headers(), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "一括収集に失敗しました");
      setMessage(`${payload.processed}投稿者の収集が完了しました`);
      await loadAuthors();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "一括収集に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  if (!secret) {
    return <main style={{ maxWidth: 520, margin: "60px auto", padding: 24 }}>
      <h1>選別投稿者管理</h1>
      <p>続行するにはCRON_SECRETを入力してください。このタブを閉じると消えます。</p>
      <input type="password" value={secretInput} onChange={(event) => setSecretInput(event.target.value)} style={{ width: "100%", padding: 12 }} />
      <button onClick={unlock} style={{ marginTop: 12, padding: "11px 18px" }}>開く</button>
    </main>;
  }

  return <main style={{ maxWidth: 1180, margin: "0 auto", padding: 24, color: "#171717" }}>
    <h1>選別投稿者管理</h1>
    <p>登録時は動画だけを25件ずつ取得し、S〜A率が低ければ自動停止します。次回からは新着動画だけを保存します。モザイクは除外しません。</p>
    {error && <div style={{ padding: 12, background: "#fff0f0", color: "#9b1c1c", marginBottom: 12 }}>{error}</div>}
    {message && <div style={{ padding: 12, background: "#f0f7ff", marginBottom: 12 }}>{message}</div>}
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, margin: "18px 0" }}>
      {[["登録", summary.total], ["稼働中", summary.active], ["利用不可", summary.unavailable], ["初回未完了", summary.pending], ["取得動画", summary.fetched], ["採用動画", summary.accepted]].map(([label, value]) => <div key={String(label)} style={{ padding: 14, background: "#f5f5f5" }}><small>{label}</small><div style={{ fontSize: 25, fontWeight: 800 }}>{value}</div></div>)}
    </section>
    <form onSubmit={addAuthor} style={{ display: "flex", gap: 9, flexWrap: "wrap", marginBottom: 20 }}>
      <input placeholder="@username またはXプロフィールURL" value={username} onChange={(event) => setUsername(event.target.value)} style={{ minWidth: 290, padding: 11 }} />
      <select value={expectedTier} onChange={(event) => setExpectedTier(event.target.value as "S" | "A")} style={{ padding: 11 }}><option value="S">S想定</option><option value="A">A想定</option></select>
      <select value={initialLimit} onChange={(event) => setInitialLimit(Number(event.target.value) as 50 | 100 | 200 | 500)} style={{ padding: 11 }}>
        <option value={50}>節約：最大50動画（約$0.25）</option>
        <option value={100}>標準：最大100動画（約$0.50）</option>
        <option value={200}>多め：最大200動画（約$1.00）</option>
        <option value={500}>特別：最大500動画（約$2.50）</option>
      </select>
      <button disabled={loading} style={{ padding: "11px 17px", fontWeight: 800 }}>登録して動画だけ取得</button>
      <button type="button" disabled={loading} onClick={collectBatch} style={{ padding: "11px 17px" }}>全投稿者を収集</button>
    </form>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>{["投稿者", "状態", "初回", "取得", "採用", "重複", "除外", "採用率", "最終収集", "操作"].map((label) => <th key={label} style={{ textAlign: "left", padding: 9, borderBottom: "2px solid #ccc" }}>{label}</th>)}</tr></thead>
      <tbody>{authors.map((author) => {
        const fetched = Number(author.curated_total_fetched ?? 0);
        const accepted = Number(author.curated_total_accepted ?? 0);
        const excluded = Number(author.curated_total_safety_excluded ?? 0) + Number(author.curated_total_content_excluded ?? 0);
        return <tr key={author.x_author_id}>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}><strong>@{author.username}</strong><br /><small>{author.curated_expected_tier}想定</small></td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}>{author.curated_status === "active" ? "稼働" : author.curated_status === "unavailable" ? `利用不可（${Number(author.curated_unavailable_failure_count ?? 0)}回）` : "停止"}</td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}>{author.curated_backfill_status ?? "pending"}</td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}>{fetched}</td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}>{accepted}</td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}>{Number(author.curated_total_duplicates ?? 0)}</td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}>{excluded}</td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}>{fetched ? `${Math.round(accepted / fetched * 100)}%` : "-"}</td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd" }}>{formatDate(author.curated_last_collected_at)}</td>
          <td style={{ padding: 9, borderBottom: "1px solid #ddd", whiteSpace: "nowrap" }}><button disabled={loading || author.curated_status !== "active"} onClick={() => collectOne(author)}>収集</button> <button disabled={loading} onClick={() => changeStatus(author)}>{author.curated_status === "active" ? "停止" : "再開"}</button></td>
        </tr>;
      })}</tbody>
    </table></div>
  </main>;
}
