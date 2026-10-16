"use client";
import {useRef,useState} from "react";
type Props={id:number;url:string;poster?:string|null};
export default function TierPreviewVideo({id,url,poster}:Props){
  const player=useRef<HTMLVideoElement>(null);
  const [direct,setDirect]=useState(false),[error,setError]=useState(""),[diagnostic,setDiagnostic]=useState(""),[checking,setChecking]=useState(false),[cached,setCached]=useState(false),[preparing,setPreparing]=useState(false);
  const source=cached?`/api/tier-preview-playback?id=${id}`:direct?url:`/api/video?url=${encodeURIComponent(url)}`;
  function failed(){const code=player.current?.error?.code;setError(code===3?"動画のデコードに失敗しました。":code===2?"動画の通信に失敗しました。":"動画を読み込めませんでした。");}
  function retry(){setError("");setDiagnostic("");player.current?.load();}
  async function check(){setChecking(true);setDiagnostic("");try{
    const r=await fetch(source,{headers:{Range:"bytes=0-0"},cache:"no-store",signal:AbortSignal.timeout(15000)});
    const type=r.headers.get("content-type")??"不明";await r.body?.cancel();
    setDiagnostic(`再生先 HTTP=${r.status} / ${type}${r.ok&&type.startsWith("video/")?"（動画応答あり）":""}`);
  }catch{setDiagnostic("再生先に接続できないか、15秒でタイムアウトしました。");}finally{setChecking(false);}}
  async function prepare(){setPreparing(true);setError("");setDiagnostic("互換再生を準備中です。動画をPC内に取得しています。");try{const r=await fetch("/api/tier-preview-playback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});const data=await r.json();if(!r.ok)throw Error(data.error??"PREPARE_FAILED");setCached(true);setDiagnostic("互換再生の準備完了。「再生する」を押してください。");}catch(e){setError(e instanceof Error?e.message:"PREPARE_FAILED");}finally{setPreparing(false);}}
  async function play(){try{await player.current?.play();}catch(e){setError(e instanceof Error?e.message:"PLAY_FAILED");}}
  return <div>
    <video ref={player} key={source} controls playsInline preload="none" poster={poster??undefined} src={source} onError={failed} onPlaying={()=>{setError("");setDiagnostic("");}} style={{width:"100%",maxHeight:350}}/>
    {error&&<p role="alert">{error} サムネイルだけでTierを評価せず、再生を確認してください。</p>}
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        <button disabled={preparing} onClick={()=>void prepare()}>{preparing?"互換再生を準備中…":"互換再生を準備（PC内へ取得）"}</button>
        <button disabled={preparing} onClick={()=>void play()}>再生する</button>
        <button onClick={retry}>再読み込み</button>
        <button disabled={checking} onClick={()=>void check()}>{checking?"確認中…":"再生エラーを確認"}</button>
        <button onClick={()=>{setCached(false);setDirect(v=>!v);setError("");setDiagnostic("");}}>{direct?"サイト経由に戻す":"直接再生を試す"}</button>
      </div>
    {diagnostic&&<p role="status">{diagnostic}</p>}
  </div>;
}
