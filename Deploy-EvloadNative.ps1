[CmdletBinding()]
param (
    [string]$ServerIP = "evload",
    [string]$ServerUser = "root"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "     EVLoad Native Deployer (Ubuntu)    " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$BashScript = @'
#!/bin/bash
set -e

# Esporta la variabile per aumentare la RAM disponibile per Node.js
export NODE_OPTIONS="--max-old-space-size=1024"

echo ""
echo "[1/7] Installazione dipendenze base e GitHub CLI (gh)..."
apt-get update
apt-get install -y curl git gpg

if ! command -v gh > /dev/null; then
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    apt-get update
    apt-get install gh -y
fi

echo ""
echo "🔍 Controllo stato autenticazione GitHub..."
if ! gh auth status >/dev/null 2>&1; then
    echo "🔐 AUTENTICAZIONE GITHUB RICHIESTA"
    gh auth login --hostname github.com -p https -w
else
    echo "✅ GitHub CLI è già autenticata. Procedo."
fi

echo ""
echo "[2/7] Installazione Node.js 20 LTS..."
if ! command -v node > /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

echo "[3/7] Clonazione del repository di EVLoad..."
if [ -d "/opt/evload" ]; then
    cd /opt/evload
    git reset --hard HEAD
    git pull
else
    gh repo clone pacioc193/evload /opt/evload
    cd /opt/evload
fi

echo "[4/7] Preparazione ambiente base..."
sed -i 's/prisma generate --ignore-existing/prisma generate/' /opt/evload/install.sh
sed -i 's/return cachedJwtSecret/return cachedJwtSecret as string/' /opt/evload/backend/src/auth.ts

chmod +x install.sh
./install.sh

echo "[5/7] Compilazione ed esecuzione migrazioni database..."
cd /opt/evload/backend
npx prisma generate
if npx prisma migrate deploy; then
    echo "✅ Prisma migrate deploy completato."
else
    echo "⚠️ Prisma migrate deploy fallito, provo fallback con prisma db push..."
    npx prisma db push --accept-data-loss
fi
cd /opt/evload

chmod +x build-prod.sh
./build-prod.sh

echo "[6/7] Configurazione del servizio Systemd (evload.service)..."
cat << 'EOF' > /etc/systemd/system/evload.service
[Unit]
Description=EVLoad Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/evload/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable evload
systemctl restart evload

if ! systemctl is-active --quiet evload; then
    echo "❌ Servizio evload non attivo dopo il deploy. Ultimi log:"
    journalctl -u evload -n 120 --no-pager || true
    exit 1
fi

echo ""
echo "=========================================================="
echo "✅ DEPLOY NATIVO COMPLETATO CON SUCCESSO!"
echo "=========================================================="
CT_IP=$(ip -4 addr show eth0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1)
if [ -z "$CT_IP" ]; then
    CT_IP=$(hostname -I | awk '{print $1}')
fi

echo "L'applicazione è ora raggiungibile all'indirizzo:"
echo "👉 http://$CT_IP:3001"
echo "=========================================================="
rm -f /root/install_evload.sh
'@

$TempScript = New-TemporaryFile
$utf8NoBomEncoding = New-Object System.Text.UTF8Encoding $false

# Invece di far tentare a PowerShell di risolvere i CRLF, scriviamo lo script crudo
# per poi convertire le newline in puro stile unix tramite l'oggetto StringBuilder
$ScriptUnix = $BashScript -replace "`r`n","`n"
[System.IO.File]::WriteAllText($TempScript.FullName, $ScriptUnix, $utf8NoBomEncoding)

Write-Host "Copia file sul server..."
scp -q -O "$($TempScript.FullName)" "$ServerUser@$ServerIP`:/root/install_evload.sh"

if ($LASTEXITCODE -ne 0) {
    Remove-Item $TempScript.FullName
    exit 1
}

Write-Host "Avvio esecuzione sul server..."
ssh -t "$ServerUser@$ServerIP" "chmod +x /root/install_evload.sh && bash /root/install_evload.sh"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Deploy remoto fallito. Controlla i log mostrati sopra." -ForegroundColor Red
    Remove-Item $TempScript.FullName
    exit 1
}

Remove-Item $TempScript.FullName