import type { Metadata } from "next";
import DownloadForm from "./DownloadForm";
import Link from "next/link";
import { SITE_NAME, SITE_URL } from "../../lib/seo";

export const metadata: Metadata = {
  title: { absolute: `X動画保存｜iPhone・Androidの保存方法｜${SITE_NAME}` },
  description: "X・Twitterの公開投稿URLから動画を保存する方法を紹介。iPhoneのSafari・AndroidのChromeでの保存手順、保存先、保存できないときの確認方法をまとめました。",
  alternates: { canonical: "/download" },
  openGraph: { type: "website", title: `X動画保存｜${SITE_NAME}`, description: "保存を許可されたX動画を投稿URLから端末に保存できます。", url: `${SITE_URL}/download`, images: [`${SITE_URL}/twizou-share.png`] },
  twitter: { card: "summary_large_image", title: `X動画保存｜${SITE_NAME}`, description: "保存を許可されたX動画を投稿URLから端末に保存できます。", images: [`${SITE_URL}/twizou-share.png`] },
};
export default function DownloadPage() { return <><DownloadForm /><section className="download-guide" id="save-guide" aria-labelledby="save-guide-title">
  <h2 id="save-guide-title">iPhone・Androidで動画を保存する方法</h2>
  <p>まずは下の基本手順で保存してください。保存先やボタンの表示は、端末・ブラウザの設定によって異なります。</p>
  <nav className="download-guide-nav" aria-label="保存方法の目次"><a href="#save-steps">基本手順</a><a href="#save-iphone">iPhone</a><a href="#save-android">Android</a><a href="#save-trouble">保存できないとき</a><Link href="/download/iphone">iPhone専用ガイド</Link><Link href="/download/android">Android専用ガイド</Link></nav>
  <section id="save-steps"><h3>投稿URLから保存する基本手順</h3>
    <ol><li>Xの投稿URLを入力し、保存の許可と注意事項を確認して「動画を確認する」を押します。</li><li>見つかった動画の「動画を保存」を押します。動画詳細ページから保存する場合は、この操作から始められます。</li><li>保存画面の注意事項を確認し、同意のチェックを入れて「動画を保存する」を押します。</li><li>受信が終わるまで待ち、ブラウザのダウンロード一覧で完了を確認します。</li></ol>
  </section>
  <section id="save-iphone"><h3>iPhone・iPadのSafariで保存する</h3>
    <p>基本手順で保存した後、Safariのダウンロード一覧、または「ファイル」アプリの「ブラウズ」から「ダウンロード」を確認してください。設定に応じて「iCloud Drive」や「このiPhone内」に保存されます。写真アプリに自動で入るとは限りません。</p>
    <p>受信が終わったのに保存先を選べない場合は、保存画面の「保存し直す」を押します。「共有・保存先を選ぶ」が表示されている場合は、共有メニューから利用できる保存先を選べます。「ファイルに保存」や「ビデオを保存」など、実際に表示された項目を選んでください。</p>
    <p className="download-guide-note">共有ボタンや保存先の項目は、端末・OS・ファイル形式によって表示されない場合があります。</p>
    <a href="https://support.apple.com/ja-jp/102440" target="_blank" rel="noopener noreferrer">Apple公式：ダウンロードしたファイルの探し方</a>
  </section>
  <section id="save-android"><h3>AndroidのChromeで保存する</h3>
    <p>基本手順で保存した後、Chromeのメニューから「ダウンロード」を開きます。端末の「Files」などのファイル管理アプリでも、「ダウンロード」フォルダを確認できます。アプリ名や保存場所は機種の設定によって異なります。</p>
    <p>保存が始まらない場合は、受信終了後の「保存し直す」を押してください。「共有・保存先を選ぶ」が表示される端末では、そのボタンから保存先や対応アプリを選ぶ方法もあります。</p>
    <a href="https://support.google.com/chrome/answer/95759?co=GENIE.Platform%3DAndroid&amp;hl=ja" target="_blank" rel="noopener noreferrer">Google公式：Androidでファイルをダウンロードする</a>
  </section>
  <section id="save-trouble"><h3>動画を保存できないとき</h3>
    <dl className="download-guide-issues">
      <div><dt>保存した動画が見つからない</dt><dd>ブラウザのダウンロード一覧と端末の「ダウンロード」フォルダを確認します。同じ動画を何度も保存する前に、受信中でないかも確認してください。</dd></div>
      <div><dt>受信が途中で止まる・エラーになる</dt><dd>通信状態と端末の空き容量を確認してください。受信中は画面を開いたまま待ち、失敗した場合は保存画面の「再試行」で確認し直します。投稿URLから取得した保存用情報が期限切れなら、投稿URLを再入力して「動画を確認する」を押してください。</dd></div>
      <div><dt>Xなどのアプリ内ブラウザで動かない</dt><dd>twizouのページをSafariまたはChromeで開き直し、もう一度保存を試してください。</dd></div>
      <div><dt>動画が大きい・元投稿が利用できない</dt><dd>この保存機能の上限は1件256MBです。上限を超える動画や、非公開・削除・当サイトの掲載対象外の動画は保存できません。公開中でも、配信元の状態により取得できない場合があります。</dd></div>
    </dl>
  </section>
  <p className="download-guide-note">権利者が保存を許可した動画のみ利用してください。保存条件は<Link href="/download-policy">保存ポリシー</Link>をご確認ください。</p>
</section></>; }
