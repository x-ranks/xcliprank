"use client";

import { useEffect, useState } from "react";

const SECRET_KEY = "x-api-usage-cron-secret";
const LABELS: Record<string, string> = { discovery: "広域探索", priority: "優先探索", curated_initial: "選別投稿者 初回", curated_incremental: "選別投稿者 新着", author_lookup: "アカウント検索", x_publish: "X自動投稿" };

type Usage = { total: { requests: number; posts: number; users: number }; bySource: Record<string, { requests: number; posts: number; users: number; errors: number }>; byDay: Record<string, { requests: number; posts: number; users: number }> };

export default function XApiUsagePage() {
  const [secret, setSecret] = useState("");
  const [input, setInput] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { const value = window.sessionStorage.getItem(SECRET_KEY) ?? ""; if (value) { setSecret(value); setInput(value); } }, []);
  useEffect(() => { if (!secret) return; void load(secret); }, [secret]);
  async function load(value: string) {
    setError("");
    try { const response = await fetch("/api/x-api-usage?days=30", { headers: { Authorization: `Bearer ${value}` }, cache: "no-store" }); const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error ?? "取得に失敗しました"); setUsage(payload); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "取得に失敗しました"); }
  }
  if (!secret) return <main style={{ maxWidth: 760, margin: "40px auto", padding: 20, fontFamily: "sans-serif" }}><h1>X API利用量</h1><p>CRON_SECRETを入力すると、直近30日間の利用量を表示します。</p><input type="password" value={input} onChange={(event) => setInput(event.target.value)} style={{ width: "100%", padding: 10 }} /><button onClick={() => { window.sessionStorage.setItem(SECRET_KEY, input.trim()); setSecret(input.trim()); }} style={{ marginTop: 10, padding: 10 }}>開く</button></main>;
  return <main style={{ maxWidth: 900, margin: "30px auto", padding: 20, fontFamily: "sans-serif" }}><a href="/learning-tools">← 学習・レビュー管理へ戻る</a><h1>X API利用量（直近30日）</h1>{error && <p style={{ color: "#b00020" }}>{error}</p>}{usage && <><section style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{[["リクエスト", usage.total.requests], ["Post", usage.total.posts], ["User", usage.total.users]].map(([label, value]) => <div key={String(label)} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, minWidth: 150 }}><b>{label}</b><div style={{ fontSize: 28 }}>{value}</div></div>)}</section><h2>用途別</h2><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">用途</th><th>リクエスト</th><th>Post</th><th>User</th><th>エラー</th></tr></thead><tbody>{Object.entries(usage.bySource).map(([source, row]) => <tr key={source}><td style={{ padding: 8, borderTop: "1px solid #ddd" }}>{LABELS[source] ?? source}</td><td align="center">{row.requests}</td><td align="center">{row.posts}</td><td align="center">{row.users}</td><td align="center">{row.errors}</td></tr>)}</tbody></table><h2>日別</h2><div>{Object.entries(usage.byDay).map(([day, row]) => <div key={day} style={{ display: "flex", gap: 16, borderTop: "1px solid #eee", padding: 6 }}><b style={{ width: 110 }}>{day}</b><span>リクエスト {row.requests}</span><span>Post {row.posts}</span><span>User {row.users}</span></div>)}</div></>}</main>;
}
