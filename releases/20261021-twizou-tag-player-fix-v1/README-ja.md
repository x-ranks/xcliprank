# twizou プレイヤー案内・タグ遷移修正

2026-10-21 に本番とローカルへの適用を確認したリリースです。

- 再生エラー案内を動画プレイヤー内に表示し、×で閉じられるように変更。
- 自動推定についての注記を削除し、動画のタグ見出しを「この動画に付けられたタグ」に変更。
- タグ関連リンクを通常のページ遷移に切り替え、タグ一覧から動画へ進む導線も揃えました。

本番はビルド `BgEanIn6bUycw2KDg8uJ4`、バックアップ `/home/rbxfxmfd/xclip-before-twizou-tag-player-fix-v1-20261021.6D2sp7`。ローカルは11ファイルの同期が成功し、バックアップは `C:\Projects\xcliprank-local-backups\twizou-tag-player-fix-2026-10-21T11-59-25-939Z-896146` です。詳細は `docs/completions/20261021-twizou-tag-player-fix-v1-applied.json` を参照してください。

本番インストーラーは適用中の検証失敗時に旧 runtime を復旧します。ローカルは展開した ZIP 内の `apply-local.cjs --rollback "バックアップ先"` で戻せます。

自動検証では本番の動画ページとタグページの HTTP 応答を確認しました。PC・スマホの実操作による見た目と遷移の確認は、まだ報告されていません。
