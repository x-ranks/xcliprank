param([switch]$Check,[switch]$Install)
$ErrorActionPreference = 'Stop'
if ($Check -eq $Install) { throw 'Specify exactly one of -Check or -Install.' }
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workerPath = Join-Path $PSScriptRoot 'run-auto-label-worker.cjs'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$taskName = 'TwizouAutoLabelLocal'
if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) { throw 'WORKER_MISSING' }
& $nodePath $workerPath --check
if ($LASTEXITCODE -ne 0) { throw 'WORKER_PRECHECK_FAILED' }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) { throw 'TASK_ALREADY_EXISTS; inspect it before making changes' }
if ($Check) { Write-Output "TASK_PRECHECK_OK name=$taskName interval=3h account=$([Security.Principal.WindowsIdentity]::GetCurrent().Name); no changes"; return }
$action = New-ScheduledTaskAction -Execute $nodePath -Argument ('"' + $workerPath + '" --run') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 3) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel LeastPrivilege
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Local-only twizou automatic labeling; model and frames stay on this PC.' | Out-Null
Write-Output "TASK_REGISTERED name=$taskName interval=3h; results=.local-admin/label-auto-v1/worker-runs.log"
