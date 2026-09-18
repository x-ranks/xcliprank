"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type RequestStatus = "pending" | "reviewing" | "resolved" | "closed";

type ContactRequest = {
  id: number;
  request_code: string;
  category: string;
  name: string | null;
  contact_email: string;
  subject: string;
  details: string;
  status: RequestStatus;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

const SECRET_KEY = "contact-requests-cron-secret";
const categoryLabels: Record<string, string> = {
  advertising: "広告掲載",
  partnership: "提携・掲載依頼",
  technical: "サイトの不具合",
  other: "その他",
};
const statusLabels: Record<RequestStatus, string> = {
  pending: "未対応",
  reviewing: "確認中",
  resolved: "対応済み",
  closed: "終了",
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ja-JP") : "—";
}

export default function ContactRequestsAdminPage() {
  const [secret, setSecret] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [filter, setFilter] = useState<"all" | RequestStatus>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    const stored = window.sessionStorage.getItem(SECRET_KEY) ?? "";
    if (stored) {
      setSecret(stored);
      setSecretInput(stored);
    }
  }, []);

  const loadRequests = useCallback(async (value = secret, quiet = false) => {
    if (!value) return;
    if (!quiet) setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/contact-requests", {
        headers: { Authorization: `Bearer ${value}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "取得に失敗しました。");
      }

      setRequests(payload.requests);
      setNotes((current) => {
        const next = { ...current };
        for (const item of payload.requests as ContactRequest[]) {
          if (!(item.request_code in next)) {
            next[item.request_code] = item.review_note ?? "";
          }
        }
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取得に失敗しました。");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [secret]);

  useEffect(() => {
    if (!secret) return;
    void loadRequests(secret);
    const timer = window.setInterval(() => void loadRequests(secret, true), 30_000);
    return () => window.clearInterval(timer);
  }, [secret, loadRequests]);

  const counts = useMemo(() => ({
    total: requests.length,
    pending: requests.filter((item) => item.status === "pending").length,
    reviewing: requests.filter((item) => item.status === "reviewing").length,
    resolved: requests.filter((item) => item.status === "resolved").length,
    closed: requests.filter((item) => item.status === "closed").length,
  }), [requests]);

  const visibleRequests = useMemo(
    () => filter === "all" ? requests : requests.filter((item) => item.status === filter),
    [filter, requests]
  );

  useEffect(() => {
    document.title = counts.pending > 0
      ? `(${counts.pending}) 新着の問い合わせ | X CLIP RANK`
      : "問い合わせ管理 | X CLIP RANK";
  }, [counts.pending]);

  function unlock() {
    const value = secretInput.trim();
    if (!value) return;
    window.sessionStorage.setItem(SECRET_KEY, value);
    setSecret(value);
  }

  async function updateStatus(item: ContactRequest, status: RequestStatus) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/contact-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          requestCode: item.request_code,
          status,
          reviewNote: notes[item.request_code] ?? "",
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "更新に失敗しました。");
      }

      setMessage(`受付 ${item.request_code.slice(0, 8)}… を「${statusLabels[status]}」に更新しました。`);
      await loadRequests(secret, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  if (!secret) {
    return (
      <main className="removal-admin-login">
        <h1>問い合わせ管理</h1>
        <p>CRON_SECRETを入力してください。このタブを閉じると入力内容は消えます。</p>
        <input
          type="password"
          value={secretInput}
          onChange={(event) => setSecretInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") unlock(); }}
        />
        <button type="button" onClick={unlock}>管理画面を開く</button>
      </main>
    );
  }

  return (
    <main className="removal-admin">
      <header className="removal-admin-header">
        <div>
          <Link href="/learning-tools">← 運営・学習管理へ戻る</Link>
          <h1>問い合わせ管理</h1>
          <p>30秒ごとに新しい問い合わせを確認します。</p>
        </div>
        <button type="button" disabled={loading} onClick={() => loadRequests()}>
          {loading ? "更新中…" : "今すぐ更新"}
        </button>
      </header>

      {counts.pending > 0 ? (
        <div className="removal-alert">
          <strong>新しい問い合わせが {counts.pending} 件あります</strong>
          <span>内容を確認して対応状況を更新してください。</span>
        </div>
      ) : (
        <div className="removal-alert removal-alert-clear">
          <strong>未対応の問い合わせはありません</strong>
        </div>
      )}

      {error && <div className="removal-admin-error">{error}</div>}
      {message && <div className="removal-admin-message">{message}</div>}

      <section className="removal-summary">
        {([
          ["all", "全件", counts.total],
          ["pending", "未対応", counts.pending],
          ["reviewing", "確認中", counts.reviewing],
          ["resolved", "対応済み", counts.resolved],
          ["closed", "終了", counts.closed],
        ] as const).map(([key, label, value]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
          >
            <span>{label}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </section>

      <section className="removal-admin-list">
        {visibleRequests.length === 0 && (
          <div className="removal-empty">該当する問い合わせはありません。</div>
        )}

        {visibleRequests.map((item) => (
          <article
            key={item.request_code}
            className={`removal-admin-card ${item.status === "pending" ? "is-new" : ""}`}
          >
            <div className="removal-card-top">
              <div>
                <span className={`removal-status status-${item.status}`}>
                  {item.status === "pending" ? "● 新着・未対応" : statusLabels[item.status]}
                </span>
                <strong>{categoryLabels[item.category] ?? item.category}</strong>
              </div>
              <time>{formatDate(item.created_at)}</time>
            </div>

            <h2>{item.subject}</h2>
            <p className="removal-details">{item.details}</p>

            <dl className="removal-meta">
              <div><dt>お名前・会社名</dt><dd>{item.name || "—"}</dd></div>
              <div><dt>返信先</dt><dd><a href={`mailto:${item.contact_email}`}>{item.contact_email}</a></dd></div>
              <div><dt>受付番号</dt><dd>{item.request_code}</dd></div>
              <div><dt>対応日時</dt><dd>{formatDate(item.reviewed_at)}</dd></div>
            </dl>

            <label className="removal-note">
              管理メモ
              <textarea
                value={notes[item.request_code] ?? ""}
                onChange={(event) => setNotes((current) => ({
                  ...current,
                  [item.request_code]: event.target.value,
                }))}
                maxLength={1000}
                placeholder="返信内容や対応結果を記録できます"
              />
            </label>

            <div className="removal-actions">
              <button type="button" disabled={loading} onClick={() => updateStatus(item, "reviewing")}>確認中にする</button>
              <button type="button" disabled={loading} className="action-done" onClick={() => updateStatus(item, "resolved")}>対応済みにする</button>
              <button type="button" disabled={loading} className="action-reject" onClick={() => updateStatus(item, "closed")}>終了にする</button>
              {item.status !== "pending" && (
                <button type="button" disabled={loading} onClick={() => updateStatus(item, "pending")}>未対応に戻す</button>
              )}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
