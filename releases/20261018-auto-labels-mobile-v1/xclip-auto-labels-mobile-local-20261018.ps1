param([string]$ProjectRoot='C:\Projects\xcliprank',[string]$Rollback='')
$ErrorActionPreference='Stop'
$taskArgs=@((Join-Path $PSScriptRoot 'local\install.cjs'),'--project',$ProjectRoot)
if($Rollback){$taskArgs+=@('--rollback',$Rollback)}
& node @taskArgs
if($LASTEXITCODE -ne 0){throw '更新を完了できませんでした。表示されたエラーコードを共有してください。'}
