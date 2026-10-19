# Xclip 更新履歴・引き継ぎ台帳

最終更新：2026-10-11（日本時間）。この台帳は作成・検証・ローカル適用・本番適用を区別します。ファイルの存在だけで本番反映済みとは判断しません。

## 現在の基準

- 現在の開発先：`C:\Projects\xcliprank`。`Documents\x_video_rank_mvp` は古い環境であり、現在の更新元として使わない。
- 本番：ColorfulBox、`https://xcliprank.com`。現在公開中のコードはサーバーの `.htaccess` にある `PassengerAppRoot` と、runtimeの `DEPLOY_SOURCE`・`.next/BUILD_ID` で照合する。古い会話のVercel向けデプロイ手順を現在の本番へそのまま適用しない。
- GitのHEADだけでは現状を表さない。現在のローカルには未コミット変更・未追跡ファイルがある。更新前にそれらを保護する。
- 今回のローカル修正は適用済み。本番用修正版は作成・検証済みで、サーバーでの実行結果は未受領。本番の再生不能動画の除外と、実DBへの再登録結果は未確認。
- 対応する成果物とローカルコードのSHA-256は `Xclip-更新照合台帳.json` に記録する。ハッシュは取得時点の内容を示し、適用済みの証明とは区別する。

## 過去の更新の復元

参照できた会話・ローカル文書・更新ファイルから復元したものです。全会話の完全な監査を済ませたという意味ではありません。過去の適用状況を確認できないものは、そのまま未確認と記載します。

