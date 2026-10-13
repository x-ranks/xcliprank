param([string]$PgBin='', [string]$BackupRoot="$env:USERPROFILE\Documents\XclipBackups")
$ErrorActionPreference='Stop'
$engine=Join-Path $PSScriptRoot 'xclip-snapshot-20261012.cjs'
$node=(Get-Command node -ErrorAction Stop).Source
if(!$PgBin){
 $found=Get-Command pg_dump -ErrorAction SilentlyContinue
 if($found){$PgBin=Split-Path -Parent $found.Source}
 else {
  $candidates=Get-ChildItem -LiteralPath 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
  foreach($c in $candidates){if(Test-Path -LiteralPath (Join-Path $c.FullName 'bin\pg_dump.exe')){$PgBin=Join-Path $c.FullName 'bin';break}}
 }
}
if(!$PgBin){throw 'POSTGRES_CLIENT_MISSING: PostgreSQLのコマンドラインツールを準備してください。既存のDBや設定は変更していません。'}
$dump=Join-Path $PgBin 'pg_dump.exe'; $restore=Join-Path $PgBin 'pg_restore.exe'
if(!(Test-Path -LiteralPath $dump) -or !(Test-Path -LiteralPath $restore)){throw 'POSTGRES_CLIENT_INCOMPLETE'}
if(!(Test-Path -LiteralPath $engine)){throw 'BACKUP_ENGINE_MISSING'}
# Individual fields prevent a connection URL/password from entering command history.
$env:PGHOST=Read-Host 'Supabase Connect画面のHost（Direct または Session pooler）'
$env:PGPORT=Read-Host '同じ画面のPort（Transaction poolerの6543は使わない）'
$env:PGUSER=Read-Host '同じ画面のUser'
$env:PGDATABASE=Read-Host '同じ画面のDatabase（通常postgres）'
if(!$env:PGHOST -or !$env:PGUSER -or !$env:PGDATABASE -or $env:PGPORT -notmatch '^\d+$' -or $env:PGPORT -eq '6543'){throw 'INVALID_CONNECTION_FIELDS'}
$env:PGSSLMODE='require';$env:PGCONNECT_TIMEOUT='20';$env:PGOPTIONS='-c default_transaction_read_only=on'
$dbpw=Read-Host 'DBパスワード（画面には表示されません）' -AsSecureString
$bkpw=Read-Host 'バックアップ用パスフレーズ（12文字以上）' -AsSecureString
$p1=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbpw)
$p2=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($bkpw)
$folder=$null; $plain=$null
try{
 $env:PGPASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p1)
 $env:XCLIP_BACKUP_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p2)
 if($env:XCLIP_BACKUP_PASSWORD.Length -lt 12){throw 'BACKUP_PASSWORD_TOO_SHORT'}
 New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
 $folder=Join-Path $BackupRoot ('database-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6))
 New-Item -ItemType Directory -Path $folder | Out-Null
 $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 & icacls $folder '/inheritance:r' '/grant:r' "*$($sid):(OI)(CI)F" | Out-Null
 if($LASTEXITCODE -ne 0){throw 'PRIVATE_BACKUP_ACL_FAILED'}
 $plain=Join-Path $folder 'database.dump'
 & $dump '--format=custom' '--no-password' '--lock-wait-timeout=10000' '--file' $plain 2> (Join-Path $folder 'pg_dump-private.log')
 if($LASTEXITCODE -ne 0){throw 'PG_DUMP_FAILED: pg_dump-private.logをローカルで確認してください。ログは未編集で共有しないでください。'}
 & $restore '--list' $plain 1> (Join-Path $folder 'restore-list-private.txt') 2> (Join-Path $folder 'pg_restore-private.log')
 if($LASTEXITCODE -ne 0){throw 'PG_ARCHIVE_INVALID'}
 & $node $engine file $plain (Join-Path $folder 'encrypted')
 if($LASTEXITCODE -ne 0){throw 'ENCRYPTED_BACKUP_FAILED: 元dumpは削除せず保護フォルダに保持しています。'}
 Write-Host 'XCLIP_DB_DUMP_AND_ARCHIVE_CHECK_OK'
 Write-Host "BACKUP_DIRECTORY=$folder"
 Write-Host 'DB_RESTORE=PENDING: 本番を上書きする復元は行っていません。'
 Write-Host '暗号化版を別媒体にも保存してください。平文dumpとrestore-testは非公開で管理してください。'
}finally{
 foreach($n in @('PGPASSWORD','PGHOST','PGPORT','PGUSER','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT','PGOPTIONS','XCLIP_BACKUP_PASSWORD')){Remove-Item -LiteralPath "Env:$n" -ErrorAction SilentlyContinue}
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p1)
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p2)
}
