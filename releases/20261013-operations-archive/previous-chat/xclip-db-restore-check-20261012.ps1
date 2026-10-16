param([Parameter(Mandatory=$true)][string]$Dump,[Parameter(Mandatory=$true)][string]$PgBin,[string]$TestRoot="$env:USERPROFILE\Documents\XclipBackups")
$ErrorActionPreference='Stop'
$Dump=(Resolve-Path -LiteralPath $Dump).Path
foreach($name in @('initdb.exe','pg_ctl.exe','pg_restore.exe','psql.exe')){if(!(Test-Path -LiteralPath (Join-Path $PgBin $name))){throw "RESTORE_CLIENT_MISSING: $name"}}
New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
$base=Join-Path $TestRoot ('db-restore-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $base | Out-Null
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls $base '/inheritance:r' '/grant:r' "*$($sid):(OI)(CI)F" | Out-Null
if($LASTEXITCODE -ne 0){throw 'PRIVATE_TEST_ACL_FAILED'}
$data=Join-Path $base 'cluster';$log=Join-Path $base 'postgres-private.log'
$listener=New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
$started=$false
try{
 & (Join-Path $PgBin 'initdb.exe') '-D' $data '-U' 'xclip_restore' '-A' 'trust' '--encoding=UTF8' 1> (Join-Path $base 'initdb-private.log') 2>&1
 if($LASTEXITCODE -ne 0){throw 'TEST_CLUSTER_INIT_FAILED'}
 & (Join-Path $PgBin 'pg_ctl.exe') '-D' $data '-l' $log '-o' "-h 127.0.0.1 -p $port" '-w' 'start' | Out-Null
 if($LASTEXITCODE -ne 0){throw 'TEST_CLUSTER_START_FAILED'}
 $started=$true
 # All connections are explicitly to the newly created LOCAL cluster.
 $actual=& (Join-Path $PgBin 'psql.exe') '-X' '-h' '127.0.0.1' '-p' "$port" '-U' 'xclip_restore' '-d' 'postgres' '-At' '-c' 'show data_directory;'
 if($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($actual.Trim()) -ne [IO.Path]::GetFullPath($data)){throw 'TEST_CLUSTER_IDENTITY_MISMATCH'}
 & (Join-Path $PgBin 'psql.exe') '-X' '-v' 'ON_ERROR_STOP=1' '-h' '127.0.0.1' '-p' "$port" '-U' 'xclip_restore' '-d' 'postgres' '-c' 'DROP SCHEMA public; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;' 1> (Join-Path $base 'prepare-private.log') 2>&1
 if($LASTEXITCODE -ne 0){throw 'TEST_DATABASE_PREPARE_FAILED'}
 & (Join-Path $PgBin 'pg_restore.exe') '--exit-on-error' '--no-owner' '--no-privileges' '--schema=public' '-h' '127.0.0.1' '-p' "$port" '-U' 'xclip_restore' '-d' 'postgres' $Dump 1> (Join-Path $base 'restore-private.log') 2>&1
 if($LASTEXITCODE -ne 0){throw 'PUBLIC_SCHEMA_RESTORE_FAILED: Supabase固有の拡張・依存も確認します。復元ログは非公開で保持してください。'}
 & (Join-Path $PgBin 'psql.exe') '-X' '-v' 'ON_ERROR_STOP=1' '-h' '127.0.0.1' '-p' "$port" '-U' 'xclip_restore' '-d' 'postgres' '-c' 'SELECT count(*) AS restored_posts FROM public.posts; SELECT count(*) AS restored_authors FROM public.authors;' 1> (Join-Path $base 'counts.txt') 2>&1
 if($LASTEXITCODE -ne 0){throw 'RESTORED_APP_TABLES_CHECK_FAILED'}
 @{
  status='PUBLIC_SCHEMA_RESTORE_OK';target='new isolated local PostgreSQL cluster';
  productionTouched=$false;dumpSHA256=(Get-FileHash -LiteralPath $Dump -Algorithm SHA256).Hash.ToLower();
  limitations=@('public schema only; managed Supabase schemas/auth/settings/storage bodies are outside this restoration test','Owners and grants were not applied to the local test; confirm the actual recovery target separately','No application or provider collection was started')
 } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $base 'SAFE-REPORT.json') -Encoding UTF8
 Write-Host 'XCLIP_PUBLIC_SCHEMA_RESTORE_CHECK_OK'
 Get-Content -LiteralPath (Join-Path $base 'counts.txt')
 Write-Host "RESTORE_TEST_DIRECTORY=$base"
}finally{
 if($started){& (Join-Path $PgBin 'pg_ctl.exe') '-D' $data '-m' 'fast' '-w' 'stop' | Out-Null}
}
