import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = {
  title: "著作権・削除方針",
  description: "X CLIP RANKの著作権・プライバシー侵害等に関する削除申請手順です。",
  alternates: { canonical: "/copyright" },
  robots: { index: false, follow: true },
};

export default function CopyrightPage() {
  return (
    <LegalPage title="著作権・削除方針" lead="権利侵害、違法な内容、同意のない掲載などが疑われる場合の対応方針です。">
      <section className="legal-section">
        <h2>当サイトでの表示</h2>
        <p>当サイトはX上の公開投稿を参照して表示し、動画ファイル自体を保存・再アップロードしません。投稿が削除・非公開化された場合は、当サイト上でも利用できなくなることがあります。</p>
      </section>
      <section className="legal-section">
        <h2>申請できる内容</h2>
        <ul>
          <li>著作権、肖像権、プライバシーその他の権利侵害</li>
          <li>本人の同意がない、または非同意が疑われる公開</li>
          <li>未成年者が関係する疑いのある内容</li>
          <li>違法性が疑われる内容</li>
        </ul>
      </section>
      <section className="legal-section legal-callout">
        <h2>削除要請の方法</h2>
        <p><Link href="/removal-request">削除要請フォーム</Link>へ対象のX投稿URL、理由、具体的な説明、返信用メールアドレスを入力してください。内容を確認し、当サイトのランキング・表示対象からの除外を判断します。追加確認をお願いする場合があります。</p>
      </section>
      <section className="legal-section">
        <h2>X上の元投稿</h2>
        <p>当サイトから除外しても、X上の元投稿自体は削除されません。元投稿の削除が必要な場合は、Xの報告・権利侵害申請もあわせて利用してください。</p>
      </section>
      <section className="legal-section">
        <h2>虚偽申請の禁止</h2>
        <p>第三者になりすました申請や、妨害目的の虚偽申請は行わないでください。申請情報は確認と対応のためにのみ利用します。</p>
      </section>
    </LegalPage>
  );
}
