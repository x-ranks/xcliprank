param(
  [string]$ProjectRoot = 'C:\Projects\xcliprank',
  [string]$Rollback = ''
)
$ErrorActionPreference = 'Stop'
$taskInstaller = Join-Path $PSScriptRoot 'install.cjs'
$taskArguments = @($taskInstaller, '--project', $ProjectRoot)
if($Rollback){ $taskArguments += @('--rollback', $Rollback) }
& node @taskArguments
if($LASTEXITCODE -ne 0){ throw 'ラベル学習の更新を完了できませんでした。表示されたエラーコードを共有してください。' }
