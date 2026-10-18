"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { createLabelService } from "../../lib/label-learning-service";
import type { Decisions, LabelDefinition, LabelReport } from "../../lib/label-learning-core";
import { preparedCount, preparationGoal, remainingPreparation, type LabelPurpose } from "../../lib/label-learning-batch";
type View = Awaited<ReturnType<ReturnType<typeof createLabelService>["status"]>>;
type Video = View["videos"][number];
const box = { border: "1px solid #456", borderRadius: 12, padding: 16, marginTop: 18 };
const line = { display: "flex", flexWrap: "wrap" as const, gap: 10, alignItems: "center" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))", gap: 12 };
const percent = (v: number | null) => v === null ? "未算出" : `${(v * 100).toFixed(1)}％`;
type Run = (action: string, body?: Record<string, unknown>) => Promise<void>;
function LabelEditor({ label, disabled, run }: { label: LabelDefinition; disabled: boolean; run: Run }) {
  const [name, setName] = useState(label.name);
  useEffect(() => setName(label.name), [label.name]);
  return <form style={{ ...line, border: "1px solid #456", borderRadius: 8, padding: 10 }} onSubmit={e => { e.preventDefault(); void run("edit-label", { id: label.id, name, active: label.active }); }}>
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
  const [role, setRole] = useState<"train" | "test">(video.review?.role ?? video.preparedFor ?? "train");
  const [failed, setFailed] = useState<number[]>([]);
  const saved = JSON.stringify(video.review);
  useEffect(() => { const review = JSON.parse(saved) as Video["review"]; setDecisions(review?.decisions ?? {}); setRole(review?.role ?? video.preparedFor ?? "train"); }, [saved, video.preparedFor]);
  const active = labels.filter(l => l.active), hasDecision = active.some(l => typeof decisions[l.id] === "boolean");
  return <article style={box}>
    <h3>@{video.author ?? "投稿者不明"} ／ 投稿 {video.postId}</h3>
    <p>{video.review ? `正解保存済み：${video.review.role === "train" ? "学習用" : "精度確認用"}` : "正解は未保存"}{video.everTrained ? " ／ 過去に学習使用済み" : ""}</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
      {video.frames.map((src, i) => <figure key={src} style={{ margin: 0 }}><img src={src} alt={`投稿${video.postId}の確認画像${i + 1}`} loading="lazy" style={{ width: "100%", maxHeight: 280, objectFit: "contain", background: "#07111d" }} onError={() => setFailed(v => v.includes(i) ? v : [...v, i])} onLoad={() => setFailed(v => v.filter(n => n !== i))} /><figcaption>{[10, 25, 50, 80][i]}％地点 ／ {video.times[i].toFixed(1)}秒{failed.includes(i) ? "（画像読込失敗）" : ""}</figcaption></figure>)}
    </div>
    <fieldset disabled={busy}><legend>4枚をまとめて確認した正解</legend>
      <div style={{ ...grid, margin: "12px 0" }}>{active.map(l => <fieldset key={l.id} style={{ margin: 0, minWidth: 0, borderRadius: 8 }}><legend>{l.name}</legend>
        {([true, false, null] as const).map(value => <label key={String(value)} style={{ marginRight: 16 }}><input type="radio" name={`${video.postId}-${l.id}`} checked={(decisions[l.id] ?? null) === value} onChange={() => setDecisions(d => ({ ...d, [l.id]: value }))} />{value === true ? "該当する" : value === false ? "該当しない" : "未確認"}</label>)}
      </fieldset>)}</div>
      <button type="button" onClick={() => setDecisions(d => Object.fromEntries(active.map(l => [l.id, d[l.id] === true ? true : false])))}>残りのラベルを「該当しない」にする</button>
      <p><label>この動画の用途 <select value={role} onChange={e => setRole(e.target.value as "train" | "test")}><option value="train">学習用</option><option value="test">精度確認用（学習に使わない）</option></select></label></p>
      <button disabled={!hasDecision || failed.length > 0} onClick={() => void run("review", { postId: video.postId, role, decisions })}>正解を保存</button>
    </fieldset>
    {role === "test" && video.everTrained ? <p>この動画または同じ投稿者を過去に学習しているため、独立した精度チェックには数えません。</p> : null}
    {video.review?.role === "test" && !video.review.blinded ? <p>予測を見た後に正解を保存・変更したため、独立した精度チェックから除外します。</p> : null}
    <p><button disabled={busy} onClick={() => void run("predict", { postId: video.postId })}>この動画の予測を表示</button>　<a href={`https://x.com/i/status/${video.postId}`} target="_blank" rel="noreferrer">元投稿を開く</a></p>
    {video.prediction ? <ul style={grid}>{video.prediction.map(p => <li key={p.id}>{labels.find(l => l.id === p.id)?.name}：{p.score === null ? "教材不足" : `${p.selected ? "候補あり" : "候補なし"} ／ 判定スコア ${percent(p.score)}`}</li>)}</ul> : null}
    <p>判定スコアは正解率ではありません。予測を先に見ると、この動画を公平な精度チェックに使えなくなります。</p>
  </article>;
}
export default function LabelLearningPanel() {
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [name, setName] = useState(""), [postInput, setPostInput] = useState(""), [filter, setFilter] = useState("unreviewed-train"), [page, setPage] = useState(0);
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
  async function prepareBatch(purpose: LabelPurpose, size: 10 | 100) {
    if (running.current || !current.current) return;
    const goal = preparationGoal(current.current.videos, purpose, size);
    const needed = remainingPreparation(current.current.videos, purpose, goal);
    if (!needed) { setMessage("準備済み件数または保存上限に達しています。未保存の動画に正解を付けてください。"); return; }
    running.current = true; stop.current = false; setBusy(true); setError("");
    setFilter(purpose === "train" ? "unreviewed-train" : "unreviewed-test"); setPage(0);
    let ready = 0, failed = 0;
    try {
      // Each successful item is persisted by the server. Reopening the page and
      // clicking the same button resumes from the prepared count, never from zero.
      for (let attempt = 0; attempt < needed * 3 + 10 && !stop.current; attempt++) {
        const active = current.current; if (!active || !remainingPreparation(active.videos, purpose, goal)) break;
        if (mounted.current) setMessage(`${purpose === "train" ? "学習用" : "精度確認用"}を準備中：${preparedCount(active.videos, purpose)}/${goal}動画（今回成功${ready}・見送り${failed}）`);
        try { await request("prepare", { purpose }); ready++; }
        catch (e) {
          failed++; await refresh(); const code = (e as Error & { code?: string }).code;
          if (!["LABEL_DUPLICATE_VIDEO", "LABEL_VIDEO_FETCH_FAILED", "LABEL_VIDEO_TOO_LARGE", "LABEL_SOURCE_CHANGED"].includes(code ?? "")) throw e;
        }
      }
      if (mounted.current) setMessage(`画像の準備：成功${ready}・見送り${failed}。${stop.current ? "停止しました。同じボタンで続きから再開できます。" : "未保存の動画に正解を付けてください。次回も追加できます。"}`);
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const videos = view?.videos.filter(v => {
    const purpose = v.review?.role ?? v.preparedFor;
    if (filter === "all") return true;
    if (filter === "unreviewed") return !v.review;
    if (filter.startsWith("unreviewed-")) return !v.review && purpose === filter.slice(11);
    return purpose === filter;
  }) ?? [];
  const lastPage = Math.max(0, Math.ceil(videos.length / 10) - 1), shownPage = Math.min(page, lastPage);
  const trainingPrepared = preparedCount(view?.videos ?? [], "train");
  const testPrepared = preparedCount(view?.videos ?? [], "test");
  const testReady = view?.videos.filter(v => v.review?.role === "test" && v.review.blinded && !v.everTrained).length ?? 0;
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: 24 }}>
    <Link href="/learning-tools">← 管理画面の入口</Link>　<Link href="/label-publication">学習済みラベルを本番へ反映 →</Link><h1>ラベル管理・4枚で学習</h1>
    <p>①ラベル作成 → ②学習用を100件まで準備し、4枚を見て正解保存 → ③累積した教材すべてで学習 → ④新しいランダム動画で精度チェック。</p>
    <p>ラベル・画像・モデルはこのPCの専用フォルダへ保存します。本番掲載、Tier評価、巡回、既存のラベルJSONは変更しません。</p>
    {error ? <p role="alert" style={{ color: "#ff9292" }}>{error}</p> : null}<p role="status" aria-live="polite">{message}</p>
    <button disabled={busy} onClick={() => { void refresh().catch(e => setError(e.message)); }}>記録を更新</button>
    {!view ? <p>記録を読み込んでいます…</p> : <>
      <section style={box}><h2>1．必要なラベルを作成</h2>
        <form style={line} onSubmit={e => { e.preventDefault(); void run("create-label", { name }); }}><label>新しいラベル名 <input value={name} maxLength={40} disabled={busy} onChange={e => setName(e.target.value)} /></label><button disabled={busy || !name.trim()}>ラベルを追加</button></form>
        <p>最大40個。名前の変更と使用休止ができます。休止しても教師データは削除しません。</p>
        <div style={{ ...grid, marginTop: 12 }}>{view.labels.map(l => <LabelEditor key={l.id} label={l} disabled={busy} run={run} />)}</div>
      </section>
      <section style={box}><h2>2．4枚を準備してラベル付け</h2>
        <p>収集済みDBの掲載条件を満たす動画から選びます。新規ポストの収集やX API呼出は行いません。動画の10％・25％・50％・80％地点を表示します。</p>
        <p>学習用：画像準備 {trainingPrepared}/100動画 ／ 正解保存 {view.trainingCount}/100動画</p>
        <progress aria-label="学習用の正解保存進捗" max={100} value={Math.min(100, view.trainingCount)} style={{ width: "100%" }} />
        <p>10件の正解を保存したら「次の学習用10件を準備」で追加できます。「学習用100件まで準備」は途中停止・画面を開き直した後も準備済み件数から続けます。正解保存は手動です。画面を閉じると追加取得は止まります。</p>
        <p>元動画を1本ずつ一時ダウンロードしてCPU処理します。1動画最大96MiB、100件なら転送量は最大約9.4GiBです。抽出後に一時動画を削除し、4枚の画像と特徴を保持します。通信量を抑える場合は10件ずつ進めてください。</p>
        <div style={line}><button disabled={busy || !view.labels.some(l => l.active)} onClick={() => void run("prepare", { purpose: "train" })}>学習用を1件追加</button><button disabled={busy || !view.labels.some(l => l.active)} onClick={() => void prepareBatch("train", 10)}>次の学習用10件を準備</button><button disabled={busy || !view.labels.some(l => l.active) || trainingPrepared >= 100} onClick={() => void prepareBatch("train", 100)}>学習用100件まで準備・再開</button>{busy ? <button onClick={() => { stop.current = true; }}>この動画の準備後に停止</button> : null}</div>
        <p><button disabled={busy} onClick={() => { setFilter("unreviewed-train"); setPage(0); }}>未保存の学習用動画を確認する</button></p>
        <form style={{ ...line, marginTop: 12 }} onSubmit={e => { e.preventDefault(); const input = postInput.trim(); const matched = input.match(/^https:\/\/(?:x\.com|twitter\.com)\/[^/?#]+\/status\/(\d{1,25})(?:[/?#].*)?$/); const postId = matched?.[1] ?? input; if (!/^\d{1,25}$/.test(postId)) { setError("投稿IDまたはXの投稿URLを入力してください。"); return; } void run("prepare", { postId, purpose: "train" }); }}><label>収集済み投稿のID／URL <input value={postInput} onChange={e => setPostInput(e.target.value)} disabled={busy} /></label><button disabled={busy || !postInput.trim()}>指定動画を準備</button></form>
      </section>
      <section style={box}><h2>3．学習と精度チェック</h2>
        <p>正解保存済みの学習用：{view.trainingCount}動画 ／ 画像準備済み：{view.videos.length}動画</p>
        <ul style={grid}>{view.labels.filter(l => l.active).map(l => {
          const answers = view.videos.filter(v => v.review?.role === "train").map(v => v.review!.decisions[l.id]);
          return <li key={l.id}>{l.name}：該当{answers.filter(v => v === true).length}・非該当{answers.filter(v => v === false).length}・未確認{answers.filter(v => typeof v !== "boolean").length}</li>;
        })}</ul>
        <div style={line}><button disabled={busy || view.trainingCount < 10} onClick={() => void run("train")}>保存済み{view.trainingCount}件すべてで学習する</button></div>
        <p>10件ごとに別の学習へ切り替わることはありません。前の正解を残して20件・30件・100件と追加し、学習ボタンを押すと保存済み教材をすべて使います。</p>
        <h3>新しいランダム動画で精度を確認</h3>
        <p>精度確認用：準備{testPrepared}動画 ／ 予測を見る前に正解保存済み{testReady}動画。学習に使っていない投稿者の新しい動画をランダムに選び、用途を自動で「精度確認用」にします。</p>
        <div style={line}><button disabled={busy || !view.model || view.model.stale} onClick={() => void prepareBatch("test", 10)}>新しいランダム10件を精度確認用に準備</button><button disabled={busy} onClick={() => { setFilter("unreviewed-test"); setPage(0); }}>精度確認用に正解を付ける</button><button disabled={busy || !view.model || view.model.stale || !testReady} onClick={() => void run("check")}>正解と予測を比べて精度チェック</button></div>
        <p>学習には10動画以上と、各ラベルの該当・非該当それぞれ2件以上が必要です。未確認は非該当として学習しません。</p>
        <p>確認して該当しないラベルにも「該当しない」を付けてください。「残りのラベルを該当しないにする」でまとめて指定できます。</p>
        <p>精度確認用は、予測を見る前に正解を保存してください。過去に学習した動画・同じ投稿者の動画・予測を見てから正解を変更した動画は採点対象外です。</p>
        {view.model ? <><p>モデル作成：{new Date(view.model.trainedAt).toLocaleString("ja-JP")} ／ 教材{view.model.samples}動画{view.model.stale ? " ／ 教材変更あり：再学習してください" : ""}</p>
          <ul style={grid}>{view.model.heads.map(h => <li key={h.id}>{view.labels.find(l => l.id === h.id)?.name}：該当{h.positive}・非該当{h.negative} ／ {h.ready ? "学習済み" : "教材不足"}</li>)}</ul>
          <p>試作評価は同じ動画・投稿者のグループを分けて{view.model.crossCheck.folds}分割。グループ数{view.model.crossCheck.groups}。同じ投稿者しかいない場合は評価できません。</p>
          <Report title="教材内の分割検証（試作の目安）" report={view.model.stale ? null : view.model.crossCheck.report} labels={view.labels} />
        </> : <p>モデルは未作成です。</p>}
        <Report title="学習未使用動画での精度チェック" report={view.testReport} labels={view.labels} />
      </section>
      <section style={box}><h2>動画の確認</h2><div style={line}><label>表示 <select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="unreviewed-train">学習用：正解未保存</option><option value="unreviewed-test">精度確認用：正解未保存</option><option value="all">すべて</option><option value="unreviewed">正解未保存（全用途）</option><option value="train">学習用（保存済みを含む）</option><option value="test">精度確認用（保存済みを含む）</option></select></label><span>{videos.length}動画 ／ {videos.length ? shownPage * 10 + 1 : 0}〜{Math.min((shownPage + 1) * 10, videos.length)}件を表示</span><button disabled={busy || shownPage === 0} onClick={() => setPage(shownPage - 1)}>前の10件</button><button disabled={busy || shownPage >= lastPage} onClick={() => setPage(shownPage + 1)}>次の10件を確認</button></div>
        {!videos.length ? <p>この表示の未確認動画はありません。次の10件を準備するか、表示を切り替えてください。</p> : null}
        {videos.slice(shownPage * 10, shownPage * 10 + 10).map(v => <ReviewCard key={v.postId} video={v} labels={view.labels} busy={busy} run={run} />)}
      </section>
    </>}
  </main>;
}
