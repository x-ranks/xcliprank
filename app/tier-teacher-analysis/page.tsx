"use client";
import Link from "next/link";
import {useState} from "react";
type Metric={count:number;accuracy:number|null;macroF1:number|null;perClass:{label:string;support:number;precision:number|null;recall:number|null}[]};
type Result={dbManualCount:number;truncated:boolean;localTeacherCount:number;mergedCount:number;conflicts:number;excluded:number;labelCounts:Record<string,number>;features:{usable:number;missing:number;invalid:number;mixedDimensionExcluded:number};existingVisualModel:{found:boolean;trainedAt:string|null;labelsChanged:number};comparison:{performed:boolean;trainCount:number;testCount:number;groupCount:number;commonCount:number;legacyTrainingCount:number;visual:Metric;commonVisual:Metric;legacy:Metric;examples:{id:string;actual:string;visual:string;legacy:string|null}[]};notes:string[]};
const percent=(v:number|null)=>v===null?"未計測":(v*100).toFixed(1)+"%";
export default function Page(){
 const [data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function analyze(){setBusy(true);setError("");try{const r=await fetch("/api/tier-teacher-analysis",{cache:"no-store"});const text=await r.text();let body;try{body=JSON.parse(text);}catch{throw Error(`API応答を確認できません（HTTP ${r.status}）。`);}if(!r.ok)throw Error(body.error);setData(body);}catch(e){setError(e instanceof Error?e.message:"診断失敗");}finally{setBusy(false);}}
 return <main style={{maxWidth:1100,margin:"0 auto",padding:24,color:"#eee",background:"#151515",minHeight:"100vh"}}>
  <Link href="/learning-tools">← 管理画面</Link><h1>教師データ・Tier学習比較</h1>
  <p>動画Tierレビューと参考アカウント教師レビューを照合し、キャッシュ済みの視覚特徴で新しい評価方式を検証します。DB更新・動画再収集・X API呼び出しは行いません。</p>
  <button disabled={busy} onClick={analyze}>{busy?"教師データを診断中…":"教師データを読み込み、精度を比較"}</button>
  {error&&<p role="alert" style={{color:"#ffaaaa"}}>{error}</p>}
  {data&&<>
   <h2>教師データの接続</h2><p>DB手動評価 {data.dbManualCount}件 ／ ローカル教師評価 {data.localTeacherCount}件 ／ 統合後 {data.mergedCount}件</p>
   <p>評価が異なる重複 {data.conflicts}件（DB手動評価を優先） ／ 安全・形式等で除外 {data.excluded}件</p>
   {data.truncated&&<p>DB読み込みは20,000件で打ち切られています。全件診断ではありません。</p>}
   <p>{Object.entries(data.labelCounts).map(([g,n])=>`${g}: ${n}件`).join(" ／ ")}</p>
   <h2>視覚特徴の準備</h2><p>使用可能 {data.features.usable}件 ／ 未抽出・失敗 {data.features.missing}件 ／ 不正 {data.features.invalid}件 ／ 次元違い {data.features.mixedDimensionExcluded}件</p>
   <p>既存視覚モデル：{data.existingVisualModel.found?data.existingVisualModel.trainedAt:"未保存"} ／ 学習時から評価が変わった投稿 {data.existingVisualModel.labelsChanged}件</p>
   <Link href="/preference-model">視覚好みモデル学習へ</Link>
   <h2>学習に使っていない投稿者での比較</h2><p>分離グループ {data.comparison.groupCount} ／ 学習 {data.comparison.trainCount}件 ／ 検証 {data.comparison.testCount}件 ／ 両方式で比較可能 {data.comparison.commonCount}件</p>
   <p>現行方式の学習対象 {data.comparison.legacyTrainingCount}件。最低100件未満では現行方式の比較値は出ません。</p>
   {data.comparison.performed?<>
    <table style={{width:"100%"}}><thead><tr><th>評価方式</th><th>件数</th><th>S/A/OTHER/X一致率</th><th>クラス平均F1</th></tr></thead><tbody>
     {[['現行メタデータ補正',data.comparison.legacy],['視覚候補（同じ比較対象）',data.comparison.commonVisual],['視覚候補（検証対象全体）',data.comparison.visual]].map(([label,m])=>{const metric=m as Metric;return <tr key={String(label)}><td>{String(label)}</td><td>{metric.count}</td><td>{percent(metric.accuracy)}</td><td>{percent(metric.macroF1)}</td></tr>;})}
    </tbody></table>
    <h3>視覚候補のTier別精度（検証対象全体）</h3><table style={{width:"100%"}}><thead><tr><th>教師評価</th><th>検証数</th><th>適合率</th><th>再現率</th></tr></thead><tbody>{data.comparison.visual.perClass.map(c=><tr key={c.label}><td>{c.label}</td><td>{c.support}</td><td>{percent(c.precision)}</td><td>{percent(c.recall)}</td></tr>)}</tbody></table>
    <p>適合率：そのTierと予測した中で教師と合った割合。再現率：教師がそのTierとした中で拾えた割合。</p>
    <details><summary>評価が異なる例（最大50件、動画自動再生なし）</summary><ul>{data.comparison.examples.map(p=><li key={p.id}>{p.id}：教師 {p.actual} ／ 現行 {p.legacy??"比較対象外"} ／ 視覚候補 {p.visual}</li>)}</ul></details>
   </>:<p>視覚特徴が20件以上の学習対象・10件以上の検証対象・学習側2分類以上に足りないため、精度比較は未実施です。</p>}
   <h2>検証の範囲</h2><ul>{data.notes.map(n=><li key={n}>{n}</li>)}</ul>
  </>}
 </main>;
}
