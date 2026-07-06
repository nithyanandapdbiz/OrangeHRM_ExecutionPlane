# ============================================================================
# demo-dev-change.ps1
#
# One-shot end-to-end demo of the dev-change reconciliation pipeline against
# the configured AUT (Application Under Test).
#
# What it does:
#   1. Verifies the AUT is reachable.
#   2. Boots the API server (port 4001) if not already running.
#   3. Creates a throw-away git branch and INJECTS a simulated dev change
#      (additive, non-destructive — adds a new live smoke spec).
#   4. POSTs /api/dev-change/analyse with skipExecution=false so Playwright
#      actually runs against the configured AUT URL.
#   5. Polls the job until done, then prints decisions / cycle / outcomes.
#   6. Optionally cleans up the branch and any auto-started server.
#
# Usage (PowerShell):
#   .\scripts\demo-dev-change.ps1                # run the demo
#   .\scripts\demo-dev-change.ps1 -Scenario A    # selector drift (failure path)
#   .\scripts\demo-dev-change.ps1 -Scenario B    # additive smoke spec (default)
#   .\scripts\demo-dev-change.ps1 -DryRun        # plan only, no live execution
#   .\scripts\demo-dev-change.ps1 -KeepBranch    # don't reset the demo branch
#   .\scripts\demo-dev-change.ps1 -KeepServer    # don't kill the API at end
#
# Environment variables:
#   AUT_BASE_URL   — base URL of the AUT (required)
#   AUT_USERNAME   — auth username (optional)
#   AUT_PASSWORD   — auth password (optional)
# ============================================================================

