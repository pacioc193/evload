#!/usr/bin/env bash
# =============================================================================
# evload – Raspberry Pi 4 + Raspbian Full Installation Script
# =============================================================================
# Usage:
#   chmod +x install.sh && sudo ./install.sh
#
# What this script does:
#   1. Updates the system
#   2. Installs Node.js 20 LTS, git, Chromium, unclutter
#   3. Copies evload to /opt/evload (or installs from the current directory)
#   4. Installs npm dependencies and builds the project
#   5. Creates .env and config.yaml from examples, generates JWT_SECRET
#   6. Pushes the Prisma database schema
#   7. Creates and enables the systemd service
#   8. Configures Chromium kiosk autostart (LXDE)
#   9. Configures screen blanking / DPMS timeout
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Config ───────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/evload"
SERVICE_NAME="evload"
EVLOAD_PORT="${EVLOAD_PORT:-3001}"
KIOSK_URL="http://localhost:${EVLOAD_PORT}/garage"
AUTOSTART_DIR="/etc/xdg/lxsession/LXDE-pi"
AUTOSTART_FILE="${AUTOSTART_DIR}/autostart"
SCREEN_BLANK_MIN="${SCREEN_BLANK_MIN:-5}"

# ── Must run as root ──────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || error "This script must be run as root (use sudo)."

# ── Step 1: System update ─────────────────────────────────────────────────────
info "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ── Step 2: Install system dependencies ──────────────────────────────────────
info "Installing system dependencies..."
apt-get install -y -qq git curl unclutter

# Node.js 20 LTS via NodeSource
if ! command -v node &>/dev/null || [[ $(node -e "process.exit(parseInt(process.version.slice(1))>=20?0:1)" 2>/dev/null; echo $?) != 0 ]]; then
  info "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
else
  info "Node.js $(node --version) already installed."
fi

# Chromium browser for kiosk
if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null; then
  info "Installing Chromium browser..."
  apt-get install -y -qq chromium-browser || apt-get install -y -qq chromium
fi
CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null)
info "Chromium binary: ${CHROMIUM_BIN}"

# ── Step 3: Copy evload to /opt/evload ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -d "${INSTALL_DIR}" ]]; then
  warn "${INSTALL_DIR} already exists — skipping copy (run update.sh to update)."
else
  info "Copying evload to ${INSTALL_DIR}..."
  cp -r "${REPO_ROOT}" "${INSTALL_DIR}"
  chown -R pi:pi "${INSTALL_DIR}" 2>/dev/null || true
fi

cd "${INSTALL_DIR}"

# ── Step 4: Install npm deps and build ────────────────────────────────────────
info "Forcing clean reinstall of backend dependencies..."
rm -rf backend/node_modules
npm ci --prefix backend --omit=dev

info "Forcing clean reinstall of frontend dependencies..."
rm -rf frontend/node_modules
npm ci --prefix frontend

info "Building project (backend + frontend)..."
npm run build --prefix backend
npm run build --prefix frontend

# ── Step 5: Create .env and config.yaml ──────────────────────────────────────
info "Setting up environment files..."
if [[ ! -f backend/.env ]]; then
  cp backend/.env.example backend/.env
  # Generate a secure JWT secret
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" backend/.env
  echo "PORT=${EVLOAD_PORT}" >> backend/.env
  echo "GARAGE_MODE=true"   >> backend/.env
  info ".env created with fresh JWT_SECRET."
else
  warn "backend/.env already exists — not overwriting."
fi

if [[ ! -f backend/config.yaml ]]; then
  cp backend/config.example.yaml backend/config.yaml
  info "config.yaml created from example."
else
  warn "backend/config.yaml already exists — not overwriting."
fi

# Ensure data directory exists
mkdir -p backend/data

# ── Step 6: Prisma DB push ────────────────────────────────────────────────────
info "Running Prisma database migration..."
cd backend
npx prisma generate
if npx prisma migrate deploy; then
  info "Prisma migrate deploy completed."
else
  warn "Prisma migrate deploy failed, falling back to prisma db push..."
  npx prisma db push --accept-data-loss
fi
cd ..

# ── Step 7: systemd service ───────────────────────────────────────────────────
info "Creating systemd service ${SERVICE_NAME}..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=evload – Tesla EV Charging Manager
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=${INSTALL_DIR}/backend
EnvironmentFile=${INSTALL_DIR}/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=evload

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl start  "${SERVICE_NAME}"
if ! systemctl is-active --quiet "${SERVICE_NAME}"; then
  error "Service ${SERVICE_NAME} is not active after startup.\n$(journalctl -u ${SERVICE_NAME} -n 120 --no-pager || true)"
fi
info "Service ${SERVICE_NAME} enabled and started."

# ── Step 8: Chromium kiosk autostart ─────────────────────────────────────────
info "Configuring Chromium kiosk autostart..."
mkdir -p "${AUTOSTART_DIR}"

# Preserve existing @lxpanel / @pcmanfm entries if present
if [[ -f "${AUTOSTART_FILE}" ]]; then
  # Remove any old evload/chromium lines we may have added
  sed -i '/chromium/d' "${AUTOSTART_FILE}"
  sed -i '/unclutter/d' "${AUTOSTART_FILE}"
fi

cat >> "${AUTOSTART_FILE}" <<EOF

# evload kiosk — added by install.sh
@unclutter -idle 0.5 -root
@${CHROMIUM_BIN} --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-features=TranslateUI --app=${KIOSK_URL}
EOF

info "Kiosk autostart configured for ${KIOSK_URL}."

# ── Step 9: Screen blanking ───────────────────────────────────────────────────
info "Configuring screen timeout (${SCREEN_BLANK_MIN} minutes)..."
BLANK_SEC=$((SCREEN_BLANK_MIN * 60))

# Disable compositor blanking via lightdm / XFCE settings files
LIGHTDM_CONF="/etc/lightdm/lightdm.conf"
if [[ -f "${LIGHTDM_CONF}" ]]; then
  if grep -q "^\[SeatDefaults\]" "${LIGHTDM_CONF}"; then
    sed -i '/^\[SeatDefaults\]/a xserver-command=X -s 0 -dpms' "${LIGHTDM_CONF}"
  fi
fi

# xset via LXDE autostart
sed -i '/xset/d' "${AUTOSTART_FILE}"
cat >> "${AUTOSTART_FILE}" <<EOF
@xset s ${BLANK_SEC} ${BLANK_SEC}
@xset dpms ${BLANK_SEC} ${BLANK_SEC} ${BLANK_SEC}
EOF

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  evload installation complete!         ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Service status : sudo systemctl status ${SERVICE_NAME}"
echo "  Backend logs   : journalctl -u ${SERVICE_NAME} -f"
echo "  Web UI         : http://localhost:${EVLOAD_PORT}"
echo "  Garage kiosk   : ${KIOSK_URL}"
echo ""
echo "  Next steps:"
echo "    1. Edit ${INSTALL_DIR}/backend/config.yaml (proxy URL, HA URL, etc.)"
echo "    2. Reboot the RPi to start the kiosk: sudo reboot"
echo ""
