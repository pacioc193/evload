# =============================================================================
# evload – Kiosk Setup Script (Windows PowerShell → Raspberry Pi)
# =============================================================================
# Configures Chromium kiosk + screen blanking on a remote RPi.
#
# Usage:
#   .\setup-kiosk.ps1 -RpiHost 192.168.1.100
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$RpiHost,

    [string]$RpiUser       = "pi",
    [int]   $EvloadPort    = 3001,
    [int]   $ScreenBlankMin = 5
)

$ErrorActionPreference = "Stop"
$SshTarget = "${RpiUser}@${RpiHost}"

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    [OK] $Msg" -ForegroundColor Green }

Write-Step "Configuring Chromium kiosk on $SshTarget ..."

$remoteScript = @"
set -euo pipefail
EVLOAD_PORT=${EvloadPort}
KIOSK_URL="http://localhost:\${EVLOAD_PORT}/garage"
SCREEN_BLANK_MIN=${ScreenBlankMin}
BLANK_SEC=\$((SCREEN_BLANK_MIN * 60))
AUTOSTART_DIR=/etc/xdg/lxsession/LXDE-pi
AUTOSTART="\${AUTOSTART_DIR}/autostart"

# Install deps
command -v chromium-browser >/dev/null 2>&1 || sudo apt-get install -y -qq chromium-browser || sudo apt-get install -y -qq chromium
command -v unclutter >/dev/null 2>&1 || sudo apt-get install -y -qq unclutter
CHROMIUM=\$(command -v chromium-browser 2>/dev/null || command -v chromium)

# Update autostart
sudo mkdir -p "\${AUTOSTART_DIR}"
sudo sed -i '/chromium/d; /unclutter/d; /xset/d' "\${AUTOSTART}" 2>/dev/null || true
sudo tee -a "\${AUTOSTART}" >/dev/null <<KIOSK

# evload kiosk
@unclutter -idle 0.5 -root
@\${CHROMIUM} --kiosk --noerrdialogs --disable-infobars --app=\${KIOSK_URL}
@xset s \${BLANK_SEC} \${BLANK_SEC}
@xset dpms \${BLANK_SEC} \${BLANK_SEC} \${BLANK_SEC}
KIOSK

echo "Kiosk configured."
"@

& ssh $SshTarget $remoteScript
Write-Ok "Done. Reboot the RPi to activate: ssh $SshTarget 'sudo reboot'"
