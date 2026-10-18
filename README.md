## 2026-10-18 最新候補：全動画自動ラベル・スマホ個別ページ v1

ユーザーが目視なしの概略自動ラベル公開を明示許可。新しい全動画モードで自動推定→本番メタデータ反映、既存手動正解は保護。旧「目視必須」は手動確認モードに残す。`/label-publication` から明示開始し、画面を開いている間だけ1件ずつ進めて途中再開。×ボタンで元の一覧/page/edition/位置へ戻る。公開index条件や巡回/削除/モデルを保持。

今回のコードは作成・隔離検証・配布済み候補で、実ローカル/本番への今回適用と全件推定は未実施。以前の本番v2/ローカル適用、手動反映81件の画面確認は完了済み。`releases/20261018-auto-labels-mobile-v1` と docs/completions/20261018-auto-labels-mobile-source.json を優先。Git直下はローカル候補、production/sourceは別の本番候補。モデル/教師/実state/.envは公開Gitへ入れない。ユーザーから別途依頼がない限りPC/UI操作や実環境適用は行わない。

## 2026-10-18 最新：本番v2・ローカルの適用完了

両方のインストーラー成功をユーザー提供ログで確認。v1/v2のローカル更新内容は同一。ユーザーが再起動と `/label-publication` での手動正解の準備・本番反映操作まで実施したと報告。画面で準備100件・反映済み81件・独立精度確認0件を確認。残り19件の理由と公開表示・保存/戻る/共有の実動作確認は結果待ち。根拠：docs/completions/20261018-public-labels-publication81-observed.json。下記の未適用/未受領は当時の履歴。モデル/教師/巡回状態を保持し、未依頼の実環境適用やPC操作をしない。

## 2026-10-18 最新状態：個別URL・ラベル公開基盤v2は本番適用済み

ユーザー提供のv2完了ログ・公開HTTP200・API認証確認成功で本番適用を確認。`production/source` のアプリ本体とv2配布処理が現行。`snapshots/production-live-20261018` は適用前の保存版。今回ローカル更新と実ラベル公開の成功報告は未受領。根拠：docs/completions/20261018-public-labels-pages-v2-production-applied.json。以下の未適用/旧版復旧/未実装という説明は当時の履歴で、この状態を優先する。v1を再実行しない。モデル/教師/巡回状態をGitへ含めず、明示依頼のない実環境適用・PC操作を行わない。

## 2026-10-18 最新：本番配布v2（API許可一覧の修正）

v1はユーザー実行時に公開確認401→403で失敗し、旧runtimeへ復旧済み（トップ/24時間HTTP200）。本番ラベル・個別URLは未適用。v2は `tools/xclip-public-labels-pages-deploy-20261018-v2.sh`。新APIだけApache許可一覧へ追加し、認証を維持、失敗時は設定も復旧します。未知設定は拒否。アプリ本体/ローカルPS1はv1と同一。`releases/20261018-public-labels-pages-v2` と累積履歴を参照し、v1を再実行しないでください。v2の本番成功は未確認です。

## 2026-10-18 最新候補：本番ラベル反映と個別URL

学習100件完了を確認。`/label-publication` で手動正解を本番へ反映、新しい動画は4枚を見て推定を確定して反映できます。`/p/[投稿ID]` に保存/投稿者/同投稿者/ラベル関連リンクと固有title/自己canonicalを追加。保存またはランキング登場の記録があり、掲載条件を満たす動画だけインデックス対象。本文も保存実績もない動画はnoindex。教師/モデルはPC内に保持。

ローカルは直下、本番の最新候補は `production/source/`、確認済み稼働版は `snapshots/production-live-20261018/`。今回機能はコード作成・検証の段階で、実環境への適用は未実施。配布物は `releases/20261018-public-labels-pages-v1/`。既存の100教材を上書き・Git登録しません。

# Xclip：最新ローカル管理ソース

最新版mainはラベル学習100件v2を含みます。v1はPR #13でGitHub Node22検証成功、v2はローカル39回帰/型/隔離build/220 SHA確認済み。10/16時点の基準タグは`local-admin-20261016`。根拠：`docs/completions/20261017-label-learning-source.json`と10/16の保存記録。

2026-10-16に実ローカル `C:\Projects\xcliprank` の未コミット・未追跡を含むコードを統合しました。リポジトリ直下の `app/`・`lib/` が現在のローカル管理版です。過去のZIPを順に適用する必要はありません。

**本番ColorfulBoxの全文を取得・照合し、`production/source` に本番用の最新候補を統合しました。直下をColorfulBoxへそのまま配置しないでください。** ローカルのランキングAPIは本番表示を読むプレビュー用で、公開サーバーの集計APIと異なります。`production/README.md` を参照してください。

## 取得と起動

