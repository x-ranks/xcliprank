## 2026-10-18 最新：本番v2・ローカルの適用完了

両方のインストーラー成功をユーザー提供ログで確認。v1/v2のローカル更新内容は同一。次はローカル管理の再起動と `/label-publication` からの手動正解の本番反映。実ラベル公開・保存/戻る/共有の実動作確認は成功報告待ち。根拠：docs/completions/20261018-public-labels-pages-local-applied.json。下記の未適用/未受領は当時の履歴。モデル/教師/巡回状態を保持し、未依頼の実環境適用やPC操作をしない。

## 2026-10-18 最新状態：個別URL・ラベル公開基盤v2は本番適用済み

ユーザー提供のv2完了ログ・公開HTTP200・API認証確認成功で本番適用を確認。`production/source` のアプリ本体とv2配布処理が現行。`snapshots/production-live-20261018` は適用前の保存版。今回ローカル更新と実ラベル公開の成功報告は未受領。根拠：docs/completions/20261018-public-labels-pages-v2-production-applied.json。以下の未適用/旧版復旧/未実装という説明は当時の履歴で、この状態を優先する。v1を再実行しない。モデル/教師/巡回状態をGitへ含めず、明示依頼のない実環境適用・PC操作を行わない。

## 2026-10-18 最新：本番配布v2（API許可一覧の修正）

v1はユーザー実行時に公開確認401→403で失敗し、旧runtimeへ復旧済み（トップ/24時間HTTP200）。本番ラベル・個別URLは未適用。v2は `tools/xclip-public-labels-pages-deploy-20261018-v2.sh`。新APIだけApache許可一覧へ追加し、認証を維持、失敗時は設定も復旧します。未知設定は拒否。アプリ本体/ローカルPS1はv1と同一。`releases/20261018-public-labels-pages-v2` と累積履歴を参照し、v1を再実行しないでください。v2の本番成功は未確認です。

## 2026-10-18：本番全文取得とラベル公開・個別URL候補

100教材の学習完了をユーザー報告・ローカル件数で確認。実精度0件。直下は最新ローカル候補、production/sourceは本番208全文に今回機能を加えた候補。snapshots/production-live-20261018はユーザー添付で確認した実稼働ソース。従来の本番全文待ちは解消。今回機能の実ローカル/本番適用・実ラベル公開は未完了。docs/features/public-labels-pages-v1-20261018-source.json、production READMEと累積履歴を優先し、下記の古い未取得・未実装・100件未完了の説明は当時の状態として扱う。秘密・モデル・教師・状態をGitへ入れない。公開GitへのpushだけでColorfulBoxは更新されない。

## 2026-10-17 ラベル学習100件 v2

ラベル管理は100教材まで準備/再開、次の10件、横並び、新規ランダム10件の独立精度確認に対応し実ローカルへ適用済み。既存14ラベル/10教材/モデルを保持。実100件の教材作成と実精度は未完了。docs/completions/20261017-label-learning100-local-applied.json とv2 source overlayを参照。既存状態を初期化しない。

# 2026-10-17 ユーザー指定の最優先課題

- ラベル付け（L01）と個別URL `/p/[postId]`（M07）を開発の最優先とする。docs/XCLIP_TOP_PRIORITIES_20261017.md と docs/XCLIP_OPERATIONS_TASKS.md を必ず読む。
- 個別ページには固有title（投稿者名＋本文先頭＋「動画を保存」）、保存ボタン、元投稿・投稿者へのリンク、同投稿者の他動画、ラベル関連動画、保存数・初回保存日時（欠損時非表示）を置く。戻る操作とURL共有・直接表示も要件。
- ラベル学習はmain統合・実ローカル適用・合成4枚抽出確認済み。実動画の正解付け・実測精度は未確認。個別URLは未実装。要件記録を適用完了と混同しない。

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
