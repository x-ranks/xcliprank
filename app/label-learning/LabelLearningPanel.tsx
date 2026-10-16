"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { createLabelService } from "../../lib/label-learning-service";
import type { Decisions, LabelDefinition, LabelReport } from "../../lib/label-learning-core";
type View = Awaited<ReturnType<ReturnType<typeof createLabelService>["status"]>>;
type Video = View["videos"][number];
const box = { border: "1px solid #456", borderRadius: 12, padding: 16, marginTop: 18 };
const line = { display: "flex", flexWrap: "wrap" as const, gap: 10, alignItems: "center" };
const percent = (v: number | null) => v === null ? "未算出" : `${(v * 100).toFixed(1)}％`;
type Run = (action: string, body?: Record<string, unknown>) => Promise<void>;
function LabelEditor({ label, disabled, run }: { label: LabelDefinition; disabled: boolean; run: Run }) {
  const [name, setName] = useState(label.name);
  useEffect(() => setName(label.name), [label.name]);
  return <form style={line} onSubmit={e => { e.preventDefault(); void run("edit-label", { id: label.id, name, active: label.active }); }}>
    <label>ラベル名 <input aria-label={`${label.name}の名前`} value={name} maxLength={40} disabled={disabled} onChange={e => setName(e.target.value)} /></label>
    <button disabled={disabled || !name.trim()}>名前を保存</button>
    <button type="button" disabled={disabled} onClick={() => void run("edit-label", { id: label.id, name: label.name, active: !label.active })}>{label.active ? "使用を休止" : "使用を再開"}</button>
    <span>{label.active ? "使用中" : "休止中（正解データは保持）"}</span>
  </form>;
}
function Report({ title, report, labels }: { title: string; report: LabelReport | null; labels: LabelDefinition[] }) {
  return <section style={box}><h3>{title}</h3>{report ? <>
    <p>対象 {report.videos}動画 ／ 判定できた項目 {report.scored}/{report.known} ／ 判定一致率 {percent(report.agreement)} ／ F1 {percent(report.f1)}</p>
    <p>未確認項目と教材不足のラベルは採点しません。少数データの結果であり、実運用の精度を保証する数値ではありません。</p>
    <div style={{ overflowX: "auto" }}><table><thead><tr><th>ラベル</th><th>採点数</th><th>的中率</th><th>検出率</th><th>見逃し</th><th>誤検出</th></tr></thead>
      <tbody>{report.labels.map(r => <tr key={r.id}><td>{labels.find(l => l.id === r.id)?.name ?? "休止ラベル"}</td><td>{r.scored}/{r.known}</td><td>{percent(r.precision)}</td><td>{percent(r.recall)}</td><td>{r.fn}</td><td>{r.fp}</td></tr>)}</tbody></table></div>
    <p>的中率：付けたラベルの正しさ。検出率：正解ラベルを見つけられた割合。</p>
  </> : <p>まだ算出していません。教材や投稿者の種類が足りない場合も算出できません。</p>}</section>;
}
function ReviewCard({ video, labels, busy, run }: { video: Video; labels: LabelDefinition[]; busy: boolean; run: Run }) {
  const [decisions, setDecisions] = useState<Decisions>(video.review?.decisions ?? {});
  const [role, setRole] = useState<"train" | "test">(video.review?.role ?? "train");
  const [failed, setFailed] = useState<number[]>([]);
  const saved = JSON.stringify(video.review);
  useEffect(() => { const review = JSON.parse(saved) as Video["review"]; setDecisions(review?.decisions ?? {}); setRole(review?.role ?? "train"); }, [saved]);
  const active = labels.filter(l => l.active), hasDecision = active.some(l => typeof decisions[l.id] === "boolean");
  return <article style={box}>
    <h3>@{video.author ?? "投稿者不明"} ／ 投稿 {video.postId}</h3>
    <p>{video.review ? `正解保存済み：${video.review.role === "train" ? "学習用" : "精度確認用"}` : "正解は未保存"}{video.everTrained ? " ／ 過去に学習使用済み" : ""}</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
      {video.frames.map((src, i) => <figure key={src} style={{ margin: 0 }}><img src={src} alt={`投稿${video.postId}の確認画像${i + 1}`} loading="lazy" style={{ width: "100%", maxHeight: 280, objectFit: "contain", background: "#07111d" }} onError={() => setFailed(v => v.includes(i) ? v : [...v, i])} onLoad={() => setFailed(v => v.filter(n => n !== i))} /><figcaption>{[10, 25, 50, 80][i]}％地点 ／ {video.times[i].toFixed(1)}秒{failed.includes(i) ? "（画像読込失敗）" : ""}</figcaption></figure>)}
    </div>
    <fieldset disabled={busy}><legend>4枚をまとめて確認した正解</legend>
      {active.map(l => <fieldset key={l.id} style={{ margin: "8px 0" }}><legend>{l.name}</legend>
        {([true, false, null] as const).map(value => <label key={String(value)} style={{ marginRight: 16 }}><input type="radio" name={`${video.postId}-${l.id}`} checked={(decisions[l.id] ?? null) === value} onChange={() => setDecisions(d => ({ ...d, [l.id]: value }))} />{value === true ? "該当する" : value === false ? "該当しない" : "未確認"}</label>)}
      </fieldset>)}
      <button type="button" onClick={() => setDecisions(d => Object.fromEntries(active.map(l => [l.id, d[l.id] === true ? true : false])))}>残りのラベルを「該当しない」にする</button>
      <p><label>この動画の用途 <select value={role} onChange={e => setRole(e.target.value as "train" | "test")}><option value="train">学習用</option><option value="test">精度確認用（学習に使わない）</option></select></label></p>
      <button disabled={!hasDecision || failed.length > 0} onClick={() => void run("review", { postId: video.postId, role, decisions })}>正解を保存</button>
    </fieldset>
    {role === "test" && video.everTrained ? <p>この動画または同じ投稿者を過去に学習しているため、独立した精度チェックには数えません。</p> : null}
    {video.review?.role === "test" && !video.review.blinded ? <p>予測を見た後に正解を保存・変更したため、独立した精度チェックから除外します。</p> : null}
    <p><button disabled={busy} onClick={() => void run("predict", { postId: video.postId })}>この動画の予測を表示</button>　<a href={`https://x.com/i/status/${video.postId}`} target="_blank" rel="noreferrer">元投稿を開く</a></p>
    {video.prediction ? <ul>{video.prediction.map(p => <li key={p.id}>{labels.find(l => l.id === p.id)?.name}：{p.score === null ? "教材不足" : `${p.selected ? "候補あり" : "候補なし"} ／ 判定スコア ${percent(p.score)}`}</li>)}</ul> : null}
    <p>判定スコアは正解率ではありません。予測を先に見ると、この動画を公平な精度チェックに使えなくなります。</p>
  </article>;
}
export default function LabelLearningPanel() {
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [name, setName] = useState(""), [postInput, setPostInput] = useState(""), [filter, setFilter] = useState("all"), [page, setPage] = useState(0);
  const current = useRef<View | null>(null), running = useRef(false), stop = useRef(false), mounted = useRef(false);
  function apply(data: View) { current.current = data; if (mounted.current) setView(data); }
  async function refresh(signal?: AbortSignal) {
    const r = await fetch("/api/label-learning", { cache: "no-store", signal }); const data = await r.json();
    if (!r.ok) throw Error(`${data.error ?? "記録を読めません。"}（${data.code ?? "READ_FAILED"}）`); apply(data as View);
  }
  useEffect(() => { mounted.current = true; const controller = new AbortController(); void refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setError(String(e.message)); }); return () => { mounted.current = false; stop.current = true; controller.abort(); }; }, []);
  async function request(action: string, body: Record<string, unknown> = {}) {
    const r = await fetch("/api/label-learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body, revision: current.current?.revision }) });
    const data = await r.json(); if (!r.ok) { const e = Object.assign(Error(`${data.error}（${data.code}）`), { code: data.code }); throw e; } apply(data as View);
  }
  async function run(action: string, body: Record<string, unknown> = {}) {
    if (running.current || !current.current) return; running.current = true; setBusy(true); setError(""); setMessage("処理中です…");
    try { await request(action, body); if (mounted.current) setMessage("保存・処理が完了しました。"); }
    catch (e) { if (mounted.current) { setError((e as Error).message); setMessage(""); } await refresh().catch(() => undefined); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function prepareBatch() {
    if (running.current || !current.current) return; running.current = true; stop.current = false; setBusy(true); setError(""); let ready = 0, failed = 0;
    try {
      for (let i = 0; i < 10 && !stop.current; i++) {
        if (mounted.current) setMessage(`画像を準備中：${i + 1}/10動画（成功${ready}・見送り${failed}）`);
        try { await request("prepare"); ready++; }
        catch (e) { failed++; await refresh(); const code = (e as Error & { code?: string }).code; if (!["LABEL_DUPLICATE_VIDEO", "LABEL_VIDEO_FETCH_FAILED", "LABEL_VIDEO_TOO_LARGE", "LABEL_PROCESS_FAILED"].includes(code ?? "")) throw e; }
      }
      if (mounted.current) setMessage(`画像の準備：成功${ready}・見送り${failed}。${stop.current ? "ここで停止しました。" : "正解ラベルを付けて保存してください。"}`);
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const videos = view?.videos.filter(v => filter === "all" || (filter === "unreviewed" ? !v.review : v.review?.role === filter)) ?? [];
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}>
    <Link href="/learning-tools">← 管理画面の入口</Link><h1>ラベル管理・4枚で学習</h1>
    <p>①ラベル作成 → ②動画の4枚を確認して正解を保存 → ③10件以上で学習 → ④未使用の動画で精度チェック。</p>
    <p>ラベル・画像・モデルはこのPCの専用フォルダへ保存します。本番掲載、Tier評価、巡回、既存のラベルJSONは変更しません。</p>
    {error ? <p role="alert" style={{ color: "#ff9292" }}>{error}</p> : null}<p role="status" aria-live="polite">{message}</p>
    <button disabled={busy} onClick={() => { void refresh().catch(e => setError(e.message)); }}>記録を更新</button>
    {!view ? <p>記録を読み込んでいます…</p> : <>
      <section style={box}><h2>1．必要なラベルを作成</h2>
        <form style={line} onSubmit={e => { e.preventDefault(); void run("create-label", { name }); }}><label>新しいラベル名 <input value={name} maxLength={40} disabled={busy} onChange={e => setName(e.target.value)} /></label><button disabled={busy || !name.trim()}>ラベルを追加</button></form>
        <p>最大40個。名前の変更と使用休止ができます。休止しても教師データは削除しません。</p>
        {view.labels.map(l => <LabelEditor key={l.id} label={l} disabled={busy} run={run} />)}
      </section>
      <section style={box}><h2>2．4枚を準備してラベル付け</h2>
        <p>収集済みDBの掲載条件を満たす動画から選びます。新規ポストの収集やX API呼出は行いません。動画の10％・25％・50％・80％地点を表示します。</p>
        <p>元動画の一時ダウンロードとCPU処理が必要です。1動画最大96MiB、10件で最大960MiB。初回は既存画像モデルの読み込みが必要です。準備後に一時動画を削除し、4枚の画像と特徴を保持します。</p>
        <div style={line}><button disabled={busy || !view.labels.some(l => l.active)} onClick={() => void run("prepare")}>1動画の画像を準備</button><button disabled={busy || !view.labels.some(l => l.active)} onClick={() => void prepareBatch()}>10動画を順に準備</button>{busy ? <button onClick={() => { stop.current = true; }}>この動画の準備後に停止</button> : null}</div>
        <form style={{ ...line, marginTop: 12 }} onSubmit={e => { e.preventDefault(); const input = postInput.trim(); const matched = input.match(/^https:\/\/(?:x\.com|twitter\.com)\/[^/?#]+\/status\/(\d{1,25})(?:[/?#].*)?$/); const postId = matched?.[1] ?? input; if (!/^\d{1,25}$/.test(postId)) { setError("投稿IDまたはXの投稿URLを入力してください。"); return; } void run("prepare", { postId }); }}><label>収集済み投稿のID／URL <input value={postInput} onChange={e => setPostInput(e.target.value)} disabled={busy} /></label><button disabled={busy || !postInput.trim()}>指定動画を準備</button></form>
      </section>
      <section style={box}><h2>3．学習と精度チェック</h2>
        <p>正解保存済みの学習用：{view.trainingCount}動画 ／ 画像準備済み：{view.videos.length}動画</p>
        <ul>{view.labels.filter(l => l.active).map(l => {
          const answers = view.videos.filter(v => v.review?.role === "train").map(v => v.review!.decisions[l.id]);
          return <li key={l.id}>{l.name}：該当{answers.filter(v => v === true).length}・非該当{answers.filter(v => v === false).length}・未確認{answers.filter(v => typeof v !== "boolean").length}</li>;
        })}</ul>
        <div style={line}><button disabled={busy || view.trainingCount < 10} onClick={() => void run("train")}>学習して試作結果を確認</button><button disabled={busy || !view.model || view.model.stale} onClick={() => void run("check")}>未使用動画で精度チェック</button></div>
        <p>学習には10動画以上と、各ラベルの該当・非該当それぞれ2件以上が必要です。未確認は非該当として学習しません。</p>
        <p>確認して該当しないラベルにも「該当しない」を付けてください。「残りのラベルを該当しないにする」でまとめて指定できます。</p>
        <p>精度確認用は、予測を見る前に正解を保存してください。過去に学習した動画・同じ投稿者の動画・予測を見てから正解を変更した動画は採点対象外です。</p>
        {view.model ? <><p>モデル作成：{new Date(view.model.trainedAt).toLocaleString("ja-JP")} ／ 教材{view.model.samples}動画{view.model.stale ? " ／ 教材変更あり：再学習してください" : ""}</p>
          <ul>{view.model.heads.map(h => <li key={h.id}>{view.labels.find(l => l.id === h.id)?.name}：該当{h.positive}・非該当{h.negative} ／ {h.ready ? "学習済み" : "教材不足"}</li>)}</ul>
          <p>試作評価は同じ動画・投稿者のグループを分けて{view.model.crossCheck.folds}分割。グループ数{view.model.crossCheck.groups}。同じ投稿者しかいない場合は評価できません。</p>
          <Report title="教材内の分割検証（試作の目安）" report={view.model.stale ? null : view.model.crossCheck.report} labels={view.labels} />
        </> : <p>モデルは未作成です。</p>}
        <Report title="学習未使用動画での精度チェック" report={view.testReport} labels={view.labels} />
      </section>
      <section style={box}><h2>動画の確認</h2><div style={line}><label>表示 <select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="all">すべて</option><option value="unreviewed">正解未保存</option><option value="train">学習用</option><option value="test">精度確認用</option></select></label><span>{videos.length}動画</span><button disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>前へ</button><button disabled={busy || (page + 1) * 10 >= videos.length} onClick={() => setPage(p => p + 1)}>次へ</button></div>
        {videos.slice(page * 10, page * 10 + 10).map(v => <ReviewCard key={v.postId} video={v} labels={view.labels} busy={busy} run={run} />)}
      </section>
    </>}
  </main>;
}
