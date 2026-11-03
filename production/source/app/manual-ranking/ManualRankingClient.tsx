"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ManualPlacement, ManualState } from "../../lib/manual-ranking";

type Form = { id?: string; url: string; title: string; posterUrl: string; playback: "auto" | "video" | "link"; trending: string; daily: string; weekly: string };
const blank = (): Form => ({ url: "", title: "", posterUrl: "", playback: "auto", trending: "", daily: "", weekly: "" });
const secretKey = "manual-ranking-secret";

export default function ManualRankingClient() {
  const [secret, setSecret] = useState("");
  const [inputSecret, setInputSecret] = useState("");
  const [state, setState] = useState<ManualState | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [imageInputKey, setImageInputKey] = useState(0);
  useEffect(() => { const previous = sessionStorage.getItem(secretKey); if (previous) { setSecret(previous); setInputSecret(previous); } }, []);
  useEffect(() => { if (secret) void reload(secret); }, [secret]);
  async function request(method: "GET" | "POST", body?: object, token = secret) {
    const response = await fetch("/api/manual-ranking", { method, cache: "no-store", headers: {
      Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {})
    }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw Error(data.error ?? "本番への反映に失敗しました。");
    return data.state as ManualState;
  }
  async function reload(token = secret) {
    setBusy(true); setError("");
    try { setState(await request("GET", undefined, token)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "確認に失敗しました。"); }
    finally { setBusy(false); }
  }
  function unlock() {
    const value = inputSecret.trim();
    if (!value) return;
    sessionStorage.setItem(secretKey, value); setSecret(value);
  }
  function resetSecret() {
    sessionStorage.removeItem(secretKey); setSecret(""); setInputSecret(""); setState(null); setError("");
  }
  function edit(row: ManualPlacement) {
    setThumbnail(null);
    setImageInputKey(value => value + 1);
    setForm({ id: row.id, url: row.url, title: row.title, posterUrl: row.posterUrl ?? "", playback: row.playback,
      trending: String(row.positions.trending ?? ""), daily: String(row.positions.daily ?? ""), weekly: String(row.positions.weekly ?? "") });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save() {
    if (!state) return;
    const positions = { trending: form.trending ? Number(form.trending) : null,
      daily: form.daily ? Number(form.daily) : null, weekly: form.weekly ? Number(form.weekly) : null };
    let isX = false;
    try { isX = ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(new URL(form.url).hostname.toLowerCase()); } catch { /* URL validation at server */ }
    if (!form.url.trim() || (!isX && !form.title.trim()) || Object.values(positions).every(value => value === null)) {
      setError("URL・少なくとも1つの順位と、X以外は表示名を入力してください。"); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const thumbnailData = thumbnail ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(Error("画像を読み込めませんでした。"));
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(Error("画像を読み込めませんでした。"));
        reader.readAsDataURL(thumbnail);
      }) : null;
      const next = await request("POST", { revision: state.revision, action: "save",
        entry: { id: form.id, url: form.url, title: form.title, posterUrl: form.posterUrl || null, playback: form.playback, positions }, thumbnailData });
      setState(next); setForm(blank()); setThumbnail(null); setImageInputKey(value => value + 1); setMessage("本番への登録が完了しました。ランキングを開いて表示を確認してください。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "登録に失敗しました。"); }
    finally { setBusy(false); }
  }
  async function remove(row: ManualPlacement) {
    if (!state || !confirm(`「${row.title}」の順位指定を削除しますか？`)) return;
    setBusy(true); setError(""); setMessage("");
    try { setState(await request("POST", { revision: state.revision, action: "remove", entry: { id: row.id } }));
      setMessage("本番の順位指定を削除しました。既存動画は通常順位に戻ります。"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "削除に失敗しました。"); }
    finally { setBusy(false); }
  }
  const field = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <label style={{ display: "grid", gap: 5 }} key={key}>{label}<input {...props} value={form[key] ?? ""}
      onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))}
      style={{ padding: 10, border: "1px solid #888", borderRadius: 6 }} /></label>;
  return <main style={{ maxWidth: 820, margin: "32px auto", padding: 20, color: "#f7f8fa" }}>
    <Link href="/learning-tools">← 管理トップ</Link><h1>個別URLをランキングへ登録</h1>
    <p>ローカル専用画面です。登録後は本番へ反映します。X投稿URLは本文・画像などを取得します。X以外は動画ファイルを直接再生し、それ以外のURLは元ページへのリンクとして表示します。</p>
    {!secret ? <section style={{ display: "grid", gap: 10, maxWidth: 500 }}>
      <label>管理用シークレット<input type="password" value={inputSecret} onChange={event => setInputSecret(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") unlock(); }} style={{ display: "block", width: "100%", padding: 10 }} /></label>
      <button type="button" onClick={unlock}>開く</button></section> : <>
      <button type="button" onClick={resetSecret}>管理キーを変更</button>
      {error && <p role="alert" style={{ color: "#ff6470" }}>{error}　<button type="button" onClick={() => reload()}>状態を再読込</button></p>}
      {message && <p role="status" style={{ color: "#79d79b" }}>{message}</p>}
      <section style={{ display: "grid", gap: 12, padding: 18, border: "1px solid #ccc", borderRadius: 10 }}>
        <h2>{form.id ? "登録内容を変更" : "新しく登録"}</h2>
        {field("url", "動画または元ページのURL", { type: "url", required: true, placeholder: "https://..." })}
        {field("title", "ランキングの表示名（X投稿は省略可）", { maxLength: 120 })}
        {field("posterUrl", "サムネイルURL（任意）", { type: "url", placeholder: "https://..." })}
        <label>画像をアップロード（X以外、JPEG・PNG・WebP、3MBまで）<input key={imageInputKey} type="file" accept="image/jpeg,image/png,image/webp"
          onChange={event => { const file = event.target.files?.[0] ?? null;
            if (file && (file.size > 3 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
              setError("JPEG・PNG・WebPの3MB以下の画像を選択してください。"); event.target.value = ""; setThumbnail(null); return;
            } setError(""); setThumbnail(file); }} /></label>
        <label>表示方法 <select value={form.playback} onChange={event => setForm(current => ({ ...current, playback: event.target.value as Form["playback"] }))}>
          <option value="auto">自動判定</option><option value="video">動画として再生（拡張子なしも可）</option><option value="link">元URLへのリンク</option>
        </select></label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {field("trending", "新着順位（1〜500）", { type: "number", min: 1, max: 500 })}
          {field("daily", "24時間順位（1〜100）", { type: "number", min: 1, max: 100 })}
          {field("weekly", "週間順位（1〜100）", { type: "number", min: 1, max: 100 })}
        </div>
        <p style={{ fontSize: 13 }}>空欄のランキングには表示しません。通常の動画は指定順位から下へ1つずつ移動します。過去版の順位は変更しません。</p>
        <div><button type="button" disabled={busy || !state} onClick={save}>{busy ? "処理中…" : "登録して本番へ反映"}</button>
          {form.id && <button type="button" onClick={() => setForm(blank())}>編集をやめる</button>}</div>
      </section>
      <section style={{ marginTop: 24 }}><h2>本番の登録一覧（{state?.entries.length ?? 0}件）</h2>
        <button type="button" disabled={busy} onClick={() => reload()}>本番の状態を再読込</button>
        {state?.entries.map(row => <article key={row.id} style={{ borderBottom: "1px solid #ccc", padding: "12px 0" }}>
          <strong>{row.title}</strong>　<a href={row.url} target="_blank" rel="noopener noreferrer">元URL ↗</a>
          <div>新着 {row.positions.trending ?? "—"}位 ／ 24時間 {row.positions.daily ?? "—"}位 ／ 週間 {row.positions.weekly ?? "—"}位</div>
          <small>{row.mediaUrl ? "直接再生" : "元ページへのリンク"}</small><div>
          <button type="button" disabled={busy} onClick={() => edit(row)}>編集</button>　
          <button type="button" disabled={busy} onClick={() => remove(row)}>登録解除</button></div>
        </article>)}
      </section>
    </>}
  </main>;
}
