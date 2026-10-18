import type { Metadata } from "next";
import LegalPage from "../components/LegalPage";

export const metadata: Metadata = {
  title: "広告・PR表記方針",
  description: "X CLIP RANKにおける広告、PR、アフィリエイトリンクの表示方針です。",
  alternates: { canonical: "/advertising-disclosure" },
  robots: { index: false, follow: true },
};

export default function AdvertisingDisclosurePage() {
  return (
    <LegalPage title="広告・PR表記方針" lead="広告やアフィリエイトを掲載する場合の透明性と、ランキングからの独立性に関する方針です。">
      <section className="legal-section">
        <h2>広告であることの明示</h2>
        <p>報酬が発生する広告、PR、アフィリエイトリンクを掲載する場合は、「広告」「PR」など閲覧者が判別できる表示を行います。</p>
      </section>
      <section className="legal-section">
        <h2>ランキングとの分離</h2>
        <p>広告報酬の有無だけを理由に、通常の動画ランキング順位を変更しません。スポンサー枠を設ける場合は、通常ランキングと区別できる表示にします。</p>
      </section>
      <section className="legal-section">
        <h2>外部サイト</h2>
        <p>広告リンク先の商品・サービス・契約は外部事業者が提供します。利用条件、料金、個人情報の取扱いはリンク先で確認してください。</p>
      </section>
      <section className="legal-section">
        <h2>計測</h2>
        <p>広告効果の確認のため、個人を直接特定しない範囲でクリックや流入元を計測する場合があります。取扱いはプライバシーポリシーに従います。</p>
      </section>
    </LegalPage>
  );
}