[CmdletBinding()]
param(
  [ValidateSet('A','B')] [string] $Scenario   = 'B',
  [string] $ApiSecret    = 'demo-secret-realtime',
  [int]    $Port         = 4001,
  [switch] $DryRun,
  [switch] $NoAi,
  [switch] $KeepBranch,
  [switch] $KeepServer,
  [int]    $TimeoutSec   = 600
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$autBaseUrl = if ($env:AUT_BASE_URL) { $env:AUT_BASE_URL } else { throw "AUT_BASE_URL env var is required" }

function Write-Header($msg) { Write-Host ""; Write-Host "=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)     { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Step($msg)   { Write-Host "[STEP] $msg" -ForegroundColor Yellow }
function Write-Info($msg)   { Write-Host "[INFO] $msg" -ForegroundColor Gray }

# ----------------------------------------------------------------------------
# 1. Pre-flight: live AUT reachability + git clean
# ----------------------------------------------------------------------------
Write-Header "1. Pre-flight checks"

Write-Step "Probing $autBaseUrl ..."
try {
  $r = Invoke-WebRequest `
        -Uri $autBaseUrl `
        -UseBasicParsing -TimeoutSec 15
  if ($r.StatusCode -ne 200) { throw "HTTP $($r.StatusCode)" }
  Write-Ok "AUT reachable (HTTP 200)"
} catch {
  Write-Error "AUT unreachable: $($_.Exception.Message)"
  exit 1
}

Write-Step "Verifying git working tree is clean ..."
$dirty = git status --porcelain
if ($dirty) {
  Write-Error "Working tree has uncommitted changes. Commit or stash first.`n$dirty"
  exit 1
}
Write-Ok "Working tree clean"

# ----------------------------------------------------------------------------
# 2. Boot API server if not running
# ----------------------------------------------------------------------------
Write-Header "2. API server (port $Port)"

$serverProc      = $null
$serverWasRunning = $false
try {
  $ping = Invoke-WebRequest -Uri "http://localhost:$Port/api/dev-change/cycles" `
            -Headers @{ Authorization = "Bearer $ApiSecret" } `
            -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
  $serverWasRunning = $true
  Write-Ok "API server already running"
} catch {
  Write-Step "Starting API server in background ..."
  $env:API_SECRET                       = $ApiSecret
  $env:PORT                             = "$Port"
  $env:DEV_CHANGE_ENABLED               = 'true'
  $env:DEV_CHANGE_ENABLE_ADVERSARIAL    = 'true'
  $env:DEV_CHANGE_SELF_CRITIQUE_ENABLED = 'true'
  $env:AI_ENRICH_DEV_CHANGE_CROSSRUN    = 'true'
  $env:AI_ENRICH_DEV_CHANGE_LEARNING    = 'true'
  $env:BASE_URL                         = $autBaseUrl
  $logFile = Join-Path $root 'logs\demo-api-server.log'
  if (-not (Test-Path (Split-Path $logFile))) { New-Item -ItemType Directory -Path (Split-Path $logFile) | Out-Null }
  $serverProc = Start-Process -FilePath 'node' -ArgumentList 'src/main.js' `
                 -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" `
                 -PassThru -WindowStyle Hidden
  Write-Info "PID=$($serverProc.Id) log=$logFile"

  # Wait up to 20s for boot
  $ok = $false
  for ($i=0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
      Invoke-WebRequest -Uri "http://localhost:$Port/api/dev-change/cycles" `
        -Headers @{ Authorization = "Bearer $ApiSecret" } `
        -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop | Out-Null
      $ok = $true; break
    } catch { }
  }
  if (-not $ok) {
    Write-Error "API server did not become ready in 20s. See $logFile"
    if ($serverProc) { $serverProc | Stop-Process -Force -ErrorAction SilentlyContinue }
    exit 1
  }
  Write-Ok "API server ready"
}

# ----------------------------------------------------------------------------
# 3. Create demo branch + inject change
# ----------------------------------------------------------------------------
Write-Header "3. Inject simulated dev change (Scenario $Scenario)"

$branch = "demo/dev-change-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss')
$base   = git rev-parse HEAD
git checkout -b $branch | Out-Null
Write-Ok "Branch: $branch (base=$($base.Substring(0,7)))"

$demoPageFile = if ($env:DEMO_PAGE_FILE) { $env:DEMO_PAGE_FILE } else { $null }

switch ($Scenario) {
  'A' {
    if (-not $demoPageFile -or -not (Test-Path $demoPageFile)) {
      Write-Error "Scenario A requires DEMO_PAGE_FILE env var pointing to an existing page object JS file."
      exit 1
    }
    Write-Step "Scenario A: inject selector rename in $demoPageFile (failure path)"
    $orig    = Get-Content $demoPageFile -Raw
    $patched = $orig -replace 'data-testid="([^"]+)"', 'data-testid="$1-renamed"'
    if ($patched -eq $orig) { Write-Error "No data-testid attributes found in $demoPageFile to rename"; exit 1 }
    Set-Content -Path $demoPageFile -Value $patched -NoNewline
    git commit -am "feat(ui): rename data-testid selectors (simulated dev change)" | Out-Null
  }
  'B' {
    Write-Step "Scenario B: add new live smoke spec (additive)"
    $healthPath = if ($env:APP_HEALTH_URL) { $env:APP_HEALTH_URL } else { '/' }
    $spec = @"
const { test, expect } = require('@playwright/test');

/**
 * Demo: live AUT smoke spec injected by demo-dev-change.ps1.
 * Verifies the dev-change pipeline picks up the new spec and runs it.
 */
test('AUT: home page reachable', async ({ page }) => {
  await page.goto('$healthPath');
  await expect(page).toHaveURL(/.*/);
  await expect(page.locator('body')).toBeVisible();
});
"@
    $specPath = 'tests/specs/live_aut_smoke.spec.js'
    Set-Content -Path $specPath -Value $spec -Encoding UTF8
    git add $specPath | Out-Null
    git commit -m "test(aut): add live AUT smoke spec" | Out-Null
  }
}
$head = git rev-parse HEAD
Write-Ok "Committed head=$($head.Substring(0,7))"

# ----------------------------------------------------------------------------
# 4. Trigger pipeline via REST
# ----------------------------------------------------------------------------
Write-Header "4. POST /api/dev-change/analyse"

$h    = @{ Authorization = "Bearer $ApiSecret"; 'Content-Type' = 'application/json' }
$body = @{
  baseSha       = $base
  headSha       = $head
  dryRun        = [bool]$DryRun
  noAi          = [bool]$NoAi
  skipExecution = [bool]$DryRun
  headless      = $true
} | ConvertTo-Json

Write-Info ("payload: " + $body)
$job = Invoke-RestMethod -Uri "http://localhost:$Port/api/dev-change/analyse" `
        -Method Post -Headers $h -Body $body
Write-Ok "jobId=$($job.jobId) status=$($job.status)"

# ----------------------------------------------------------------------------
# 5. Poll
# ----------------------------------------------------------------------------
Write-Header "5. Poll job (timeout ${TimeoutSec}s)"

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$final    = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $s = Invoke-RestMethod -Uri "http://localhost:$Port/api/dev-change/jobs/$($job.jobId)" -Headers @{ Authorization = "Bearer $ApiSecret" }
  Write-Host ("  [{0}] status={1} exit={2}" -f (Get-Date -Format HH:mm:ss), $s.status, $s.exitCode)
  if ($s.status -ne 'running') { $final = $s; break }
}
if (-not $final) {
  Write-Error "Job did not finish within $TimeoutSec s — still running. Job ID: $($job.jobId)"
  exit 3
}
Write-Ok "Final status: $($final.status) (exit=$($final.exitCode))"

# ----------------------------------------------------------------------------
# 6. Inspect results
# ----------------------------------------------------------------------------
Write-Header "6. Pipeline output"

$h2   = @{ Authorization = "Bearer $ApiSecret" }
$sha7 = $head.Substring(0,7)

Write-Host ""; Write-Host "--- Decisions (last 10) ---" -ForegroundColor Cyan
try {
  Invoke-RestMethod -Uri "http://localhost:$Port/api/dev-change/decisions?limit=10" -Headers $h2 |
    Select-Object -ExpandProperty entries |
    Format-Table timestamp, agentName,
                 @{n='in'; e={ ($_.input  | ConvertTo-Json -Compress) }},
                 @{n='out';e={ ($_.output | ConvertTo-Json -Compress) }} -AutoSize
} catch { Write-Info $_.Exception.Message }

Write-Host ""; Write-Host "--- Cycle for $sha7 ---" -ForegroundColor Cyan
try {
  Invoke-RestMethod -Uri "http://localhost:$Port/api/dev-change/cycles/$sha7" -Headers $h2 |
    ConvertTo-Json -Depth 5
} catch { Write-Info "no cycle yet for $sha7" }

Write-Host ""; Write-Host "--- outcomes.jsonl (last 10) ---" -ForegroundColor Cyan
$outFile = Join-Path $root 'logs\dev-change\outcomes.jsonl'
if (Test-Path $outFile) {
  Get-Content $outFile -Tail 10
} else {
  Write-Info "no outcomes.jsonl yet"
}

Write-Host ""; Write-Host "--- Report file ---" -ForegroundColor Cyan
$report = Join-Path $root "logs\dev-change\$sha7-report.json"
if (Test-Path $report) {
  Write-Ok $report
  Write-Info "Pretty-print: Get-Content '$report' | ConvertFrom-Json | ConvertTo-Json -Depth 6"
} else {
  Write-Info "Report not found: $report"
}

Write-Host ""; Write-Host "--- Tuning snapshot ---" -ForegroundColor Cyan
try { npm run --silent dev-change:tune } catch { Write-Info $_.Exception.Message }

# ----------------------------------------------------------------------------
# 7. Cleanup
# ----------------------------------------------------------------------------
Write-Header "7. Cleanup"

if ($KeepBranch) {
  Write-Info "Branch '$branch' kept (per -KeepBranch)."
} else {
  Write-Step "Resetting working tree and deleting demo branch ..."
  git checkout - 2>&1 | Out-Null
  git branch -D $branch 2>&1 | Out-Null
  Write-Ok "Branch $branch deleted"
}

if ($serverProc -and -not $KeepServer -and -not $serverWasRunning) {
  Write-Step "Stopping auto-started API server (PID $($serverProc.Id))"
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  Write-Ok "API server stopped"
} elseif ($serverWasRunning) {
  Write-Info "API server was pre-existing — leaving it running."
} elseif ($KeepServer) {
  Write-Info "API server kept running (per -KeepServer). Logs: logs\demo-api-server.log"
}

# ----------------------------------------------------------------------------
# Exit code = pipeline's exit code (2 = review-required, which is normal)
# ----------------------------------------------------------------------------
Write-Host ""
Write-Host "DONE. Pipeline exit code: $($final.exitCode)" -ForegroundColor Magenta
exit $final.exitCode
