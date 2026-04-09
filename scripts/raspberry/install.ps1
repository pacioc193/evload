# =============================================================================
# evload – Raspberry Pi 4 Full Installation Script (Windows / PowerShell)
# =============================================================================
# Run from your Windows machine to SSH-deploy evload to a Raspberry Pi.
# Prerequisites:
#   - SSH key-based access to the RPi (or password auth)
#   - PowerShell 5.1+ or PowerShell 7+ (pwsh)
#   - The Posh-SSH module OR OpenSSH in PATH
#
# Usage:
#   .\install.ps1 -RpiHost 192.168.1.100 -RpiUser pi
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$RpiHost,

    [string]$RpiUser = "pi",
    [int]   $EvloadPort = 3001,
    [int]   $ScreenBlankMin = 5
)

$ErrorActionPreference = "Stop"

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    [OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "    [WARN] $Msg" -ForegroundColor Yellow }

# ── Helpers ───────────────────────────────────────────────────────────────────
function Invoke-Ssh {
    param([string]$Cmd, [switch]$NoFail)
    $result = & ssh "$RpiUser@$RpiHost" $Cmd
    if ($LASTEXITCODE -ne 0 -and -not $NoFail) {
        throw "SSH command failed (exit $LASTEXITCODE): $Cmd"
    }
    return $result
}

function Copy-To-Rpi {
    param([string]$Local, [string]$Remote)
    & scp -r $Local "${RpiUser}@${RpiHost}:${Remote}"
    if ($LASTEXITCODE -ne 0) { throw "scp failed: $Local -> $Remote" }
}

# ── Resolve repo root ─────────────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = Resolve-Path (Join-Path $ScriptDir "../..")

Write-Step "Building evload locally (backend + frontend)..."
Push-Location $RepoRoot
try {
    & npm run build --prefix backend
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed" }
    & npm run build --prefix frontend
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
} finally {
    Pop-Location
}
Write-Ok "Local build complete."

Write-Step "Uploading evload to ${RpiUser}@${RpiHost}:/opt/evload ..."
Invoke-Ssh "sudo mkdir -p /opt/evload && sudo chown ${RpiUser}:${RpiUser} /opt/evload" -NoFail
Copy-To-Rpi "$RepoRoot\backend"  "/opt/evload/"
Copy-To-Rpi "$RepoRoot\frontend" "/opt/evload/"
Write-Ok "Files uploaded."

Write-Step "Running remote installation steps..."

$remoteScript = @"
set -euo pipefail

# System dependencies
sudo apt-get update -qq
sudo apt-get install -y -qq git curl unclutter

# Node.js 20 LTS
if ! node -e 'process.exit(parseInt(process.version.slice(1))>=20?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
  sudo apt-get install -y -qq nodejs
fi

# Chromium
command -v chromium-browser >/dev/null 2>&1 || sudo apt-get install -y -qq chromium-browser || sudo apt-get install -y -qq chromium
CHROMIUM=\$(command -v chromium-browser 2>/dev/null || command -v chromium)

cd /opt/evload

# Force clean npm reinstall (backend + frontend)
rm -rf backend/node_modules frontend/node_modules
npm ci --prefix backend --omit=dev
npm ci --prefix frontend

# .env setup
if [[ ! -f backend/.env ]]; then
  cp backend/.env.example backend/.env
  JWT=\$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=\${JWT}/" backend/.env
  echo "PORT=$EvloadPort" >> backend/.env
  echo "GARAGE_MODE=true" >> backend/.env
fi

# config.yaml
[[ -f backend/config.yaml ]] || cp backend/config.example.yaml backend/config.yaml

mkdir -p backend/data

# Prisma
cd backend && npx prisma generate && (npx prisma migrate deploy || npx prisma db push --accept-data-loss) && cd ..

# systemd
sudo tee /etc/systemd/system/evload.service >/dev/null <<SVCEOF
[Unit]
Description=evload
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/evload/backend
EnvironmentFile=/opt/evload/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable evload
sudo systemctl restart evload
if ! systemctl is-active --quiet evload; then
    journalctl -u evload -n 120 --no-pager || true
    exit 1
fi

# Kiosk autostart
AUTOSTART_DIR=/etc/xdg/lxsession/LXDE-pi
sudo mkdir -p "\$AUTOSTART_DIR"
AUTOSTART="\${AUTOSTART_DIR}/autostart"
sudo sed -i '/chromium/d; /unclutter/d; /xset/d' "\$AUTOSTART" 2>/dev/null || true
BLANK_SEC=\$((${ScreenBlankMin} * 60))
sudo tee -a "\$AUTOSTART" >/dev/null <<KIOSK
@unclutter -idle 0.5 -root
@\${CHROMIUM} --kiosk --noerrdialogs --disable-infobars --app=http://localhost:${EvloadPort}/garage
@xset s \${BLANK_SEC} \${BLANK_SEC}
@xset dpms \${BLANK_SEC} \${BLANK_SEC} \${BLANK_SEC}
KIOSK

echo "Done."
"@

Invoke-Ssh $remoteScript
Write-Ok "Remote installation complete."

Write-Step "Summary"
Write-Host ""
Write-Host "  RPi address  : $RpiHost"
Write-Host "  Web UI       : http://${RpiHost}:${EvloadPort}"
Write-Host "  Garage kiosk : http://${RpiHost}:${EvloadPort}/garage"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Edit /opt/evload/backend/config.yaml on the RPi"
Write-Host "    2. Reboot the RPi:  ssh ${RpiUser}@${RpiHost} 'sudo reboot'"
Write-Host ""