Node.js 22系とnpmを用意し、新しい作業フォルダへ取得します。既存の稼働フォルダへ上書きしないでください。

```powershell
git clone https://github.com/x-ranks/xcliprank.git xcliprank-latest
cd xcliprank-latest
npm ci
npm run check:source
npm run test:offline
```

管理者が既存の安全な保管先から `.env.local` と必要なローカルデータを復元してから起動します。設定名は `.env.example` にあります。値はGitHubやチャットへ保存しません。

```powershell
npm run dev -- -p 3004
```

http://localhost:3004/learning-tools が管理機能への入口です。投稿者管理 `/curated-manager`、巡回記録 `/fxtwitter-monitor`、再生不可監視 `/availability-monitor`。

GitだけでDB・登録一覧・取得位置・予約枠・手動除去・教師データ・モデルを復元することはできません。DBは既存Supabaseを使用し、同じDBと本番連携先／CRON_SECRETを管理者が設定します。旧DBパスワードは2026-10-12にリセット済みです。

動画フレーム抽出にはFFmpeg／FFprobeが必要です。古いブラウザー判定ツールが使う `visual-filter-model/group1-shard1of1.bin` はGit対象外なので既存の正しい資材を別途復元してください。教師／学習済みモデルをGitへ追加しないでください。

## 検証

```powershell
node scripts/check-canonical.cjs types
node scripts/check-canonical.cjs build
```

検証はコードを一時フォルダへコピーし、外部通信を拒否して実行します。実ローカル・本番・DB・providerへ適用しません。36回帰テスト、型検査、Next.jsビルド成功。FFmpegが必要な2テストは別実行です。実ブラウザーの再生・通常巡回の全投稿者成功は別途確認が必要です。

`docs/canonical-source-baseline-20261016.json` に取得元とSHAを記録しています。`npm run check:source` はその固定版の照合です。今後アプリを変更したら、確認済み変更として台帳と基準SHAを更新してください。

## 運用と資料

- 公開サイトはColorfulBox。新着巡回はFxTwitterへ一時切替済み。直近24h24投稿者／3h8投稿者／同一24h／5秒間隔、失敗も1枠。登録上限1,000と区別します。
- 現在の状態：`docs/XCLIP_CURRENT_STATUS.md`。履歴：`docs/XCLIP_UPDATE_HISTORY.md`。全45タスク：`docs/XCLIP_OPERATIONS_TASKS.md`。
- 別AIへの入口：`docs/XCLIP_AI_HANDOFF_20261016.md`。同資料の「ルート旧版」という説明はこのソース整理前の記録です。現在は本READMEと最新状態を優先します。
- `snapshots/` と `releases/` は取得時点の保存資料です。古い配布物を現行コードに再適用しないでください。
- GitHubはユーザー指定で公開を継続。秘密・実state・DB dump・教師／モデルは含めません。
- 旧VercelへのGit自動デプロイは `vercel.json` の `git.deploymentEnabled=false` で無効化。旧Vercel Cronを現在の運用として使いません。設定根拠：https://vercel.com/docs/project-configuration/git-configuration

本番ソースの取得待ちは解消済みです。今回候補の実ローカル・本番適用とラベル公開はまだ行っていません。

## 2026-10-17追加：ラベル管理と学習

`http://localhost:3004/label-learning`でラベルを作成し、動画4枚を確認して該当/非該当/未確認を保存できます。学習用10動画以上から試作し、教材内のグループ分割検証と未使用動画での精度チェックを別表示します。ラベルごとに該当/非該当2件以上必要です。最初は少数のラベルで確認してください。

画像/モデル/教師は`.local-admin/label-learning-v1`のPC内保存。既存Tier、既存ラベルJSON、本番掲載やDBの更新はしません。`npm run dev -- --hostname localhost -p 3004`で起動してください（production実行ではラベル機能を無効化）。FFmpeg/FFprobeと既存画像モデルの読込が必要で、動画準備は最大96MiB/本の通信とCPUを使用します。2026-10-17にユーザー許可で実ローカルへv2を適用・再起動済み。保存済み14ラベル/10教材/モデルを保持し、実100教材と精度確認はこれからです。

最新配布ZIPと累積履歴は`releases/20261017-label-learning100-v2/`（旧v1も保持）。既存C:\Projects\xcliprank向けZIPには現行SHAのガードがあり、Gitの新規取得へ重ねて適用する必要はありません。

100件へ進む手順：画面で「学習用100件まで準備・再開」または「次の学習用10件を準備」→4枚を確認し正解保存→「保存済み○件すべてで学習する」。その後「新しいランダム10件を精度確認用に準備」→予測を見る前に正解保存→「正解と予測を比べて精度チェック」。ラベルは画面幅に合わせて横に折り返します。途中停止/画面終了後は同じボタンで保存済み件数から再開します。
