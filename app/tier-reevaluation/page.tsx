"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
type Job = { id: string; phase: string; total: number; changed: number; applied: number; skipped: number; ignored: number; modelSamples: number;personalModelTrainedAt:string|null;restored:number;restoreConflicts:number; transitions: Record<string, number> };
type Sample = { id: number; x_post_id: string; author_username: string; preview_image_url: string; video_url: string; adult_tier: string; manual_tier: string | null; before: string; proposed: string };
type Result = { job: Job | null; samples: Sample[]; sampleScope?: string; error?: string };
export default function TierReevaluation() {
  const [result, setResult] = useState<Result>({ job: null, samples: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stop = useRef(false);
  async function request(action?: string, id?: string) {
    const response = await fetch("/api/tier-reevaluation", action ? { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ action, id }) } : { cache: "no-store" });
    const text = await response.text();
    let data: Result;
    try { data = JSON.parse(text); }
    catch { throw new Error(`再評価APIがJSONを返しませんでした（HTTP ${response.status}）。開発サーバーを再起動して画面を更新してください。`); }
    if (!response.ok) throw new Error(data.error ?? "確認に失敗しました。");
    setResult(data); return data;
  }
  useEffect(() => { request().catch(e => setError(e.message)); }, []);
  async function run(action: "start" | "scan" | "apply" | "cancel" | "restore") {
    setBusy(true); setError(""); stop.current = false;
    try {
      let data = await request(action, result.job?.id);
      while (!stop.current && data.job && ((action !== "apply" && action !== "cancel" && action !== "restore" && data.job.phase === "scanning") || (action === "apply" && data.job.phase === "applying") || (action === "restore" && data.job.phase === "restoring"))) {
        data = await request(action === "restore" ? "restore" : action === "apply" ? "apply" : "scan", data.job.id);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "処理に失敗しました。"); }
    finally { setBusy(false); }
  }
  async function review(post: Sample, tier: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/review", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ postId: post.id, manualTier: tier }) });
      if (!response.ok) throw new Error("手動評価を保存できませんでした。");
      setResult(r => ({ ...r, samples: r.samples.map(p => p.id === post.id ? { ...p, manual_tier: tier } : p) }));
    } catch (e) { setError(e instanceof Error ? e.message : "保存に失敗しました。"); }
    finally { setBusy(false); }
  }
  const job = result.job;
  return <main style={{maxWidth: 1100, margin: "0 auto", padding: 20, color: "#eee", background: "#151515", minHeight: "100vh"}}>
    <Link href="/learning-tools">← 管理画面</Link>
    <h1>未評価動画の再評価</h1>
    <p>最新の手動評価を参考に、保存済み情報から再計算します。X APIクレジットは消費しません。手動評価済み・安全上の除外・NONEは対象外です。</p>
    <p>最初に変更予定を作成し、確認後に保存してください。同じSupabaseを使う本番ランキングにも影響します。計算中と保存中は途中停止・続行できます。</p>
    {error && <p role="alert" style={{color: "#ffaaaa"}}>{error}</p>}
    <div style={{display: "flex", flexWrap: "wrap", gap: 10}}>
      {(!job || ["done","restored"].includes(job.phase)) && <button disabled={busy} onClick={() => run("start")}>最新の学習で変更予定を作成</button>}
      {job?.phase === "scanning" && <button disabled={busy} onClick={() => run("scan")}>計算を続ける</button>}
      {job && ["ready", "applying"].includes(job.phase) && <button disabled={busy} onClick={() => run("apply")}>{job.phase === "ready" ? "変更予定を確認したのでDBに保存" : "保存を続ける"}</button>}
      {job && ["ready","applying","done","restoring"].includes(job.phase) && <button disabled={busy||(!job.applied&&job.phase!=="applying"&&job.phase!=="restoring")} onClick={()=>run("restore")}>この再評価で変更したTier・スコアを復元</button>}
      {job?.phase==="restored"&&<p>復元完了：{job.restored}件。手動評価や並行変更を保護して復元しなかった件数：{job.restoreConflicts}件。</p>}
      {busy && <button onClick={() => { stop.current = true; }}>この区切りで停止</button>}
      {job && job.phase !== "done" && <button disabled={busy} onClick={() => run("cancel")}>処理を終了（保存済みの変更は維持）</button>}
      <button disabled={busy} onClick={() => { setError(""); request().catch(e => setError(e.message)); }}>ランダム50件を選び直す</button>
    </div>
    {job && <section>
      <h2>{job.phase === "done" ? "再評価の保存完了" : job.phase === "ready" ? "変更予定（未保存）" : job.phase === "scanning" ? "変更予定を計算中" : "保存中"}</h2>
      <p>使用する視覚モデルの学習日時：{job.personalModelTrainedAt??"視覚モデルなし（従来方式）"}</p>
      <p>教師データ {job.modelSamples}件 ／ 対象 {job.total}件 ／ Tier変更予定 {job.changed}件 ／ 保存済み {job.applied}件 ／ 競合等で除外 {job.skipped}件 ／ 計算対象外 {job.ignored}件</p>
      <details><summary>Tier変更の内訳</summary><ul>{Object.entries(job.transitions).map(([key, count]) => <li key={key}>{key}：{count}件</li>)}</ul></details>
      <p>{result.sampleScope === "applied" ? "保存済みの再評価対象からランダム抽出" : "変更予定の対象からランダム抽出（まだ保存されていません）"}：{result.samples.length}件。50件未満なら対象分だけ表示します。</p>
      <p>保存後のランキング表示は、キャッシュ更新と再読込まで数分かかる場合があります。掲載は枠・公開条件によって決まります。</p>
    </section>}
    <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginTop: 20}}>
      {result.samples.map(post => <article key={post.id} style={{padding: 12, background: "#252525", borderRadius: 8}}>
        <p>@{post.author_username} ／ {post.before} → {post.proposed}</p>
        <p>現在：{post.manual_tier ? `手動 ${post.manual_tier}` : `自動 ${post.adult_tier}`}</p>
        {post.video_url && post.manual_tier !== "X" && <video controls playsInline preload="none" poster={post.preview_image_url || undefined} src={post.video_url} style={{width: "100%", maxHeight: 350}} />}
        <p><a href={`https://x.com/i/status/${post.x_post_id}`} target="_blank" rel="noreferrer">元投稿を確認</a></p>
        <div style={{display: "flex", gap: 8}}>{["S", "A", "B", "C", "D", "X"].map(tier => <button disabled={busy} key={tier} onClick={() => review(post, tier)} aria-label={`投稿${post.x_post_id}を${tier}で手動評価`}>{tier}</button>)}</div>
      </article>)}
    </div>
  </main>;
}
