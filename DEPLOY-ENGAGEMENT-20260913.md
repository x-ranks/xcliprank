# サイト内計測画面 v1 デプロイ手順

## 1. Supabase SQL

Supabase DashboardのSQL Editorで、次のファイル全体を1回だけ実行します。

`supabase/engagement-page-view-20260913.sql`

成功後にPowerShellへ進みます。

## 2. PowerShell

ZIPをWindowsのダウンロードフォルダーへ保存した前提です。

```powershell
Set-Location $env:USERPROFILE\Downloads

$Zip = ".\site-backup-xcliprank-engagement-dashboard-20260913.zip"
$Destination = ".\xcliprank-engagement-dashboard-20260913"

Expand-Archive -Path $Zip -DestinationPath $Destination -Force
Set-Location "$Destination\site-backup-20260907-1788717004708\project"

npm install
npm run build
npx vercel@latest login
npx vercel@latest whoami
npx vercel@latest --prod
```

Vercel CLIへ既にログイン済みなら、`login`は省略できます。

## 3. 公開後の確認

`https://xcliprank.com/engagement-admin`

Vercelに設定済みの`CRON_SECRET`を入力し、7日・30日の計測値を確認します。
