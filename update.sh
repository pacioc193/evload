#!/usr/bin/env bash
set -e

echo "🔄 [1/4] Download ultime modifiche dal repository..."
git pull

echo "🔨 [2/4] Rebuild completo container Docker (no cache) e riavvio..."
docker compose build --no-cache
docker compose up -d

echo "⏳ [3/4] Attendo che il container sia pronto..."
sleep 5

echo "🗄️  [4/4] Esecuzione migrazioni database..."
if docker compose exec evload npx prisma migrate deploy; then
	echo "✅ Prisma migrate deploy completato nel container."
else
	echo "⚠️ Prisma migrate deploy fallito nel container, provo fallback con prisma db push..."
	docker compose exec evload npx prisma db push --accept-data-loss
fi

if ! docker compose ps evload | grep -q "running"; then
	echo "❌ Container evload non in esecuzione. Ultimi log:"
	docker compose logs --tail=120 evload
	exit 1
fi

echo "✅ Aggiornamento completato con successo!"
