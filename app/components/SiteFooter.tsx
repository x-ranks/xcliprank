import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer>
      <p className="site-footer-age">18歳未満の方は利用できません。</p>
      <p>
        動画ファイルはX上の公開投稿を参照して表示しており、当サイトでは動画ファイルの保存・再アップロードを行っていません。
      </p>
      <p>
        違法または権利侵害と思われる投稿は、<Link href="/removal-request">削除要請フォーム</Link>からお知らせください。
      </p>
      <nav className="site-footer-links" aria-label="サイト情報">
        <Link href="/privacy">プライバシー</Link>
        <Link href="/terms">利用規約</Link>
        <Link href="/copyright">著作権・削除方針</Link>
        <Link href="/advertising-disclosure">広告・PR表記</Link>
        <Link href="/contact">お問い合わせ</Link>
      </nav>
    </footer>
  );
}
