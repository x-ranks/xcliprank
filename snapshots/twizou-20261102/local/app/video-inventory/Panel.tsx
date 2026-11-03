"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { INVENTORY_TIERS, type VideoInventory } from "../../lib/video-inventory";
export default function Panel() {
  const [data, setData] = useState<VideoInventory | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  async function read() {
    controller.current?.abort(); const request = new AbortController(); controller.current = request; setBusy(true); setError("");
    try { const r = await fetch("/api/video-inventory", { cache: "no-store", signal: request.signal }), value = await r.json(); if (!r.ok || value.ok !== true) throw Error(value.error || "件数を取得できませんでした。"); if (!request.signal.aborted) setData(value); }
    catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : "件数を取得できませんでした。"); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  useEffect(() => { void read(); return () => controller.current?.abort(); }, []);
  return <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
    <Link href="/learning-tools#operations">← 管理トップ</Link><h1>動画数・Tier別件数</h1>
    <p>動画URLが登録されたDB内の全動画です。非表示・掲載条件外の動画も含みます。手動Tierを優先し、未設定なら自動Tierで数えます。</p>
    <button onClick={() => void read()} disabled={busy}>{busy ? "確認中…" : "記録を更新"}</button><p>集計結果は最大5分再利用します。動画取得や判定処理は行いません。</p>
    {error && <p role="alert">{error}</p>}
    {data && <><p>集計日時：{new Date(data.measuredAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）</p><h2>総動画数：{data.total.toLocaleString()}件</h2><table><thead><tr><th scope="col">Tier</th><th scope="col">動画数</th></tr></thead><tbody>{INVENTORY_TIERS.map(tier => <tr key={tier}><th scope="row">{tier}</th><td>{data.tiers[tier].toLocaleString()}件</td></tr>)}<tr><th scope="row">未判定・その他</th><td>{data.other.toLocaleString()}件</td></tr></tbody></table></>}
  </main>;
}
