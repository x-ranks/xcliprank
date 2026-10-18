"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "site-visual-preference-review-v1";
const TIERS = ["S", "A", "B", "C", "D", "X"] as const;
const PREFERENCES = ["ideal", "not_ideal", "hold"] as const;
type Tier = (typeof TIERS)[number];
type Preference = (typeof PREFERENCES)[number];
type ReviewRecord = { preference: Preference; tier: Tier | null; reviewedAt: string };
type SamplePost = {
  id: number;
  xPostId: string;
  xUrl: string | null;
  previewImageUrl: string;
  authorUsername: string | null;
  authorName: string | null;
  createdAt: string | null;
  existingAdultTier: string | null;
};
type SavedState = { sample: SamplePost[]; reviews: Record<string, ReviewRecord>; position: number };
type ApiPost = {
  id: number;
  x_post_id: string;
  author_username: string | null;
  author_name: string | null;
  created_at: string | null;
  x_url: string | null;
  preview_image_url: string | null;
  adult_tier: string | null;
};
type ApiResponse = { success: boolean; posts?: ApiPost[]; error?: string };

const GROUPS: Record<string, string[]> = {
  high: ["S", "A+"],
  A: ["A"],
  B: ["B", "B+"],
  C: ["C"],
  D: ["D", "D+"],
};

function stableValue(id: number) {
  let value = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

function selectSample(posts: ApiPost[]): SamplePost[] {
  const eligible = posts.filter((post) => Boolean(post.preview_image_url));
  const selected = new Set<number>();
  const result: SamplePost[] = [];
  const shuffled = [...eligible].sort((a, b) => stableValue(a.id) - stableValue(b.id));
  const add = (post: ApiPost) => {
    if (selected.has(post.id) || !post.preview_image_url) return;
    selected.add(post.id);
    result.push({
      id: post.id,
      xPostId: post.x_post_id,
      xUrl: post.x_url,
      previewImageUrl: post.preview_image_url,
      authorUsername: post.author_username,
      authorName: post.author_name,
      createdAt: post.created_at,
      existingAdultTier: post.adult_tier,
    });
  };

  for (const tiers of Object.values(GROUPS)) {
    for (const post of shuffled.filter((candidate) => tiers.includes(candidate.adult_tier ?? ""))) {
      if (result.filter((item) => tiers.includes(item.existingAdultTier ?? "")).length >= 10) break;
      add(post);
    }
  }
  for (const post of shuffled) {
    if (result.length >= 50) break;
    add(post);
  }
  return result
    .sort((a, b) => stableValue(a.id + 17) - stableValue(b.id + 17))
    .slice(0, 50);
}

function readSaved(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as SavedState;
    if (!value || !Array.isArray(value.sample) || !value.reviews || typeof value.position !== "number") return null;
    return value;
  } catch {
    return null;
  }
}