| 日付・期間 | 内容 | 確認根拠・状態 |
|---|---|---|
| 2026-08〜09 | コンテンツフィルター、安全確認、手動除外・教師レビュー等の基盤 | 「Add content filter module」、現在の `lib/content-filter.ts` 等。全改版の本番適用日時は未照合。現在の保守で既存の手動除外や安全判定を上書きしない。 |
| 2026-09-07頃 | 投稿画像へのモザイク・ぼかし・JPEG変換、適用フラグ | 「Add content filter module」の当時の本番反映報告と、その後のユーザー動作確認。旧Vercel環境での履歴であり、現在のColorfulBox版との一致は未照合。 |
| 2026-09-07頃 | サイトとDBのバックアップ | 同会話に934ファイル・5テーブル13,191行のバックアップ報告。取得不能な機密変数等の不足も報告されている。完全復元可能との断定はしない。 |
| 2026-09-07頃 | 広域探索停止・選別投稿者100%への設定 | 同会話にローカル変更・型検査成功。本番デプロイは認証エラーで未反映との報告。その後の現行版と同一とは判断しない。 |
| 2026-09-13〜16 | 管理ハブ、アクセス・エンゲージメント、ローカル管理保護、開発先の固定 | 現在の文書、ローカルコード、保存済み更新アーカイブ。固定開発先は `C:\Projects\xcliprank`。当時のVercel運用文書は現在の公開方式と区別する。 |
| 2026-09-30 | ランキング流動性・SEOの調査 | 「Xclip流動性とSEO」。この調査時点では追加実装・Preview作成なし。後日のランキング改修と区別する。 |
| 2026-10-03 | 収集のページ継続、再開、公平な巡回順 | 「Xclip収集ログ確認」「Xclip収集の週次判断」、PR #7の反映済みとの過去報告。10/3の実行ログは24投稿者・287読み取り・39新規保存・248重複・実エラー0。現在の無料巡回とは別の有料収集経路の履歴。 |
| 2026-10-04 | 動画カードのTier・スコア非表示、再生時間表示 | 「Xclip収集ログ確認」に作成・検証と切り替え不具合の修正履歴。切り替え修正後のユーザー成功報告あり。 |
| 2026-10-04 | 新着・24時間ランキングの補充枠・重複回避 | 同会話に100件以上の表示、過去動画補充、日次枠85件、重複回避の改修と切り替え修正。ユーザー成功報告あり。今回の更新では配分・選択方法を変更していない。 |
| 2026-10-04〜05 | 収集検索範囲の期限切れ対策 | 「Xclip収集ログ確認」に更新ファイルと `curated_search_expiry` 追加手順。「Xclip収集の週次判断」では10/5本番反映済みとの運用記録。現在のDB列をこの作業から直接照合はしていない。 |
| 2026-10-06 | Tier再評価、教師データ分析、管理リンク、ローカルHost判定 | `docs/20261006-parallel-roadmap.md` と保存済み成果物。Host修正後のローカル正常動作は過去のユーザー報告。各モデルの本番反映・実精度の判定は別途必要。 |
| 2026-10-07〜08 | 複数フレーム、プレビュー互換、教師分析、順序調整、再現率検証、モデルリリース関連 | 現在の `docs/tier-*.md`、コード、保存済み更新ファイル。成果物ごとの版とSHA-256を照合台帳に保存。ファイルがあることを本番適用済みの根拠にしない。 |
| 2026-10-08〜09 | 動画保存の調査からローカル実装へ移行 | 「Implement video downloads and saves」は調査・変更案のみ。「Xclip収集ログ確認」では依存ファイル不足で初版/v2が停止し、v3へ修正、その後ユーザーがローカル保存成功を確認。調査のみの会話を完成版と誤認しない。 |
| 2026-10-10〜11 | 投稿URLからの保存、直接再生、HLS、再生回復、URL許可リスト、時間メタデータ、表示文言 | 現在のローカルコード、`xclip-direct-*`・`xclip-video-url-*`・`xclip-site-copy-duration-*` 等の保存済み更新ファイル。今回の本番修正は、これらを含む実際の公開ビルドのソースをコピーして変更する。各過去版の適用時刻は未照合。 |
| 2026-10-11 | 凍結アカウントの監視、投稿削除監視、低頻度巡回、診断ログ | 「Xclip監視ログ確認」の実ログと、suspended v3・lowload・diagnosticsの更新ファイル。15:17 JSTのログでは投稿2件が `message` 不在により判定不明となり途中休止。本番で旧監視が動いていたことを確認。 |
| 2026-10-11 | FxTwitter無料巡回への移行と本番同期認証の修正 | 「プロジェクト運用方針確認」に認証修正後の本番同期動作確認。ローカルには10:36 JSTの更新バックアップが存在。自動収集は最大8投稿者・3時間周期・同一対象24時間以上・通信5秒間隔。有料の手動/復旧経路と区別する。 |
| 2026-10-11 | プロフィールURLと100/200/300投稿による簡易登録・自動同期・掲載 | 同会話と11:11 JSTのローカル更新バックアップ。今回も登録・途中再開・既存データ保護のテストで確認。 |
| 2026-10-11 | 選別投稿者の巡回管理画面 | 「プロジェクト運用方針確認」で作成・検証済みと訂正済み。19:37 JSTのローカルバックアップとコードでローカル適用を確認。本番dashboard単体更新の実行結果は未確認。今回の本番用修正に含まれる。 |
| 2026-10-11 | 再生不能動画の除外・取得0件修正 | このチャットで作成・検証・ローカル適用。本番未適用。詳細は次項。 |

## 今回の更新：availability-curated-fix-20261011

### 変更

- `lib/post-status.ts`：message省略を許容し、ID・投稿者・公開状態・動画メタデータを照合。削除と非表示を区別し、引用先だけの非表示で親投稿を除外しない。動画情報不足では除外解除しない。
- `lib/availability-scan.ts`：投稿ごとの判定不明で監視全体を休止しない。削除・非表示は24時間以上離れた2回の確認と同一巡回の正常動画応答で確認してから除外。通信障害・制限の休止は維持。
- `lib/fxtwitter-curated.ts`：新規取得は通常のstatuses一覧。cursorに取得経路を記録し、旧media一覧の途中再開との混在を防止。外部サービス障害と空一覧を区別する。
- `lib/free-curated-scan.ts`：空一覧等の個別失敗で後続投稿者の巡回を止めない。既存投稿ID・累計・前回成功時刻を保持。
- 巡回管理の既存コードとテストを統合。DBへの保存時の手動指定、安全確認、重複保護を維持。

### 検証・適用

