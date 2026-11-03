"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { labelA4Diagnostics } from "../../lib/label-a4-diagnostics";
type Report = ReturnType<typeof labelA4Diagnostics>;
const pct = (value: number | null) => value === null ? "未算出" : `${(value * 100).toFixed(1)}％`;
export default function LabelA4Diagnostics() {
  const [report, setReport] = useState<Report | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function refresh(signal?: AbortSignal) {
    setBusy(true); setError("");
    try { const response = await fetch("/api/label-diagnostics", { cache: "no-store", signal }), data = await response.json(); if (!response.ok) throw Error(data.error ?? "診断を読めませんでした。"); if (!signal?.aborted) setReport(data); }
    catch (e) { if (!signal?.aborted) setError((e as Error).message); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, []);
  return <section aria-labelledby="label-a4-title" style={{ border: "1px solid #456", borderRadius: 12, padding: 16, margin: "18px 0" }}>
    <h2 id="label-a4-title">タグ未付与の診断</h2>
    <p>保存済みの教材とモデルだけを読みます。動画の取得・学習・本番反映は行いません。</p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "確認中…" : "診断を更新"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {report ? <>
      <p role="status">準備済み {report.prepared}件 ／ 学習用の正解保存 {report.training}件 ／ 正解未保存 {report.unreviewed}件 ／ 現モデルの教材 {report.modelSamples}件 ／ 独立した精度確認 {report.independentTestVideos}件</p>
      {report.stale ? <p role="alert">教材またはタグ定義が変わっています。先に学習画面で再学習してください。古いモデルの比較は表示しません。</p> : null}
      <p><Link href="/label-learning">学習画面へ：未保存の正解を付ける・不足する教材を追加する</Link></p>
      <h3>判定基準の比較（学習に使った教材内）</h3>
      <p>これは本番の正解率ではありません。基準を下げるとタグは増えますが、誤付与も増える可能性があります。設定は自動変更しません。</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>基準</th><th>比較動画数</th><th>タグが付く動画</th><th>正しく付与</th><th>誤付与</th><th>見逃し</th></tr></thead><tbody>{report.comparisons.map(row => <tr key={row.threshold}><td>{row.threshold}</td><td>{row.videos}</td><td>{row.tagged}</td><td>{row.tp}</td><td>{row.fp}</td><td>{row.fn}</td></tr>)}</tbody></table></div>
      <h3>優先して教材を足すタグ</h3>
      <p>該当・非該当が各2件未満なら学習できません。各10件・該当する投稿者3種類は追加教材を選ぶ目安で、精度を保証する基準ではありません。</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>タグ</th><th>該当</th><th>非該当</th><th>該当投稿者数</th><th>次の作業</th><th>分割検証の的中率</th><th>検出率</th></tr></thead><tbody>{report.labels.map(label => <tr key={label.id}><td>{label.name}</td><td>{label.positive}</td><td>{label.negative}</td><td>{label.positiveAuthors}</td><td>{label.guidance === "untrained" ? "該当・非該当の教材を追加" : label.guidance === "examples" ? "少ない側・別投稿者の教材を追加" : "未学習動画で精度を確認"}{!label.trained ? "（現在は学習未完了）" : ""}</td><td>{pct(label.crossCheck?.precision ?? null)}</td><td>{pct(label.crossCheck?.recall ?? null)}</td></tr>)}</tbody></table></div>
      <p>分割検証は従来の基準0.5での試作評価です。上の基準別比較や独立した精度確認とは区別してください。全動画へ無理にタグを付けることはしません。</p>
    </> : null}
  </section>;
}