function dateLabel(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SiteVisualPreferenceReviewPage() {
  const [sample, setSample] = useState<SamplePost[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>({});
  const [position, setPosition] = useState(0);
  const [tier, setTier] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const saved = readSaved();
      if (saved?.sample.length) {
        setSample(saved.sample);
        setReviews(saved.reviews);
        setPosition(Math.max(0, Math.min(saved.position, saved.sample.length - 1)));
        return;
      }
      const response = await fetch("/api/review", { method: "GET", cache: "no-store" });
      const data = await response.json() as ApiResponse;
      if (!response.ok || !data.success) throw new Error(data.error ?? "投稿を取得できませんでした");
      const selected = selectSample(data.posts ?? []);
      if (selected.length < 50) throw new Error(`サムネイル付き投稿が${selected.length}件しかありません。50件必要です。`);
      setSample(selected);
      setReviews({});
      setPosition(0);
      setTier(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "投稿を取得できませんでした");
    } finally {
      setLoading(false);
      setHydrated(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (hydrated && sample.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sample, reviews, position }));
    }
  }, [hydrated, position, reviews, sample]);

  const item = sample[position];
  const reviewedCount = sample.filter((post) => reviews[String(post.id)]).length;
  const finished = sample.length === 50 && reviewedCount === sample.length;
  const counts = useMemo(() => {
    const preference = { ideal: 0, not_ideal: 0, hold: 0, unreviewed: 0 };
    const tiers: Record<string, number> = {};
    for (const post of sample) {
      const review = reviews[String(post.id)];
      if (!review) preference.unreviewed++;
      else preference[review.preference]++;
      if (review?.tier) tiers[review.tier] = (tiers[review.tier] ?? 0) + 1;
    }
    return { preference, tiers };
  }, [reviews, sample]);

  function commit(preference: Preference, selectedTier: Tier | null) {
    if (!item || (preference !== "hold" && !selectedTier)) return;
    setReviews((previous) => ({ ...previous, [String(item.id)]: { preference, tier: selectedTier, reviewedAt: new Date().toISOString() } }));
    setTier(null);
    if (position < sample.length - 1) setPosition((value) => value + 1);
  }

  function move(delta: number) {
    setPosition((value) => Math.max(0, Math.min(sample.length - 1, value + delta)));
    setTier(null);
  }

  function reset() {
    if (!window.confirm("保存した試験評価をすべてリセットしますか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    setSample([]);
    setReviews({});
    setPosition(0);
    setTier(null);
    setHydrated(false);
    void load();
  }

  function download() {
    const output = sample.map((post) => {
      const review = reviews[String(post.id)];
      return { source: "site", postId: post.id, xPostId: post.xPostId, xUrl: post.xUrl, previewImageUrl: post.previewImageUrl, existingAdultTier: post.existingAdultTier, authorUsername: post.authorUsername, createdAt: post.createdAt, preference: review?.preference ?? null, tier: review?.tier ?? null, reviewedAt: review?.reviewedAt ?? null };
    });
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "site-visual-preference-review.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || !item) return;
      const key = event.key.toUpperCase();
      if (TIERS.includes(key as Tier)) { setTier(key as Tier); return; }
      if (event.key === "1" && tier) commit("ideal", tier);
      if (event.key === "2" && tier) commit("not_ideal", tier);
      if (event.key === "3") commit("hold", null);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, tier, position]);

  if (!hydrated || loading) return <main className="shell"><p>自サイトの投稿を読み込み中...</p><Styles /></main>;
  if (error) return <main className="shell"><h1>読み込みエラー</h1><p className="error">{error}</p><button onClick={() => void load()}>再読み込み</button><Styles /></main>;
  if (sample.length < 50) return <main className="shell"><h1>サンプル不足</h1><p>評価に必要な50件を取得できませんでした。</p><button onClick={() => void load()}>再取得</button><Styles /></main>;

  if (finished) return <main className="shell"><Header /><div className="meta"><strong>50 / 50</strong><span>100%完了</span></div><div className="progress"><div style={{ width: "100%" }} /></div><Summary counts={counts} sample={sample} reviews={reviews} download={download} reset={reset} complete /><Styles /></main>;

  return <main className="shell">
    <Header />
    <div className="meta"><strong>{position + 1} / 50</strong><span>評価済み {reviewedCount}件（{Math.round((reviewedCount / 50) * 100)}%）</span></div>
    <div className="progress"><div style={{ width: `${Math.round((reviewedCount / 50) * 100)}%` }} /></div>
    <div className="toolbar"><button onClick={download}>JSONダウンロード</button><button onClick={reset}>評価をリセット</button></div>
    <div className="grid">
      <section className="visual">
        <div className="rank">TWIVIDEO参照ではなく自サイト投稿 ／ {position + 1}</div>
        {imageFailed[item.id] ? <div className="imageError">画像を読み込めません</div> : <img src={item.previewImageUrl} alt="投稿サムネイル" onError={() => setImageFailed((previous) => ({ ...previous, [item.id]: true }))} />}
        <div className="ids"><span>post ID: <b>{item.id}</b></span><span>投稿者: <b>{item.authorName ?? item.authorUsername ?? "不明"}</b></span><span>投稿日: <b>{dateLabel(item.createdAt)}</b></span></div>
        <div className="links">{item.xUrl ? <a href={item.xUrl} target="_blank" rel="noreferrer">X投稿を開く ↗</a> : <span>X投稿URLなし</span>}</div>
      </section>
      <aside className="panel">
        <h2>理想に近いですか？</h2><p className="hint">試験用・DBには保存されません。tierを選んでから理想／非理想を確定してください。</p>
        <div className="tiers">{TIERS.map((value) => <button className={tier === value ? "selected" : ""} key={value} onClick={() => setTier(value)}>{value}</button>)}</div>
        <p>選択中のtier：<b>{tier ?? "未選択"}</b></p>
        <div className="decision"><button className="ideal" disabled={!tier} onClick={() => commit("ideal", tier)}>理想に近い <kbd>1</kbd></button><button className="notIdeal" disabled={!tier} onClick={() => commit("not_ideal", tier)}>理想ではない <kbd>2</kbd></button><button className="hold" onClick={() => commit("hold", null)}>保留 <kbd>3</kbd></button></div>
        <div className="nav"><button onClick={() => move(-1)} disabled={position === 0}>← 前へ</button><button onClick={() => move(1)} disabled={position === sample.length - 1}>次へ →</button></div>
        {reviews[String(item.id)] && <p className="saved">保存済み：{reviews[String(item.id)].preference} / tier {reviews[String(item.id)].tier ?? "-"}</p>}
      </aside>
    </div>
    <Summary counts={counts} sample={sample} reviews={reviews} compact />
    <Styles />
  </main>;
}

