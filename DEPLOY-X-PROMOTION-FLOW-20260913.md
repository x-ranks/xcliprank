# X投稿流入改善版 デプロイ手順

## 1. Supabase SQL

Supabase DashboardのSQL Editorで、次のファイル全体を1回だけ実行します。

`supabase/x-promotion-logs-20260913.sql`

成功後にPowerShellへ進みます。

## 2. PowerShell

ZIPをWindowsのダウンロードフォルダーへ保存した前提です。

```powershell
Set-Location "$env:USERPROFILE\Downloads"

$Zip = ".\site-backup-xcliprank-x-promotion-flow-20260913.zip"
$Destination = ".\xcliprank-x-promotion-flow-20260913"

if (Test-Path $Destination) {
    throw "展開先が既に存在します：$Destination"
}

Expand-Archive -Path $Zip -DestinationPath $Destination
Set-Location "$Destination\site-backup-20260907-1788717004708\project"

npm install
npm run build
npx vercel@latest login
npx vercel@latest whoami
npx vercel@latest --prod
```

Vercel CLIへログイン済みなら、`login`は省略できます。

## 3. 公開後の確認

1. `https://xcliprank.com/x-promotion` を開く
2. `CRON_SECRET`を入力する
3. A・B・Cの3文面を切り替えられることを確認する
4. 投稿履歴欄が表示されることを確認する
5. 投稿する場合はアカウントを確認し、1文面を選んで送信する

同じ日・同じTOP3を再送すると、重複防止により投稿前に停止します。
