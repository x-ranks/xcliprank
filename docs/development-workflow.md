> 2026-10-11 現行運用への注記：以下のVercel公開手順は過去の運用記録です。現在の本番はColorfulBoxです。着手前に [更新履歴](XCLIP_UPDATE_HISTORY.md) と [更新照合台帳](xclip-update-artifacts.json) を確認し、公開中のruntime・DEPLOY_SOURCE・BUILD_IDに対応するコードを基準にしてください。作成・検証・ローカル適用・本番適用を区別し、各更新を履歴へ追記してください。固定作業先とローカルデータの保護事項は引き続き有効です。

> 2026-10-19 適用確認後のGit記録：本番・ローカルそれぞれの完了ログと対象ファイルを照合できたら、変更内容・版・SHA-256・バックアップ・未確認事項を更新履歴と照合台帳または `docs/completions/` に記し、対象コードまたは再現可能な配布物を限定してcommitし、GitHubへpushする。未コミットの別作業は巻き込まない。適用結果が未報告ならユーザーに確認し、完了を推定しない。この運用は現行のColorfulBox本番に対するもので、以下のVercel公開手順を復活させるものではない。

# Xcliprank ローカル開発・GitHub・Vercel運用

## 作業場所

固定フォルダは C:\Projects\xcliprank。旧バックアップを直接編集しない。

## 日常の手順

1. 固定フォルダで git status を確認する。
2. 未コミット変更を保護したうえで git pull --ff-only を実行する。失敗したら履歴分岐を調べ、勝手にmerge/rebaseしない。
3. git switch -c <作業ブランチ名> でブランチを作成する。
4. npm ci でpackage-lock.jsonに従って依存関係を用意する。
5. npm run dev -- --port 3004 で起動する。管理・学習画面は http://localhost:3004/learning-tools。
6. ローカル画面・型・npm run buildを検証する。
7. 対象ファイルを指定してstageし、git diff --cachedを確認してcommitする。秘密情報を含めない。
8. git push -u origin <作業ブランチ名> でpushする。
9. Vercel Previewでランキング・再生・主要ページ・APIを確認する。
10. Preview成功後にmainへ統合し、Productionとhttps://xcliprank.comを確認する。

接続先はPrivateのx-ranks/xcliprankと既存のxrankings/x-video-rank-mvp。Git接続・自動デプロイの稼働確認は移行作業の完了報告で確認する。

## Gitに入らないローカルファイル

|配置先|用途|
|---|---|
|.env.local|ローカル環境の認証・接続設定。値を文書化・共有・commitしない|
|visual-filter-model/group1-shard1of1.bin|ローカル視覚判定用のモデル重み|
|data/teacher-authors.json|ローカル教師評価履歴|
|data/visual-preference-model.json|学習済み好みモデルと学習情報|
|data/visual-preference-feature-cache/|ローカル特徴量キャッシュ|
|artifacts/visual-preference-poc/|ローカル学習・評価成果物|
|artifacts/visual-preference-holdout/|ローカル検証成果物|

現在のPCではこれらを保持する。新しいPCでcloneしても復元されないため、旧環境から安全な方法で同じ相対パスへ個別にコピーする。依存関係と.nextは再生成する。

.env.exampleは説明用ダミーのみを含む設定例。本物のキーを入れない。

本番ではローカル学習用APIの一部が意図的に404を返す。ローカル学習機能の検証にはdevサーバーを使用する。

## 本番の保護

Vercelの既存環境変数・ドメインは削除・上書きしない。Preview未検証のコードをProductionへ投入しない。異常時は直前の正常デプロイを確認してロールバックの承認を得る。旧フォルダは移行完了まで保持する。
