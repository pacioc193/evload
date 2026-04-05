# =============================================================================
# evload – Official RPi 7" Display Setup Script (Windows PowerShell → RPi)
# =============================================================================
# Configures the official Raspberry Pi 7" 800×480 touch display on a remote
# RPi: rotation, DPMS, vcgencmd sudoers entry.
#
# Usage:
#   .\setup-display.ps1 -RpiHost 192.168.1.100
#   .\setup-display.ps1 -RpiHost 192.168.1.100 -Rotation 180 -DpmsBlankSec 300
# =============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$RpiHost,

    [string]$RpiUser      = "pi",
    [int]   $Rotation     = 0,       # 0 | 90 | 180 | 270
    [int]   $DpmsBlankSec = 300      # 5 minutes
)

$ErrorActionPreference = "Stop"
$SshTarget = "${RpiUser}@${RpiHost}"

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    [OK] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "    [WARN] $Msg" -ForegroundColor Yellow }

Write-Step "Configuring RPi display on $SshTarget (rotation=${Rotation}°, DPMS=${DpmsBlankSec}s)..."

$remoteScript = @"
set -euo pipefail
ROTATION=${Rotation}
DPMS_BLANK_SEC=${DpmsBlankSec}

# Detect boot config path (Bookworm uses /boot/firmware/config.txt)
BOOT_CONFIG=/boot/config.txt
[[ -f /boot/firmware/config.txt ]] && BOOT_CONFIG=/boot/firmware/config.txt
echo "Using boot config: \${BOOT_CONFIG}"

# Display rotation
sudo sed -i '/^display_rotate/d' "\${BOOT_CONFIG}"
case "\${ROTATION}" in
  90)  echo "display_rotate=1" | sudo tee -a "\${BOOT_CONFIG}" ;;
  180) echo "display_rotate=2" | sudo tee -a "\${BOOT_CONFIG}" ;;
  270) echo "display_rotate=3" | sudo tee -a "\${BOOT_CONFIG}" ;;
  *)   echo "No rotation applied (0 or unknown)." ;;
esac

# DRM overlay
grep -q "^dtoverlay=vc4-kms-v3d" "\${BOOT_CONFIG}" || echo "dtoverlay=vc4-kms-v3d" | sudo tee -a "\${BOOT_CONFIG}"

# vcgencmd permission
sudo usermod -aG video pi 2>/dev/null || true
SUDOERS=/etc/sudoers.d/evload-vcgencmd
if [[ ! -f "\${SUDOERS}" ]]; then
  echo "pi ALL=(ALL) NOPASSWD: /usr/bin/vcgencmd display_power *" | sudo tee "\${SUDOERS}" >/dev/null
  sudo chmod 440 "\${SUDOERS}"
  echo "sudoers entry created."
fi

# DPMS xorg config
DPMS_MIN=\$(( DPMS_BLANK_SEC / 60 ))
sudo mkdir -p /etc/X11/xorg.conf.d
sudo tee /etc/X11/xorg.conf.d/10-evload-dpms.conf >/dev/null <<XORG
Section "ServerFlags"
  Option "BlankTime"   "\${DPMS_MIN}"
  Option "StandbyTime" "\${DPMS_MIN}"
  Option "SuspendTime" "\${DPMS_MIN}"
  Option "OffTime"     "\${DPMS_MIN}"
EndSection
Section "Monitor"
  Option "DPMS"
EndSection
XORG

echo "Done."
"@

& ssh $SshTarget $remoteScript
Write-Ok "Display configured. Reboot the RPi: ssh $SshTarget 'sudo reboot'"
