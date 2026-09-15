# 管理ポータル統合版 デプロイ手順

このZIPは直前のX投稿流入改善も含む累積版です。

まだ実行していない場合だけ、Supabase DashboardのSQL Editorで次を1回実行します。

`supabase/x-promotion-logs-20260913.sql`

既に実行済みなら、追加SQLはありません。

## PowerShell

```powershell
Set-Location "$env:USERPROFILE\Downloads"

$Zip = ".\site-backup-xcliprank-learning-tools-hub-20260913.zip"
$Destination = ".\xcliprank-learning-tools-hub-20260913"

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

ローカル確認時は次を実行します。

```powershell
npm run dev -- -p 3004
```

確認URL：`http://localhost:3004/learning-tools`