function Header() { return <header className="header"><div><p className="eyebrow">SITE VISUAL PREFERENCE REVIEW</p><h1>自サイト投稿の理想参照評価</h1></div><span className="notice">試験用・DBには保存されません</span></header>; }

function Summary({ counts, sample, reviews, download, reset, compact = false, complete = false }: { counts: { preference: { ideal: number; not_ideal: number; hold: number; unreviewed: number }; tiers: Record<string, number> }; sample: SamplePost[]; reviews: Record<string, ReviewRecord>; download?: () => void; reset?: () => void; compact?: boolean; complete?: boolean }) {
  return <section className={compact ? "summary compact" : "summary"}><h2>{complete ? "完了サマリー" : "集計"}</h2><div className="summaryCards"><div><b>{counts.preference.ideal}</b><span>理想に近い</span></div><div><b>{counts.preference.not_ideal}</b><span>理想ではない</span></div><div><b>{counts.preference.hold}</b><span>保留</span></div><div><b>{counts.preference.unreviewed}</b><span>未評価</span></div></div><p>tier別件数：{TIERS.map((value) => `${value} ${counts.tiers[value] ?? 0}`).join(" ／ ")}</p>{complete && <div className="toolbar"><button onClick={download}>JSONダウンロード</button><button onClick={reset}>評価をリセット</button></div>}</section>;
}

function Styles() { return <style jsx global>{`
*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#17191c}button{font:inherit;border:1px solid #cbd0d8;border-radius:8px;padding:9px 12px;background:#fff;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.shell{max-width:1200px;margin:0 auto;padding:26px 22px 56px}.header{display:flex;justify-content:space-between;gap:16px;align-items:center}.eyebrow{margin:0;color:#687082;font-size:11px;letter-spacing:.14em;font-weight:800}h1{margin:4px 0 12px}.notice{padding:9px 12px;border-radius:8px;background:#fff4d6;color:#795b16;font-size:12px;font-weight:700}.meta{display:flex;justify-content:space-between;margin-top:18px;font-size:13px}.progress{height:8px;margin:7px 0 14px;background:#dfe2e8;border-radius:99px;overflow:hidden}.progress div{height:100%;background:#2e465f;transition:width .2s}.toolbar{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-bottom:18px}.toolbar button{font-size:12px}.grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(330px,.8fr);gap:20px;align-items:start}.visual,.panel,.summary{border:1px solid #d8dbe2;border-radius:14px;background:#fff}.visual{padding:16px}.rank{margin-bottom:10px;color:#687082;font-size:12px;font-weight:800}.visual img,.imageError{display:block;width:100%;aspect-ratio:16/10;object-fit:contain;background:#0c0e11;border-radius:9px}.imageError{display:grid;place-items:center;color:#c6cbd4}.ids{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px;color:#687082;font-size:12px}.ids b{color:#17191c}.links{margin-top:14px}.links a{color:#1d5caa;font-weight:700;font-size:13px}.panel{padding:20px}.hint{color:#626a76;font-size:13px;line-height:1.6}.tiers{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin:16px 0 10px}.tiers button{font-size:18px;font-weight:800}.tiers .selected{border-color:#2e465f;background:#e8eef5;box-shadow:inset 0 0 0 2px #2e465f}.decision{display:grid;gap:8px;margin-top:16px}.decision button{color:#fff;font-weight:800}.ideal{background:#23724b}.notIdeal{background:#a74646}.hold{background:#626a76}kbd{margin-left:5px;padding:2px 5px;border:1px solid #ffffff88;border-radius:4px}.nav{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.saved{padding:10px;background:#f2f3f6;border-radius:7px;font-size:12px}.summary{padding:18px;margin-top:20px}.summaryCards{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.summaryCards div{padding:13px 8px;text-align:center;border:1px solid #e2e4e8;border-radius:8px}.summaryCards b,.summaryCards span{display:block}.summaryCards b{font-size:22px}.summaryCards span{color:#687082;font-size:11px;margin-top:4px}.error{padding:12px;border:1px solid #e2a1a1;border-radius:8px;background:#fff0f0;color:#8b2020}.compact .summaryCards{grid-template-columns:repeat(4,1fr)}
@media(max-width:760px){.shell{padding:16px 12px 42px}.header{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:1fr}.summaryCards,.compact .summaryCards{grid-template-columns:repeat(2,1fr)}.tiers{grid-template-columns:repeat(3,1fr)}.toolbar{margin-top:8px}}
`}</style>; }
