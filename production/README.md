# 本番ソースの統合状況：取得待ち

ローカル版と本番版は役割が異なります。現リポジトリ直下は最新ローカル管理版です。本番としてビルド／配布する対象ではありません。

最後の本番診断：runtime `/home/rbxfxmfd/xclip-video-card-20261004.DJKKID/runtime`、DEPLOY_SOURCE `/home/rbxfxmfd/xclip-ranking-updates-v2-20261014.aj9FwJ/source`、BUILD_ID `H6KQokOwZZcvhnEQnY251`。ユーザー実行結果で一致を確認。

再生関連14ファイルのうち、既知の本番用コピーと6ファイルが相違／未配置です。これだけで現本番を完全に再現できると判断しないため、正確な全コード一覧・本文を取得する必要があります。

1. `tools/xclip-github-production-source-export-20261016.sh` をColorfulBoxの `/home/rbxfxmfd/` に配置。
2. `bash /home/rbxfxmfd/xclip-github-production-source-export-20261016.sh` をユーザーが実行。
3. `XCLIP_GITHUB_PRODUCTION_SOURCE_EXPORT_OK` と `ATTACH_FILE=...` を確認。
4. 出力JSONをダウンロードして、このチャットへ添付。

app/lib/scripts/sql/supabase/publicと固定のビルド設定だけを対象に、実稼働sourceとbuildを照合し、プログラム・公開資材のSHAと本文を新規JSONへ保存します。秘密らしい文字列、リンク、所有者違い、途中の版変更では出力を拒否します。設定・DB・巡回state・モデル重み・ホームのCron本文／実Cron設定は含めず、アプリ変更・DB/provider通信はありません。

JSON受領後、内容を検査して `production/` へ本番版を統合し、専用の型／ビルド／回帰、localとの相違表、取得方法を確定します。それまでは本番完全統合は未完了です。
