> **2026-10-13 保存用ブランチ**：最新版の設定・完了履歴・配布物は [現在の状況](docs/XCLIP_CURRENT_STATUS.md) を参照。現行ローカルは `snapshots/local-20261013/`、本番用の既知差分は `snapshots/production-known-files-20261013/`。以下のルートの旧アプリ説明から直接公開しないでください。

# X Video Rank MVP

X API → Supabase → Ranking → X公式埋め込み、までをつないだテスト実装です。

## 1. Supabase
1. Supabaseで新規Projectを作成
2. SQL Editorで `supabase/schema.sql` を実行
3. Project URL / Publishable Key / Service Role Key を取得

## 2. X Developer
X Developer PlatformでAppを作成しBearer Tokenを取得します。

このMVPは Recent Search:
`GET https://api.x.com/2/tweets/search/recent`
を使用します。

`.env.local` の `X_SEARCH_QUERY` で収集条件を変更できます。

初期値:
`has:videos -is:retweet lang:ja`

成人向けサイトとして運営する場合も、最初は「信頼できる投稿者のallowlist + has:videos」のように対象を限定し、未成年・非合意・違法コンテンツの掲載を防ぐ審査レイヤーを別途設けることを推奨します。

## 3. 環境変数
`.env.example` を `.env.local` にコピーして値を設定:

```bash
cp .env.example .env.local
```

## 4. 起動
Node.js 20+ 推奨。

```bash
npm install
npm run dev
```

ブラウザ:
`http://localhost:3000`

### ローカル視覚判定モデル

`visual-filter-model/group1-shard1of1.bin` はローカルの確認画面だけで使用します。
本番環境ではモデル配信APIが意図的に404を返すため、このバイナリはGitHubへ保存しません。
固定ローカルフォルダでは既存ファイルをそのまま保持してください。リポジトリを新しくcloneした場合は、
以前のプロジェクトから同ファイルを `visual-filter-model/` へコピーすると確認画面を利用できます。

`data/teacher-authors.json` もローカルの教師評価履歴を含むためGitHubへ保存しません。
固定ローカルフォルダでは既存ファイルを保持し、別PCへ移す場合のみ安全な経路で個別にコピーしてください。

## 5. 収集を1回実行
ブラウザまたはcurl:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  http://localhost:3000/api/collect
```

成功するとSupabaseの `posts` と `metric_snapshots` に保存されます。

## 6. ランキング
- 急上昇: 直近6時間
- 24時間: 直近24時間
- 週間: 直近168時間

現時点では `score` の単純ソートです。
`lib/ranking.ts` で重みを変更できます。

## 7. X埋め込み
フロントはXの公式 widgets.js の `createTweet()` を使い、投稿IDから元投稿を埋め込みます。
動画ファイル自体はこのアプリに保存しません。

## 8. Vercel
GitHubへpushしてVercelへImportし、環境変数を設定してください。
`vercel.json` に30分ごとのcron設定を含めています。

注意: Vercel Cronの認証方法や利用可能な実行頻度はプラン/仕様変更の影響を受けるため、公開前にVercel公式ドキュメントで現行仕様を確認してください。

## 追加すべき実運用機能
- allowlist / blocklist
- 管理画面
- 投稿の手動非表示
- 削除済みX投稿の自動除外
- コンテンツ審査
- 通報フォーム
- 年齢ゲート
- DMCA/権利者削除窓口
- APIコスト監視
- キャッシュ
- スコアのvelocity化
