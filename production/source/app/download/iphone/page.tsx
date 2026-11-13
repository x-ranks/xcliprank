import type { Metadata } from "next";
import DeviceGuide from "../DeviceGuide";
import { SITE_NAME, SITE_URL } from "../../../lib/seo";

const TITLE = "X(Twitter)の動画をiPhoneに保存する方法｜Safariの保存先も解説";
export const metadata: Metadata = {
  title: { absolute: `${TITLE}｜${SITE_NAME}` },
  description: "iPhoneでX(Twitter)の動画を保存する手順を紹介。投稿URLの確認からSafariでの保存、保存した動画が見つからないときの探し方、写真アプリへの入れ方までまとめました。",
  alternates: { canonical: "/download/iphone" },
  openGraph: { type: "website", title: TITLE, description: "iPhoneのSafariでX動画を保存する手順と、保存先の確認方法。", url: `${SITE_URL}/download/iphone`, images: [`${SITE_URL}/twizou-share.png`] },
  twitter: { card: "summary_large_image", title: TITLE, description: "iPhoneのSafariでX動画を保存する手順と、保存先の確認方法。", images: [`${SITE_URL}/twizou-share.png`] },
};

export default function IphoneDownloadPage() {
  return <DeviceGuide
    device="iphone"
    heading="X(Twitter)の動画をiPhoneに保存する方法"
    lead="iPhoneではSafariで保存するのが基本です。投稿URLを用意して、保存画面から端末に保存し、ファイルアプリや写真アプリで確認するまでの流れをまとめました。"
    browser="iPhoneのSafari"
    steps={[
      { title: "Safariでtwizouの保存ページを開く", body: "Xなどのアプリ内ブラウザでは保存が始まらないことがあります。右下や右上のメニューから「Safariで開く」を選び、Safariで開き直してください。" },
      { title: "Xの投稿URLをコピーする", body: "保存したい投稿の共有ボタンから「リンクをコピー」を選びます。" },
      { title: "URLを貼り付けて動画を確認する", body: "投稿URLを入力し、保存の許可と注意事項を確認してから「動画を確認する」を押します。" },
      { title: "「動画を保存」を押す", body: "見つかった動画の「動画を保存」を押し、受信が終わるまで画面を開いたまま待ちます。" },
      { title: "保存した動画を確認する", body: "Safariのダウンロード一覧、または「ファイル」アプリの「ブラウズ」→「ダウンロード」で確認できます。" },
    ]}
    whereTitle="保存した動画が見つからないとき・写真アプリに入れたいとき"
    where={[
      "Safariのアドレスバー付近にあるダウンロードのアイコンから、保存した動画の一覧を開けます。",
      "「ファイル」アプリの「ブラウズ」から「ダウンロード」を開きます。設定によって「iCloud Drive」か「このiPhone内」に入ります。",
      "写真アプリで見たい場合は、ファイルアプリで動画を開き、共有ボタンから「ビデオを保存」を選びます。表示されない場合は、動画の形式や端末の設定が影響している可能性があります。",
      "保存画面に「保存し直す」や「共有・保存先を選ぶ」が出ている場合は、それを押すと保存先を選び直せます。",
    ]}
    faqs={[
      { q: "保存ボタンを押しても何も起きません", a: "Xアプリ内のブラウザではなく、Safariで開いているか確認してください。通信状態が悪い場合は、受信が終わるまで画面を開いたまま待ち、失敗したら保存画面の「再試行」を押します。" },
      { q: "どんな動画でも保存できますか？", a: "いいえ。権利者が保存を許可した動画のみ利用できます。非公開・削除済みの投稿や、サイトの掲載対象外の動画、1件256MBを超える動画は保存できません。" },
      { q: "iPhoneの空き容量が足りないとエラーになりますか？", a: "空き容量が足りないと受信が途中で止まることがあります。不要なファイルを整理してから、もう一度試してください。" },
    ]}
    official={{ href: "https://support.apple.com/ja-jp/102440", label: "Apple公式：ダウンロードしたファイルの探し方" }}
  />;
}