- 登録、保存、本番同期、巡回管理、状態監視、空応答と通信障害の区別、新旧cursor、誤除外防止、復旧の模擬テスト成功。
- 変更モジュールの型検査成功。配布した本番用ファイルの展開・照合・適用・再適用・未知版拒否を隔離コピーで確認。ローカル用ファイルの実適用成功。
- 実通信：`@yoyoyokun19` のmedia一覧0件、statuses一覧20投稿、動画候補10件。有料X API利用0件。候補抽出でありDB登録成功の報告ではない。
- ローカル適用：2026-10-11 20:52 JST。変更前バックアップ：`.local-admin/fxtwitter-curated-backups/20261011115212931-bd7faf`。
- 本番用：`xclip-availability-curated-fix-deploy-20261011.sh`。ローカル用：`xclip-availability-curated-fix-local-20261011.ps1`。SHA-256は照合台帳を参照。
- 本番の全体ビルドと公開後の確認はサーバーで更新ファイルを実行した際に行う。更新時に追加巡回・待機期限リセットは行わない。

## 2026-10-11：更新履歴の運用追加

ユーザー指示により、今後は更新ファイルをチャットへ直接添付し、実行方法もチャット本文へ記載する。更新履歴を継続し、以前の会話の更新も確認できた範囲で追記する。

- この台帳、成果物とコードの照合台帳、ローカルの `AGENTS.md` に確認ルールを保存する。
- 旧 `docs/development-workflow.md` には、Vercel手順が過去の記録であることと現在の台帳への参照を追記する。
- この変更は文書・運用ルールのみ。上記プログラム更新ファイルの内容は変えていない。

## 今後の各更新で必ず記録する項目

1. 日時（JST）、依頼元の会話、具体的な変更目的。
2. 基準にしたローカル/本番コード、対象ファイル、変更前後の照合値、既存の未コミット変更。
3. 更新ファイル名・版・SHA-256、前提と含まれる更新、置き換える旧版。
4. 実施した検証と結果、未確認事項。ビルド成功を本番反映済みと扱わない。
5. 作成済み/検証済み/ローカル適用済み/本番適用済み/復旧済みを別々に記録。
6. 適用先・時刻・成功表示・バックアップ先・復旧方法。共有されたサーバーログを根拠として追記する。

未確認の項目を推測で埋めず、次に確認する項目として残す。古い会話のコードより、実際に適用されているコードとその照合結果を優先して整合を確認する。

## 2026-10-11T21:20:56+09:00 : previous issue closed and recorded in Git

- User instruction: treat the availability and zero-result collection work as complete and record it in Git. This records completion of the requested work; it does not certify full collection success for every author.
- Screenshots supplied by the user show 43 and 25 published items, with author-specific fetching stopped partway through. No production database query or server installation log was supplied. Production deployment and end-to-end display remain unverified by this agent.
- Scope: local FxTwitter registration and monitoring UI, their directly related modules/tests, handoff rules/history, and the exact production/local installer artifacts plus the production source patch archive under $releaseRelative.
- Preserve unrelated download, playback, Tier-learning, collector and layout changes as uncommitted work. No application source changed in this recording operation. Release files match the previously recorded SHA-256 values; selected local source files were checked against the prior source snapshot.
- Prior tests/typecheck remain as recorded above; no new build, paid API request, collection, database change or deployment was run. The production source zip is a patch set for the detected deployed source, not a complete standalone application; the local and production source variants must remain distinct.
- Git commit is authorized in this conversation. GitHub push is not performed. The commit ID is recorded in the downloadable Git receipt after commit creation.
- User operating preference: do not operate the PC, apply local updates, or run commands without an explicit request. In ordinary update delivery, supply downloadable files, complete history and inline execution instructions for the user to execute. This Git recording and read-only feasibility review are the current explicitly requested operations.
- Next request is feasibility verification only: FxTwitter for author addition/bulk import; official X API for subsequent new-video polling. No implementation or scheduled-provider change is included in this completion commit.

## 2026-10-19：twizou SEO・index範囲更新の本番/ローカル適用完了

