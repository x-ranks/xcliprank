"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const SECRET_KEY = "engagement-admin-cron-secret";
const LOCAL_DEVELOPMENT = process.env.NODE_ENV !== "production";
const LOCAL_AUTH_VALUE = "local-development";
const RANGE_LABELS: Record<string, string> = {
  trending: "新着",
  daily: "24時間",
  weekly: "週間",
  reels: "おすすめリール",
  unknown: "未分類",
};

type DailyRow = {
  date: string;
  users: number;
  sessions: number;
  xSessions: number;
  videoOpen: number;
  qualifiedView: number;
  rankingChange: number;
  outboundX: number;
};

type Stats = {
  ok: true;
  days: 7 | 30;
  since: string;
  timezone: string;
  truncated: boolean;
  totals: {
    events: number;
    pageView: number;
    users: number;
    sessions: number;
    xSessions: number;
    videoOpen: number;
    qualifiedView: number;
    rankingChange: number;
    outboundX: number;
    opensPerSession: number;
    qualificationRate: number;
  };
  daily: DailyRow[];
  rangeOpens: Record<string, number>;
  acquisitionSessions: Record<string, number>;
  xContentSessions: Record<string, number>;
};

function number(value: number) {
  return value.toLocaleString("ja-JP");
}

function acquisitionLabel(key: string) {
  if (key === "x") return "X";
  if (key === "direct") return "直接・不明";
  if (key.startsWith("campaign:")) return `キャンペーン: ${key.slice(9)}`;
  if (key.startsWith("referral:")) return `参照元: ${key.slice(9)}`;
  return key;
}

