# ColorfulBox本番ソース（2026-10-18更新）

`source/` はユーザー添付の実稼働208ファイルに「本番ラベル反映・個別URLv1」を組み込んだ更新候補。型/回帰/standalone buildを検証する。今回機能は未適用。確認した実稼働版そのものは `../snapshots/production-live-20261018/`。BUILD_IDと全SHAは `../docs/production-source-baseline-20261018.json`。従来の本番全文取得待ちは解消した。

リポジトリ直下はローカル管理用であり、本番用と交換しない。設定、DB、Cron、登録/巡回状態、教師/モデル、実保存記録はGitに含まれない。`source`で `npm ci` → `node scripts/check-canonical.cjs test` → `node scripts/check-canonical.cjs types` → `node scripts/build-production-offline.cjs`（新規取得で.envなし）を実行できる。

既存本番への適用は `../tools/xclip-public-labels-pages-deploy-20261018.sh`。実稼働source/BUILD_ID/SHAを照合し、ステージングでテスト・build・HTTP確認、workerと登録の排他を取ってruntimeを切替、失敗時に元runtimeへ戻す。既存env/DBスキーマ/Cron/巡回枠/取得位置/除去判定は変えない。適用後に公開サイトのDBを限定読取して実HTMLを確認するが、動画CDN取得・投稿収集・ラベル反映・偽の保存記録は実行しない。

新しい承認ラベル・ランキング登場・保存観測・署名鍵はruntime外 `~/.xclip-public-catalog` に保持する（任意の絶対XCLIP_PUBLIC_CATALOG_DIR）。このフォルダーは非公開の暗号化バックアップ対象に追加し、Gitへ入れない。過去の保存実績は不明なので補填しない。OSの保存完了を測れると説明しない。