- 目的：表示名をtwizouへ変更し、現行の掲載許可基準を維持したまま動画個別・投稿者ページのindex対象とサイトマップを広げる。対象はP0-A/B、C-1〜C-3、C-6、C-7。
- 基準：本番のavailability-priority-v3を含むソースと対象ファイルをインストーラーが照合。Git HEADだけでは現行本番・ローカルの全変更を表さない。今回のGit記録は配布物と適用証跡であり、リポジトリ全ソースの同期完了とは区別する。
- 本番：ユーザー提供ログで `TWIZOU_SEO_INDEX_V1_FIX2_DEPLOYMENT_COMPLETE`、ビルドID `bQqDGHe34ulE7VuZaMUxy` を確認。ステージ確認、サイトマップ動画2,924件・投稿者83件、個別ページmetadata確認に成功。Cronと監視ラッパーは変更なし。旧runtimeバックアップは `/home/rbxfxmfd/xclip-before-twizou-seo-index-v1-fix2.rdpt4W`。
- ローカル：初回は `.next/types/validator.ts` のAppRoutes型エラーで自動復元。再実行で `LOCAL_SYNC_APPLIED files=46`。成功時バックアップは `C:\Projects\xcliprank-local-backups\twizou-seo-index-2026-10-19T11-31-02-192Z-8b68bd`。適用後に46/46ファイルが配布manifestのSHA-256と一致し、バックアップ記録が存在することを確認。成功時インストーラーは型チェックと関連4テストを通した。初回エラーはユーザーがローカルサーバー再起動との関係を推測しているが、原因は未確定。
- 配布物：`releases/20261019-twizou-seo-index/` に本番差分zip、成功したfix2スクリプト、ローカル同期zip、SHA-256を保存。元zip内の本番スクリプトは修正前なので単独で実行しない。ファイル別の照合値は同梱manifest、適用証跡・復旧条件は `docs/completions/20261019-twizou-seo-index.json` に記録。
- 未確認：Search Consoleの登録増加（事前報告4件）、本番の実データ全体・長期動作、ローカルのブラウザ動作。ユーザー提供ログに基づく本番適用と、こちらで実施したローカルファイル照合を区別する。
- 今後：変更の作成・検証・本番適用・ローカル適用を別々に追跡し、適用結果を確認できたら対象コードまたは再現可能な配布物、照合値、成功表示、復旧先をGitへ記録してGitHubへpushする。適用結果が未報告なら、このチャットから確認を促し、推測で完了扱いにしない。

## 2026-10-19：twizou SEO追加実装・個別URL順位登録の本番/ローカル適用

- 目的：`watasi_v3.md`のStep 0/A/T/B（共通index述語、タグ面、内部リンクとページ送り、メタ修正）と、ローカル管理の個別URL順位登録を反映。既存の掲載許可基準、`/p/` description、sitemapの`lastmod`は維持。
- 作成・検証：本番42ファイル、ローカル38ファイル。隔離テスト49件、最適化ビルド、模擬データでsitemap対象319本の内部リンク到達を確認。模擬検証を本番全件実測とは扱わない。
- 本番：初回は404 HTMLのhead内だけを数える検査が、Next.jsのストリーミングメタを見落として失敗。`PREVIOUS_RUNTIME_RESTORED`を確認。HTML全体ではtitle 1、robots 1、canonical 0。検査を修正した`apply-production-followup-fix1.sh`で`TWIZOU_SEO_FOLLOWUP_V1_DEPLOYMENT_COMPLETE`を確認。ビルドID `r1LEJwRjZ55ygRNWEgfC2`、sitemap動画2,926件・投稿者83件、旧runtimeバックアップ `/home/rbxfxmfd/xclip-before-twizou-seo-followup-v1-20261019.MHdQ2Y`。Cronと監視ラッパーは変更なし。
- ローカル：`LOCAL_SYNC_APPLIED files=38`、バックアップ `C:\Projects\xcliprank-local-backups\twizou-seo-followup-2026-10-19T14-18-31-472Z-507162`。適用後38/38ファイルが配布manifestのSHA-256と一致し、バックアップ記録を確認。
- 配布物と照合値：`releases/20261019-twizou-seo-followup/`、詳細は`docs/completions/20261019-twizou-seo-followup.json`。GitHubのソースツリー全体を本番へ同期した記録ではない。
- 既知の未完了：ローカル個別URL登録画面は認証エラーをユーザーが報告。原因は入力したキーを本番へ渡す前にローカルの`CRON_SECRET`で照合していたこと。ローカル専用修正版を準備中で、個別URLの実登録成功は未確認。Search Consoleの増加、本番全URL到達率、全ページ種別のHTML一覧照合も未実測。

