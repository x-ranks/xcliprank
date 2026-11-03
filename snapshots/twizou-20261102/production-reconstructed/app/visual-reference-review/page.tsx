"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "visual-reference-review-v1";
const TIERS = ["S", "A", "B", "C", "D", "X"] as const;
const PREFERENCES = ["ideal", "not_ideal", "hold"] as const;
type Tier = (typeof TIERS)[number];
type Preference = (typeof PREFERENCES)[number];
type ReviewRecord = { preference: Preference; tier: Tier | null; reviewedAt: string };
type ReviewState = Record<string, ReviewRecord>;
type ReferenceItem = {
  rank: number;
  itemId: string;
  mediaId: string;
  thumbnailUrl: string;
  xUrl: string | null;
  xPostId: string | null;
};

const REFERENCES: ReferenceItem[] = [
  { rank: 1, itemId: "4008488", mediaId: "2093501579718688768", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2093501579718688768/img/IsTJuBTivd_W1BzZ.jpg", xUrl: "https://x.com/Arvind_07c/status/2093501721393922348", xPostId: null },
  { rank: 2, itemId: "3984599", mediaId: "1999013319114661888", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/1999013319114661888/img/1iRRW_Xmkt_abCEP.jpg", xUrl: "https://x.com/kireidavid/status/1999013411414487153", xPostId: null },
  { rank: 3, itemId: "4001890", mediaId: "2092157957068947456", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092157957068947456/img/1_xGMq01StvSdGVe.jpg", xUrl: "https://x.com/miltra_77/status/2092459364598825284", xPostId: null },
  { rank: 4, itemId: "3999749", mediaId: "2089733009280774145", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2089733009280774145/img/-DLtbEyQOt9oHqRN.jpg", xUrl: "https://x.com/99transgodess/status/2089733033846882304", xPostId: null },
  { rank: 5, itemId: "4002557", mediaId: "2092552168364720129", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092552168364720129/img/dL5wYM8f2FB_l26I.jpg", xUrl: "https://x.com/daigaku_ni/status/2092552233762402605", xPostId: null },
  { rank: 6, itemId: "3772050", mediaId: "2069390646927151104", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2069390646927151104/img/uPSTrkFZguXVM19h.jpg", xUrl: "https://x.com/otonajikannn_/status/2069390751310684271", xPostId: null },
  { rank: 7, itemId: "4004397", mediaId: "2093003854833209344", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2093003854833209344/img/NGgM8Um7cGdDG1En.jpg", xUrl: "https://x.com/Koreanstudiox/status/2093046703721189434", xPostId: null },
  { rank: 8, itemId: "3986478", mediaId: "2091251373405044736", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2091251373405044736/img/XYVeq8m6BlWtGGlN.jpg", xUrl: "https://x.com/Nudesmov/status/2091251713038827991", xPostId: null },
  { rank: 9, itemId: "4005489", mediaId: "2076654112767422466", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2076654112767422466/img/XQHDE3hpCIAvbXrz.jpg", xUrl: "https://x.com/maikasama365/status/2092587084133671206", xPostId: null },
  { rank: 10, itemId: "4002345", mediaId: "2092300864082059264", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092300864082059264/img/h_xmiPdw3BivNUER.jpg", xUrl: "https://x.com/PREMIUM81266209/status/2092300982239846648", xPostId: null },
  { rank: 11, itemId: "3997983", mediaId: "2092278011416702976", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092278011416702976/img/5rZxPgZyAeUWCJdj.jpg", xUrl: null, xPostId: null },
  { rank: 12, itemId: "4005800", mediaId: "2092945628972388352", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092945628972388352/img/Cd5JQLm5e1awL9fn.jpg", xUrl: null, xPostId: null },
  { rank: 13, itemId: "4002358", mediaId: "2088670794385952768", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2088670794385952768/img/4uv1AqCSXUBzrTOi.jpg", xUrl: null, xPostId: null },
  { rank: 14, itemId: "4000381", mediaId: "2092272278239420416", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092272278239420416/img/TBWWP6N4ohu9BDNm.jpg", xUrl: null, xPostId: null },
  { rank: 15, itemId: "4010345", mediaId: "2093341583307599872", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2093341583307599872/img/FVtWr9O3ioa9yadc.jpg", xUrl: null, xPostId: null },
  { rank: 16, itemId: "3997453", mediaId: "2092549660175147008", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092549660175147008/img/LKQlDeE1kGB7Jtsu.jpg", xUrl: null, xPostId: null },
  { rank: 17, itemId: "3999548", mediaId: "2092551587621433344", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092551587621433344/img/v0ggoP1hUaNOjiqR.jpg", xUrl: null, xPostId: null },
  { rank: 18, itemId: "3997896", mediaId: "2052494587407519746", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2052494587407519746/img/7hQDHTPXuGultx1R.jpg", xUrl: null, xPostId: null },
  { rank: 19, itemId: "4006531", mediaId: "2093267120855691264", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2093267120855691264/img/zXYXbMFyhSLbqGhd.jpg", xUrl: null, xPostId: null },
  { rank: 20, itemId: "4001648", mediaId: "2092660349249990656", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092660349249990656/img/eIbZD9DIpA7r-kDL.jpg", xUrl: null, xPostId: null },
  { rank: 21, itemId: "3998744", mediaId: "1839871211058114560", thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1839871211058114560/pu/img/6ShQFdh-ZwAF_Dg6.jpg", xUrl: null, xPostId: null },
  { rank: 22, itemId: "3995043", mediaId: "2050124611694829568", thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/2050124611694829568/pu/img/5XtU99ClMsltrg8s.jpg", xUrl: null, xPostId: null },
  { rank: 23, itemId: "3996238", mediaId: "2091996546959024128", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2091996546959024128/img/0LIQ21qiyK1P9iOf.jpg", xUrl: null, xPostId: null },
  { rank: 24, itemId: "3950877", mediaId: "2087551591985405952", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2087551591985405952/img/TqrT8xlAfi_-Xtla.jpg", xUrl: null, xPostId: null },
  { rank: 25, itemId: "4006606", mediaId: "2093315675142103040", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2093315675142103040/img/0CyjiMTXk_GKsdQ8.jpg", xUrl: null, xPostId: null },
  { rank: 26, itemId: "4002401", mediaId: "2092272806352572416", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092272806352572416/img/ScbfaAzInZbz2mLm.jpg", xUrl: null, xPostId: null },
  { rank: 27, itemId: "4004787", mediaId: "2092887835325919232", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092887835325919232/img/5uMfkN358qKv5BYA.jpg", xUrl: null, xPostId: null },
  { rank: 28, itemId: "3996756", mediaId: "2091539075794956288", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2091539075794956288/img/pkafppuM-f8iHYP5.jpg", xUrl: null, xPostId: null },
  { rank: 29, itemId: "3988824", mediaId: "2091867381530587136", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2091867381530587136/img/nC_Ktirb6Qqzm9JS.jpg", xUrl: null, xPostId: null },
  { rank: 30, itemId: "4010931", mediaId: "2093655374440415232", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2093655374440415232/img/fHewseKg9xGafm8W.jpg", xUrl: null, xPostId: null },
  { rank: 31, itemId: "3889773", mediaId: "2069382022074908672", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2069382022074908672/img/5RC2bEjHsIk9hzbh.jpg", xUrl: null, xPostId: null },
  { rank: 32, itemId: "3995441", mediaId: "2092157946277081088", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092157946277081088/img/T4_rKSMT58ad7voP.jpg", xUrl: null, xPostId: null },
  { rank: 33, itemId: "3997669", mediaId: "2092445605671186433", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092445605671186433/img/vQLfXlaOboibeHzh.jpg", xUrl: null, xPostId: null },
  { rank: 34, itemId: "4000240", mediaId: "2082234046994935808", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2082234046994935808/img/jWhdiHyHTJfaODFm.jpg", xUrl: null, xPostId: null },
  { rank: 35, itemId: "4001701", mediaId: "2092726836476485632", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092726836476485632/img/PvVNfVPcWIoXIeQI.jpg", xUrl: null, xPostId: null },
  { rank: 36, itemId: "3989974", mediaId: "2091796663040155648", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2091796663040155648/img/SVhKHrCk4FfVnXbz.jpg", xUrl: null, xPostId: null },
  { rank: 37, itemId: "3995562", mediaId: "2092182457844105216", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092182457844105216/img/wLnFAslnGfrX_uS9.jpg", xUrl: null, xPostId: null },
  { rank: 38, itemId: "4004790", mediaId: "2092996372932988928", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092996372932988928/img/FgJEseHhyqYDEkQP.jpg", xUrl: null, xPostId: null },
  { rank: 39, itemId: "4000296", mediaId: "2091846791079800833", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2091846791079800833/img/KHJiWaqYBCrvyn2p.jpg", xUrl: "https://x.com/ynwpll/status/2092752378307195199", xPostId: null },
  { rank: 40, itemId: "3982244", mediaId: "2091261003376062464", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2091261003376062464/img/6vtxNN21znukR06Q.jpg", xUrl: null, xPostId: null },
  { rank: 41, itemId: "3995641", mediaId: "2092198566416502784", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092198566416502784/img/JPXKLAOmpNB9vPdV.jpg", xUrl: null, xPostId: null },
  { rank: 42, itemId: "4008485", mediaId: "2093501293935669248", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2093501293935669248/img/hi5TH7PtbjyP2_mb.jpg", xUrl: null, xPostId: null },
  { rank: 43, itemId: "3997808", mediaId: "2092447803876560896", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092447803876560896/img/5zQk-b4QNnLgm6LK.jpg", xUrl: null, xPostId: null },
  { rank: 44, itemId: "4005495", mediaId: "1734933190610137088", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/1734933190610137088/img/lfjseNbEVmUTCmdt.jpg", xUrl: null, xPostId: null },
  { rank: 45, itemId: "3990026", mediaId: "2091756780804272128", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2091756780804272128/img/eGc5zF-ySE5aEB-f.jpg", xUrl: null, xPostId: null },
  { rank: 46, itemId: "3997985", mediaId: "1966103366377025538", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/1966103366377025538/img/DKo8KYVe1kMUyGTb.jpg", xUrl: null, xPostId: null },
  { rank: 47, itemId: "3994531", mediaId: "2092222439111729152", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092222439111729152/img/WsqI2xOneWDUooEA.jpg", xUrl: null, xPostId: null },
  { rank: 48, itemId: "4010204", mediaId: "2093501579718688768", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2093501579718688768/img/IsTJuBTivd_W1BzZ.jpg", xUrl: null, xPostId: null },
  { rank: 49, itemId: "3969934", mediaId: "2090004040050696192", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2090004040050696192/img/_B4HXEFq9xy53-aK.jpg", xUrl: null, xPostId: null },
  { rank: 50, itemId: "3997797", mediaId: "2092569218793476098", thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2092569218793476098/img/z9jStBnJ2cQbRK2Y.jpg", xUrl: null, xPostId: null },
];

const PREFERENCE_LABELS: Record<Preference, string> = {
  ideal: "理想に近い",
  not_ideal: "理想ではない",
  hold: "保留",
};

function emptyState(): ReviewState {
  return {};
}

function loadState(): ReviewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as ReviewState;
    return parsed && typeof parsed === "object" ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

function saveState(state: ReviewState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export default function VisualReferenceReviewPage() {
  const [state, setState] = useState<ReviewState>({});
  const [index, setIndex] = useState(0);
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [imageFailed, setImageFailed] = useState<Record<number, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadState();
    setState(saved);
    setHydrated(true);
    const savedIndex = Number(localStorage.getItem(`${STORAGE_KEY}:position`));
    if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < REFERENCES.length) setIndex(savedIndex);
  }, []);

  useEffect(() => {
    if (hydrated) {
      saveState(state);
      localStorage.setItem(`${STORAGE_KEY}:position`, String(index));
    }
  }, [hydrated, index, state]);

  const item = REFERENCES[index];
  const currentReview = item ? state[String(item.rank)] : undefined;
  const reviewed = Object.keys(state).filter((key) => REFERENCES.some((reference) => String(reference.rank) === key));
  const counts = useMemo(() => {
    const preference: Record<"ideal" | "not_ideal" | "hold" | "unreviewed", number> = { ideal: 0, not_ideal: 0, hold: 0, unreviewed: 0 };
    const tiers: Record<string, number> = {};
    for (const reference of REFERENCES) {
      const review = state[String(reference.rank)];
      if (!review) preference.unreviewed++;
      else preference[review.preference]++;
      if (review?.tier) tiers[review.tier] = (tiers[review.tier] ?? 0) + 1;
    }
    return { preference, tiers };
  }, [state]);
  const progress = Math.round((reviewed.length / REFERENCES.length) * 100);
  const finished = reviewed.length === REFERENCES.length;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      const key = event.key.toUpperCase();
      if (TIERS.includes(key as Tier)) {
        setSelectedTier(key as Tier);
        return;
      }
      if (event.key === "1" && selectedTier) commit("ideal", selectedTier);
      if (event.key === "2" && selectedTier) commit("not_ideal", selectedTier);
      if (event.key === "3") commit("hold", null);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedTier, state, index]);

  function commit(preference: Preference, tier: Tier | null) {
    if (!item || (preference !== "hold" && !tier)) return;
    const next = { ...state, [String(item.rank)]: { preference, tier, reviewedAt: new Date().toISOString() } };
    setState(next);
    setSelectedTier(null);
    if (index < REFERENCES.length - 1) setIndex((value) => value + 1);
  }

  function move(delta: number) {
    setIndex((value) => Math.max(0, Math.min(REFERENCES.length - 1, value + delta)));
    setSelectedTier(null);
  }

  function reset() {
    if (!window.confirm("保存した試験評価をすべてリセットしますか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(`${STORAGE_KEY}:position`);
    setState({});
    setIndex(0);
    setSelectedTier(null);
  }

  function download() {
    const output = REFERENCES.map((reference) => {
      const review = state[String(reference.rank)];
      return { rank: reference.rank, itemId: reference.itemId, mediaId: reference.mediaId, xPostId: reference.xPostId, xUrl: reference.xUrl, preference: review?.preference ?? null, tier: review?.tier ?? null, reviewedAt: review?.reviewedAt ?? null };
    });
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "visual-reference-review.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!hydrated) return <main className="shell"><p>試験評価を準備中...</p><Styles /></main>;
  if (finished) {
    return (
      <main className="shell">
        <header className="header"><div><p className="eyebrow">VISUAL REFERENCE REVIEW</p><h1>試験評価が完了しました</h1></div><span className="notice">試験用・DBには保存されません</span></header>
        <div className="meta"><strong>50 / 50</strong><span>100%完了</span></div>
        <div className="progress"><div style={{ width: "100%" }} /></div>
        <section className="summary completeSummary"><h2>完了サマリー</h2><div className="summaryCards"><div><b>{counts.preference.ideal}</b><span>理想に近い</span></div><div><b>{counts.preference.not_ideal}</b><span>理想ではない</span></div><div><b>{counts.preference.hold}</b><span>保留</span></div><div><b>50</b><span>評価済み</span></div></div><p>tier別件数：{TIERS.map((tier) => `${tier} ${counts.tiers[tier] ?? 0}`).join(" ／ ")}</p><div className="toolbar"><button onClick={download}>結果JSONをダウンロード</button><button onClick={reset}>評価をリセット</button></div></section>
        <Styles />
      </main>
    );
  }
  if (!item) return null;
  return (
    <main className="shell">
      <header className="header">
        <div><p className="eyebrow">VISUAL REFERENCE REVIEW</p><h1>理想動画の参照評価</h1></div>
        <span className="notice">試験用・DBには保存されません</span>
      </header>
      <div className="meta"><strong>{index + 1} / {REFERENCES.length}</strong><span>{progress}%完了</span></div>
      <div className="progress"><div style={{ width: `${progress}%` }} /></div>
      <div className="toolbar"><span>評価済み {reviewed.length}件</span><button onClick={download}>結果JSONをダウンロード</button><button onClick={reset}>評価をリセット</button></div>
      <div className="grid">
        <section className="visual">
          <div className="rank">RANK {item.rank}</div>
          {imageFailed[item.rank] ? <div className="imageError">画像を読み込めません</div> : <img src={item.thumbnailUrl} alt={`TWIVIDEO rank ${item.rank} のサムネイル`} onError={() => setImageFailed((previous) => ({ ...previous, [item.rank]: true }))} />}
          <div className="ids"><span>TWIVIDEO item ID: <b>{item.itemId}</b></span><span>media/video ID: <b>{item.mediaId}</b></span></div>
          <div className="links">{item.xUrl ? <a href={item.xUrl} target="_blank" rel="noreferrer">元X投稿を開く ↗</a> : <span>元X投稿URL：取得不能</span>}<a href={`https://twivideo.net/api/video.php?id=${item.itemId}`} target="_blank" rel="noreferrer">TWIVIDEO項目を開く ↗</a></div>
        </section>
        <aside className="panel">
          <h2>この動画は理想に近いですか？</h2>
          <p className="hint">まずtierを選択してから、理想／非理想を確定してください。保留はtierなしで進められます。</p>
          <div className="tiers">{TIERS.map((tier) => <button className={selectedTier === tier ? "tier selected" : "tier"} key={tier} onClick={() => setSelectedTier(tier)}>{tier}</button>)}</div>
          <p className="selected">選択中のtier：<b>{selectedTier ?? "未選択"}</b></p>
          <div className="decision"><button className="ideal" disabled={!selectedTier} onClick={() => commit("ideal", selectedTier)}><kbd>1</kbd> 理想に近い</button><button className="notIdeal" disabled={!selectedTier} onClick={() => commit("not_ideal", selectedTier)}><kbd>2</kbd> 理想ではない</button><button className="hold" onClick={() => commit("hold", null)}><kbd>3</kbd> 保留</button></div>
          <div className="nav"><button onClick={() => move(-1)} disabled={index === 0}>← 前へ</button><button onClick={() => move(1)} disabled={index === REFERENCES.length - 1}>次へ →</button></div>
          {currentReview && <p className="current">この項目の保存済み評価：{PREFERENCE_LABELS[currentReview.preference]} / tier {currentReview.tier ?? "-"}</p>}
        </aside>
      </div>
      <section className="summary">
        <h2>集計</h2>
        <div className="summaryCards"><div><b>{counts.preference.ideal}</b><span>理想に近い</span></div><div><b>{counts.preference.not_ideal}</b><span>理想ではない</span></div><div><b>{counts.preference.hold}</b><span>保留</span></div><div><b>{counts.preference.unreviewed}</b><span>未評価</span></div></div>
        <p>tier別件数：{TIERS.map((tier) => `${tier} ${counts.tiers[tier] ?? 0}`).join(" ／ ")}</p>
        {finished && <p className="complete">50件の試験評価が完了しました。JSONをダウンロードして保存できます。</p>}
      </section>
      <Styles />
    </main>
  );
}

function Styles() {
  return <style jsx global>{`
    * { box-sizing: border-box; } body { margin: 0; background: #f4f5f7; color: #17191c; } button, input { font: inherit; }
    .shell { max-width: 1200px; margin: 0 auto; padding: 26px 22px 56px; } .header { display:flex; justify-content:space-between; gap:16px; align-items:center; } h1 { margin:4px 0 12px; } h2 { margin-top:0; } .eyebrow { margin:0; color:#687082; font-size:11px; letter-spacing:.14em; font-weight:800; } .notice { padding:9px 12px; border-radius:8px; background:#fff4d6; color:#795b16; font-size:12px; font-weight:700; }
    .meta { display:flex; justify-content:space-between; margin-top:18px; font-size:13px; } .progress { height:8px; margin:7px 0 14px; background:#dfe2e8; border-radius:99px; overflow:hidden; } .progress div { height:100%; background:#2e465f; transition:width .2s; }
    .toolbar { display:flex; flex-wrap:wrap; gap:9px; align-items:center; margin-bottom:18px; color:#626a76; font-size:13px; } .toolbar span { margin-right:auto; } button { border:1px solid #cbd0d8; border-radius:8px; padding:9px 12px; background:#fff; cursor:pointer; } button:disabled { cursor:not-allowed; opacity:.45; } .toolbar button { font-size:12px; }
    .grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(330px,.8fr); gap:20px; align-items:start; } .visual,.panel,.summary { border:1px solid #d8dbe2; border-radius:14px; background:#fff; } .visual { padding:16px; } .rank { margin-bottom:10px; color:#687082; font-size:12px; font-weight:800; letter-spacing:.1em; } .visual img,.imageError { display:block; width:100%; aspect-ratio:16/10; object-fit:contain; background:#0c0e11; border-radius:9px; } .imageError { display:grid; place-items:center; color:#c6cbd4; } .ids { display:flex; flex-wrap:wrap; gap:10px 20px; margin-top:14px; font-size:12px; color:#687082; } .ids b { color:#17191c; } .links { display:flex; flex-wrap:wrap; gap:12px; margin-top:15px; } a { color:#1d5caa; font-size:13px; font-weight:700; } .panel { padding:20px; } .hint { color:#626a76; font-size:13px; line-height:1.6; } .tiers { display:grid; grid-template-columns:repeat(6,1fr); gap:7px; margin:16px 0 10px; } .tier { font-size:18px; font-weight:800; } .tier.selected { border-color:#2e465f; background:#e8eef5; color:#1d354d; box-shadow:inset 0 0 0 2px #2e465f; } .selected { color:#626a76; font-size:13px; } .decision { display:grid; gap:8px; margin-top:16px; } .decision button { color:#fff; font-weight:800; } .ideal { background:#23724b; } .notIdeal { background:#a74646; } .hold { background:#626a76; } kbd { margin-right:5px; padding:2px 5px; border:1px solid #ffffff88; border-radius:4px; } .nav { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:14px; } .current { margin-bottom:0; padding:10px; background:#f2f3f6; border-radius:7px; font-size:12px; } .summary { padding:18px; margin-top:20px; } .summaryCards { display:grid; grid-template-columns:repeat(4,1fr); gap:9px; } .summaryCards div { padding:13px 8px; text-align:center; border:1px solid #e2e4e8; border-radius:8px; } .summaryCards b,.summaryCards span { display:block; } .summaryCards b { font-size:22px; } .summaryCards span { color:#687082; font-size:11px; margin-top:4px; } .complete { color:#23724b; font-weight:700; } .shell > p { padding:20px; }
    @media (max-width:760px) { .shell { padding:16px 12px 42px; } .header { align-items:flex-start; flex-direction:column; } .grid { grid-template-columns:1fr; } .summaryCards { grid-template-columns:repeat(2,1fr); } .tiers { grid-template-columns:repeat(3,1fr); } .toolbar span { width:100%; } }
  `}
  </style>;
}
