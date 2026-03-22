#!/usr/bin/env bash
set -e

echo "🔄 [1/4] Download ultime modifiche dal repository..."
git pull

echo "🔨 [2/4] Rebuild e riavvio dei container Docker..."
docker compose up -d --build

echo "⏳ [3/4] Attendo che il container sia pronto..."
sleep 5

echo "🗄️  [4/4] Esecuzione migrazioni database..."
docker compose exec evload npx prisma migrate deploy

echo "✅ Aggiornamento completato con successo!"
