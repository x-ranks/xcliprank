import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer>
      <p className="site-footer-age"><strong>18歳未満の方は利用できません。</strong></p>
      <p>
        twizouは公開投稿と管理者が登録した動画URLのランキングを提供します。再生できる動画は元の配信元からお使いの端末へ直接読み込まれます。twizouでは動画の収集・アップロードは一切行っておりません。
      </p>
      <p>
        <strong>児童ポルノ・リベンジポルノ・著作権侵害等のコンテンツは違法である為</strong> 厳格に対処いたします。<Link prefetch={false} href="/removal-request"><strong>削除要請フォーム</strong></Link>からお知らせくださいますようご協力をお願いします。
      </p>
      <nav className="site-footer-links" aria-label="サイト情報">
        <Link prefetch={false} href="/browse">動画一覧</Link>
        <Link prefetch={false} href="/accounts">投稿者一覧</Link>
        <Link prefetch={false} href="/tags">タグ一覧</Link>
        <Link prefetch={false} href="/privacy">プライバシー</Link>
        <Link prefetch={false} href="/terms">利用規約</Link>
        <Link prefetch={false} href="/copyright">著作権・削除方針</Link>
        <Link prefetch={false} href="/advertising-disclosure">広告・PR表記</Link>
        <Link prefetch={false} href="/contact">お問い合わせ</Link>
      </nav>
    </footer>
  );
}

