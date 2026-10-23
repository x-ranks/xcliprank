# twizou 投稿ページ説明・画像寸法 v1

2026-10-24。`gpt_watasi.txt` の提案を現行実装と照合し、本文が空の投稿ページに投稿者名・投稿日・公開タグのみから構成する説明を追加した。既存本文はそのまま表示し、推測した出来事や内容は加えない。ページの title / description へ実際のタグを反映し、一覧カードのサムネイルに `width` / `height` を指定した。

対象は `lib/public-video-core.ts`、`app/p/[id]/page.tsx`、`app/components/PublicVideoCards.tsx` と公開ページ検査 `scripts/test-public-pages.cjs` の4ファイル。変更前後の SHA-256 は `manifest.json`。ローカルと本番の適用結果は `completion.json` に記録した。本番用の実配布ZIPの SHA-256 は `35c0d3530370001341a3c9ea804f4a7ca19dec38ede9c22fd0dd82a8a0ecc38e`。

ローカルでは公開ページ・公開動画サービス検査と TypeScript 型検査に成功。本番の事前照合、隔離ステージのビルド・全テスト、公開後の投稿メタデータ・サイトマップ確認に成功し、ビルドID `LEsxmu1hZQsDsGVeZnxcz` で切り替わった。Cronと監視ラッパーは変更していない。独立した外部HTTP検査はローカル環境の資格情報エラーで実施できず、サーバー上の公開後スモークを適用根拠とした。

資料の関連動画リンクと年齢確認の再表示防止は既存実装で、今回の対象外。関連動画の候補には公開タグが必要なため、進行中の自動ラベル処理の結果を見て評価する。Xへの自動投稿、翻訳、記事執筆はこの更新には含めない。
