[CmdletBinding()]
param (
    [string]$ServerIP = "evload",
    [string]$ServerUser = "root"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "       EVLoad Native Updater            " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Questo script si connetterà al server Ubuntu ($ServerIP),"
Write-Host "scaricherà le ultime modifiche da GitHub, re-compilerà"
Write-Host "l'applicazione e riavvierà il servizio."
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$BashScript = @'
#!/bin/bash
set -e

# Esporta la variabile per aumentare la RAM disponibile per Node.js (necessario per Vite)
export NODE_OPTIONS="--max-old-space-size=1024"

echo "🔄 [1/4] Scaricamento aggiornamenti da GitHub..."
cd /opt/evload
git fetch --all
git reset --hard origin/main
git pull

echo "📦 [2/4] Aggiornamento dipendenze e database..."
npm --prefix backend install
npm --prefix frontend install
cd backend
npx prisma generate
npx prisma migrate deploy
cd ..

echo "🏗️ [3/4] Compilazione applicazione (Frontend + Backend)..."
chmod +x build-prod.sh
./build-prod.sh

echo "🚀 [4/4] Riavvio servizio EVLoad..."
systemctl restart evload

echo ""
echo "=========================================================="
echo "✅ AGGIORNAMENTO COMPLETATO!"
echo "=========================================================="
echo "Il servizio è stato riavviato con successo."
echo "=========================================================="
rm -f /root/update_evload.sh
'@

$TempScript = New-TemporaryFile
$utf8NoBomEncoding = New-Object System.Text.UTF8Encoding $false
$ScriptUnix = $BashScript -replace "`r`n","`n"
[System.IO.File]::WriteAllText($TempScript.FullName, $ScriptUnix, $utf8NoBomEncoding)

Write-Host "Copia dello script di aggiornamento sul server..." -ForegroundColor Yellow
scp -q -O "$($TempScript.FullName)" "$ServerUser@$ServerIP`:/root/update_evload.sh"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Errore durante la connessione al server." -ForegroundColor Red
    Remove-Item $TempScript.FullName
    exit 1
}

Write-Host "Avvio della procedura di aggiornamento (potrebbe richiedere qualche minuto)..." -ForegroundColor Yellow
ssh -t "$ServerUser@$ServerIP" "chmod +x /root/update_evload.sh && bash /root/update_evload.sh"

Remove-Item $TempScript.FullName
Write-Host "Operazione completata!" -ForegroundColor Green
