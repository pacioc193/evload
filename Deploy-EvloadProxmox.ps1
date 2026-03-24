[CmdletBinding()]
param (
    [string]$ProxmoxIP = "192.168.1.87",
    [string]$ProxmoxUser = "root"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "        EVLoad Proxmox Deployer         " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Questo script si connetterà a Proxmox, creerà un container LXC,"
Write-Host "installerà Docker ed eseguirà il deploy di EVLoad in automatico."
Write-Host ""

$CTID = Read-Host "Inserisci l'ID per il nuovo container (es. 100, 101, lascia vuoto per 100)"
if (-not $CTID) { $CTID = "100" }

$CTPass = Read-Host -AsSecureString "Inserisci una password per l'utente root del container"
$CTPassPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($CTPass))

$ProxyURL = Read-Host "Inserisci l'URL del proxy Tesla (es. http://192.168.1.50:8080)"
$VIN = Read-Host "Inserisci il VIN della tua auto"
$VehicleName = Read-Host "Inserisci il nome della tua auto (es. La mia Tesla, lascia vuoto per 'Tesla')"
if (-not $VehicleName) { $VehicleName = "Tesla" }

$BashScript = @'
#!/bin/bash
set -e

CTID=$1
CT_PASS=$2
PROXY_URL=$3
VIN=$4
VEHICLE_NAME=$5

echo ""
echo "[1/8] Aggiornamento lista template in corso..."
pveam update > /dev/null

echo "[2/8] Ricerca template Debian 12..."
TEMPLATE=$(pveam available -section system | grep debian-12-standard | awk '{print $2}' | sort -V | tail -n 1)
if [ -z "$TEMPLATE" ]; then
    echo "❌ Errore: Template Debian 12 non trovato!"
    exit 1
fi

echo "      Template trovato: $TEMPLATE"
echo "      Scaricamento template (se non presente)..."
pveam download local $TEMPLATE > /dev/null 2>&1 || true

if pct status $CTID &>/dev/null; then
    echo "❌ Errore: Il container con ID $CTID esiste già su Proxmox!"
    exit 1
fi

echo "[3/8] Creazione del container LXC ($CTID)..."
pct create $CTID local:vztmpl/${TEMPLATE##*/} \
    --ostype debian \
    --arch amd64 \
    --hostname evload \
    --cores 2 \
    --memory 1024 \
    --swap 512 \
    --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --storage local-lvm \
    --rootfs local-lvm:8 \
    --password "$CT_PASS" \
    --unprivileged 1 > /dev/null

echo "[4/8] Configurazione privilegi Docker e avvio container..."
pct set $CTID --features keyctl=1,nesting=1 > /dev/null
pct set $CTID --onboot 1 > /dev/null
pct start $CTID

echo "      Attendo 15 secondi per l'inizializzazione della rete nel container..."
sleep 15

echo "[5/8] Installazione dipendenze base (curl, git)..."
pct exec $CTID -- apt-get update > /dev/null
pct exec $CTID -- apt-get install -y curl git > /dev/null

echo "[6/8] Installazione di Docker nel container (potrebbe richiedere un minuto)..."
pct exec $CTID -- bash -c "curl -fsSL https://get.docker.com | sh > /dev/null 2>&1"

echo "[7/8] Clonazione di EVLoad e configurazione..."
pct exec $CTID -- git clone https://github.com/pacioc193/evload.git /opt/evload > /dev/null 2>&1

JWT_SECRET=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 64 | head -n 1)
pct exec $CTID -- bash -c "cp /opt/evload/backend/.env.example /opt/evload/.env"
pct exec $CTID -- bash -c "sed -i 's|^DATABASE_URL=.*|DATABASE_URL=file:/app/backend/data/db.sqlite|' /opt/evload/.env"
pct exec $CTID -- bash -c "sed -i 's|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|' /opt/evload/.env"

pct exec $CTID -- bash -c "cp /opt/evload/backend/config.example.yaml /opt/evload/config.yaml"
pct exec $CTID -- bash -c "sed -i 's|url:.*|url: \"$PROXY_URL\"|' /opt/evload/config.yaml"
pct exec $CTID -- bash -c "sed -i 's|vehicleId:.*|vehicleId: \"$VIN\"|' /opt/evload/config.yaml"
pct exec $CTID -- bash -c "sed -i 's|vehicleName:.*|vehicleName: \"$VEHICLE_NAME\"|' /opt/evload/config.yaml"

echo "[8/8] Compilazione e avvio di EVLoad tramite Docker Compose..."
echo "      ⚠️  Questa operazione richiede alcuni minuti (build di backend e frontend)..."
pct exec $CTID -- bash -c "cd /opt/evload && docker compose up -d --build"

CT_IP=$(pct exec $CTID -- ip -4 addr show eth0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1)

echo ""
echo "=========================================================="
echo "✅ DEPLOY COMPLETATO CON SUCCESSO!"
echo "=========================================================="
if [ -n "$CT_IP" ]; then
    echo "EVLoad è ora in esecuzione ed è raggiungibile all\'indirizzo:"
    echo "👉 http://$CT_IP:3001"
else
    echo "Deploy terminato, ma non sono riuscito a trovare l\'IP del container."
    echo "Controlla l\'IP dalla console di Proxmox (CT $CTID) e naviga alla porta 3001."
fi
echo "=========================================================="
'@

$TempScript = New-TemporaryFile
Set-Content -Path $TempScript.FullName -Value $BashScript -Encoding utf8

Write-Host ""
Write-Host "Avvio la connessione SSH verso $ProxmoxUser@$ProxmoxIP..." -ForegroundColor Yellow
Write-Host "Ti verrà richiesta la password di root di Proxmox." -ForegroundColor Yellow
Write-Host ""

# Esecuzione dello script tramite SSH
Get-Content $TempScript.FullName | ssh "$ProxmoxUser@$ProxmoxIP" "bash -s -- '$CTID' '$CTPassPlain' '$ProxyURL' '$VIN' '$VehicleName'"

Remove-Item $TempScript.FullName
Write-Host "Script completato!" -ForegroundColor Green
