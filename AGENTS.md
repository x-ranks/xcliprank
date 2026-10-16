# Xclip 最新ソースの作業ルール

- README.md、docs/XCLIP_CURRENT_STATUS.md、docs/XCLIP_UPDATE_HISTORY.md、docs/xclip-update-artifacts.json、docs/canonical-source-status-20261016.jsonを先に読む。
- 2026-10-16整理後、直下app/libは最新ローカル管理コード。過去の「直下は旧main」という説明は整理前の履歴。本番版はproduction/README.mdの全source取得待ちであり、直下をColorfulBoxへ配布しない。
- GitHubはユーザー指定で公開継続。秘密、.env、DB dump、実state、教師、学習済みモデルを追加しない。cloneで秘密・状態が復元されると説明しない。
- 実ローカルC:\Projects\xcliprank、本番ColorfulBox。未知変更を上書きせず、実コード・runtime/DEPLOY_SOURCE/BUILD_ID/SHAを照合する。
- 明示依頼のないPC/UI操作、実ローカル適用、本番デプロイ、課金API呼出は行わない。ユーザーへ配布リンクと実行方法をチャット本文で渡す。
- 型・模擬テスト・ビルドはscripts/check-canonical.cjsで全状態を隔離。配布実ファイルの適用・再適用・復元・未知編集拒否も必要範囲で確認。
- app/libの基準SHAはdocs/canonical-source-baseline-20261016.json。アプリを変更した際は確認済み差分として台帳を更新し、未知hashを無条件許可しない。
- 累積履歴と適用根拠を保存し、作成・検証・local適用・本番適用・GitHub記録を区別する。10/14登録1,000／ランキングv2完了、10/15学習通信削減local完了。無料枠効果は未測定、再生改善は本番本文待ちで未作成。
- 定期新着はFxTwitterへ一時切替、24h24／3h8、同一24h、5秒、失敗も1枠。Xへ無断復帰しない。監視の除去判定を緩めず、手動除去／停止／位置／予約を保持する。
- Supabase DB passwordは2026-10-12にリセット済み。認証障害時に旧設定残存の可能性を案内する。値を要求しない。
- 旧VercelへのGit自動deployは無効。現本番へVercel用Cron／公開手順を流用しない。
