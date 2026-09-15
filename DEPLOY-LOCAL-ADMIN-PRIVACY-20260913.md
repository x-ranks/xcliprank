# ローカル管理画面・本番非公開版

## この版の変更

- `http://localhost:3004/learning-tools` に運営・学習画面を集約
- `x-promotion`、`engagement-admin` を含む管理画面を本番では404に変更
- localhostでは管理画面を自動認証し、CRON_SECRETの入力を不要化
- 認証付き管理APIと自動投稿APIは維持（既存の定期処理には影響なし）
- ローカル画面上部に、Supabase接続・本番ランキング照合・管理認証・X投稿認証の状態を表示
- 動画Tierレビューと教師レビューの本番反映経路を画面上に明記
- `/api/review` のSupabase初期化を遅延化し、環境変数なしのビルド失敗を解消

## 重要：ローカル管理画面の環境変数

VercelのSecret値はCLIからダウンロードできません。以前レビュー画面が動いていたプロジェクトの `.env.local` を、新しいプロジェクトへコピーしてください。Secretをチャットへ貼り付けないでください。

```powershell
Get-ChildItem "$env:USERPROFILE" -Filter ".env.local" -File -Recurse -ErrorAction SilentlyContinue |
    Select-Object FullName
```

表示された旧プロジェクトのパスを使ってコピーします。

```powershell
Copy-Item "C:\以前のプロジェクト\project\.env.local" ".\.env.local"
```

`.env.local` には少なくとも次の値が必要です。

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- X投稿を行う場合は `X_API_KEY`、`X_API_KEY_SECRET`、`X_ACCESS_TOKEN`、`X_ACCESS_TOKEN_SECRET`

## 展開・ローカル起動・デプロイ

```powershell
Set-Location "$env:USERPROFILE\Downloads"

$Zip = ".\site-backup-xcliprank-local-admin-private-20260913.zip"
$Destination = ".\xcliprank-local-admin-private-20260913"

if (Test-Path $Destination) {
    throw "展開先が既に存在します：$Destination"
}

Expand-Archive -Path $Zip -DestinationPath $Destination
Set-Location "$Destination\site-backup-20260907-1788717004708\project"

npm install
```

続いて、上記手順で旧プロジェクトから `.env.local` をコピーしてからローカル起動します。

```powershell
npm run dev -- -p 3004
```

確認URL：`http://localhost:3004/learning-tools`

本番から管理画面を非公開にする変更は、次のコマンドでデプロイします。

```powershell
npx vercel@latest login
npx vercel@latest whoami
npx vercel@latest --prod
```

## 本番反映の仕組み

### 動画Tierレビュー

レビュー保存時に、本番Supabaseの `posts.manual_tier` を直接更新します。同じ本番Supabaseを `.env.local` に設定していれば、24時間・週間・リールの対象Tier判定へ直ちに反映されます。手動D/Xはランキング対象外です。

### 参考アカウント教師レビュー

通常のS・A・その他・X評価は、まずローカルの `data/teacher-authors.json` に保存される教師データです。評価だけでは本番順位は変わりません。

本番順位へ反映する手順：

1. 参考アカウント教師レビュー
2. 視覚好みモデル学習
3. 現行＋視覚モデル比較で解析
4. 「本番用に保存」を実行

最後の操作で `posts.visual_preference_score` が本番Supabaseへ保存され、24時間・週間ランキングの同一Tier内で20%の重みとして使われます。新着は時系列優先のため、この視覚スコアによる並べ替えを行いません。

教師レビューで「規約違反」を指定した場合だけは例外で、対象動画を即時非表示・手動Tier Xとして本番Supabaseへ直接反映します。
