import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer>
      <p className="site-footer-age">18歳未満の方は利用できません。</p>
      <p>
        Xclipは、X（旧Twitter）の公開投稿情報をもとに、動画ランキングと保存補助機能を提供する無料サイトです。動画はXの配信元からお使いの端末へ直接読み込まれます。Xclipでは動画ファイルの保管・再アップロードは行っていません。
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

