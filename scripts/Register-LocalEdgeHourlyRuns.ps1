param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,
    [string]$TaskName = "LocalEdgeHourlyRuns",
    [int]$MaxRuns = 10,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$invokeScript = Join-Path $PSScriptRoot "Invoke-LocalEdgeScheduledRun.ps1"
if (-not (Test-Path -LiteralPath $invokeScript)) {
    throw "Missing runner script at '$invokeScript'."
}

$automationDir = Join-Path $repoRoot ".automation"
if (-not (Test-Path -LiteralPath $automationDir)) {
    New-Item -ItemType Directory -Path $automationDir | Out-Null
}

$safeTaskName = ($TaskName -replace '[^A-Za-z0-9._-]+', '-').Trim('-')
if ([string]::IsNullOrWhiteSpace($safeTaskName)) {
    $safeTaskName = "LocalEdgeHourlyRuns"
}

$statePath = Join-Path $automationDir "$safeTaskName.json"
if (Test-Path -LiteralPath $statePath) {
    Remove-Item -LiteralPath $statePath -Force
}

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false | Out-Null
}

$currentUser = if ($env:USERDOMAIN) {
    "$($env:USERDOMAIN)\$($env:USERNAME)"
}
else {
    $env:USERNAME
}

$startAt = (Get-Date).AddHours(1)
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$invokeScript`" -ProjectId `"$ProjectId`" -TaskName `"$TaskName`" -MaxRuns $MaxRuns"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 1)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Trigger Local Edge project runs once an hour until $MaxRuns runs have been queued." `
    -Force | Out-Null

Write-Output "Registered task '$TaskName'. First scheduled repeat will fire at $($startAt.ToString('yyyy-MM-dd HH:mm:ss'))."

if ($RunNow) {
    Write-Output "Triggering run 1 immediately."
    & $invokeScript -ProjectId $ProjectId -TaskName $TaskName -MaxRuns $MaxRuns
}
