import type { Metadata } from "next";
import DeviceGuide from "../DeviceGuide";
import { SITE_NAME, SITE_URL } from "../../../lib/seo";

const TITLE = "X(Twitter)の動画をAndroidに保存する方法｜Chromeの保存先も解説";
export const metadata: Metadata = {
  title: { absolute: `${TITLE}｜${SITE_NAME}` },
  description: "AndroidでX(Twitter)の動画を保存する手順を紹介。投稿URLの確認からChromeでの保存、保存した動画が見つからないときの探し方、ギャラリーに表示されないときの対処までまとめました。",
  alternates: { canonical: "/download/android" },
  openGraph: { type: "website", title: TITLE, description: "AndroidのChromeでX動画を保存する手順と、保存先の確認方法。", url: `${SITE_URL}/download/android`, images: [`${SITE_URL}/twizou-share.png`] },
  twitter: { card: "summary_large_image", title: TITLE, description: "AndroidのChromeでX動画を保存する手順と、保存先の確認方法。", images: [`${SITE_URL}/twizou-share.png`] },
};

export default function AndroidDownloadPage() {
  return <DeviceGuide
    device="android"
    heading="X(Twitter)の動画をAndroidに保存する方法"
    lead="AndroidではChromeで保存するのが基本です。投稿URLを用意して、保存画面から端末に保存し、ダウンロードフォルダやギャラリーで確認するまでの流れをまとめました。"
    browser="AndroidのChrome"
    steps={[
      { title: "Chromeでtwizouの保存ページを開く", body: "Xなどのアプリ内ブラウザでは保存が始まらないことがあります。メニューから「ブラウザで開く」などを選び、Chromeで開き直してください。" },
      { title: "Xの投稿URLをコピーする", body: "保存したい投稿の共有ボタンから「リンクをコピー」を選びます。" },
      { title: "URLを貼り付けて動画を確認する", body: "投稿URLを入力し、保存の許可と注意事項を確認してから「動画を確認する」を押します。" },
      { title: "「動画を保存」を押す", body: "見つかった動画の「動画を保存」を押し、受信が終わるまで画面を開いたまま待ちます。" },
      { title: "保存した動画を確認する", body: "Chromeのメニューから「ダウンロード」を開くか、ファイル管理アプリの「ダウンロード」フォルダを確認します。" },
    ]}
    whereTitle="保存した動画が見つからないとき・ギャラリーに出ないとき"
    where={[
      "Chromeの右上のメニュー（︙）から「ダウンロード」を開くと、保存した動画の一覧を確認できます。",
      "「Files」などのファイル管理アプリで「ダウンロード」フォルダを開きます。アプリ名や保存場所は機種によって異なります。",
      "ギャラリーやフォトアプリにすぐ表示されない場合は、少し待つかアプリを開き直してみてください。それでも出ない場合は、ファイル管理アプリから動画を開いて再生できます。",
      "保存が始まらない場合は、受信後の「保存し直す」を押します。「共有・保存先を選ぶ」が表示される端末では、そこから保存先や対応アプリを選べます。",
    ]}
    faqs={[
      { q: "保存ボタンを押しても何も起きません", a: "Xアプリ内のブラウザではなく、Chromeで開いているか確認してください。通信状態が悪い場合は、受信が終わるまで画面を開いたまま待ち、失敗したら保存画面の「再試行」を押します。" },
      { q: "どんな動画でも保存できますか？", a: "いいえ。権利者が保存を許可した動画のみ利用できます。非公開・削除済みの投稿や、サイトの掲載対象外の動画、1件256MBを超える動画は保存できません。" },
      { q: "端末の空き容量が足りないとエラーになりますか？", a: "空き容量が足りないと受信が途中で止まることがあります。不要なファイルを整理してから、もう一度試してください。" },
    ]}
    official={{ href: "https://support.google.com/chrome/answer/95759?co=GENIE.Platform%3DAndroid&hl=ja", label: "Google公式：Androidでファイルをダウンロードする" }}
  />;
}
