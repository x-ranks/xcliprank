"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SECRET_KEY = "ranking-admin-cron-secret";
const REASONS = [
  ["minor", "未成年と思われる"],
  ["voyeurism", "盗撮と思われる"],
  ["nonconsensual", "同意のない撮影と思われる"],
  ["site_unsuitable", "サイトに適していない"],
  ["other", "その他の規約違反"],
] as const;

type RankingPost = {
  x_post_id: string;
  author_username: string | null;
  text: string | null;
  x_url: string | null;
  preview_image_url: string | null;
  video_url: string | null;
  adult_tier: string | null;
};

type RemovedPost = RankingPost & {
  moderation_reason: string | null;
  moderation_source: string | null;
  moderated_at: string | null;
};

export default function RankingAdminPage() {
  const [secret, setSecret] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [range, setRange] = useState("daily");
  const [posts, setPosts] = useState<RankingPost[]>([]);
  const [removed, setRemoved] = useState<RemovedPost[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const stored = window.sessionStorage.getItem(SECRET_KEY) ?? "";
    if (stored) {
      setSecret(stored);
      setSecretInput(stored);
    }
  }, []);

  useEffect(() => {
    if (secret) void load(secret, range);
  }, [secret, range]);

  async function load(value = secret, selectedRange = range) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/ranking-admin?range=${selectedRange}`, {
        headers: { Authorization: `Bearer ${value}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "ランキングを取得できませんでした。");
      setPosts(payload.posts ?? []);
      setRemoved(payload.removed ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ランキングを取得できませんでした。");
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

  async function update(xPostId: string, action: "remove" | "restore") {
    const reason = reasons[xPostId] ?? "";
    if (action === "remove" && !reason) {
      setError("削除理由を選択してください。");
      return;
    }
    const confirmation = action === "remove"
      ? "この動画をすべてのランキングから直ちに除外します。よろしいですか？"
      : "この動画をランキング候補へ戻します。よろしいですか？";
    if (!window.confirm(confirmation)) return;

    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/ranking-admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ xPostId, action, reason }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "更新に失敗しました。");
      setMessage(action === "remove" ? "動画をランキングから除外しました。" : "動画をランキング候補へ戻しました。");
      await load(secret, range);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新に失敗しました。");
      setLoading(false);
    }
  }

  if (!secret) {
    return <main style={{ maxWidth: 560, margin: "60px auto", padding: 24 }}>
      <h1>ランキング安全管理</h1>
      <p>CRON_SECRETを入力してください。このタブを閉じると入力内容は消えます。</p>
      <input type="password" value={secretInput} onChange={(event) => setSecretInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") unlock(); }} style={{ width: "100%", padding: 12 }} />
      <button type="button" onClick={unlock} style={{ marginTop: 12, padding: "11px 18px" }}>管理画面を開く</button>
    </main>;
  }

  return <main style={{ maxWidth: 1240, margin: "0 auto", padding: 22, color: "#171717" }}>
    <Link href="/learning-tools" style={{ color: "#177d70", fontWeight: 800, textDecoration: "none" }}>← 学習・レビュー管理へ戻る</Link>
    <h1 style={{ marginBottom: 5 }}>ランキング安全管理</h1>
    <p style={{ marginTop: 0 }}>掲載中の動画を確認し、未成年・盗撮・同意のない撮影などをすべてのランキングから即時除外します。DBから動画情報を物理削除せず、対応履歴を残します。</p>

    {error && <div style={{ padding: 13, marginBottom: 12, background: "#fff0f0", color: "#9b1c1c" }}>{error}</div>}
    {message && <div style={{ padding: 13, marginBottom: 12, background: "#edf8ef", color: "#175b2d" }}>{message}</div>}

    <div style={{ display: "flex", gap: 8, margin: "18px 0", flexWrap: "wrap" }}>
      {[["trending", "新着"], ["daily", "24時間"], ["weekly", "週間"]].map(([value, label]) =>
        <button key={value} type="button" disabled={loading} onClick={() => setRange(value)} style={{ padding: "10px 17px", borderRadius: 8, border: range === value ? "2px solid #111" : "1px solid #bbb", background: range === value ? "#111" : "white", color: range === value ? "white" : "#111", fontWeight: 800 }}>{label}</button>
      )}
      <button type="button" disabled={loading} onClick={() => load()} style={{ padding: "10px 17px", marginLeft: "auto" }}>{loading ? "更新中…" : "再読込"}</button>
    </div>

    <section>
      <h2>現在のランキング（{posts.length}件）</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {posts.map((post, index) => <article key={post.x_post_id} style={{ padding: 13, border: "1px solid #d8dde3", borderRadius: 12, background: "white" }}>
          {post.video_url
            ? <video src={`/api/video?url=${encodeURIComponent(post.video_url)}`} poster={post.preview_image_url ?? undefined} controls muted playsInline preload="metadata" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", background: "#000", borderRadius: 8 }} />
            : post.preview_image_url && <img src={post.preview_image_url} alt="動画サムネイル" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 8 }} />}
          <div style={{ marginTop: 9 }}><strong>#{index + 1}　{post.adult_tier ?? "-"}　@{post.author_username ?? "不明"}</strong></div>
          <p style={{ minHeight: 42, fontSize: 13, lineHeight: 1.5, overflow: "hidden" }}>{post.text ?? ""}</p>
          <a href={post.x_url ?? `https://x.com/i/web/status/${post.x_post_id}`} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>X投稿を確認 ↗</a>
          <select value={reasons[post.x_post_id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [post.x_post_id]: event.target.value }))} style={{ width: "100%", marginTop: 10, padding: 9 }}>
            <option value="">削除理由を選択</option>
            {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button type="button" disabled={loading} onClick={() => update(post.x_post_id, "remove")} style={{ width: "100%", marginTop: 8, padding: 11, border: 0, borderRadius: 7, background: "#a30d20", color: "white", fontWeight: 900 }}>ランキングから即時除外</button>
        </article>)}
      </div>
    </section>

    <details style={{ marginTop: 30, padding: 15, border: "1px solid #d8dde3", borderRadius: 10 }}>
      <summary style={{ fontWeight: 900 }}>最近除外した動画（{removed.length}件）</summary>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {removed.map((post) => <div key={post.x_post_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 10, background: "#f6f7f8" }}>
          <span>@{post.author_username ?? "不明"} / {REASONS.find(([value]) => value === post.moderation_reason)?.[1] ?? post.moderation_reason ?? "規約違反"} / {post.moderated_at ? new Date(post.moderated_at).toLocaleString("ja-JP") : ""}</span>
          <button type="button" disabled={loading} onClick={() => update(post.x_post_id, "restore")}>誤操作を取り消す</button>
        </div>)}
      </div>
    </details>
  </main>;
}
