"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { createLabelPublication } from "../../lib/label-publication-service";
type View = Awaited<ReturnType<ReturnType<typeof createLabelPublication>["status"]>>;
const box = { border: "1px solid #456", padding: 16, borderRadius: 12, margin: "16px 0" }, grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))", gap: 12 };
function Row({ row, view, busy, run }: { row: View["rows"][number]; view: View; busy: boolean; run: (action: string, body?: Record<string, unknown>) => Promise<void> }) {
  const [ids, setIds] = useState(row.labelIds), [loaded, setLoaded] = useState<number[]>([]); const saved = JSON.stringify(row.labelIds); useEffect(() => setIds(JSON.parse(saved)), [saved]);
  return <article style={box}><h3>@{row.author ?? "投稿者"} ／ {row.id}</h3><p>{row.published ? "本番反映済み" : row.stale ? "モデル更新あり：再準備が必要" : row.approved ? "確認済み・反映待ち" : "推定結果・目視確認が必要"}</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>{row.frames.map((src, i) => <img key={src} src={src} alt={`確認画像${i + 1}`} loading="lazy" onLoad={() => setLoaded(old => old.includes(i) ? old : [...old, i])} onError={() => setLoaded(old => old.filter(n => n !== i))} style={{ width: "100%", maxHeight: 240, objectFit: "contain" }} />)}</div>
    <fieldset disabled={busy || row.published || row.stale}><legend>本番に表示するラベル</legend><div style={grid}>{view.labels.filter(l => l.active).map(l => <label key={l.id}><input type="checkbox" checked={ids.includes(l.id)} onChange={e => setIds(old => e.target.checked ? [...old, l.id] : old.filter(id => id !== l.id))} />{l.name}</label>)}</div>
      <button disabled={row.origin === "inferred" && loaded.length !== 4} onClick={() => void run("approve", { id: row.id, labelIds: ids })}>4枚を確認してラベルを確定</button></fieldset>
    {row.error ? <p role="alert">{row.error}</p> : null}<p><a href={`https://x.com/i/status/${row.id}`} target="_blank" rel="noreferrer">元投稿</a> ／ <a href={`https://xcliprank.com/p/${row.id}`} target="_blank" rel="noreferrer">本番の個別ページ</a></p>
  </article>;
}
export default function LabelPublicationPanel() {
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [page, setPage] = useState(0);
  const current = useRef<View | null>(null), running = useRef(false), alive = useRef(false), stop = useRef(false);
  function apply(v: View) { current.current = v; if (alive.current) setView(v); }
  async function refresh(signal?: AbortSignal) { const r = await fetch("/api/label-publication", { cache: "no-store", signal }); const d = await r.json(); if (!r.ok) throw Error(`${d.error}（${d.code}）`); apply(d); }
  useEffect(() => { alive.current = true; const c = new AbortController(); void refresh(c.signal).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => { alive.current = false; stop.current = true; c.abort(); }; }, []);
  async function request(action: string, body: Record<string, unknown> = {}) { const r = await fetch("/api/label-publication", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body, revision: current.current?.revision }) }); const d = await r.json(); if (!r.ok) throw Error(`${d.error}（${d.code}）`); apply(d); }
  async function run(action: string, body: Record<string, unknown> = {}) { if (running.current || !current.current) return; running.current = true; setBusy(true); setError(""); try { await request(action, body); setMessage("処理が完了しました。反映済みの件数を確認してください。"); } catch (e) { setError((e as Error).message); await refresh().catch(() => undefined); } finally { running.current = false; if (alive.current) setBusy(false); } }
  async function inferTen() { if (running.current || !current.current) return; running.current = true; stop.current = false; setBusy(true); setError(""); try { for (let i = 0; i < 10 && !stop.current; i++) { setMessage(`新しい動画を推定中 ${i + 1}/10`); await request("infer"); } setMessage("推定したラベルを4枚の画像で確認してから反映してください。"); } catch (e) { setError((e as Error).message); await refresh().catch(() => undefined); } finally { running.current = false; if (alive.current) setBusy(false); } }
  const rows = view?.rows ?? [], last = Math.max(0, Math.ceil(rows.length / 10) - 1), selected = Math.min(page, last);
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}><Link href="/label-learning">← ラベル学習</Link><h1>学習したラベルを本番へ反映</h1>
    <p>モデル・教師・動画画像はこのPCに置き、確認済みのラベル名と投稿IDだけを本番へ送ります。Tier・新着巡回・掲載可否は変更しません。</p>
    {error ? <p role="alert">{error}</p> : null}<p role="status" aria-live="polite">{message}</p><button disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>記録を更新</button>
    {view ? <><section style={box}><p>学習教材{view.modelSamples}動画 ／ 独立した精度確認{view.independentTestVideos}動画 ／ 準備{rows.length}件 ／ 反映済み{rows.filter(r => r.published).length}件</p>
      <p>①「手動正解を準備」→②確認済みラベルを本番へ反映。新しい動画は③10件ずつ推定→④4枚を見てラベルを確定→⑤本番へ反映、の順に進みます。</p>
      <div style={grid}><button disabled={busy} onClick={() => void run("stage-manual")}>学習時に付けた手動正解を準備</button><button disabled={busy} onClick={() => void inferTen()}>新しい10動画のラベルを推定</button><button disabled={busy || !rows.some(r => r.published)} onClick={() => void run("clear-published")}>反映済みの確認一覧を整理</button><button disabled={busy || !rows.some(r => r.approved && !r.published && !r.stale)} onClick={() => void run("publish")}>確認済みラベルを本番へ反映（最大100件）</button></div>
      {busy ? <button onClick={() => { stop.current = true; }}>この動画が終わったら停止</button> : null}<p>独立した精度確認が少ない間、推定だけで自動公開しません。0.9以上のスコアを候補にしていますが、これは正解率90％という意味ではありません。</p></section>
      <nav aria-label="確認する動画"><button disabled={busy || selected === 0} onClick={() => setPage(selected - 1)}>前の10件</button> {selected + 1}/{last + 1}ページ <button disabled={busy || selected >= last} onClick={() => setPage(selected + 1)}>次の10件</button></nav>
      {rows.slice(selected * 10, selected * 10 + 10).map(r => <Row key={`${r.id}-${r.videoHash}-${r.modelRevision}`} row={r} view={view} busy={busy} run={run} />)}
    </> : <p>学習モデルを確認しています…</p>}</main>;
}
