# evload

**evload** is a self-hosted Tesla charging and climate scheduling web application, inspired by [EVCC](https://evcc.io/). It runs as a single Docker container on Proxmox (or any Linux host) and provides:

- **Dynamic load balancing** via Home Assistant — automatically throttles or pauses charging when the house approaches its power limit
- **Smart scheduling** — "Start at [time]" and "Finish by [time] at [%]" modes, calculated from battery capacity
- **Climate scheduler** — pre-conditions the cabin, but only when the car is plugged in
- **100% cell balancing** — monitors actual current to avoid interrupting the BMS balancing cycle
- **Telegram bot** — `/start`, `/stop`, and proactive notifications when HA overrides a schedule
- **Demo mode** — fully simulated UI with no real vehicle or HA required
- **Statistics page** — per-session energy, voltage, and current charts powered by Recharts

---

## Quick Start (Docker — recommended)

### 1. Clone the repo and create config files

```bash
git clone https://github.com/pacioc193/evload.git
cd evload

# Copy example files (do NOT commit the real ones)
cp backend/.env.example .env
cp backend/config.example.yaml config.yaml
```

### 2. Edit `.env` (secrets only)

```bash
nano .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | SQLite path — keep as `file:./data/dev.db` |
| `JWT_SECRET` | Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TELEGRAM_BOT_TOKEN` | From [@BotFather](https://t.me/botfather) — optional |
| `TELEGRAM_CHAT_ID` | Your personal or group chat ID — optional |
| `HA_CLIENT_ID` | Your HA OAuth Client ID — optional |
| `HA_CLIENT_SECRET` | Your HA OAuth Client Secret — optional |

> **Never put URLs, IPs, or ports in `.env`.** Those belong in `config.yaml` and are editable from the UI.

### 3. Edit `config.yaml` (operational settings)

```yaml
demo: false                   # Set to true to skip all real connections

charging:
  batteryCapacityKwh: 75      # Your actual battery size (e.g. 75 for Long Range)
  defaultAmps: 16
  maxAmps: 32
  minAmps: 5

homeAssistant:
  url: "http://homeassistant.local:8123"
  powerEntityId: "sensor.home_power"   # Entity that reports total house watts
  maxHomePowerW: 7000                  # Charging is throttled when house exceeds this

proxy:
  url: "http://192.168.1.100:8080"     # Your teslablehttpproxy URL
  vehicleId: "your_vehicle_id_here"

telegram:
  enabled: false
  allowedChatIds: []                   # Add your chat ID to restrict access
```

### 4. Start with Docker Compose

```bash
docker compose up -d
```

Open **http://localhost:3001** in your browser. On the first launch you will be prompted to set a UI password.

---

## Quick Start (Manual / Development)

### Prerequisites

- Node.js 18+
- npm 9+

### Install

```bash
# Unix / macOS
./install.sh

# Windows (PowerShell)
./install.ps1
```

### Start in development mode

```bash
npm run dev
```

This starts both the backend (port 3001) and frontend (Vite dev server, port 5173) with hot-reload. The frontend proxies `/api` and `/ws` to the backend automatically.

---

## Demo Mode

Demo mode lets you explore the full UI without a real Tesla or Home Assistant connection.

### How to enable

1. Open **Settings** (gear icon in the sidebar)
2. In the **Quick Settings** panel, click the **Demo Mode** toggle to turn it ON
3. Click **Save**
4. Navigate to **Dashboard** — within ~2 seconds you will see a simulated vehicle charging

### What Demo Mode simulates

| Feature | Demo behaviour |
|---|---|
| Vehicle state | Connected, plugged in, charging at 16A |
| SoC | Starts at ~50%, increments slowly |
| Home power | Simulated oscillating draw |
| HA connection | Reported as connected with synthetic power data |
| Cell balancing | Triggered automatically when SoC hits 100% |
| Climate | Cabin temperature simulated |

### Disabling Demo Mode

Toggle **Demo Mode** OFF in Settings and click **Save**. The backend reconnects to real integrations within ~2 seconds.

---

## Settings Reference

All settings in the Quick Settings panel are persisted immediately to `config.yaml` when you click **Save**. You can also edit the raw YAML directly in the Monaco editor at the bottom of the page.

| Setting | Description |
|---|---|
| **Demo Mode** | Bypass all real HTTP calls with simulated data |
| **HA URL** | Full URL to your Home Assistant instance |
| **Power Entity ID** | HA sensor entity ID reporting total home watts |
| **Grid Entity ID** | Optional HA sensor for grid import/export watts |
| **Max Home Power** | Watts threshold — charging is throttled if house exceeds this |
| **Proxy URL** | URL of your teslablehttpproxy instance |
| **Vehicle ID** | The vehicle ID from teslablehttpproxy |
| **Battery Capacity** | Your car's usable battery in kWh (used for "Finish by" math) |
| **Default / Max / Min Amps** | Charging current limits |

---

## Page Guide

### Dashboard

Shows real-time vehicle state: battery level, charge rate, voltage, current, and cabin temperature. Also displays live home power from Home Assistant.

**Charging Control** panel lets you start/stop the engine with a target SoC and amp setting. If HA is throttling your charge, a warning banner is shown.

### Climate

Manual climate controls (start/stop, set temperature). Climate commands are only sent when the vehicle is plugged in.

### Schedule

Create charging and climate schedules:
- **Start at [time]** — engine starts exactly at the specified time
- **Finish by [time] at [%]** — the backend calculates the latest start time using `batteryCapacityKwh`, current SoC, and available amperage

If Home Assistant intervenes and delays a schedule, a Telegram notification explains why.

### Statistics

Per-session history with interactive Recharts graphs: SoC over time, power & current, and voltage.

### Settings

Configure all integrations, Demo Mode toggle, and edit raw `config.yaml` via Monaco Editor.

---

## Architecture

```
evload/
├── backend/               Node.js + Express + WebSocket
│   ├── src/
│   │   ├── config.ts      Config schema + YAML loader (reads backend/config.yaml)
│   │   ├── engine/        Core charging engine (HA throttle, balancing, scheduler)
│   │   ├── services/      HA, Proxy, Telegram, Failsafe services
│   │   ├── routes/        REST API routes
│   │   └── ws/            1Hz WebSocket broadcaster
│   ├── prisma/            SQLite schema (telemetry, sessions, schedules)
│   └── config.example.yaml
├── frontend/              React + Vite + TailwindCSS
│   └── src/
│       ├── pages/         Dashboard, Climate, Statistics, Schedule, Settings
│       ├── store/         Zustand stores (auth, WebSocket state)
│       └── api/           Axios API helpers
├── config.yaml            NOT committed — copy from config.example.yaml
├── .env                   NOT committed — copy from backend/.env.example
└── docker-compose.yml
```

### Config file location

The backend always reads and writes `config.yaml` from the **backend directory** (i.e. `backend/config.yaml` in development, or `/app/backend/config.yaml` in Docker). This is the single source of truth for all operational settings.

---

## Fail-Safe Behaviour

If the teslablehttpproxy or Home Assistant connection drops:

1. All automated charging/climate control loops are **immediately halted**
2. A **Telegram alert** is sent
3. A red **FAILSAFE ACTIVE** banner is shown across the entire UI
4. You can still control the car via the official Tesla app

Once the connection is restored, the failsafe clears automatically.

---

## Telegram Bot Commands

If `TELEGRAM_BOT_TOKEN` is set and `telegram.enabled: true` in config:

| Command | Action |
|---|---|
| `/start [soc] [amps]` | Start charging engine (e.g. `/start 80 16`) |
| `/stop` | Stop charging engine |
| `/status` | Get current engine status |
| `/help` | List available commands |

Proactive notifications are sent when:
- HA overrides/throttles a charging schedule
- Cell balancing starts or completes
- Failsafe activates or clears

---

## Development Scripts

```bash
npm run dev            # Start backend + frontend in parallel (dev mode)
npm run build          # Build both packages for production

# Backend only
npm run dev --prefix backend
npm run test --prefix backend    # Jest tests

# Frontend only
npm run dev --prefix frontend
npm run build --prefix frontend
```

---

## Updating

```bash
git pull
./install.sh       # Re-installs deps and runs Prisma migrations
docker compose up -d --build   # If using Docker
```
