"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import PersonalLearningWorker from "../components/PersonalLearningWorker";
type Release={activeMode:string|null;adoption:{modelHash:string;at:string}|null;preview:{id:string;mode:string;count:number;modelHash:string}|null};
type Status={release?:Release;enabled:boolean;status:Record<string,unknown>|null;newVideos?:Record<string,unknown>|null;preparation:Record<string,unknown>|null;active:Record<string,unknown>|null};
type MetricReport={passed?:boolean;after?:{macroF1:number|null};exactAfter?:number|null;falseHighAfter?:number|null;bcExact?:number|null;sFalseHigh?:number|null;highRecallAfter?:number|null;highPrecisionAfter?:number|null};
type CandidateReport={mode:string;trainingCount:number;tuning:MetricReport|null;final:MetricReport|null;reason:string|null};
export default function Page(){
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function load(){try{const r=await fetch("/api/tier-personal-model",{cache:"no-store"}),p=await r.json();if(!r.ok)throw Error(p.error);setStatus(p);setError("");}catch(e){setError(e instanceof Error?e.message:"取得失敗");}}
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[]);
  async function act(action:string,extra:Record<string,unknown>={}){setBusy(true);try{const r=await fetch("/api/tier-personal-model",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...extra})}),p=await r.json();if(!r.ok)throw Error(p.error);await load();}catch(e){setError(e instanceof Error?e.message:"処理失敗");}finally{setBusy(false);}}
  const validation=status?.status?.validation as {selectedMode?:string|null;manualPreviewMode?:string|null;candidates?:CandidateReport[]}|undefined;
  const name=(mode:string|null|undefined)=>({manual_only:"従来の手動モデル",manual_guarded:"手動モデル＋S抑制",manual_ordinal:"手動Tierの順位学習",manual_recall:"A/S取りこぼし回復",merged:"参考評価を統合"} as Record<string,string>)[mode??""]??"未選択";
  const percent=(n:number|null|undefined)=>n==null?"—":(n*100).toFixed(1)+"％";
  function downloadReport(){const url=URL.createObjectURL(new Blob([JSON.stringify(status,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="xclip-tier-comparison-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <main style={{maxWidth:1000,margin:"auto",padding:24}}>
    <Link href="/learning-tools#operations">← 運営・管理</Link><h1>共通Tier学習・見た目の評価</h1>
    <p>動画Tierレビューの評価を優先し、参考アカウントの既存評価も統合します。新しい教師データを作り直す必要はありません。</p>
    <p>動画の再生時間の10％・25％・50％・80％から4枚を抽出し、時間順にまとめた特徴から学習します。100秒の動画なら10秒・25秒・50秒・80秒です。</p>
    <p>サムネイル版の特徴は使わず、教師動画も評価対象の動画も同じ位置から抽出します。4枚の静止画による評価なので、動きそのものの理解や全場面の確認ではありません。</p>
    <p>有効にすると、この画面・動画Tierレビュー・運営管理画面を開いている間、特徴抽出と再学習が進みます。閉じた後は次に開いたときに再開します。</p>
    <p>投稿の再収集やX API呼び出しは行いません。動画取得の通信とPCのCPUを使います。動画は一時ファイルへ取得し、4枚の特徴を保存したら一時ファイルを削除します。既存の手動Tierは変更しません。</p>
    <p>切り出しにはFFmpegとFFprobeが必要です。取得不能・96MiB超・1時間超・切り出し失敗の動画は、部分的な特徴で判定せず除外して件数を記録します。</p>
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      <button disabled={busy} onClick={()=>void act("enable")}>教師データを統合して自動学習を有効化</button>
      <button disabled={busy} onClick={()=>void act("compare-cached")}>保存済み特徴で候補モデルを比較（動画取得なし）</button>
      <button disabled={busy} onClick={()=>void act("disable")}>自動学習を停止</button>
      <button disabled={busy} onClick={()=>void act("activate")}>検証を通過した候補を共通モデルに採用</button>
      <button disabled={busy} onClick={()=>void act("deactivate")}>視覚モデルの適用を解除</button>
      <button disabled={busy} onClick={()=>void act("prepare-videos")}>保存済み未評価動画の4フレーム準備・再開</button>
      <button disabled={busy} onClick={()=>void act("pause-videos")}>保存済み動画の準備を一時停止</button>
    </div>
    <section><h2>今回確認したモデルを本番に採用</h2>
      <p>採用対象：{status?.release?.preview?.mode??"プレビュー未作成"}（{status?.release?.preview?.count??0}件確認）。採用すると同じSupabaseを使う本番収集と過去動画の再評価に適用されます。自動検証の通過とは別に、手動採用の記録を残します。</p>
      <button disabled={busy||status?.release?.preview?.mode!=="manual_recall"||!status?.release?.preview?.count} onClick={()=>void act("adopt-reviewed",{previewId:status?.release?.preview?.id,modelHash:status?.release?.preview?.modelHash})}>確認したmanual_recallを正式採用（本番共通）</button>
      <p>採用後に新規収集された動画は、このPCの管理画面が開いている間に順次4フレームを準備し、同じ採用モデルで本番DBへ反映します。PC停止中は従来Tierで収集し、再開後に追いつきます。過去動画の準備中はそちらを優先します。</p>
      <button disabled={busy||!status?.release?.adoption} onClick={()=>void act("resume-new-videos")}>新規動画の自動評価を再開</button>
      <button disabled={busy||!status?.release?.adoption} onClick={()=>void act("pause-new-videos")}>新規動画の自動評価を停止</button>
      <p>現在の採用：{status?.release?.activeMode??"なし"} ／ 採用日時：{status?.release?.adoption?.at??"—"}</p>
      <button disabled={busy||!status?.release?.adoption} onClick={()=>void act("restore-model",{modelHash:status?.release?.adoption?.modelHash})}>採用前のモデルに戻す（変更済みTierは別途復元）</button>
    </section><PersonalLearningWorker/>{error&&<p role="alert" style={{color:"#f77"}}>{error}</p>}
    <p><Link href="/tier-video-preview">新Tierモデル・動画50件プレビューへ →</Link></p>
    <h2>教師データの比較と失敗分析</h2>
    <p>比較ボタンでは保存済み特徴だけを使います。従来の手動モデル・S抑制・Tierの順位学習・A/S取りこぼし回復・参考評価統合を同じ手動評価動画で比較し、調整用で選んだ方式を別の最終検証で確認します。採用やTier更新は行いません。</p>
    <p>Xの理由が「内容が弱い」の場合だけ低評価Dの教師として利用し、対象外・AI生成・理由不明などのXはランキング品質モデルから除外して別集計します。失敗内訳はdiagnostics、比較結果はvalidation.candidatesに表示します。</p>
    {validation?.candidates&&<><h3>候補モデルの比較</h3><p>動画プレビューで試す手動候補：{name(validation.manualPreviewMode)}。温度補正・S抑制・A/Sの回復条件は調整用データだけで選びます。回復条件が見つからなければ従来方式を維持します。スコアは正解率ではありません。</p><div style={{overflowX:"auto"}}><table><caption>選択方式：{name(validation.selectedMode)}（調整用データで選択）</caption><thead><tr>{["方式","学習件数","調整F1","最終F1","Tier一致率","B/C一致率","A/S拾い上げ率","A/S適合率","S/A過大評価率","低評価→S率","最終条件"].map(h=><th key={h} scope="col" style={{padding:8}}>{h}</th>)}</tr></thead><tbody>{validation.candidates.map(c=><tr key={c.mode}><th scope="row">{name(c.mode)}</th><td>{c.trainingCount}</td><td>{percent(c.tuning?.after?.macroF1)}</td><td>{percent(c.final?.after?.macroF1)}</td><td>{percent(c.final?.exactAfter)}</td><td>{percent(c.final?.bcExact)}</td><td>{percent(c.final?.highRecallAfter)}</td><td>{percent(c.final?.highPrecisionAfter)}</td><td>{percent(c.final?.falseHighAfter)}</td><td>{percent(c.final?.sFalseHigh)}</td><td>{c.reason??(c.final?.passed?"通過":"保留")}</td></tr>)}</tbody></table></div><p>最終確認の数字を見て選択方式を変更することはしません。以前の検証動画も含む開発比較なので、新しい手動評価動画での追試が必要です。</p><button onClick={downloadReport}>比較結果をJSONで保存</button></>}
    <h2>学習状況</h2><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(status,null,2)}</pre>
    <h2>反映先</h2><p>採用後、同じモデルを選別投稿者の新規収集と「未評価動画の再評価」で利用します。特徴がない場合や信頼度が低い場合は従来の評価を使います。</p>
    <p>教師の抽出・検証の後に、保存済み未評価動画の準備が進みます。準備は特徴の保存だけで、Tierを書き換えません。</p>
    <p>本番収集中の動画抽出は既定では停止しています。4フレーム版を配置しFFmpeg/FFprobeを用意したサーバーでのみ利用できます。未準備の動画は従来方式で保存し、ローカルで準備してから再評価できます。</p>
    <p>過去動画への適用は、<Link href="/tier-reevaluation">未評価動画の再評価・50件確認</Link>から変更予定を確認して実行できます。</p>
    <p>候補は投稿者・同一特徴を分離し、従来の最終Tierと比較します。今回の手動採用後はモデルを固定し、自動更新を停止します。ランキングでの体感改善は別途確認します。</p>
  </main>;
}
