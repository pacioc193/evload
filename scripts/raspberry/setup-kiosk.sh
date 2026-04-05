#!/usr/bin/env bash
# =============================================================================
# evload – Kiosk Setup Script (Unix/Linux – run on the Raspberry Pi)
# =============================================================================
# Configures Chromium kiosk mode + screen blanking for an already-installed
# evload instance. Run this if you only need to (re)configure the kiosk.
#
# Usage:
#   chmod +x setup-kiosk.sh && sudo ./setup-kiosk.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }

EVLOAD_PORT="${EVLOAD_PORT:-3001}"
KIOSK_URL="http://localhost:${EVLOAD_PORT}/garage"
SCREEN_BLANK_MIN="${SCREEN_BLANK_MIN:-5}"
AUTOSTART_DIR="/etc/xdg/lxsession/LXDE-pi"
AUTOSTART_FILE="${AUTOSTART_DIR}/autostart"

[[ $EUID -eq 0 ]] || { warn "Not running as root — some steps may fail."; }

# Install Chromium + unclutter if missing
info "Checking Chromium installation..."
if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null; then
  apt-get install -y -qq chromium-browser || apt-get install -y -qq chromium
fi
CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null)
info "Using Chromium: ${CHROMIUM_BIN}"

command -v unclutter &>/dev/null || apt-get install -y -qq unclutter

# Configure autostart
info "Writing LXDE autostart file..."
mkdir -p "${AUTOSTART_DIR}"

# Remove any previous evload kiosk lines
if [[ -f "${AUTOSTART_FILE}" ]]; then
  sed -i '/chromium/d; /unclutter/d; /xset/d' "${AUTOSTART_FILE}"
fi

BLANK_SEC=$((SCREEN_BLANK_MIN * 60))

cat >> "${AUTOSTART_FILE}" <<EOF

# evload kiosk — added by setup-kiosk.sh
@unclutter -idle 0.5 -root
@${CHROMIUM_BIN} --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-features=TranslateUI --app=${KIOSK_URL}
@xset s ${BLANK_SEC} ${BLANK_SEC}
@xset dpms ${BLANK_SEC} ${BLANK_SEC} ${BLANK_SEC}
EOF

info "Autostart configured:"
cat "${AUTOSTART_FILE}"

echo ""
echo -e "${GREEN}Kiosk setup done.${NC} Reboot to activate: sudo reboot"
echo "  Kiosk URL: ${KIOSK_URL}"
echo "  Screen blanks after ${SCREEN_BLANK_MIN} minute(s)."
