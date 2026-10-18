"use client";
import { useEffect, useRef, useState } from "react";
import type { createAutoLabels } from "../../lib/label-auto-service";
type View = Awaited<ReturnType<ReturnType<typeof createAutoLabels>["status"]>>;
const phases: Record<string, string> = { idle: "未開始", running: "処理中（位置を保存済み）", paused: "一時停止", blocked: "設定・モデルの確認が必要", completed: "今回の一周が完了" };
export default function AutoLabelPanel() {
  const [view, setView] = useState<View | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [threshold, setThreshold] = useState(0.7);
  const latest = useRef<View | null>(null), running = useRef(false), stop = useRef(false), alive = useRef(false);
  function apply(v: View) { latest.current = v; if (alive.current) { setView(v); setThreshold(v.threshold); } }
  async function refresh(signal?: AbortSignal) { const r = await fetch("/api/label-auto", { cache: "no-store", signal }); const d = await r.json(); if (!r.ok) throw Error(d.error ?? "記録を取得できませんでした。"); apply(d); }
  useEffect(() => { alive.current = true; const c = new AbortController(); void refresh(c.signal).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => { alive.current = false; stop.current = true; c.abort(); }; }, []);
  async function request(action: string) {
    const r = await fetch("/api/label-auto", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, revision: latest.current?.revision ?? 0, threshold }) });
    const d = await r.json(); if (!r.ok) throw Error(d.error ?? "処理を完了できませんでした。"); apply(d); return d as View;
  }
  async function start(fresh = false) {
    if (running.current || !latest.current) return; running.current = true; stop.current = false; setBusy(true); setError("");
    try {
      let current = await request(fresh ? "new" : "start");
      while (!stop.current && alive.current && current.phase === "running") {
        current = await request("step");
        if (current.phase === "running" && !stop.current && alive.current) await new Promise(r => setTimeout(r, 1000));
      }
      if (stop.current && alive.current && current.phase === "running") await request("pause");
    } catch (e) { if (alive.current) { setError((e as Error).message); await refresh().catch(() => undefined); } }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  const c = view?.counts;
  return <section className="auto-label-panel" aria-labelledby="auto-label-title"><h2 id="auto-label-title">全動画を自動ラベル付け</h2>
    <p>掲載できる動画を1件ずつ一時取得し、4枚から推定して本番へ反映します。手動ラベルは保持します。確認画像の目視操作は不要です。</p>
    <p>この画面を開いている間に進みます。閉じると次の動画へは進まず、処理位置を保存します。再起動後も続きから再開できます。</p>
    <p>自動ラベルは推定として表示します。学習できていないラベルは付けず、候補なしもそのまま記録します。スコアは実際の正解率を示す値ではありません。</p>
    {error ? <p role="alert">{error}</p> : null}
    <p role="status" aria-live="polite">{view ? (view.phase === "running" && !busy ? "処理位置を保存済み・再開待ち" : phases[view.phase]) : "記録を確認中…"}{busy ? " ／ 今の1件が終わるまでお待ちください" : ""}</p>
    {c ? <dl className="auto-label-counts"><div><dt>掲載候補を確認</dt><dd>{c.scanned}件</dd></div><div><dt>今回の本番反映</dt><dd>{c.published}件</dd></div><div><dt>うち該当ラベルなし</dt><dd>{c.emptyLabels}件</dd></div><div><dt>既存ラベルを保持</dt><dd>{c.protected + c.already}件</dd></div><div><dt>掲載条件外</dt><dd>{c.unavailable}件</dd></div><div><dt>動画の処理失敗</dt><dd>{c.failed}件</dd></div></dl> : null}
    {view?.current ? <p>処理対象：{view.current.handle ? "@" + view.current.handle : view.current.id}{view.pendingPublication ? " ／ 推定済み・本番反映を再試行できます" : ""}</p> : null}
    {view?.message ? <p role="alert">処理を止めて位置を保存しました。通信・本番更新・モデルの状態を確認して再開してください。（{view.message}）</p> : null}
    <label>判定の厳しさ <select disabled={busy || (view !== null && !["idle", "completed", "blocked"].includes(view.phase))} value={threshold} onChange={e => setThreshold(Number(e.target.value))}><option value={0.7}>標準（0.7）</option><option value={0.5}>広め（0.5）</option><option value={0.9}>厳しめ（0.9）</option></select></label>
    <div className="auto-label-actions"><button type="button" disabled={busy || !view || view.phase === "completed"} onClick={() => void start()}>自動反映を開始・続きから再開</button><button type="button" disabled={!busy} onClick={() => { stop.current = true; }}>今の1件が終わったら停止</button><button type="button" disabled={busy || !view || !["completed", "blocked"].includes(view.phase)} onClick={() => void start(true)}>新着・失敗分を含めて新しい一周を開始</button><button type="button" disabled={busy} onClick={() => void refresh().catch(e => setError(e.message))}>記録を更新</button></div>
    {view?.lastErrors.length ? <details><summary>直近の処理失敗（最大20件）</summary><ul>{view.lastErrors.map((e, i) => <li key={e.id + ":" + i}>{e.id}：{e.code}</li>)}</ul></details> : null}
  </section>;
}