## 2026-10-19：個別URL登録のローカル認証修正

- 管理画面で入力した管理キーをローカルの別設定と照合して弾いていた問題を修正。ローカルAPIは入力キーを本番へ転送し、管理画面からキーを変更できるようにした。
- ユーザー提供ログで `LOCAL_PRECHECK_OK files=3`、`LOCAL_SYNC_APPLIED files=3` を確認。バックアップは `C:\Projects\xcliprank-local-backups\twizou-manual-ranking-auth-2026-10-19T14-29-57-975Z-8760a0`。適用後の3ファイルは配布manifestのSHA-256と一致。
- 配布物は `releases/20261019-twizou-manual-ranking-auth/`、詳細証跡は `docs/completions/20261019-twizou-manual-ranking-auth.json`。本番コードの変更は含まない。
- この修正後、公開サイトの `/api/manual-ranking` が403 HTMLとなる別問題を確認。したがって個別URL登録の実動作は未確認。公開側で通る既存APIを使う修正版を別リリースとして準備中であり、ローカル認証修正単体を機能完了とは扱わない。

## 2026-10-19：個別URLランキング登録のAPI経路修正を本番・ローカルに適用

- 背景：公開サイトの新設 `/api/manual-ranking` は403 HTMLで遮断される一方、既存の閲覧APIへのGETと操作記録APIへのPOSTはアプリまで届くことを、ユーザー提供の読み取り専用・空データ診断で確認した。
- 変更：管理画面の状態読み取りを `GET /api/public-video?type=placement`、登録を `POST /api/engagement?type=placement` に接続。両方とも既存の本番管理キー認証へ委譲する。通常の閲覧・操作記録処理を維持。
- 事前検証：隔離テスト50件と最適化ビルド、ローカルインストーラーの隔離適用・復元を確認。本番スクリプトはソース・配布ハッシュ照合、テスト、型検査、ビルド、切替後の公開経路確認を行い、失敗時は旧ランタイムへ復元する。
- 本番：ユーザー提供ログで `CURRENT_SOURCE_AND_BRIDGE_PAYLOAD_HASHES_MATCH`、`STAGED_PAYLOAD_FILES_COPIED=3`、`SITEMAP_CHECK_OK posts=2926 accounts=83`、`MANUAL_RANKING_BRIDGE_AUTH_CHECK_OK; invalid token rejected; no write`、`TWIZOU_MANUAL_RANKING_BRIDGE_V1_DEPLOYMENT_COMPLETE` を確認。ビルドID `liCSzSpUlf0rPlnOfTmZJ`。旧runtimeバックアップ `/home/rbxfxmfd/xclip-before-twizou-manual-ranking-bridge-v1-20261019.jKs7gK`。Cronと監視ラッパーは変更なし。
- ローカル：ユーザー提供ログで `LOCAL_PRECHECK_OK files=2`、`LOCAL_SYNC_APPLIED files=2` を確認。バックアップ `C:\Projects\xcliprank-local-backups\twizou-manual-ranking-bridge-2026-10-19T14-54-16-726Z-39961d`。適用後の2ファイルは配布manifestのSHA-256と一致し、バックアップ記録も確認。
- 配布物と照合値：`releases/20261019-twizou-manual-ranking-bridge/`、詳細は `docs/completions/20261019-twizou-manual-ranking-bridge.json`。このGit記録は配布物と適用証跡であり、本番・ローカルのソースツリー全体をGitHubと同期したことを意味しない。
- 未確認：有効な管理キーによる状態読み取りと実際のURL登録・ランキング反映。無効な管理キーの拒否は確認済みだが、成功経路を推測で完了扱いにしない。

### 2026-10-20 追記：管理画面からの実動作確認

- ユーザーが本番の `CRON_SECRET` を管理画面のキーとして設定し、認証が通ったと報告。
- ユーザーが個別URLを1件登録し、指定したランキング順位への表示まで確認したと報告。これをユーザーによる実動作確認として記録する。登録URL、順位、登録日時、公開データの独立照合は行っていない。
