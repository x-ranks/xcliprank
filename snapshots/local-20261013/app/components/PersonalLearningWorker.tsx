"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export default function PersonalLearningWorker(){
  const [message,setMessage]=useState("共通学習の状態を確認中");
  useEffect(()=>{
    if(!["localhost","127.0.0.1","[::1]"].includes(location.hostname))return;
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
    async function tick(){
      let delay=5000;
      try{
        const r=await fetch("/api/tier-personal-model",{cache:"no-store"}),s=await r.json();
        if(!r.ok)throw Error(s.error??"共通学習を確認できません");
        if(s.enabled){
          const step=await fetch("/api/tier-personal-model",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"step"})});const p=await step.json();if(!step.ok)throw Error(p.error??"学習処理に失敗しました");
          if(!stopped)setMessage(p.newVideoProcessed?"新規動画を採用モデルで評価しました":p.newVideosIdle?"新規動画の評価待ち（自動確認中）":p.newVideosPaused?"新規動画の自動評価は停止中":p.preparing?`保存済み動画の4フレーム準備：${p.processed}件処理済み`:p.preparationDone?"保存済み動画の準備が完了しました":p.remaining?`教師動画の4フレームを準備中：残り約${p.remaining}件`:p.finished?"共通学習の検証が完了しました":"共通学習は有効です");
          if(p.remaining||p.preparing)delay=1500;
        }else if(!stopped)setMessage("共通学習は停止中です");
      }catch(e){if(!stopped)setMessage(e instanceof Error?e.message:"共通学習を確認できません");delay=30000;}
      if(!stopped)timer=setTimeout(tick,delay);
    }
    void tick();return()=>{stopped=true;if(timer)clearTimeout(timer);};
  },[]);
  return <p style={{fontSize:13,padding:"8px 0"}}><Link href="/tier-personal-model">共通Tier学習</Link>：{message}</p>;
}
