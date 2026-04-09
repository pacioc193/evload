#!/usr/bin/env bash
# =============================================================================
# evload – Official RPi 7" Display Setup Script (Unix/Linux – run on RPi)
# =============================================================================
# Configures the official Raspberry Pi 7" 800×480 touch display:
#   - Display rotation (0=normal / 90 / 180 / 270 degrees)
#   - DPMS screen-off timeout
#   - Touch screen input calibration hint
#   - vcgencmd display_power permission for GARAGE_MODE
#
# Usage:
#   chmod +x setup-display.sh && sudo ./setup-display.sh
#   sudo ./setup-display.sh --rotation 0
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }

ROTATION="${ROTATION:-0}"           # 0 | 90 | 180 | 270
DPMS_BLANK_SEC="${DPMS_BLANK_SEC:-300}"  # 5 minutes default

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rotation)  ROTATION="$2";      shift 2 ;;
    --dpms)      DPMS_BLANK_SEC="$2"; shift 2 ;;
    *) warn "Unknown option: $1"; shift ;;
  esac
done

[[ $EUID -eq 0 ]] || { warn "Not running as root — /boot/config.txt edits will fail."; }

BOOT_CONFIG="/boot/config.txt"
# Raspberry Pi OS Bookworm uses /boot/firmware/config.txt
[[ -f "/boot/firmware/config.txt" ]] && BOOT_CONFIG="/boot/firmware/config.txt"

info "Using boot config: ${BOOT_CONFIG}"
info "Display rotation : ${ROTATION}°"
info "DPMS blank       : ${DPMS_BLANK_SEC}s"

# ── Display rotation ──────────────────────────────────────────────────────────
# Remove any previous display_rotate line
sed -i '/^display_rotate/d' "${BOOT_CONFIG}"

case "${ROTATION}" in
  0)   info "Normal orientation — no display_rotate needed." ;;
  90)  echo "display_rotate=1" >> "${BOOT_CONFIG}"; info "Rotation 90° applied." ;;
  180) echo "display_rotate=2" >> "${BOOT_CONFIG}"; info "Rotation 180° applied." ;;
  270) echo "display_rotate=3" >> "${BOOT_CONFIG}"; info "Rotation 270° applied." ;;
  *)   warn "Unknown rotation value '${ROTATION}'. Valid: 0, 90, 180, 270." ;;
esac

# ── Enable DRM display driver (required for HDMI / DSI on newer kernels) ──────
if ! grep -q "^dtoverlay=vc4-kms-v3d" "${BOOT_CONFIG}"; then
  echo "dtoverlay=vc4-kms-v3d" >> "${BOOT_CONFIG}"
  info "Added vc4-kms-v3d overlay."
fi

# ── vcgencmd permission (GARAGE_MODE display on/off) ─────────────────────────
info "Adding 'pi' user to the 'video' group for vcgencmd access..."
usermod -aG video pi 2>/dev/null || warn "Could not add pi to video group (may already be a member)."

# Allow sudo for vcgencmd without password (for evload GARAGE_MODE)
SUDOERS_FILE="/etc/sudoers.d/evload-vcgencmd"
if [[ ! -f "${SUDOERS_FILE}" ]]; then
  echo "pi ALL=(ALL) NOPASSWD: /usr/bin/vcgencmd display_power *" > "${SUDOERS_FILE}"
  chmod 440 "${SUDOERS_FILE}"
  info "sudoers rule created: pi can run vcgencmd display_power without password."
fi

# ── DPMS via xorg config ──────────────────────────────────────────────────────
XORG_CONF="/etc/X11/xorg.conf.d/10-evload-dpms.conf"
mkdir -p /etc/X11/xorg.conf.d
cat > "${XORG_CONF}" <<EOF
# evload – DPMS configuration for garage display
Section "ServerFlags"
  Option "BlankTime"   "$(( DPMS_BLANK_SEC / 60 ))"
  Option "StandbyTime" "$(( DPMS_BLANK_SEC / 60 ))"
  Option "SuspendTime" "$(( DPMS_BLANK_SEC / 60 ))"
  Option "OffTime"     "$(( DPMS_BLANK_SEC / 60 ))"
EndSection

Section "Monitor"
  Option "DPMS"
EndSection
EOF
info "Xorg DPMS config written to ${XORG_CONF}."

# ── Touch calibration hint ────────────────────────────────────────────────────
echo ""
info "Touch calibration:"
echo "  If touches are rotated/offset after display rotation, install xinput-calibrator:"
echo "    sudo apt-get install -y xinput-calibrator"
echo "    DISPLAY=:0 xinput_calibrator"
echo "  Then copy the generated Section to /etc/X11/xorg.conf.d/99-calibration.conf"
echo ""
echo -e "${GREEN}Display setup done.${NC} Reboot to apply: sudo reboot"
