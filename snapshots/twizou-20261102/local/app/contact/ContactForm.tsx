"use client";

import { FormEvent, useState } from "react";

export default function ContactForm() {
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
      const response = await fetch("/api/contact-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "送信に失敗しました。");
      }

      form.reset();
      setMessage({
        tone: "success",
        text: `お問い合わせを受け付けました。受付番号：${payload.requestCode}`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "送信に失敗しました。",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {message && (
        <div className={`removal-message ${message.tone}`} role="status">
          {message.text}
        </div>
      )}

      <form className="removal-form" onSubmit={submit}>
        <div className="removal-field">
          <label htmlFor="category">お問い合わせ種別</label>
          <select id="category" name="category" required defaultValue="">
            <option value="" disabled>種別を選択</option>
            <option value="advertising">広告掲載について</option>
            <option value="partnership">提携・掲載依頼について</option>
            <option value="technical">サイトの不具合について</option>
            <option value="other">その他</option>
          </select>
        </div>

        <div className="removal-field">
          <label htmlFor="name">お名前・会社名（任意）</label>
          <input id="name" name="name" type="text" maxLength={100} autoComplete="name" />
        </div>

        <div className="removal-field">
          <label htmlFor="contactEmail">返信用メールアドレス</label>
          <input id="contactEmail" name="contactEmail" type="email" required maxLength={254} autoComplete="email" />
          <small>お問い合わせへの返信以外には使用しません。</small>
        </div>

        <div className="removal-field">
          <label htmlFor="subject">件名</label>
          <input id="subject" name="subject" type="text" required minLength={3} maxLength={120} />
        </div>

        <div className="removal-field">
          <label htmlFor="details">お問い合わせ内容</label>
          <textarea id="details" name="details" required minLength={20} maxLength={2000} placeholder="お問い合わせ内容を20文字以上で入力してください。" />
        </div>

        <div className="removal-honeypot" aria-hidden="true">
          <label htmlFor="website">ウェブサイト</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label className="removal-consent">
          <input name="confirmed" type="checkbox" value="yes" required />
          <span>入力内容とプライバシーポリシーを確認しました。</span>
        </label>

        <button className="removal-submit" type="submit" disabled={sending}>
          {sending ? "送信中…" : "問い合わせを送信"}
        </button>
      </form>
    </>
  );
}
