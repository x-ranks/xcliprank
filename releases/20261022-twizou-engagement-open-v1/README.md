# 動画オープン計測の適用記録 — 2026-10-22

ランキングカードが `/p/[id]` に遷移する現行UIで、旧ポップアップ専用だった `video_open` を個別ページ表示時にも送信する変更。`from` に応じて新着・24時間・週間・リールへ分類し、タグ・投稿者・直接訪問も総動画オープン数へ含める。既存APIの5分重複防止を使用する。既存の閲覧履歴を遡って補完する変更ではない。

## 照合・検証

- 変更前のローカル管理API：10月15〜18日の動画オープン計23件、10月19〜22日は訪問があっても0件。
- 初回本番適用は切替前に `test-public-pages.cjs` が新部品の import を拒否して停止。本番runtimeは変更されなかった。
- fix1ではテストを更新し、本番ソースの隔離コピーで52件の回帰テスト、型チェック、Next本番ビルドを確認。Windowsのjunctionに起因するstandaloneコピー警告は出たが、ビルド終了コードは0。
- 本番 `--check`：`CURRENT_SOURCE_AND_OPEN_TRACKING_PAYLOAD_HASHES_MATCH`、`PRECHECK_OK; LIVE_BUILD_ID=Fx2tcddxuDKSsQFoBPRt6`。
- 本番 `--apply`：`STAGED_BUILD_AND_TESTS_OK`、`SITEMAP_CHECK_OK posts=3501`、`POST_PAGE_CHECK_OK`、`ENGAGEMENT_API_SMOKE_OK`、`TWIZOU_ENGAGEMENT_OPEN_V1_FIX1_DEPLOYMENT_COMPLETE`。ユーザー提供の実行ログによる確認。
- 本番新BUILD_ID：`f6l2AFJY_Z04_PUGQJOAA`。前runtimeバックアップ：`/home/rbxfxmfd/xclip-before-twizou-engagement-open-v1.ErI455`。staging：`/home/rbxfxmfd/xclip-twizou-engagement-open-v1.1PgRWD`。
- ローカル機能コードとテスト更新は適用済み。バックアップ：`C:\Projects\xcliprank-local-backups\twizou-engagement-open-20261022T101010119`、`C:\Projects\xcliprank-local-backups\twizou-engagement-open-test-fix-20261022T204639089`。型チェック、計測部品テスト、ページテスト成功。
- 実ブラウザ操作後に集計値が増えることは、記録時点で**未確認**。公開ページ・版ファイルへのこちらからの直接アクセスも失敗したため、公開疎通は適用スクリプトの出力を根拠とする。

## 対象ファイル SHA-256

| ファイル | 適用前 | 適用後 |
|---|---|---|
| `app/p/[id]/page.tsx` | `56bf8d6bcfee74cc9001d08abb690df1e23456f90b1076bc0df16c4b3cfbc2ff` | `6959ae0549f518e70939b2a15006d578398722904d289fd5af2407bb245ef373` |
| `app/components/PublicPostEngagement.tsx` | なし | `f91606b2340fcd975bf3b0c05ba18d849da992462c67ef114b011493afdb6b54` |
| `scripts/test-public-pages.cjs` | `1952c35ef40527dd1cb27023b068df5e4c5f3ec6f5a22061b54efb49d166527a` | `9b141424409343e63210940e63cc88ea649e27771864fd39b5a8b7bc58ac8a14` |

配布物：`twizou-engagement-open-v1-fix1-20261022.zip`（SHA-256 `326b37c931f93e75aa8ff59294f374b0821138748f5910f37e7b1dc1ebfeb3c5`）。秘密鍵・環境変数・計測生データは含めない。

