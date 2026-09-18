import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description: "X CLIP RANKにおけるアクセス情報・削除申請情報などの取扱いを説明します。",
  alternates: { canonical: "/privacy" },
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="プライバシーポリシー" lead="当サイトが取得する情報、その利用目的、外部サービスとの関係を説明します。">
      <section className="legal-section">
        <h2>取得する情報</h2>
        <ul>
          <li>閲覧ページ、流入元、UTMパラメータ、動画のOPENや視聴などの匿名または仮名化された利用情報</li>
          <li>端末・ブラウザ種別、IPアドレスなど、配信・不正防止・障害調査に必要な技術情報</li>
          <li>削除要請時に入力された対象URL、理由、詳細、返信用メールアドレス</li>
          <li>問い合わせフォームに入力された名前、返信用メールアドレス、件名、問い合わせ内容</li>
          <li>18歳確認の回答を端末内に保持するローカルストレージ情報</li>
        </ul>
      </section>
      <section className="legal-section">
        <h2>利用目的</h2>
        <p>ランキングと閲覧体験の改善、アクセス傾向の把握、不正利用の防止、障害対応、削除・権利侵害申請および一般の問い合わせへの対応に利用します。取得情報を、本人の同意なく第三者へ販売することはありません。</p>
      </section>
      <section className="legal-section">
        <h2>利用する外部サービス</h2>
        <p>サイト配信・解析にVercel、データ管理にSupabase、元投稿の表示にXを利用します。各サービスによる情報の取扱いには、それぞれの規約・ポリシーが適用される場合があります。</p>
      </section>
      <section className="legal-section">
        <h2>保存期間と安全管理</h2>
        <p>情報は利用目的に必要な期間に限って保持し、不要になった情報は法令や運用上必要な範囲を除き削除または匿名化します。秘密鍵などの機密情報は公開ページや公開コードに保存しません。</p>
      </section>
      <section className="legal-section">
        <h2>お問い合わせ</h2>
        <p>掲載内容の削除・権利に関する申請は<Link href="/removal-request">削除要請フォーム</Link>を、その他の案内は<Link href="/contact">お問い合わせページ</Link>をご確認ください。</p>
      </section>
    </LegalPage>
  );
}
