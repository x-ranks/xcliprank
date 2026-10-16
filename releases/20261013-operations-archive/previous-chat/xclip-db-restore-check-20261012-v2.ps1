param([Parameter(Mandatory=$true)][string]$Dump,[Parameter(Mandatory=$true)][string]$PgBin,[string]$TestRoot="$env:USERPROFILE\Documents\XclipBackups")
$ErrorActionPreference='Stop'
# v2: isolate native stderr from PowerShell errors and use an explicit test locale.
function ConvertTo-NativeArgument([string]$Value) {
 $slash=[string][char]92; $quote=[string][char]34
 $result=$quote; $slashes=0
 foreach($ch in $Value.ToCharArray()){
  if($ch -eq [char]92){$slashes++;continue}
  if($ch -eq [char]34){$result+=($slash*($slashes*2+1))+$quote}
  else{$result+=($slash*$slashes)+[string]$ch}
  $slashes=0
 }
 return $result+($slash*($slashes*2))+$quote
}
function Invoke-NativeChecked {
 param([string]$Exe,[string[]]$Arguments,[string]$LogBase,[string]$FailureCode)
 $joined=($Arguments | ForEach-Object {ConvertTo-NativeArgument $_}) -join ' '
 $proc=Start-Process -FilePath $Exe -ArgumentList $joined -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput ($LogBase+'.out.txt') -RedirectStandardError ($LogBase+'.err.txt')
 if($proc.ExitCode -ne 0){throw "$FailureCode (exit=$($proc.ExitCode)); private logs: $LogBase"}
}
$Dump=(Resolve-Path -LiteralPath $Dump).Path
$PgBin=(Resolve-Path -LiteralPath $PgBin).Path
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
$started=$false;$verified=$false
Write-Host "RESTORE_TEST_DIRECTORY=$base"
try{
 Invoke-NativeChecked -Exe (Join-Path $PgBin 'initdb.exe') -Arguments @('-D',$data,'-U','xclip_restore','-A','trust','--encoding=UTF8','--locale=C','--text-search-config=pg_catalog.simple') -LogBase (Join-Path $base 'initdb-private') -FailureCode 'TEST_CLUSTER_INIT_FAILED'
 Invoke-NativeChecked -Exe (Join-Path $PgBin 'pg_ctl.exe') -Arguments @('-D',$data,'-l',$log,'-o',"-h 127.0.0.1 -p $port",'-w','start') -LogBase (Join-Path $base 'start-private') -FailureCode 'TEST_CLUSTER_START_FAILED'
 $started=$true
 $connection=@('-X','-w','-h','127.0.0.1','-p',"$port",'-U','xclip_restore','-d','postgres')
 Invoke-NativeChecked -Exe (Join-Path $PgBin 'psql.exe') -Arguments ($connection+@('-At','-c','show data_directory;')) -LogBase (Join-Path $base 'identity-private') -FailureCode 'TEST_CLUSTER_IDENTITY_READ_FAILED'
 $actual=[IO.File]::ReadAllText((Join-Path $base 'identity-private.out.txt')).Trim()
 if([IO.Path]::GetFullPath($actual) -ne [IO.Path]::GetFullPath($data)){throw 'TEST_CLUSTER_IDENTITY_MISMATCH'}
 Invoke-NativeChecked -Exe (Join-Path $PgBin 'psql.exe') -Arguments ($connection+@('-v','ON_ERROR_STOP=1','-c','DROP SCHEMA public; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')) -LogBase (Join-Path $base 'prepare-private') -FailureCode 'TEST_DATABASE_PREPARE_FAILED'
 Invoke-NativeChecked -Exe (Join-Path $PgBin 'pg_restore.exe') -Arguments @('--exit-on-error','--no-owner','--no-privileges','--schema=public','-w','-h','127.0.0.1','-p',"$port",'-U','xclip_restore','-d','postgres',$Dump) -LogBase (Join-Path $base 'restore-private') -FailureCode 'PUBLIC_SCHEMA_RESTORE_FAILED'
 Invoke-NativeChecked -Exe (Join-Path $PgBin 'psql.exe') -Arguments ($connection+@('-v','ON_ERROR_STOP=1','-c','SELECT count(*) AS restored_posts FROM public.posts; SELECT count(*) AS restored_authors FROM public.authors;')) -LogBase (Join-Path $base 'counts') -FailureCode 'RESTORED_APP_TABLES_CHECK_FAILED'
 $verified=$true
}finally{
 if($started){Invoke-NativeChecked -Exe (Join-Path $PgBin 'pg_ctl.exe') -Arguments @('-D',$data,'-m','fast','-w','stop') -LogBase (Join-Path $base 'stop-private') -FailureCode 'TEST_CLUSTER_STOP_FAILED'}
}
if($verified){
 @{
  release='db-restore-check-20261012-v2';status='PUBLIC_SCHEMA_RESTORE_OK';target='new isolated local PostgreSQL cluster';
  productionTouched=$false;dumpSHA256=(Get-FileHash -LiteralPath $Dump -Algorithm SHA256).Hash.ToLower();
  limitations=@('public schema only; managed Supabase schemas/auth/settings/storage bodies are outside this restoration test','Owners and grants were not applied; test locale is C and is not a production collation equivalence test','No application or provider collection was started')
 } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $base 'SAFE-REPORT.json') -Encoding UTF8
 Write-Host 'XCLIP_PUBLIC_SCHEMA_RESTORE_CHECK_OK'
 Get-Content -LiteralPath (Join-Path $base 'counts.out.txt')
 Write-Host "RESTORE_TEST_DIRECTORY=$base"
}
