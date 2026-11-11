"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PublicPostLink from "./PublicPostLink";
import PublicThumbnail from "./PublicThumbnail";
import FavoriteButton, { VIDEO_LIST_EVENT } from "./FavoriteButton";
import { readVideoLists, setVideoListEntry, type VideoListKind } from "../../lib/local-video-lists";

type Card = { id: string; handle: string | null; authorName: string | null; text: string | null; posterUrl: string | null; createdAt: string | null; unavailable?: boolean };
type Mode = "random" | "search" | "month" | "tier" | "favorites" | "saveHistory";
const personal = (mode: Mode): mode is VideoListKind => mode === "favorites" || mode === "saveHistory";
const initialMode = (value: string | null): Mode => ["random", "search", "month", "tier", "favorites", "saveHistory"].includes(value ?? "") ? value as Mode : "random";
function personalCards(ids: string[], videos: Card[]): Card[] { const found = new Map(videos.map(v => [v.id, v])); return ids.map(id => found.get(id) ?? { id, handle: null, authorName: null, text: null, posterUrl: null, createdAt: null, unavailable: true }); }
function discoveryParams(mode: Mode, term: string, month: string, tier: string, seed: number, offset: number) {
  const p = new URLSearchParams({ mode: mode === "month" && !month ? "months" : mode, offset: String(offset) });
  if (mode === "search") p.set("q", term);
  if (mode === "month" && month) p.set("month", month);
  if (mode === "tier") p.set("tier", tier);
  if (mode === "random") p.set("seed", String(seed));
  return p;
}
export default function DiscoveryBrowser({ personalPage = false }: { personalPage?: boolean }) {
  const [mode, setMode] = useState<Mode>(personalPage ? "favorites" : "random"), [q, setQ] = useState(""), [term, setTerm] = useState(""), [month, setMonth] = useState(""), [tier, setTier] = useState("S"), [seed, setSeed] = useState(0);
  const [cards, setCards] = useState<Card[]>([]), [months, setMonths] = useState<string[]>([]), [offset, setOffset] = useState<number | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0), [retry, setRetry] = useState(0), [initialized, setInitialized] = useState(false);
  const generation = useRef(0);
  useEffect(() => { const params = new URLSearchParams(location.search); const selected = initialMode(params.get("mode"));
    setMode(personalPage ? (selected === "saveHistory" ? "saveHistory" : "favorites") : personal(selected) ? "random" : selected);
    setQ((params.get("q") ?? "").slice(0, 80)); setTerm((params.get("q") ?? "").slice(0, 80)); setMonth(params.get("month") ?? ""); setTier(params.get("tier") ?? "S");
    const suppliedSeed = params.get("seed"); setSeed(suppliedSeed && /^\d{1,10}$/.test(suppliedSeed) && Number(suppliedSeed) <= 0xffffffff ? Number(suppliedSeed) : Math.floor(Math.random() * 4294967296)); setInitialized(true);
  }, [personalPage]);
  useEffect(() => { const onChange = () => setRevision(n => n + 1); window.addEventListener(VIDEO_LIST_EVENT, onChange); window.addEventListener("storage", onChange); return () => { window.removeEventListener(VIDEO_LIST_EVENT, onChange); window.removeEventListener("storage", onChange); }; }, []);
  useEffect(() => { if (!initialized) return; const controller = new AbortController(); generation.current++;
    setCards([]); setOffset(0); setBusy(true); setError("");
    async function load() {
      try { let videos: Card[], next: number | null;
        if (personal(mode)) { const ids = readVideoLists(localStorage)[mode]; const chunk = ids.slice(0, 50); next = ids.length > 50 ? 50 : null;
          const response = await fetch("/api/discovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: chunk }), signal: controller.signal }); const data = await response.json(); if (!response.ok || !data.ok) throw Error(); videos = personalCards(chunk, data.videos);
        } else { const params = discoveryParams(mode, term, month, tier, seed, 0);
          if (mode === "search" && !term.trim()) { setBusy(false); setOffset(null); return; }
          const response = await fetch("/api/discovery?" + params, { signal: controller.signal }); const data = await response.json(); if (!response.ok || !data.ok) throw Error(); videos = mode === "month" && !month ? [] : data.data.videos; next = mode === "month" && !month ? null : data.data.nextOffset; setMonths(data.data.months);
        }
        setCards(videos); setOffset(next);
      } catch { if (!controller.signal.aborted) setError("読み込みに失敗しました。しばらくしてからお試しください。"); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load(); return () => controller.abort();
  }, [mode, term, month, tier, seed, initialized, personalPage, retry, personal(mode) ? revision : 0]);
  async function more() {
    if (busy || offset === null) return; const requestGeneration = generation.current; setBusy(true); setError("");
    try { let videos: Card[], next: number | null;
      if (personal(mode)) { const ids = readVideoLists(localStorage)[mode]; const chunk = ids.slice(offset, offset + 50); const response = await fetch("/api/discovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: chunk }) }); const data = await response.json(); if (!response.ok || !data.ok) throw Error(); videos = personalCards(chunk, data.videos); next = offset + chunk.length < ids.length ? offset + chunk.length : null;
      } else { const params = discoveryParams(mode, term, month, tier, seed, offset); const response = await fetch("/api/discovery?" + params); const data = await response.json(); if (!response.ok || !data.ok) throw Error(); videos = data.data.videos; next = data.data.nextOffset; }
      if (requestGeneration !== generation.current) return;
      setCards(previous => { const existing = new Set(previous.map(v => v.id)); return [...previous, ...videos.filter(v => !existing.has(v.id))]; }); setOffset(next);
    } catch { if (requestGeneration === generation.current) setError("読み込みに失敗しました。もう一度お試しください。"); } finally { if (requestGeneration === generation.current) setBusy(false); }
  }
  const returnParams = new URLSearchParams({ mode });
  if (mode === "search" && term) returnParams.set("q", term);
  if (mode === "month" && month) returnParams.set("month", month);
  if (mode === "tier") returnParams.set("tier", tier);
  if (mode === "random") returnParams.set("seed", String(seed));
  const returnTo = (personalPage ? "/favorites?" : "/discover?") + returnParams.toString();
  useEffect(() => { if (initialized && location.pathname === (personalPage ? "/favorites" : "/discover")) history.replaceState(history.state, "", returnTo); }, [initialized, personalPage, returnTo]);
  return <div className="discovery-browser"><nav className="discovery-tabs" aria-label="動画の探し方">
    {(personalPage ? [["favorites", "お気に入り"], ["saveHistory", "保存履歴"]] : [["random", "ランダム"], ["tier", "Tierで探す"], ["month", "月別"], ["search", "検索"]]).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value as Mode)}>{label}</button>)}
  </nav>
  {personalPage && <p>この端末のブラウザに記録します。お気に入りは最大1000件、保存履歴は新しい順に最大1000件です。保存履歴は保存操作の記録で、端末への保存完了を保証するものではありません。</p>}
  {mode === "search" && <form onSubmit={event => { event.preventDefault(); setTerm(q.trim()); }}><label>タグ・本文・投稿者名 <input value={q} maxLength={80} onChange={event => setQ(event.target.value)} /></label> <button type="submit">検索</button></form>}
  {mode === "month" && <label>投稿月 <select value={month} onChange={event => setMonth(event.target.value)}><option value="">月を選択</option>{months.map(m => <option key={m} value={m}>{m}</option>)}</select></label>}
  {mode === "tier" && <label>Tier <select value={tier} onChange={event => setTier(event.target.value)}>{["S", "A+", "A", "B+", "B", "C"].map(t => <option key={t}>{t}</option>)}</select></label>}
  {mode === "random" && <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 4294967296))}>並び替える</button>}
  {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>再試行</button></p>}{busy && <p role="status">読み込み中…</p>}
  {!busy && !error && cards.length === 0 && <p>{mode === "month" && !month ? "投稿月を選んでください。" : mode === "search" && !term ? "検索したい言葉を入力してください。" : "表示できる動画はありません。"}</p>}
  <div className="video-grid">{cards.map(card => <article className="video-card" key={card.id}>
    {card.unavailable ? <p>現在サイトで表示できません。</p> : <PublicPostLink id={card.id} returnTo={returnTo} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
      {card.posterUrl ? <PublicThumbnail src={card.posterUrl} alt="動画のサムネイル" width={392} height={220} loading="lazy" decoding="async" style={{ display: "block", width: "100%", height: 220, objectFit: "contain", background: "#08111e" }} /> : <div style={{ height: 120 }}>動画を開く</div>}
      <p>{card.authorName || card.handle || "投稿者"}</p><p>{Array.from(card.text ?? "").slice(0, 100).join("")}</p>
    </PublicPostLink>}<FavoriteButton id={card.id} />{mode === "saveHistory" && <button type="button" onClick={() => { try { if (!setVideoListEntry(localStorage, "saveHistory", card.id, false)) throw Error(); window.dispatchEvent(new Event(VIDEO_LIST_EVENT)); } catch { setError("履歴を変更できませんでした。"); } }}>履歴から削除</button>}
  </article>)}</div>
  {offset !== null && <button type="button" className="load-more" disabled={busy} onClick={() => void more()}>さらに表示</button>}
  <p><Link href={personalPage ? "/discover" : "/favorites"}>{personalPage ? "動画を探す" : "お気に入り・保存履歴"}</Link></p></div>;
}
