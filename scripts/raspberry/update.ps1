# =============================================================================
# evload – Remote Update Script (Windows PowerShell → Raspberry Pi)
# =============================================================================
# Builds evload locally, syncs compiled output to the RPi, restarts the
# service, and waits for the health check.
#
# Prerequisites:
#   - OpenSSH client in PATH  (Settings → Optional Features → OpenSSH Client)
#   - rsync for Windows (optional, via Git-for-Windows or WSL) — falls back to scp
#   - Node.js 20+ on the build machine
#
# Usage:
#   .\update.ps1 -RpiHost 192.168.1.100
#   .\update.ps1 -RpiHost 192.168.1.100 -RpiUser pi -EvloadPort 3001
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$RpiHost,

    [string]$RpiUser        = "pi",
    [int]   $EvloadPort     = 3001,
    [string]$InstallDir     = "/opt/evload",
    [int]   $HealthRetries  = 12,
    [int]   $HealthWaitSec  = 5
)

$ErrorActionPreference = "Stop"

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    [OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "    [WARN] $Msg" -ForegroundColor Yellow }

$SshTarget = "${RpiUser}@${RpiHost}"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir "../..")

# ── Step 1: Local build ────────────────────────────────────────────────────────
Write-Step "Building backend..."
Push-Location $RepoRoot
try {
    & npm run build --prefix backend
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
    Write-Ok "Backend built."

    Write-Step "Building frontend..."
    & npm run build --prefix frontend
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
    Write-Ok "Frontend built."
} finally {
    Pop-Location
}

# ── Step 2: Sync to RPi ───────────────────────────────────────────────────────
Write-Step "Syncing dist files to ${SshTarget}:${InstallDir} ..."

$rsyncAvailable = $null -ne (Get-Command rsync -ErrorAction SilentlyContinue)

if ($rsyncAvailable) {
    # Convert Windows paths to Unix-style for rsync
    $backendSrc  = "$RepoRoot/backend/dist/"
    $frontendSrc = "$RepoRoot/frontend/dist/"

    & rsync -avz --delete $backendSrc  "${SshTarget}:${InstallDir}/backend/dist/"
    & rsync -avz --delete $frontendSrc "${SshTarget}:${InstallDir}/frontend/dist/"
    & rsync -avz "$RepoRoot/backend/prisma/" "${SshTarget}:${InstallDir}/backend/prisma/"
} else {
    Write-Warn "rsync not found — using scp (slower, no deletion of old remote files)"
    & scp -r "$RepoRoot\backend\dist"  "${SshTarget}:${InstallDir}/backend/"
    & scp -r "$RepoRoot\frontend\dist" "${SshTarget}:${InstallDir}/frontend/"
    & scp -r "$RepoRoot\backend\prisma" "${SshTarget}:${InstallDir}/backend/"
}

Write-Ok "Files synced."

# ── Step 3: DB migration + service restart ────────────────────────────────────
Write-Step "Applying DB schema and restarting service on RPi..."
$remoteCmd = "cd ${InstallDir}/backend && npx prisma generate && npx prisma db push --accept-data-loss && sudo systemctl restart evload"
& ssh $SshTarget $remoteCmd
Write-Ok "Service restarted."

# ── Step 4: Health check ──────────────────────────────────────────────────────
Write-Step "Waiting for evload health check..."
$healthUrl = "http://${RpiHost}:${EvloadPort}/api/health"
$healthy   = $false

for ($i = 1; $i -le $HealthRetries; $i++) {
    Start-Sleep -Seconds $HealthWaitSec
    try {
        $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch { Write-Host "." -NoNewline }
}

Write-Host ""
if ($healthy) {
    Write-Ok "evload is healthy: $healthUrl"
} else {
    Write-Warn "Health check did not return 200 after $($HealthRetries * $HealthWaitSec)s"
    Write-Host "  Check logs: ssh $SshTarget 'journalctl -u evload -n 50 --no-pager'"
}

Write-Host ""
Write-Host "Update complete.  http://${RpiHost}:${EvloadPort}" -ForegroundColor Green
