param([string]$Project='C:\Projects\xcliprank',[string]$BackupRoot="$env:USERPROFILE\Documents\XclipBackups")
$ErrorActionPreference='Stop'
$engine=Join-Path $PSScriptRoot 'xclip-snapshot-20261012.cjs'
if(!(Test-Path -LiteralPath $engine)){throw '同梱cjsを同じフォルダへ展開してください。'}
$node=(Get-Command node -ErrorAction Stop).Source
if((Read-Host '管理画面・開発サーバー・編集・学習処理を終了したら YES と入力') -cne 'YES'){throw '中止しました。'}
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$target=Join-Path $BackupRoot ('local-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
$pw=Read-Host 'バックアップ用パスフレーズ（12文字以上・復元時にも必要）' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try{
 $env:XCLIP_BACKUP_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 & $node $engine local $Project $target
 if($LASTEXITCODE -ne 0){throw 'バックアップ未完了。上のエラーコードを共有してください。'}
}finally{
 Remove-Item Env:XCLIP_BACKUP_PASSWORD -ErrorAction SilentlyContinue
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
Write-Host '復元テスト先には秘密情報があります。共有するのは SAFE-REPORT.json だけにしてください。'
