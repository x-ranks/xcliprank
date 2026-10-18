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
        <p>Xclipが掲載するのは、X（旧Twitter）の公開投稿情報と動画へのURL情報です。動画はXの配信元から利用者の端末へ直接読み込まれ、Xclipでは動画ファイルの保管・再アップロードを行いません。著作権その他の権利は、投稿者または正当な権利者に帰属します。投稿の削除・非公開化、アカウントの状態、外部サービスの仕様変更により、動画を利用できなくなることがあります。</p>
      </section>
      <section className="legal-section legal-callout">
        <h2>動画の保存について</h2>
        <p>権利者が保存を許可した動画のみ利用してください。X上で公開されていることは保存・転載の許可を意味しません。違法な動画、権利侵害・非同意の動画、未成年者の性的な動画の保存は禁止します。許可のない転載・再配布も禁止します。</p>
        <p>保存機能は権利者の許諾やコンテンツの適法性を保証するものではありません。許可を確認できない場合は保存を行わず、問題がある投稿は削除要請フォームから報告してください。</p>
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

