"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FreeRegistry } from "../../lib/fxtwitter-curated-store";
import type { RegistrationJob } from "../../lib/free-curated-registration";

const emptyState: FreeRegistry = {version:1,cooldownUntil:0,authors:[]};
const date=(value:string|null)=>value?new Date(value).toLocaleString("ja-JP"):"未実行";
type ProductionState={authors:{id:string;username:string;paused:boolean;source:string;checkedAt:number;nextCheckAt:number;savedTotal:number;lastError:string|null}[];cooldownUntil:number};
type Reply={ok:boolean;error?:string;message?:string;state?:FreeRegistry;databaseHost?:string|null;id?:string;job?:RegistrationJob;production?:{state:ProductionState}};

export default function FreeAuthorsPanel(){
  const [state,setState]=useState<FreeRegistry>(emptyState),[username,setUsername]=useState("");
  const [expectedTier,setExpectedTier]=useState<"S"|"A">("S"),[count,setCount]=useState(100);
  const [selected,setSelected]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
  const [busy,setBusy]=useState(true),[databaseHost,setDatabaseHost]=useState<string|null>(null);
  const [production,setProduction]=useState<ProductionState|null>(null),[confirmPublish,setConfirmPublish]=useState(false);
  const controller=useRef<AbortController|null>(null),running=useRef(false);
  const active=state.authors.find(a=>a.id===selected);
  useEffect(()=>{
    const abort=new AbortController();controller.current=abort;
    fetch("/api/fxtwitter-authors",{cache:"no-store",signal:abort.signal}).then(async r=>{
      const p:Reply=await r.json();if(!r.ok||!p.ok)throw Error(p.error??"取得できません。");
      if(!abort.signal.aborted){if(p.state)setState(p.state);setDatabaseHost(p.databaseHost??null);}
    }).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return()=>controller.current?.abort();
  },[]);
  async function request(body:object,signal:AbortSignal){
    const response=await fetch("/api/fxtwitter-authors",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal});
    const p:Reply=await response.json();
    if(!signal.aborted){if(p.state)setState(p.state);if(p.databaseHost!==undefined)setDatabaseHost(p.databaseHost);if(p.production?.state)setProduction(p.production.state);}
    if(!response.ok||!p.ok)throw Error(p.error??"操作に失敗しました。");
    if(!signal.aborted){setMessage(p.message??"完了しました。");if(p.id)setSelected(p.id);}
    return p;
  }
  async function operation(body:{action:string;[key:string]:unknown}){
    if(busy||running.current)return;running.current=true;
    const abort=new AbortController();controller.current=abort;setBusy(true);setError("");setMessage("");setConfirmPublish(false);
    try{
      let p=await request(body,abort.signal);
      if(body.action==="register"||body.action==="register-existing"||body.action==="register-step"){
        if(body.action==="register")setUsername("");
        let steps=0;
        while(p.job&&p.job.phase!=="completed"){
          if(abort.signal.aborted)break;
          if(++steps>65)throw Error("処理が長くなったため中断しました。登録一覧から再開してください。");
          p=await request({action:"register-step",id:p.id},abort.signal);
        }
      }
    }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:"処理を再開してください。");}
    finally{running.current=false;if(!abort.signal.aborted)setBusy(false);}
  }
  const add=(event:FormEvent)=>{event.preventDefault();void operation({action:"register",username,count,expectedTier});};
  return <main className="shell">
    <header><Link href="/learning-tools#operations">← 管理トップ</Link><h1>FxTwitter 選別投稿者</h1><p><Link href="/fxtwitter-monitor">巡回管理・取得実績一覧 →</Link></p><p>プロフィールURLを入力して登録すると、動画取得・本番掲載・今後の無料巡回まで自動で設定します。</p></header>
    <section className="box">
      <h2>選別投稿者を追加</h2>
      <form onSubmit={add}>
        <label>プロフィールURL / 投稿者名<input value={username} onChange={e=>setUsername(e.target.value)} placeholder="https://x.com/username" required maxLength={256} disabled={busy}/></label>
        <label>読み込み投稿数<select value={count} onChange={e=>setCount(Number(e.target.value))} disabled={busy}><option value={100}>100投稿</option><option value={200}>200投稿</option><option value={300}>300投稿</option></select></label>
        <button type="submit" disabled={busy||!username.trim()||!databaseHost}>登録</button>
        <details><summary>期待Tierの設定</summary><label>期待Tier<select value={expectedTier} onChange={e=>setExpectedTier(e.target.value as "S"|"A")} disabled={busy}><option value="S">S</option><option value="A">A</option></select></label></details>
      </form>
      <p className="muted">選んだ投稿数の範囲で取得できた動画付き投稿をすべて処理します。共通Tierモデルと公開条件を満たす動画を本番へ掲載します。X APIクレジット消費は0です。</p>
      <p className="muted">投稿数は動画本数ではありません。重複・削除済み・凍結・掲載対象外は追加しません。表示への反映は通常最大約5分が目安です。</p>
      <p className="muted">接続先DB：<code>{databaseHost??"未設定"}</code></p>
    </section>
    <div className="feedback" aria-live="polite" aria-atomic="true">{busy?<p role="status">処理中です。取得と掲載が完了するまで、この画面を開いたままお待ちください。</p>:null}{message?<p className="success">{message}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
      {state.cooldownUntil>Date.now()?<p>無料取得の待機期限：{new Date(state.cooldownUntil).toLocaleString("ja-JP")}</p>:null}</div>
    <section className="box"><h2>登録一覧 <small>{state.authors.length} / 100</small></h2>
      {!state.authors.length?<p>登録するとここに表示されます。</p>:state.authors.map(a=><article className="author" key={a.id}>
        <h3><button className="text" disabled={busy} onClick={()=>{setSelected(a.id);setConfirmPublish(false);}}>{a.name} <small>@{a.username}</small></button></h3>
        <p>期待{a.expectedTier} / {a.paused?"停止中":"登録中"}</p>
        {a.registration?<p>{a.registration.phase==="completed"?(a.registration.scanned===0?"初回0件・取得未確認":"初回取得・掲載完了"):"取得・掲載の途中"}：{a.registration.scanned} / {a.registration.requested}投稿を確認、動画付き{a.registration.fetched}投稿、本番掲載{a.registration.saved}件</p>:<p className="muted">以前の登録です。「動画を取得して本番掲載」で、上の読み込み投稿数に合わせて取得・同期・掲載できます。</p>}
        {a.error?<p className="error">{a.error}</p>:null}
        <div className="actions"><button disabled={busy||a.paused||!databaseHost} onClick={()=>void operation({action:a.registration&&a.registration.phase!=="completed"?"register-step":"register-existing",id:a.id,count})}>{a.registration&&a.registration.phase!=="completed"?"続きを再開":"動画を取得して本番掲載"}</button>
          <button className="secondary" disabled={busy} onClick={()=>void operation({action:a.paused?"resume":"pause",id:a.id})}>{a.paused?"再開":"停止"}</button>
          <button className="secondary" disabled={busy} onClick={()=>{if(window.confirm(`@${a.username} を登録解除しますか？掲載済み動画は削除しません。`))void operation({action:"remove",id:a.id});}}>登録解除</button></div>
      </article>)}
    </section>
    <details className="box"><summary>本番の巡回状態・詳細操作</summary>
      <p>巡回は3時間ごと最大8投稿者。同じ投稿者は24時間以上空け、外部通信は5秒間隔です。失敗時の有料API切り替えはありません。</p>
      <div className="actions"><button disabled={busy||!databaseHost} onClick={()=>void operation({action:"production-status"})}>本番の巡回状態を確認</button><button className="secondary" disabled={busy||!databaseHost} onClick={()=>void operation({action:"sync"})}>登録一覧を本番へ同期</button></div>
      <p className="muted">新規登録時は同期も自動です。停止・再開・解除を変更した後は、登録一覧を本番へ同期してください。</p>
      {production?<div><p>本番登録{production.authors.length}投稿者 / 稼働{production.authors.filter(a=>!a.paused).length}投稿者</p>{production.authors.map(a=><article className="author" key={a.id}><strong>@{a.username}</strong><p>{a.paused?"停止中":"無料巡回中"} / {a.source==="legacy"?"従来から引継ぎ":"無料一覧から同期"} / 巡回新規掲載{a.savedTotal}件</p><p className="muted">前回確認：{a.checkedAt?new Date(a.checkedAt).toLocaleString("ja-JP"):"未実行"}</p>{a.lastError?<p className="error">{a.lastError}</p>:null}</article>)}</div>:null}
      <p><Link href="/curated-authors">従来の選別投稿者管理</Link></p>
      {active?<div><h3>@{active.username} の直近取得ページ</h3><p>投稿{active.rawCount}件 / 動画付き{active.candidates.length}投稿 / 取得：{date(active.checkedAt)}</p>
        <p className="muted">複数動画の投稿は、既存の保存形式に合わせて先頭の再生可能な動画1本を扱います。</p>
        <div className="actions"><button disabled={busy||active.paused||!!(active.registration&&active.registration.phase!=="completed")} onClick={()=>void operation({action:"preview",id:active.id,count:100,mode:"latest"})}>最新100投稿を確認のみ</button><button disabled={busy||active.paused||!!(active.registration&&active.registration.phase!=="completed")||!active.nextCursor} onClick={()=>void operation({action:"preview",id:active.id,count:100,mode:"older"})}>過去分100投稿を確認のみ</button></div>
        <label className="check"><input type="checkbox" checked={confirmPublish} onChange={e=>setConfirmPublish(e.target.checked)} disabled={busy}/>このページの候補を本番へ掲載する</label><button disabled={busy||active.paused||!!(active.registration&&active.registration.phase!=="completed")||!active.candidates.length||!confirmPublish} onClick={()=>void operation({action:"publish",id:active.id})}>このページの動画を本番へ掲載</button>
        {active.candidates.map(p=><p key={p.x_post_id}><a href={p.x_url} target="_blank" rel="noopener noreferrer">投稿 {p.x_post_id} ↗</a></p>)}
      </div>:null}
    </details>
    <style jsx>{`.shell{max-width:1000px;margin:auto;padding:28px 20px 80px;color:#e5edf6}h1{font-size:28px}h2{font-size:20px}h3{font-size:17px}p{line-height:1.7}a{color:#8fd2f6}.box{background:#111d2c;border:1px solid #2b3d51;border-radius:14px;padding:22px;margin:20px 0}form{display:flex;gap:14px;align-items:end;flex-wrap:wrap}label{display:grid;gap:8px}form>label:first-child{flex:1;min-width:250px}input,select{background:#0a1421;color:#e5edf6;border:1px solid #405369;border-radius:8px;padding:11px}button{background:#226fa0;border:1px solid #4c9bcc;color:white;border-radius:8px;padding:11px 14px;cursor:pointer;min-height:44px}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #a2e3ff;outline-offset:3px}.secondary{background:#1d2b3c;border-color:#465569}.text{padding:0;border:0;background:transparent;text-align:left}.muted,small{color:#9eafc3}.error{color:#ffb5b5}.success{color:#a0e7be}.author{padding:16px 0;border-top:1px solid #314153}.actions{display:flex;gap:10px;flex-wrap:wrap}.feedback{min-height:18px}summary{cursor:pointer;font-weight:600}.check{display:flex;align-items:center;margin:16px 0}.check input{width:18px;height:18px}code{overflow-wrap:anywhere}@media(max-width:680px){.shell{padding:18px 14px 60px}.box{padding:16px}form{display:grid}form>label:first-child{min-width:0}h1{font-size:24px}}`}</style>
  </main>;
}
