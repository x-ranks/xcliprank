import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = {
  title: "お問い合わせ",
  description: "X CLIP RANKへのお問い合わせ窓口をご案内します。",
  alternates: { canonical: "/contact" },
  robots: { index: false, follow: true },
};

export default function ContactPage() {
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();

  return (
    <LegalPage title="お問い合わせ" lead="内容に応じて、以下の窓口をご利用ください。">
      <section className="legal-section legal-callout">
        <h2>掲載内容・権利・削除</h2>
        <p>著作権、プライバシー、本人の同意、違法性、未成年者に関する申請は、<Link href="/removal-request">削除要請フォーム</Link>から送信してください。</p>
      </section>
      <section className="legal-section">
        <h2>広告・提携・その他</h2>
        {contactEmail ? (
          <p><a href={`mailto:${contactEmail}`}>{contactEmail}</a>へご連絡ください。内容を確認し、必要な場合に返信します。</p>
        ) : (
          <p>公開連絡先は現在準備中です。実在する受信可能な窓口を確認後、このページに掲載します。削除・権利に関する連絡は上記フォームで受け付けています。</p>
        )}
      </section>
      <section className="legal-section">
        <h2>ご注意</h2>
        <p>投稿の削除・非公開化などX上のアカウントや投稿自体に関する操作は、Xの公式窓口もご利用ください。返信を装う不審な連絡や、秘密鍵・パスワードの要求には応じないでください。</p>
      </section>
    </LegalPage>
  );
}
