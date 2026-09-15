"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TrainingStatus = {
  reviewsSinceTraining: number;
  threshold: number;
  remainingUntilRetraining: number;
  needsRetraining: boolean;
};

type AdminStatus = {
  databaseConnected: boolean;
  configuration: {
    supabaseUrl: boolean;
    supabaseServiceKey: boolean;
    cronSecret: boolean;
    xPublishing: boolean;
  };
  projectHost: string | null;
  postCount?: number;
  latestManualReviewAt?: string | null;
  visualScoreCount?: number;
  productionComparison?: {
    checked: boolean;
    matched: number;
    sampled: number;
    sameDatabaseLikely: boolean;
  };
  error?: string;
};

type ToolCard = {
  href: string;
  title: string;
  description: string;
  badge: string;
  tone: "green" | "blue" | "amber" | "gray";
  featured?: boolean;
};

// 新しい運営・管理画面を追加した場合は、必ずこの一覧へ登録します。
const operationTools: ToolCard[] = [
  {
    href: "/engagement-admin",
    title: "流入・サイト内計測",
    description: "ユーザー数、動画オープン、5秒視聴、X流入、ランキング別の利用状況を確認します。",
    badge: "アクセス分析",
    tone: "green",
    featured: true,
  },
  {
    href: "/x-promotion",
    title: "X宣伝・投稿管理",
    description: "A・B・Cの投稿文、ランキングTOP3、投稿履歴、投稿別の流入数を管理します。",
    badge: "流入改善",
    tone: "green",
    featured: true,
  },
  {
    href: "/x-api-usage",
    title: "X API利用量",
    description: "広域探索・選別投稿者収集・アカウント検索・X投稿などの利用状況を確認します。",
    badge: "運用確認",
    tone: "blue",
  },
  {
    href: "/curated-authors",
    title: "選別投稿者管理",
    description: "収集対象の投稿者を登録・停止し、収集状況やエラーを確認します。",
    badge: "収集管理",
    tone: "blue",
  },
  {
    href: "/ranking-admin",
    title: "ランキング安全管理",
    description: "現在掲載中の動画を確認し、規約違反動画をすべてのランキングから即時除外します。",
    badge: "緊急対応",
    tone: "amber",
  },
  {
    href: "/removal-requests-admin",
    title: "削除要請管理",
    description: "受け付けた削除要請を確認し、対応状況と管理メモを更新します。",
    badge: "要確認",
    tone: "amber",
  },
];

const reviewTools: ToolCard[] = [
  {
    href: "/teacher-authors",
    title: "参考アカウント教師レビュー",
    description: "登録済みの選別投稿者から保存済み動画を読み込み、S・A・その他・Xで教師データ化します。",
    badge: "今後も使用",
    tone: "green",
  },
  {
    href: "/review",
    title: "動画Tierレビュー",
    description: "収集済み動画を目視してTier評価します。ランキング品質を確認する中心画面です。",
    badge: "日常レビュー",
    tone: "green",
  },
  {
    href: "/content-filter-review",
    title: "除外判定レビュー",
    description: "AI生成・宣伝・グラビア・対象外などの自動除外が正しいか確認します。",
    badge: "必要時",
    tone: "amber",
  },
];

const modelTools: ToolCard[] = [
  {
    href: "/preference-model",
    title: "視覚好みモデル学習",
    description: "蓄積した教師データから視覚モデルを再学習し、精度を測定します。",
    badge: "教師データ追加後",
    tone: "blue",
  },
  {
    href: "/combined-ranking-preview",
    title: "現行＋視覚モデル比較",
    description: "現在のランキングと視覚モデルを組み合わせた順位を比較して、本番反映前に確認します。",
    badge: "反映前確認",
    tone: "blue",
  },
  {
    href: "/visual-filter-preview",
    title: "視覚フィルター確認",
    description: "成人向け・宣伝・サンプルなどの画像判定候補を確認するテスト画面です。",
    badge: "調整時",
    tone: "amber",
  },
];

