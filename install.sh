#!/usr/bin/env bash
set -euo pipefail
echo "[*] Starting install for evload (Unix shell)"

if command -v npm >/dev/null 2>&1; then
  echo "[*] npm found"
else
  echo "[!] npm not found — attempting automatic install (non-interactive)"

  if command -v brew >/dev/null 2>&1; then
    echo "[*] Homebrew detected — installing node"
    brew install node
  elif command -v apt-get >/dev/null 2>&1; then
    echo "[*] apt-get detected — installing Node.js LTS via NodeSource"
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    echo "[*] dnf detected — installing Node.js LTS via NodeSource"
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
    sudo dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    echo "[*] yum detected — installing Node.js LTS via NodeSource"
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
    sudo yum install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then
    echo "[*] pacman detected — installing nodejs and npm"
    sudo pacman -S --noconfirm nodejs npm
  else
    echo "[ERROR] Nessun gestore di pacchetti automatico trovato. Installa Node.js manualmente e rilancia lo script." >&2
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] Installazione automatica di Node.js fallita." >&2
    exit 1
  fi
fi

echo "[*] Forcing clean reinstall of root dependencies..."
rm -rf node_modules
npm ci --no-audit --no-fund

echo "[*] Forcing clean reinstall of backend dependencies..."
rm -rf backend/node_modules
npm --prefix backend ci --include=dev --no-audit --no-fund

echo "[*] Ensuring backend .env exists"
BACKEND_ENV=backend/.env
BACKEND_ENV_EX=backend/.env.example
if [ ! -f "$BACKEND_ENV" ] && [ -f "$BACKEND_ENV_EX" ]; then
  cp "$BACKEND_ENV_EX" "$BACKEND_ENV"
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  if grep -q '^JWT_SECRET=' "$BACKEND_ENV"; then
    sed -i.bak -E "s/^JWT_SECRET=.*/JWT_SECRET=\"$JWT_SECRET\"/" "$BACKEND_ENV" && rm "$BACKEND_ENV.bak"
  else
    echo "JWT_SECRET=\"$JWT_SECRET\"" >> "$BACKEND_ENV"
  fi
  echo "[*] Created $BACKEND_ENV with a generated JWT_SECRET"
  echo "[!] Al primo avvio il frontend ti chiedera' di scegliere la password UI."
fi

echo "[*] Forcing clean reinstall of frontend dependencies..."
rm -rf frontend/node_modules
npm --prefix frontend ci --no-audit --no-fund

echo "[*] Running Prisma generate in backend (if applicable)..."
if command -v npx >/dev/null 2>&1; then
  npx --prefix backend prisma generate
  if npx --prefix backend prisma migrate deploy; then
    echo "[*] Prisma migrate deploy completed."
  else
    echo "[!] Prisma migrate deploy failed, falling back to prisma db push..."
    npx --prefix backend prisma db push --accept-data-loss
  fi
fi

echo "[*] Install complete. To start development: npm run dev"
