"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function RemovalRequestPage() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/removal-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "送信に失敗しました。");
      form.reset();
      setMessage({ tone: "success", text: `削除要請を受け付けました。受付番号：${payload.requestCode}` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "送信に失敗しました。" });
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="removal-shell">
      <header className="removal-header">
        <Link href="/">← X CLIP RANKへ戻る</Link>
        <h1>削除要請フォーム</h1>
        <p>違法性、著作権・プライバシー侵害、本人の同意がない掲載などが疑われるX投稿について、確認を依頼できます。</p>
      </header>

      <div className="removal-notice">
        当サイトはX上の公開投稿情報・動画URLを取得し、再生・端末への保存時に動画を中継します。動画本体を当サイトのサーバーに恒久保存・再アップロードするサービスではありません。申請内容を確認後、当サイトのランキング表示からの除外を判断します。X上の投稿自体を削除する場合は、Xへの報告も行ってください。
      </div>

      {message && <div className={`removal-message ${message.tone}`} role="status">{message.text}</div>}

      <form className="removal-form" onSubmit={submit}>
        <div className="removal-field">
          <label htmlFor="reportedUrl">対象のX投稿URL</label>
          <input id="reportedUrl" name="reportedUrl" type="url" required placeholder="https://x.com/username/status/123..." maxLength={300} />
          <small>x.com または twitter.com の投稿URLを入力してください。</small>
        </div>

        <div className="removal-field">
          <label htmlFor="reason">削除を求める理由</label>
          <select id="reason" name="reason" required defaultValue="">
            <option value="" disabled>理由を選択</option>
            <option value="illegal">違法と思われる内容</option>
            <option value="minor">未成年者に関する内容</option>
            <option value="nonconsensual">本人の同意がない・プライバシー侵害</option>
            <option value="copyright">著作権・その他の権利侵害</option>
            <option value="other">その他</option>
          </select>
        </div>

        <div className="removal-field">
          <label htmlFor="details">詳細</label>
          <textarea id="details" name="details" required minLength={20} maxLength={1500} placeholder="問題と思われる箇所と、削除が必要な理由を具体的に記載してください。" />
        </div>

        <div className="removal-field">
          <label htmlFor="contactEmail">返信用メールアドレス</label>
          <input id="contactEmail" name="contactEmail" type="email" required maxLength={254} autoComplete="email" />
          <small>申請内容の確認以外には使用しません。</small>
        </div>

        <div className="removal-honeypot" aria-hidden="true">
          <label htmlFor="website">ウェブサイト</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label className="removal-consent">
          <input name="confirmed" type="checkbox" value="yes" required />
          <span>入力内容が正確であり、善意に基づく削除要請であることを確認します。</span>
        </label>

        <button className="removal-submit" type="submit" disabled={sending}>{sending ? "送信中…" : "削除要請を送信"}</button>
      </form>
    </main>
  );
}
