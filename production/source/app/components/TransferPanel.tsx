"use client";
import { useState } from "react";
import { exportTransferCode, importTransferCode } from "../../lib/list-transfer";

/** Copy-and-paste transfer of favorites, save history and followed authors between browsers. Nothing is sent to the server. */
export default function TransferPanel() {
  const [code, setCode] = useState(""), [input, setInput] = useState(""), [message, setMessage] = useState("");
  const make = () => {
    try { setCode(exportTransferCode(window.localStorage)); setMessage("引き継ぎコードを作りました。コピーして、新しい端末で貼り付けてください。"); }
    catch { setMessage("コードを作れませんでした。ブラウザの保存設定をご確認ください。"); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setMessage("コピーしました。"); }
    catch { setMessage("自動コピーできませんでした。コードの欄を長押し（またはクリック）して、全体をコピーしてください。"); }
  };
  const load = () => {
    const result = importTransferCode(window.localStorage, input);
    if (!result.ok) { setMessage(result.reason === "format" ? "コードを読み取れませんでした。「TWZ1.」から始まるコードを最後まで貼り付けてください。" : "保存できませんでした。ブラウザの保存設定をご確認ください。"); return; }
    setMessage(`読み込みました。お気に入り${result.favorites}件・保存履歴${result.saveHistory}件・フォロー${result.follows}人を追加しました。`);
    setInput(""); window.setTimeout(() => window.location.reload(), 1200);
  };
  return <details className="transfer-panel"><summary>別の端末・ブラウザに引き継ぐ</summary>
    <p>お気に入り・保存履歴・フォロー中の投稿者は、このブラウザの中だけに保存されています。機種変更やブラウザを変えるときは、コードで引き継げます（サーバーには送られません）。</p>
    <h2>1. 今の端末でコードを作る</h2>
    <button type="button" onClick={make}>引き継ぎコードを作る</button>
    {code ? <><textarea readOnly value={code} rows={4} aria-label="引き継ぎコード" onFocus={event => event.currentTarget.select()} /><button type="button" onClick={copy}>コピー</button></> : null}
    <h2>2. 新しい端末でコードを貼り付ける</h2>
    <textarea value={input} rows={4} placeholder="TWZ1. から始まるコードを貼り付け" aria-label="引き継ぎコードを貼り付け" onChange={event => setInput(event.target.value)} />
    <button type="button" onClick={load} disabled={!input.trim()}>読み込む</button>
    <p role="status">{message}</p>
  </details>;
}
