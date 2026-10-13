"use client";
import Link from "next/link";
import TierPreviewVideo from "../components/TierPreviewVideo";
import {useEffect,useRef,useState} from "react";
type Sample={id:number;x_post_id:string;author:string|null;poster:string|null;video:string;before:string;proposed:string;rawTier:string;confidence:number;visualApplied:boolean;decisionReason?:string;authorSeen:boolean;predictionShown:boolean;review:{tier:string;reason:string|null;predictionSeen:boolean}|null};
type Job={id:string;attempted:number;pool:number;total:number;changed:number;done:boolean;cancelled:boolean;visualApplied:number;failed:Record<string,number>;manualReviews:number;blindedQualityReviews:number;trainingSamples:number;modelMode?:string;policy?:{confidenceMin:number;sMin:number;sMargin:number;temperature:number}|null};
type Rescue={id:string;ids:string[];cursor:number;ready:number;done:boolean;failed:Record<string,number>};
type Result={job:Job|null;samples:Sample[];rescue:Rescue|null;reviewReport?:unknown;unseenAuthorReport?:unknown;note?:string;error?:string};
const modeNames:Record<string,string>={manual_only:"従来の手動モデル",manual_guarded:"手動Tier＋S抑制",manual_ordinal:"手動Tier＋順位学習"};
export default function VideoPreview(){
  const [result,setResult]=useState<Result>({job:null,samples:[],rescue:null}),[busy,setBusy]=useState(false),[error,setError]=useState("");const stop=useRef(false),mounted=useRef(true);
  async function request(action?:string,extra:Record<string,unknown>={}){const r=await fetch("/api/tier-video-preview",action?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...extra})}:{cache:"no-store"});const text=await r.text();let data:Result;try{data=JSON.parse(text);}catch{throw Error("プレビューAPIがJSONを返しません。開発サーバーのログを確認してください。");}if(!r.ok)throw Error(data.error??"処理失敗");if(mounted.current)setResult(data);return data;}
  useEffect(()=>{let alive=true;mounted.current=true;void request().catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;mounted.current=false;stop.current=true;};},[]);
  async function run(action:string,extra:Record<string,unknown>={}){setBusy(true);setError("");stop.current=false;try{let data=await request(action,extra);
    if(["start","step"].includes(action))while(!stop.current&&data.job&&!data.job.done&&!data.job.cancelled)data=await request("step",{id:data.job.id});
    if(["rescue-start","rescue-step"].includes(action))while(!stop.current&&data.rescue&&!data.rescue.done)data=await request("rescue-step",{id:data.rescue.id});
  }catch(e){setError(e instanceof Error?e.message:"処理失敗");}finally{setBusy(false);}}
  function exportReport(){const {samples,...report}=result;const safe={...report,samples:samples.map(({video,poster,...s})=>s)};const url=URL.createObjectURL(new Blob([JSON.stringify(safe,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="xclip-video-preview-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <main style={{maxWidth:1100,margin:"auto",padding:20}}>
    <Link href="/learning-tools#operations">← 運営・管理</Link><h1>新Tierモデル・動画50件プレビュー</h1>
    <p>調整用データで選んだ手動Tierの未採用モデルを試します。ランダムな未評価動画から最大50件を用意し、現在のTierと提案を比較します。以前のプレビューに含まれた動画は新しい抽出から除きます。ランキングとDBのTierは更新しません。</p>
    <p>読み込みで止まる動画は「互換再生を準備」を押してから再生してください。PC内に最大256MiB/本、最大8本を保存し、古いキャッシュを自動削除します。X APIは使用しません。</p>
    <p>最初は予測を隠します。動画を見て評価メモを付けると提案が表示されます。「変更前後を表示」を先に押すこともできますが、予測を見た後の評価メモは精度の集計から除きます。</p>
    <p>動画取得の通信量とPCのCPUを使います。1本ずつ処理し、成功50件または試行150件で止まります。画面を閉じると次の動画へ進まず、再び開いて続行できます。X API収集は行いません。</p>
    {error&&<p role="alert" style={{color:"#f77"}}>{error}</p>}
    <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
      <button disabled={busy} onClick={()=>void run("start")}>ランダム50件のお試し比較を作成</button>
      {result.job&&!result.job.done&&!result.job.cancelled&&<button disabled={busy} onClick={()=>void run("step",{id:result.job!.id})}>続きを準備</button>}
      {busy&&<button onClick={()=>{stop.current=true;}}>この動画で一時停止</button>}
      {result.job&&<button disabled={busy} onClick={()=>void run("reveal",{id:result.job!.id})}>全動画の変更前後を表示</button>}
      <button disabled={busy||!result.job} onClick={exportReport}>確認結果をJSONで保存</button>
    </div>
    {result.job&&<section><h2>{result.job.done?"動画の準備完了":"動画を準備中"}</h2><p>表示 {result.samples.length}件 ／ 試行 {result.job.attempted}件 ／ Tier変更案 {result.job.changed}件 ／ 視覚評価を採用 {result.job.visualApplied}件 ／ 評価メモ {result.job.manualReviews}件</p><p>方式：{modeNames[result.job.modelMode??"manual_only"]??"手動モデル"} ／ 適用下限：{((result.job.policy?.confidenceMin??0.6)*100).toFixed(0)}％ ／ S条件：{result.job.policy?`${(result.job.policy.sMin*100).toFixed(0)}％以上、他Tierとの差${(result.job.policy.sMargin*100).toFixed(0)}ポイント以上`:"従来方式"}</p><p>教師 {result.job.trainingSamples}件。手動評価済み・非公開・安全上の除外は表示対象外です。</p><details><summary>取得失敗と評価結果</summary><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify({failed:result.job.failed,blindedQualityReviews:result.job.blindedQualityReviews,reviewReport:result.reviewReport,unseenAuthorReport:result.unseenAuthorReport},null,2)}</pre></details></section>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginTop:20}}>
      {result.samples.map(s=><article key={s.id} style={{padding:12,border:"1px solid #777",borderRadius:8}}>
        <p>@{s.author??"unknown"}</p><TierPreviewVideo id={s.id} url={s.video} poster={s.poster}/>
        {(s.predictionShown||s.review)?<><p><strong>{s.before} → {s.proposed}</strong>（未保存）</p><p>{s.visualApplied?"視覚評価による提案":s.decisionReason==="s_guard"?"S判定条件を満たさないため現在のTierを維持":"スコア不足のため現在のTierを維持"} ／ 視覚判定 {s.rawTier} ／ 判定スコア {(s.confidence*100).toFixed(1)}％</p></>:<button disabled={busy} onClick={()=>void run("reveal",{id:result.job!.id,postId:s.id})}>この動画の変更前後を表示</button>}
        <p>{s.review?`確認メモ：${s.review.tier}${s.review.reason==="weak_content"?"（内容が弱い）":""}`:"先に自分のTierを付けると、予測を見ずに比較できます。"}</p>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{["S","A","B","C","D"].map(tier=><button disabled={busy} key={tier} onClick={()=>void run("review",{id:result.job!.id,postId:s.id,tier})}>{tier}</button>)}<button disabled={busy} onClick={()=>void run("review",{id:result.job!.id,postId:s.id,tier:"X",reason:"weak_content"})}>X：内容が弱い</button><button disabled={busy} onClick={()=>void run("review",{id:result.job!.id,postId:s.id,tier:"X",reason:"out_of_scope"})}>X：対象外</button></div>
        <p><a href={`https://x.com/i/status/${s.x_post_id}`} target="_blank" rel="noreferrer">元投稿</a> ／ {s.authorSeen?"学習に含まれる投稿者":"学習に含まれない投稿者"}</p>
      </article>)}
    </div>
    <section style={{marginTop:32}}><h2>容量超過の教師動画を再試行</h2><p>保存済みURLから10件ずつ再試行します。1動画の上限は256MiBで、10件では最大約2.5GiBのダウンロードが発生します。成功済みの特徴は取り直しません。X APIクレジットは使いません。</p>
      <button disabled={busy} onClick={()=>void run("rescue-start")}>容量超過の教師10件を再試行</button>
      {result.rescue&&!result.rescue.done&&<button disabled={busy} onClick={()=>void run("rescue-step",{id:result.rescue!.id})}>再試行を続ける</button>}
      {result.rescue&&<p>処理 {result.rescue.cursor}/{result.rescue.ids.length}件 ／ 成功 {result.rescue.ready}件 ／ 失敗 {JSON.stringify(result.rescue.failed)}</p>}
      <p>成功が増えたら<Link href="/tier-personal-model">共通学習画面</Link>で保存済み特徴の比較を再実行できます。これは開発比較であり、繰り返し同じ検証動画を見ることを独立した精度改善の証明には使いません。</p>
    </section>
    <p>確認メモはPC内に保存され、本番DBの手動評価には追加されません。モデル採用やTier適用のボタンは、この画面にはありません。</p>
  </main>;
}
