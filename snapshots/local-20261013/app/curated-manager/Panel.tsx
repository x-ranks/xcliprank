"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
type Author={x_author_id:string;username:string;name:string;curated_status:string;curated_expected_tier:string;curated_backfill_status:string;curated_last_error:string|null};
type Removal={id:string;username:string;at:number};
export default function Panel(){
 const [authors,setAuthors]=useState<Author[]>([]),[removed,setRemoved]=useState<Removal[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState(""),[query,setQuery]=useState("");
 async function request(operation:string,id?:string,confirm?:boolean){const response=await fetch("/api/curated-manager",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation,id,confirm}),cache:"no-store"});const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error??"更新に失敗しました。");return data;}
 async function refresh(){const d=await request("list");setAuthors(d.authors);setRemoved(d.removed);}
 async function run(operation:string,id?:string){if(operation==="remove"&&!window.confirm("この投稿者を削除し、すべての動画をサイトから除外します。巡回も停止します。DBデータと評価履歴は復旧用に保持します。実行しますか？"))return;
  setBusy(true);setError("");setMessage("");try{if(operation!=="list"){const d=await request(operation,id,operation==="remove");setMessage(d.message);}await refresh();}catch(e){setError(e instanceof Error?e.message:"更新に失敗しました。");}finally{setBusy(false);}}
 useEffect(()=>{let active=true;setBusy(true);void request("list").then(d=>{if(active){setAuthors(d.authors);setRemoved(d.removed);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:"取得に失敗しました。");}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
 const rows=authors.filter(a=>(a.username+" "+a.name).toLowerCase().includes(query.toLowerCase()));
 return <main><Link href="/learning-tools#operations">← 管理トップ</Link><h1>選別投稿者の共通管理</h1>
 <p>通常登録・FxTwitter登録を同じ本番DBで管理します。登録方法による掲載対象の差をなくします。新着の表示は元の投稿日時・評価・表示条件に従います。</p>
 <nav><Link href="/fxtwitter-authors">投稿者を追加・動画を一括取得</Link> ／ <Link href="/fxtwitter-monitor">新着取得の巡回記録</Link> ／ <Link href="/availability-monitor">再生不可動画の監視</Link></nav>
 <p><button disabled={busy} onClick={()=>void run("list")}>本番の一覧を更新</button> <button disabled={busy} onClick={()=>void run("migrate")}>既存投稿者を共通管理へ移行</button></p>
 <p>移行は既存の登録情報を照合して共通DBへ反映します。動画の再取得や有料API通信は行いません。</p>
 <div aria-live="polite">{busy?<p>処理中です…</p>:null}{message?<p>{message}</p>:null}{error?<p role="alert" className="error">{error}</p>:null}</div>
 <label>投稿者を検索 <input value={query} onChange={e=>setQuery(e.target.value)}/></label><p>共通登録 {authors.length}投稿者</p>
 <div className="table"><table><thead><tr><th>投稿者</th><th>状態</th><th>初回取得</th><th>操作</th></tr></thead><tbody>{rows.map(a=><tr key={a.x_author_id}><td>@{a.username}<small>{a.name} ／ 期待{a.curated_expected_tier}</small></td><td>{a.curated_status==="active"?"稼働":a.curated_status==="unavailable"?"利用不可":"停止"}</td><td>{a.curated_backfill_status==="completed"?"完了":"一括取得を確認"}{a.curated_last_error?<small className="error">{a.curated_last_error}</small>:null}</td><td><button disabled={busy} onClick={()=>void run(a.curated_status==="active"?"pause":"resume",a.x_author_id)}>{a.curated_status==="active"?"停止":"再開"}</button> <button disabled={busy} className="danger" onClick={()=>void run("remove",a.x_author_id)}>投稿者と動画を掲載から削除</button></td></tr>)}</tbody></table></div>
 <h2>削除済み {removed.length}投稿者</h2><p>古い一覧の同期や監視による自動復旧では復活しません。削除が途中で失敗した場合は同じ削除を再試行できます。</p>{removed.map(a=><p key={a.id}>@{a.username} ／ {new Date(a.at).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})} <button disabled={busy} onClick={()=>void run("remove",a.id)}>削除を再確認・再試行</button></p>)}
 <style jsx>{`main{max-width:1180px;margin:auto;padding:28px;color:#e5edf6}p{line-height:1.8}a{color:#9ed8ff}button,input{padding:10px;border-radius:7px;border:1px solid #567087;background:#172e44;color:white;min-height:44px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.danger{background:#652d38}.error{color:#ffb4b4}.table{overflow:auto}table{width:100%;border-collapse:collapse}td,th{padding:14px;text-align:left;border-bottom:1px solid #39516a}small{display:block;margin-top:6px}nav{line-height:2.3}`}</style></main>;
}
