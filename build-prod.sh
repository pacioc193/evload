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
