#!/usr/bin/env bash
# =============================================================================
# evload – Remote Update Script (Unix/macOS → Raspberry Pi)
# =============================================================================
# Builds evload locally, syncs the compiled output to the RPi via rsync/scp,
# then restarts the systemd service and waits for the health check.
#
# Usage:
#   chmod +x update.sh
#   RPI_HOST=192.168.1.100 ./update.sh
#   # or:
#   ./update.sh pi@192.168.1.100
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Config ────────────────────────────────────────────────────────────────────
RPI_HOST="${RPI_HOST:-${1:-}}"
RPI_USER="${RPI_USER:-pi}"
EVLOAD_PORT="${EVLOAD_PORT:-3001}"
INSTALL_DIR="${INSTALL_DIR:-/opt/evload}"
HEALTH_RETRIES=12
HEALTH_WAIT_SEC=5

[[ -z "${RPI_HOST}" ]] && error "Set RPI_HOST or pass the host as the first argument.\nExample: RPI_HOST=192.168.1.100 ./update.sh"

# Strip user@ prefix if provided as first arg
if [[ "${RPI_HOST}" == *@* ]]; then
  RPI_USER="${RPI_HOST%%@*}"
  RPI_HOST="${RPI_HOST##*@}"
fi

SSH_TARGET="${RPI_USER}@${RPI_HOST}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Step 1: Local build ────────────────────────────────────────────────────────
info "Building backend..."
npm run build --prefix "${REPO_ROOT}/backend"

info "Building frontend..."
npm run build --prefix "${REPO_ROOT}/frontend"

# ── Step 2: Sync to RPi ───────────────────────────────────────────────────────
info "Syncing backend/dist → ${SSH_TARGET}:${INSTALL_DIR}/backend/dist ..."
if command -v rsync &>/dev/null; then
  rsync -avz --delete \
    "${REPO_ROOT}/backend/dist/"  "${SSH_TARGET}:${INSTALL_DIR}/backend/dist/"
  rsync -avz --delete \
    "${REPO_ROOT}/frontend/dist/" "${SSH_TARGET}:${INSTALL_DIR}/frontend/dist/"
else
  warn "rsync not found — falling back to scp (slower, no delete of old files)"
  scp -r "${REPO_ROOT}/backend/dist"  "${SSH_TARGET}:${INSTALL_DIR}/backend/"
  scp -r "${REPO_ROOT}/frontend/dist" "${SSH_TARGET}:${INSTALL_DIR}/frontend/"
fi

info "Syncing Prisma schema..."
rsync -avz "${REPO_ROOT}/backend/prisma/" "${SSH_TARGET}:${INSTALL_DIR}/backend/prisma/" 2>/dev/null || \
  scp -r "${REPO_ROOT}/backend/prisma" "${SSH_TARGET}:${INSTALL_DIR}/backend/"

# ── Step 3: Apply DB migrations on RPi ───────────────────────────────────────
info "Applying Prisma schema on RPi..."
ssh "${SSH_TARGET}" "cd ${INSTALL_DIR}/backend && npx prisma generate && npx prisma db push --accept-data-loss"

# ── Step 4: Restart service ───────────────────────────────────────────────────
info "Restarting evload service..."
ssh "${SSH_TARGET}" "sudo systemctl restart evload"

# ── Step 5: Health check ──────────────────────────────────────────────────────
info "Waiting for evload to come online..."
HEALTH_URL="http://${RPI_HOST}:${EVLOAD_PORT}/api/health"
for i in $(seq 1 "${HEALTH_RETRIES}"); do
  sleep "${HEALTH_WAIT_SEC}"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${HEALTH_URL}" 2>/dev/null || echo 0)
  if [[ "${HTTP_CODE}" == "200" ]]; then
    echo ""
    info "✅ evload is healthy at ${HEALTH_URL}"
    break
  fi
  echo -n "."
  if [[ "${i}" == "${HEALTH_RETRIES}" ]]; then
    echo ""
    warn "Health check did not return 200 after $((HEALTH_RETRIES * HEALTH_WAIT_SEC))s — check logs:"
    echo "    ssh ${SSH_TARGET} 'journalctl -u evload -n 50 --no-pager'"
  fi
done

echo ""
info "Update complete. RPi: http://${RPI_HOST}:${EVLOAD_PORT}"