const completedTools: ToolCard[] = [
  {
    href: "/visual-reference-review",
    title: "理想動画の参照評価",
    description: "外部ランキング由来の50件を使った初期参照評価です。通常は再実施しません。",
    badge: "初期データ",
    tone: "gray",
  },
  {
    href: "/site-visual-preference-review",
    title: "自サイト視覚評価・第1バッチ",
    description: "自サイト投稿の初回50件評価です。結果は既に学習データへ統合されています。",
    badge: "完了済み",
    tone: "gray",
  },
  {
    href: "/site-visual-preference-review-2",
    title: "自サイト視覚評価・第2バッチ",
    description: "重複しない追加50件の評価画面です。再評価するときだけ使用します。",
    badge: "完了済み",
    tone: "gray",
  },
  {
    href: "/site-visual-preference-review-3",
    title: "自サイト視覚評価・第3バッチ",
    description: "未使用データで精度を測るために作成した50件の評価画面です。",
    badge: "検証用",
    tone: "gray",
  },
];

function ToolSection({ id, title, note, tools }: { id?: string; title: string; note: string; tools: ToolCard[] }) {
  return (
    <section className="section" id={id}>
      <div className="sectionHeading">
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      <div className="grid">
        {tools.map((tool) => (
          <Link className={`card${tool.featured ? " featured" : ""}`} href={tool.href} key={tool.href}>
            <span className={`badge ${tool.tone}`}>{tool.badge}</span>
            <h3>{tool.title}</h3>
            <p>{tool.description}</p>
            <span className="open">画面を開く →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function LearningToolsPage() {
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus | null>(null);
  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/teacher-authors", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (active && payload.success) setTrainingStatus(payload.trainingStatus ?? null);
      })
      .catch(() => undefined);
    fetch("/api/local-admin-status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (active && payload.ok) setAdminStatus(payload as AdminStatus);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">OPERATIONS & LEARNING HUB</p>
        <h1>運営・学習管理</h1>
        <p className="lead">アクセス計測、X宣伝、収集、安全管理、レビュー、モデル学習の入口をこの画面に集約しています。</p>
        <div className="heroActions">
          <Link href="/engagement-admin">流入・計測を確認</Link>
          <Link href="/x-promotion">X宣伝を管理</Link>
        </div>
        <div className="notice"><strong>localhost専用</strong><span>この管理ポータルと各管理画面は、本番環境では404になり公開されません。</span></div>
      </header>

      {adminStatus && (
        <section className={`environmentStatus ${adminStatus.databaseConnected ? "connected" : "disconnected"}`}>
          <div>
            <strong>{adminStatus.databaseConnected ? "本番データ接続：正常" : "本番データ接続：未設定"}</strong>
            <span>
              {adminStatus.databaseConnected
                ? `${adminStatus.projectHost ?? "Supabase"} / 投稿 ${adminStatus.postCount?.toLocaleString("ja-JP") ?? 0}件`
                : adminStatus.error ?? ".env.local を確認してください。"}
            </span>
          </div>
          <div className="statusFacts">
            <span className={adminStatus.productionComparison?.sameDatabaseLikely ? "ok" : "warn"}>
              本番ランキング照合：{adminStatus.productionComparison?.checked
                ? `${adminStatus.productionComparison.matched}/${adminStatus.productionComparison.sampled}件一致`
                : "未確認"}
            </span>
            <span className="ok">ローカル管理：自動認証</span>
            <span className={adminStatus.configuration.xPublishing ? "ok" : "warn"}>X投稿認証：{adminStatus.configuration.xPublishing ? "設定済み" : "未設定"}</span>
            <span>視覚スコア保存済み：{adminStatus.visualScoreCount?.toLocaleString("ja-JP") ?? 0}件</span>
          </div>
        </section>
      )}

      <ToolSection id="operations" title="運営・アクセス管理" note="アクセス状況、集客、収集、安全対応を確認する管理画面です。" tools={operationTools} />

      {trainingStatus && (
        <section className={`trainingStatus ${trainingStatus.needsRetraining ? "ready" : "waiting"}`}>
          <div>
            <strong>{trainingStatus.needsRetraining ? `再学習を推奨：未反映の評価が${trainingStatus.reviewsSinceTraining}件あります` : `次の再学習まであと${trainingStatus.remainingUntilRetraining}件です`}</strong>
            <span>前回学習後 {trainingStatus.reviewsSinceTraining} / {trainingStatus.threshold}件</span>
          </div>
          <Link href="/preference-model">視覚モデル学習を開く →</Link>
        </section>
      )}

      <ToolSection title="レビューと教師データ" note="ランキング品質と学習データを日常的に整える画面です。" tools={reviewTools} />

      <section className="workflow">
        <h2>教師レビューを本番へ反映する手順</h2>
        <ol>
          <li><b>教師レビュー</b><span>選別投稿者を追加し、保存済み動画を評価</span></li>
          <li><b>モデル学習</b><span>評価が50〜100件増えた段階で再学習</span></li>
          <li><b>ランキング比較</b><span>順位の変化と巻き込みを確認</span></li>
          <li><b>本番用に保存</b><span>比較画面の保存ボタンでSupabaseへ反映</span></li>
        </ol>
        <p className="workflowNote"><b>動画Tierレビュー</b>は保存時点で本番ランキングへ直接反映します。<b>教師レビュー</b>は上の4段階を完了した後、24時間・週間ランキングの同一Tier内の並び順へ20%の重みで反映します。</p>
      </section>

      <ToolSection title="学習と反映前確認" note="教師データが増えたときや、モデル調整を行うときに使います。" tools={modelTools} />
      <ToolSection title="初期評価・検証用" note="過去の評価セットです。結果確認や再検証が必要な場合だけ開きます。" tools={completedTools} />

      <nav className="footerNav">
        <Link href="/">ランキングを見る</Link>
        <Link href="/removal-request">公開中の削除要請フォーム</Link>
        <a href="#operations">運営管理へ戻る</a>
      </nav>

      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f4f6f8; color: #18202a; }
        .shell { max-width: 1120px; margin: 0 auto; padding: 42px 22px 70px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
        .hero { padding: 32px; color: white; border-radius: 24px; background: linear-gradient(135deg, #172033 0%, #273a59 55%, #176b62 100%); box-shadow: 0 18px 50px rgba(23, 32, 51, .18); }
        .eyebrow { margin: 0 0 8px; color: #90f0d1; font-size: 12px; font-weight: 900; letter-spacing: .16em; }
        h1 { margin: 0; font-size: clamp(32px, 5vw, 52px); letter-spacing: -.04em; }
        .lead { max-width: 720px; margin: 13px 0 22px; color: #dce8ef; font-size: 17px; line-height: 1.75; }
        .heroActions { display: flex; gap: 9px; flex-wrap: wrap; margin: 0 0 16px; }
        .heroActions a { padding: 11px 15px; color: #123c36; text-decoration: none; border-radius: 10px; background: #9ff3d9; font-size: 13px; font-weight: 900; }
        .heroActions a + a { color: white; border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.1); }
        .notice { display: flex; gap: 12px; align-items: center; width: fit-content; max-width: 100%; padding: 11px 14px; border: 1px solid rgba(255,255,255,.18); border-radius: 12px; background: rgba(255,255,255,.09); font-size: 13px; }
        .notice strong { white-space: nowrap; color: #9ff3d9; }
        .workflow, .section { margin-top: 28px; }
        .environmentStatus { display: flex; justify-content: space-between; gap: 18px; margin-top: 20px; padding: 18px 20px; border-radius: 15px; }
        .environmentStatus.connected { color: #165c51; border: 1px solid #b9ddd4; background: #edf8f5; }
        .environmentStatus.disconnected { color: #7c4e00; border: 1px solid #e7c876; background: #fff7dc; }
        .environmentStatus strong, .environmentStatus span { display: block; }
        .environmentStatus > div:first-child span { margin-top: 5px; font-size: 13px; opacity: .82; }
        .statusFacts { display: grid; grid-template-columns: repeat(2, auto); gap: 6px 16px; align-content: center; font-size: 12px; font-weight: 800; }
        .statusFacts .ok::before { content: "✓ "; color: #177d70; }
        .statusFacts .warn::before { content: "△ "; color: #b06a00; }
        .trainingStatus { display: flex; justify-content: space-between; align-items: center; gap: 18px; margin-top: 20px; padding: 17px 20px; border-radius: 15px; }
        .trainingStatus.ready { color: #6d4100; border: 2px solid #dc930e; background: #fff3ce; }
        .trainingStatus.waiting { color: #165c51; border: 1px solid #b9ddd4; background: #edf8f5; }
        .trainingStatus strong, .trainingStatus span { display: block; }
        .trainingStatus span { margin-top: 4px; font-size: 13px; opacity: .8; }
        .trainingStatus a { flex: 0 0 auto; padding: 10px 14px; color: white; text-decoration: none; border-radius: 9px; background: #177d70; font-weight: 900; }
        .workflow { padding: 24px; border: 1px solid #dfe5ea; border-radius: 18px; background: white; }
        .workflow h2, .sectionHeading h2 { margin: 0; font-size: 22px; }
        .workflow ol { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 0; margin: 18px 0 0; list-style: none; counter-reset: step; }
        .workflow li { position: relative; min-height: 105px; padding: 17px 15px 14px 48px; border-radius: 13px; background: #f2f7f6; counter-increment: step; }
        .workflow li::before { content: counter(step); position: absolute; left: 14px; top: 14px; display: grid; place-items: center; width: 25px; height: 25px; color: white; border-radius: 50%; background: #177d70; font-weight: 900; }
        .workflow b, .workflow span { display: block; }
        .workflow span { margin-top: 6px; color: #5c6874; font-size: 13px; line-height: 1.55; }
        .workflowNote { margin: 16px 0 0; padding: 13px 15px; color: #4d5c68; border-left: 4px solid #177d70; background: #f6f9f9; font-size: 13px; line-height: 1.75; }
        .workflowNote b { display: inline; color: #1f3f3a; }
        .sectionHeading { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 13px; }
        .sectionHeading p { max-width: 590px; margin: 0; color: #65717d; font-size: 14px; text-align: right; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .card { display: flex; min-height: 205px; flex-direction: column; padding: 20px; color: inherit; text-decoration: none; border: 1px solid #dfe5ea; border-radius: 17px; background: white; box-shadow: 0 5px 18px rgba(25, 38, 52, .04); transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
        .card.featured { border: 2px solid #7fc6b9; background: linear-gradient(160deg, #fff 35%, #effaf7 100%); }
        .card:hover { transform: translateY(-2px); border-color: #9bbfb9; box-shadow: 0 11px 26px rgba(25, 38, 52, .09); }
        .badge { align-self: flex-start; padding: 5px 9px; border-radius: 999px; font-size: 11px; font-weight: 900; }
        .badge.green { color: #126456; background: #dff7ef; }
        .badge.blue { color: #285a94; background: #e4effc; }
        .badge.amber { color: #815b0d; background: #fff1cc; }
        .badge.gray { color: #5f6870; background: #edf0f2; }
        .card h3 { margin: 15px 0 8px; font-size: 18px; }
        .card p { margin: 0; color: #65717d; font-size: 14px; line-height: 1.65; }
        .open { margin-top: auto; padding-top: 16px; color: #177d70; font-size: 13px; font-weight: 900; }
        .footerNav { display: flex; gap: 12px; margin-top: 30px; }
        .footerNav a { padding: 11px 15px; color: #25384c; text-decoration: none; border: 1px solid #d6dde3; border-radius: 10px; background: white; font-weight: 800; }
        @media (max-width: 820px) { .workflow ol, .grid { grid-template-columns: repeat(2, 1fr); } .sectionHeading { display: block; } .sectionHeading p { margin-top: 6px; text-align: left; } }
        @media (max-width: 560px) { .shell { padding: 18px 13px 45px; } .hero { padding: 24px 20px; border-radius: 18px; } .notice, .trainingStatus, .environmentStatus { display: block; } .notice span { display: block; margin-top: 5px; } .trainingStatus a { display: inline-block; margin-top: 12px; } .statusFacts { grid-template-columns: 1fr; margin-top: 12px; } .workflow ol, .grid { grid-template-columns: 1fr; } .footerNav { flex-direction: column; } }
      `}</style>
    </main>
  );
}
