import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = {
  title: "利用規約",
  description: "X CLIP RANKの利用条件を説明します。",
  alternates: { canonical: "/terms" },
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage title="利用規約" lead="X CLIP RANKを利用する前に、以下の条件をご確認ください。">
      <section className="legal-section legal-callout">
        <h2>年齢制限</h2>
        <p>当サイトは18歳以上で、かつ居住地域の法令上成人向けコンテンツを閲覧できる方のみ利用できます。</p>
      </section>
      <section className="legal-section">
        <h2>サービスの内容</h2>
        <p>Xclipは、X（旧Twitter）の公開投稿情報・動画URLを取得し、独自の基準によるランキング、動画の閲覧、端末への保存補助機能を提供します。再生・保存する動画はXの配信元から利用者の端末へ直接読み込まれ、Xclipでは動画ファイルの保管・再アップロードを行いません。ランキングへの掲載は、内容の推奨や適法性の保証、投稿者との提携を意味しません。</p>
      </section>
      <section className="legal-section">
        <h2>禁止事項</h2>
        <ul>
          <li>法令、第三者の権利または公序良俗に反する利用</li>
          <li>違法な動画、権利侵害・非同意の動画、未成年者の性的な動画の保存</li>
          <li>権利者による保存の許可を確認できない動画の保存、および許可のない転載・再配布</li>
          <li>自動操作、連打、虚偽の申請などによるランキング・計測・運営の妨害</li>
          <li>当サイトや外部サービスへ過度な負荷を与える行為</li>
          <li>セキュリティ上の制限を回避する行為</li>
        </ul>
      </section>
      <section className="legal-section">
        <h2>外部コンテンツと免責</h2>
        <p>元投稿の内容、公開状態、再生可否はXおよび投稿者側の状態に依存します。当サイトは正確性、継続公開、特定目的への適合を保証しません。法令上認められない場合を除き、利用により生じた間接的損害について責任を負いません。</p>
      </section>
      <section className="legal-section">
        <h2>変更・停止</h2>
        <p>安全性、法令、外部サービスの仕様、運営上の必要に応じて、機能や本規約を変更・停止する場合があります。重要な変更は本ページで告知します。</p>
      </section>
      <section className="legal-section">
        <h2>権利に関する申請</h2>
        <p>掲載内容に問題がある場合は<Link href="/copyright">著作権・削除方針</Link>を確認し、<Link href="/removal-request">削除要請フォーム</Link>から申請してください。</p>
      </section>
    </LegalPage>
  );
}

