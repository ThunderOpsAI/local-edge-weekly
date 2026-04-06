param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,
    [string]$TaskName = "LocalEdgeHourlyRuns",
    [int]$MaxRuns = 10
)

$ErrorActionPreference = "Stop"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js is required to trigger scheduled Local Edge runs."
}

$runner = Join-Path $PSScriptRoot "trigger-local-edge-run.mjs"
if (-not (Test-Path -LiteralPath $runner)) {
    throw "Missing runner script at '$runner'."
}

& $node.Path $runner --project-id $ProjectId --task-name $TaskName --max-runs $MaxRuns
exit $LASTEXITCODE
