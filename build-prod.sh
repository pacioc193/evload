#!/usr/bin/env bash
set -e

echo "🏗️  Build di produzione EVLoad"
echo "================================"

echo ""
echo "🔨 [1/2] Compilazione backend (TypeScript)..."
if npm run build --prefix backend; then
  echo "✅ Backend compilato con successo"
else
  echo "❌ Errore nella compilazione del backend"
  exit 1
fi

echo ""
echo "🔨 [2/2] Compilazione frontend (Vite)..."
# Ensure TypeScript is available (may be missing if npm ci was run without --include=dev)
if [ ! -f "frontend/node_modules/.bin/tsc" ]; then
  echo "  ⚠️  TypeScript compiler not found — installing frontend dev dependencies..."
  npm --prefix frontend ci --include=dev
fi
if npm run build --prefix frontend; then
  echo "✅ Frontend compilato con successo"
else
  echo "❌ Errore nella compilazione del frontend"
  exit 1
fi

echo ""
echo "✅ Build di produzione completata con successo!"
echo "   Backend: backend/dist/"
echo "   Frontend: frontend/dist/"
