# evload – Setup & Installation Guide

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Option A – Docker (recommended)](#2-option-a--docker)
3. [Option B – Native Ubuntu / Proxmox](#3-option-b--native-ubuntuproxmox)
4. [Option C – Raspberry Pi 4 + Official 7" Display](#4-option-c--raspberry-pi-4--official-7-display)
5. [First Configuration](#5-first-configuration)
6. [Google Drive Backup Setup](#6-google-drive-backup-setup)
7. [Garage Panel (Kiosk Mode)](#7-garage-panel-kiosk-mode)
8. [Updating evload](#8-updating-evload)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

### Hardware (Raspberry Pi option)
| Item | Recommended |
|------|-------------|
| Raspberry Pi 4 | 4 GB RAM |
| microSD card | 32 GB+ Class 10 / A2 |
| Official RPi 7" display | 800×480, touch |
| Power supply | Official 5V 3A USB-C |
| Tesla BLE Proxy | [tesla-ble-http-proxy](https://github.com/wimaha/TeslaBleHttpProxy) |

### Software
- **Raspbian OS** (64-bit Lite + Desktop, Bookworm recommended)
- **TeslaBleHttpProxy** running and reachable from evload
- **Home Assistant** (optional, for power monitoring)
- **Node.js 20 LTS** (installed automatically by scripts)

---

## 2. Option A – Docker

```bash
# 1. Clone the repo
git clone https://github.com/pacioc193/evload.git
cd evload

# 2. Copy environment template
cp backend/.env.example backend/.env
# Edit backend/.env: set a strong JWT_SECRET, APP_URL, etc.

# 3. Copy config template
cp backend/config.example.yaml backend/config.yaml
# Edit config.yaml with your proxy URL, HA URL, etc.

# 4. Start with Docker Compose
docker compose up -d

# 5. Open the web UI
open http://localhost:3001
```

> First launch creates the database automatically. Follow the setup wizard to set a password.

---

## 3. Option B – Native Ubuntu / Proxmox

```bash
# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs git

# Clone evload
git clone https://github.com/pacioc193/evload.git /opt/evload
cd /opt/evload

# Install deps
npm ci --prefix backend
npm ci --prefix frontend

# Build
npm run build --prefix backend
npm run build --prefix frontend

# Configure
cp backend/.env.example backend/.env
cp backend/config.example.yaml backend/config.yaml
# Edit both files

# Init database
cd backend && npx prisma generate && npx prisma db push && cd ..

# Create systemd service
sudo tee /etc/systemd/system/evload.service <<EOF
[Unit]
Description=evload
After=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/evload/backend
EnvironmentFile=/opt/evload/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now evload
```

---

## 4. Option C – Raspberry Pi 4 + Official 7" Display

### 4a. Automated installation (on the RPi itself)

Flash Raspberry Pi OS Desktop (64-bit) onto the SD card, boot, connect to WiFi, then:

```bash
# On the RPi — clone and run
git clone https://github.com/pacioc193/evload.git ~/evload
cd ~/evload/scripts/raspberry
chmod +x *.sh
sudo ./install.sh
```

The script will:
- Update the system and install Node.js 20, Chromium, unclutter
- Build and deploy evload to `/opt/evload`
- Create `.env` with a randomly generated `JWT_SECRET`
- Push the Prisma database schema
- Create and enable the `evload` systemd service
- Configure Chromium kiosk autostart pointing to `/garage`
- Set screen blanking to 5 minutes

### 4b. Remote installation from Windows

```powershell
# From your Windows dev machine
cd evload\scripts\raspberry
.\install.ps1 -RpiHost 192.168.1.100
```

### 4c. Configure the 7" display (rotation, DPMS)

```bash
# On the RPi
sudo ./setup-display.sh --rotation 0 --dpms 300

# From Windows
.\setup-display.ps1 -RpiHost 192.168.1.100 -Rotation 0 -DpmsBlankSec 300
```

### 4d. Environment variables for Garage Mode

Edit `/opt/evload/backend/.env` and add:

```env
GARAGE_MODE=true
```

This enables the `POST /api/garage/display` endpoint that physically turns the display on/off via `vcgencmd`.

---

## 5. First Configuration

1. Open `http://<device-ip>:3001` in a browser.
2. The setup wizard appears on first launch — create your admin password.
3. Go to **Settings** and configure:
   - **Proxy URL** – URL of your TeslaBleHttpProxy (e.g. `http://localhost:8080`)
   - **Vehicle ID** – your Tesla vehicle ID
   - **Home Assistant URL** – optional, enables power monitoring
4. Edit `backend/config.yaml` for advanced settings (charging limits, schedules, etc.).
5. Restart the service after editing `config.yaml`:
   ```bash
   sudo systemctl restart evload
   ```

---

## 6. Google Drive Backup Setup

### 6a. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project.
2. Enable the **Google Drive API**:  
   APIs & Services → Library → search "Drive API" → Enable.
3. Create OAuth 2.0 credentials:  
   APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application.
4. Add your evload URL as an **Authorised redirect URI**:  
   `http://<your-ip>:3001/api/backup/oauth/callback`
5. Download the credentials and note `client_id` and `client_secret`.

### 6b. Configure evload

Edit `backend/.env`:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

Edit `backend/config.yaml` backup section:

```yaml
backup:
  enabled: true
  frequency: weekly   # daily | weekly | monthly
  time: "02:00"       # HH:MM 24h
  retentionCount: 10
  driveFolderPath: "evload-backups"  # Google Drive folder name
```

### 6c. Authorise

1. Restart evload: `sudo systemctl restart evload`
2. Go to **Settings → Backup Google Drive**.
3. Click **Connetti Google Drive** and follow the Google OAuth flow.
4. Once connected, the folder picker lets you choose or type a destination folder.
5. Click **Esegui Backup Ora** to test the first backup.

---

## 7. Garage Panel (Kiosk Mode)

The Garage panel (`/garage`) is a full-screen, touch-optimised dashboard showing:

- **Battery SoC** with large progress bar
- **Charging power**, **home consumption**, **ETA**, **current (A)**
- Action buttons: **Avvia** (with SOC slider), **Ferma**, **Sgancia**, **Sbrina**
- **Screen saver** — CSS overlay after N minutes, wake on touch
- Physical display control via `vcgencmd` when `GARAGE_MODE=true`

### Access from a phone

The Garage panel is fully responsive. On mobile it reorganises buttons into a single column with large touch targets. Access it like any other page via the navigation menu or directly at `/garage`.

### Kiosk-only setup (evload already installed)

```bash
# On the RPi
sudo EVLOAD_PORT=3001 SCREEN_BLANK_MIN=5 ./setup-kiosk.sh

# From Windows
.\setup-kiosk.ps1 -RpiHost 192.168.1.100 -EvloadPort 3001 -ScreenBlankMin 5
```

---

## 8. Updating evload

### Docker

```bash
git pull
docker compose pull
docker compose up -d
```

### Native / RPi — from the RPi itself

```bash
cd ~/evload
git pull
npm run build --prefix backend
npm run build --prefix frontend
cd backend && npx prisma db push && cd ..
sudo systemctl restart evload
```

### RPi — remote update from Unix/macOS dev machine

```bash
# Builds locally and syncs to RPi via rsync
RPI_HOST=192.168.1.100 ./scripts/raspberry/update.sh
```

### RPi — remote update from Windows

```powershell
.\scripts\raspberry\update.ps1 -RpiHost 192.168.1.100
```

The update script:
1. Builds backend + frontend locally
2. Syncs `dist/` folders to RPi via rsync (or scp fallback)
3. Applies Prisma migrations
4. Restarts the service
5. Polls `/api/health` until healthy

---

## 9. Troubleshooting

### Backend won't start

```bash
journalctl -u evload -n 100 --no-pager
```

### Common errors

| Error | Solution |
|-------|----------|
| `ECONNREFUSED :8080` | TeslaBleHttpProxy not running or wrong `proxy.url` in config.yaml |
| `Failsafe ACTIVE: HA disconnected` | Home Assistant unreachable; check `homeAssistant.url` |
| `JWT_SECRET not set` | Delete `backend/.env` and restart — it will regenerate |
| White screen in browser | Check CORS: set `APP_URL` in `.env` to your device LAN IP |
| Touch screen calibration off | Run `DISPLAY=:0 xinput_calibrator` after `sudo apt install xinput-calibrator` |

### Reset failsafe

```bash
# Via API (requires auth token)
curl -X POST http://localhost:3001/api/engine/failsafe/reset \
  -H "Authorization: Bearer <token>"
```

### Test proxy connection

```bash
curl http://<proxy-host>:8080/api/1/vehicles
```

### Download logs

In the web UI: **Settings → Logs → Download Backend Log** or **Download Frontend Log**.

### Connection recovery

If the proxy disconnects mid-charge, evload suspends the session (does not stop it) and automatically resumes when the proxy comes back. Check the engine debug log in the Dashboard for `charge suspended` / `proxy reconnected: resuming charge` entries.