export default function EngagementAdminPage() {
  const [secret, setSecret] = useState(
    LOCAL_DEVELOPMENT ? LOCAL_AUTH_VALUE : ""
  );
  const [secretInput, setSecretInput] = useState("");
  const [days, setDays] = useState<7 | 30>(7);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (LOCAL_DEVELOPMENT) return;
    const stored = window.sessionStorage.getItem(SECRET_KEY) ?? "";
    if (stored) {
      setSecret(stored);
      setSecretInput(stored);
    }
  }, []);

  useEffect(() => {
    if (secret) void load(secret, days);
  }, [secret, days]);

  async function load(value = secret, selectedDays = days) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/engagement-stats?days=${selectedDays}`, {
        headers: { Authorization: `Bearer ${value}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(
          response.status === 401
            ? "CRON_SECRETが正しくありません。"
            : payload.error ?? "計測データを取得できませんでした。"
        );
      }
      setStats(payload);
    } catch (caught) {
      setStats(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "計測データを取得できませんでした。"
      );
    } finally {
      setLoading(false);
    }
  }

  function unlock() {
    const value = secretInput.trim();
    if (!value) return;
    window.sessionStorage.setItem(SECRET_KEY, value);
    setSecret(value);
  }

  function lock() {
    window.sessionStorage.removeItem(SECRET_KEY);
    setSecret("");
    setSecretInput("");
    setStats(null);
    setError("");
  }

  const rangeRows = useMemo(() => {
    if (!stats) return [];
    const total = Object.values(stats.rangeOpens).reduce((sum, value) => sum + value, 0);
    return Object.entries(stats.rangeOpens)
      .map(([key, value]) => ({
        key,
        label: RANGE_LABELS[key] ?? key,
        value,
        share: total > 0 ? (value / total) * 100 : 0,
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [stats]);

  const acquisitionRows = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.acquisitionSessions)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);
  }, [stats]);

  const xContentRows = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.xContentSessions ?? {})
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);
  }, [stats]);

  if (!secret) {
    return (
      <main className="engagement-login">
        <p className="engagement-eyebrow">PRIVATE ANALYTICS</p>
        <h1>サイト内計測</h1>
        <p>CRON_SECRETを入力してください。値はこのタブの間だけ保持します。</p>
        <input
          type="password"
          value={secretInput}
          onChange={(event) => setSecretInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") unlock();
          }}
          autoComplete="current-password"
        />
        <button type="button" onClick={unlock}>
          計測画面を開く
        </button>
      </main>
    );
  }

  return (
    <main className="engagement-admin">
      <header className="engagement-header">
        <div>
          <Link href="/learning-tools">← 学習・レビュー管理へ戻る</Link>
          <p className="engagement-eyebrow">PRIVATE ANALYTICS</p>
          <h1>サイト内計測</h1>
          <p>動画発見と回遊の状況を、匿名の集計値で確認します。</p>
        </div>
        {!LOCAL_DEVELOPMENT && (
          <button type="button" className="engagement-lock" onClick={lock}>
            ロック
          </button>
        )}
      </header>

      <div className="engagement-toolbar">
        <div className="engagement-period" aria-label="集計期間">
          {[7, 30].map((value) => (
            <button
              key={value}
              type="button"
              className={days === value ? "active" : ""}
              onClick={() => setDays(value as 7 | 30)}
              disabled={loading}
            >
              {value}日間
            </button>
          ))}
        </div>
        <button type="button" onClick={() => load()} disabled={loading}>
          {loading ? "更新中…" : "再読込"}
        </button>
      </div>

      {error && <div className="engagement-error">{error}</div>}
      {stats?.truncated && (
        <div className="engagement-warning">
          10万件を超えたため、表示は先頭10万件の集計です。
        </div>
      )}

      {stats && (
        <>
          <section className="engagement-kpis" aria-label="主要指標">
            {[
              ["匿名ユーザー", stats.totals.users, "期間内の端末単位"],
              ["訪問", stats.totals.sessions, "ブラウザのタブ単位"],
              ["動画オープン", stats.totals.videoOpen, "動画を開いた回数"],
              ["5秒視聴", stats.totals.qualifiedView, "5秒到達した回数"],
              ["1訪問あたり", stats.totals.opensPerSession, "動画オープン数"],
              ["Xからの流入", stats.totals.xSessions, "判定できた訪問数"],
            ].map(([label, value, note]) => (
              <article key={String(label)}>
                <span>{label}</span>
                <strong>{number(Number(value))}</strong>
                <small>{note}</small>
              </article>
            ))}
          </section>

          <section className="engagement-insights">
            <article>
              <span>5秒視聴率</span>
              <strong>{stats.totals.qualificationRate.toFixed(1)}%</strong>
              <small>5秒視聴 ÷ 動画オープン</small>
            </article>
            <article>
              <span>Xへ移動</span>
              <strong>{number(stats.totals.outboundX)}</strong>
              <small>サイトからX投稿を開いた回数</small>
            </article>
            <article>
              <span>ランキング切替</span>
              <strong>{number(stats.totals.rankingChange)}</strong>
              <small>タブを切り替えた回数</small>
            </article>
          </section>

          <section className="engagement-panel">
            <div className="engagement-panel-heading">
              <div>
                <h2>日別推移</h2>
                <p>日付は日本時間です。</p>
              </div>
            </div>
            {stats.daily.length === 0 ? (
              <p className="engagement-empty">期間内の計測データはまだありません。</p>
            ) : (
              <div className="engagement-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>ユーザー</th>
                      <th>訪問</th>
                      <th>動画オープン</th>
                      <th>5秒視聴</th>
                      <th>X流入</th>
                      <th>Xへ移動</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...stats.daily].reverse().map((row) => (
                      <tr key={row.date}>
                        <th>{row.date}</th>
                        <td>{number(row.users)}</td>
                        <td>{number(row.sessions)}</td>
                        <td>{number(row.videoOpen)}</td>
                        <td>{number(row.qualifiedView)}</td>
                        <td>{number(row.xSessions)}</td>
                        <td>{number(row.outboundX)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="engagement-two-columns">
            <section className="engagement-panel">
              <div className="engagement-panel-heading">
                <div>
                  <h2>ランキング別の利用率</h2>
                  <p>動画オープンを基準に集計します。</p>
                </div>
              </div>
              {rangeRows.length === 0 ? (
                <p className="engagement-empty">動画オープンはまだありません。</p>
              ) : (
                <div className="engagement-bars">
                  {rangeRows.map((row) => (
                    <div key={row.key}>
                      <div>
                        <strong>{row.label}</strong>
                        <span>
                          {number(row.value)}回 / {row.share.toFixed(1)}%
                        </span>
                      </div>
                      <progress max="100" value={row.share} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="engagement-panel">
              <div className="engagement-panel-heading">
                <div>
                  <h2>流入元</h2>
                  <p>UTMと参照元から訪問単位で判定します。</p>
                </div>
              </div>
              {acquisitionRows.length === 0 ? (
                <p className="engagement-empty">流入データはまだありません。</p>
              ) : (
                <div className="engagement-source-list">
                  {acquisitionRows.map((row) => (
                    <div key={row.key}>
                      <span>{acquisitionLabel(row.key)}</span>
                      <strong>{number(row.value)}訪問</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="engagement-panel">
            <div className="engagement-panel-heading">
              <div>
                <h2>X投稿別の流入</h2>
                <p>投稿URLのutm_contentごとに、重複しない訪問数を表示します。</p>
              </div>
            </div>
            {xContentRows.length === 0 ? (
              <p className="engagement-empty">識別できるX流入はまだありません。</p>
            ) : (
              <div className="engagement-source-list">
                {xContentRows.map((row) => (
                  <div key={row.key}>
                    <span>{row.key}</span>
                    <strong>{number(row.value)}訪問</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="engagement-footnote">
            X流入の正確な判定は、この版の公開後に発生したアクセスから始まります。広告ブロックやブラウザ制限により実数と差が出る場合があります。
          </p>
        </>
      )}
    </main>
  );
}
