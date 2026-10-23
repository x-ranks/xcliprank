param([ValidateSet('Check','Apply')][string]$Mode = 'Check')
$ErrorActionPreference = 'Stop'
$project = 'C:\Projects\xcliprank'
$release = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -LiteralPath (Join-Path $release 'manifest.json') -Raw | ConvertFrom-Json
$files = @($manifest)
foreach ($item in $files) {
  $target = Join-Path $project $item.path
  $candidate = Join-Path $release $item.path
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "TARGET_MISSING $($item.path)" }
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "CANDIDATE_MISSING $($item.path)" }
  $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $item.baselineSha256) { throw "BASELINE_MISMATCH $($item.path)" }
  if ((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.candidateSha256) { throw "CANDIDATE_MISMATCH $($item.path)" }
}
Write-Output "LOCAL_PRECHECK_OK files=$($files.Count); no changes"
if ($Mode -eq 'Check') { return }
$backup = Join-Path $release ('backup-' + (Get-Date -Format 'yyyyMMddTHHmmss'))
New-Item -ItemType Directory -Force -Path $backup | Out-Null
foreach ($item in $files) {
  $destination = Join-Path $backup $item.path
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath (Join-Path $project $item.path) -Destination $destination
}
Write-Output "LOCAL_BACKUP=$backup"
try {
  foreach ($item in $files) {
    Copy-Item -LiteralPath (Join-Path $release $item.path) -Destination (Join-Path $project $item.path)
    if ((Get-FileHash -LiteralPath (Join-Path $project $item.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.candidateSha256) { throw "APPLIED_HASH_MISMATCH $($item.path)" }
  }
  Write-Output "LOCAL_SYNC_APPLIED files=$($files.Count) backup=$backup"
} catch {
  foreach ($item in $files) { Copy-Item -LiteralPath (Join-Path $backup $item.path) -Destination (Join-Path $project $item.path) -ErrorAction Stop }
  Write-Output 'LOCAL_SYNC_FAILED_PREVIOUS_FILES_RESTORED'
  throw
}
