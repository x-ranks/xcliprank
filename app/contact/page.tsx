import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../components/LegalPage";
import ContactForm from "./ContactForm";

export const metadata: Metadata = {
  title: "お問い合わせ",
  description: "X CLIP RANKへのお問い合わせフォームです。",
  alternates: { canonical: "/contact" },
  robots: { index: false, follow: true },
};

export default function ContactPage() {
  return (
    <LegalPage title="お問い合わせ" lead="公開メールアドレスを使用せず、以下のフォームからお問い合わせを受け付けます。">
      <section className="legal-section legal-callout">
        <h2>掲載内容・権利・削除</h2>
        <p>
          著作権、プライバシー、本人の同意、違法性、未成年者に関する申請は、
          <Link href="/removal-request">削除要請フォーム</Link>
          から送信してください。
        </p>
      </section>
      <section className="legal-section">
        <h2>広告・提携・技術的な問題・その他</h2>
        <p>返信が必要なお問い合わせは、内容を確認したうえで入力されたメールアドレスへご連絡します。</p>
        <ContactForm />
      </section>
      <section className="legal-section">
        <h2>ご注意</h2>
        <p>パスワード、認証コード、秘密鍵、クレジットカード番号などの機密情報は入力しないでください。営業内容によっては返信しない場合があります。</p>
      </section>
    </LegalPage>
  );
}
