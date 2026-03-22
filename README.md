# evload

evload is a self-hosted Tesla charging and climate control web application.

It combines:

- a Node.js backend with REST API and WebSocket state streaming
- a React frontend for dashboard, schedules, settings, statistics, and diagnostics
- Home Assistant integration for load-aware charging
- Tesla proxy integration for vehicle data, commands, sleep-aware polling, and wake orchestration
- a built-in simulator for development and demo mode

The project is designed for home charging scenarios where you want to:

- avoid exceeding a household power limit
- schedule charging and cabin pre-conditioning
- keep the UI live without waking the vehicle unnecessarily
- inspect raw proxy responses and runtime state when something looks wrong

## Highlights

- Proxy status driven by `vehicle_data` polling with explicit proxy-vs-car state separation
- Home Assistant-based dynamic current throttling
- Manual, planned, and scheduled charging modes
- Plan mode remains armed across scheduled runs until explicitly switched to Off
- Scheduler starts charging plans only when engine mode is not Off
- Charging and climate scheduling, including weekly recurrence
- First-launch password setup and JWT-based session auth
- WebSocket-driven live dashboard and settings diagnostics
- Telegram notifications and command hooks
- Demo mode with simulator parity for proxy endpoints

## Repository Layout

```text
evload/
├── backend/                  Express + Prisma + WebSocket backend
│   ├── prisma/               Database schema
│   ├── src/
│   │   ├── engine/           Charging engine and balancing logic
│   │   ├── routes/           REST API endpoints
│   │   ├── services/         Proxy, HA, scheduler, telegram, failsafe
│   │   └── ws/               WebSocket broadcaster
│   ├── .env.example
│   └── config.example.yaml
├── frontend/                 React + Vite + Tailwind UI
│   └── src/
│       ├── api/              Axios API client
│       ├── pages/            Dashboard, schedule, settings, statistics
│       └── store/            Zustand stores
├── docker-compose.yml
├── Dockerfile
├── install.ps1
├── install.sh
└── features.md
```

## Architecture Summary

### Backend

- Express API mounted under `/api`
- WebSocket server mounted under `/ws`
- Prisma with libSQL adapter and SQLite-style `DATABASE_URL`
- Periodic services started on boot:
  - Home Assistant polling
  - Tesla proxy polling
  - scheduler
  - simulator
  - failsafe
  - telegram service

### Frontend

- React 18 + Vite
- Zustand store fed by backend WebSocket state
- Settings page with structured API editing and raw YAML editing
- Dashboard with live charging state, next charge, poll mode, and diagnostics

## EVLoad <-> Proxy Communication

EVLoad communicates with a [TeslaBleHttpProxy](https://github.com/wimaha/TeslaBleHttpProxy) instance over HTTP.
The proxy translates HTTP requests into BLE commands sent directly to the vehicle.

### Polling Does Not Wake The Vehicle

`GET /vehicle_data` (without `?wakeup=true`) is explicitly sleep-safe: TeslaBleHttpProxy does not establish a BLE connection or send any wake signal when the vehicle is asleep.
POST commands (`charge_start`, `charge_stop`, `set_charging_amps`, `wake_up`) automatically wake the vehicle via BLE.
EVLoad leverages this to poll safely at all times and only sends commands when the vehicle is confirmed reachable.

### State Polling

- Interval: `proxy.normalPollIntervalMs` (default 30 seconds)
- Endpoint: `GET /api/1/vehicles/:vehicleId/vehicle_data`
- An additional immediate poll is triggered on engine start (no wait for the next scheduled tick)
- Non-200 responses where the reason contains `sleep` / `asleep` / `offline` / `unavailable` are treated as proxy-reachable and parsed normally

### Runtime Status Contract

| Condition | `proxy.connected` | `vehicle.connected` | UI label |
|---|---|---|---|
| `result: true` | `true` | `true` | Proxy: Online / Car: In garage |
| `result: false`, reason contains sleep | `true` | `false` | Proxy: Online / Car: Sleeping |
| `result: false`, other reason | `true` | `false` | Proxy: Online / Car: Not in garage |
| Network error / timeout | `false` | unchanged | Proxy: Offline |

- `proxy.connected`: HTTP reachability of the proxy process
- `vehicle.connected`: car reachability from `vehicle_data.response.result`
- `response.reason` is always surfaced to Dashboard and Settings for diagnostics

### Command Guard For Sleeping Vehicle

`stopEngine()` and other command paths check `vehicle.connected` before sending commands.
If the vehicle is disconnected or sleeping, `charge_stop` (and other commands) are skipped to avoid an unintentional BLE wake.
The engine log shows `charge_stop skipped: vehicle not connected` when this guard fires.

## Features

- Load-aware charging using Home Assistant power entities
- Charging current ramp logic with configurable bounds and cadence
- Sleep-aware proxy polling: `GET /vehicle_data` never wakes the vehicle
- Immediate proxy poll on engine start (no 30-second wait)
- Command guard: commands to the vehicle are skipped when it is sleeping or unreachable
- Engine log preserved across session restarts (last 20 lines carried forward)
- Home Assistant OAuth with same-tab flow, mobile-safe dynamic `returnTo` via base64url state
- Home Assistant anti-hammer: exponential backoff + manual-reconnect lock after 3 consecutive failures
- HA diagnostics panel in Settings: retry count, last error, manual reconnect warning
- Dashboard EV power prefers HA charger entity (`ha.chargerW`) with vehicle telemetry as fallback
- Sleep state label: Dashboard shows "Sleeping" instead of "Not in garage" for sleeping vehicle
- Engine mode selector remains available even when car is sleeping/offline (blocked only by loading/failsafe)
- Settings Proxy panel: yellow "SLEEP" badge and amber card when proxy up but vehicle sleeping
- Dashboard charging ETA source logic:
  - while charging: vehicle ETA if hardware setpoint is below software setpoint, otherwise EVLoad average charging power
  - while not charging: estimate from max current x 220V
- Dashboard vehicle details panel with current/voltage/power/energy/efficiency and current-vs-limit check
- Charging efficiency persisted to local storage and surfaced in Statistics (last/average/sample count)
- Expand/collapse state persisted for Dashboard diagnostic panels, Notifications sections, and Settings panels
- Statistics sessions can be deleted from the UI with a two-step confirmation flow
- Engine live log rendered newest-first (latest line on top)
- Climate control commands and scheduling
- Charging schedules: `start_at`, `finish_by`, `start_end`, `weekly`
- Climate schedules: `start_at`, `start_end`, `weekly`
- Schedule lead wake support through `scheduleLeadTimeSec`
- Proxy diagnostics in Settings and raw proxy payload inspection in Dashboard
- Failsafe protection with automatic reset on proxy reconnect
- Telegram notifications with dynamic event catalog and configurable rules
- Demo/simulator mode for development without a real Tesla

## Prerequisites

- Node.js 18 or newer
- npm 9 or newer

For Docker usage:

- Docker
- Docker Compose

## Quick Start For Development

### 1. Clone the repository

```bash
git clone https://github.com/pacioc193/evload.git
cd evload
```

### 2. Run the install script

Windows PowerShell:

```powershell
./install.ps1
```

Unix/macOS:

```bash
./install.sh
```

The install scripts:

- install root, backend, and frontend dependencies
- create `backend/.env` from `backend/.env.example` if missing
- generate a JWT secret for local development
- run Prisma generate

### 3. Ensure backend config exists

Create `backend/config.yaml` from the example if it does not already exist.

PowerShell:

```powershell
Copy-Item backend/config.example.yaml backend/config.yaml
```

Unix/macOS:

```bash
cp backend/config.example.yaml backend/config.yaml
```

### 4. Start development mode

```bash
npm run dev
```

This starts:

- backend on port `3001`
- frontend Vite dev server on port `5173`

The frontend proxies `/api` and `/ws` to the backend during development.

### 5. First launch

On first launch, the UI will prompt you to choose the application password.

## Docker Usage

The provided Docker setup runs the production backend and serves the built frontend from the backend process.

### 1. Prepare files

- create a root `.env` file based on `backend/.env.example`
- create a root `config.yaml` file based on `backend/config.example.yaml`

Example:

```bash
cp backend/.env.example .env
cp backend/config.example.yaml config.yaml
```

### 2. Start the stack

```bash
docker compose up -d --build
```

The container:

- exposes port `3001`
- mounts `./config.yaml` into `/app/backend/config.yaml`
- reads environment variables from the root `.env`

Open:

- `http://localhost:3001`

## Deploying on Proxmox

This section describes how to run evload on a [Proxmox VE](https://www.proxmox.com/) host using an LXC container with Docker inside it.

### Prerequisites

- Proxmox VE 7 or newer installed and running
- Access to the Proxmox web UI or shell
- An internet-connected Proxmox node (to pull the container template and Docker images)

### 1. Create an LXC container

In the Proxmox web UI:

1. Click **Create CT** in the top-right corner.
2. Fill in the **General** tab:
   - Set a **Hostname** (e.g. `evload`)
   - Set a root password or upload an SSH public key
3. **Template** tab: download and select a **Debian 12** (bookworm) or **Ubuntu 24.04** template.
4. **Disks** tab: allocate at least **8 GB** of disk space.
5. **CPU** tab: assign at least **1 core** (2 recommended).
6. **Memory** tab: assign at least **512 MB** RAM (1024 MB recommended).
7. **Network** tab: configure as needed (DHCP or a static IP on your LAN).
8. Finish the wizard but **do not start** the container yet.

### 2. Enable nesting for Docker

Docker requires Linux kernel namespaces and cgroups that must be explicitly allowed in LXC. In the Proxmox web UI:

1. Select your new container in the left panel.
2. Go to **Options** → **Features**.
3. Enable **Nesting** and **keyctl**.
4. Click **OK**.

Alternatively, edit the container config directly on the Proxmox host shell:

```bash
# Replace 100 with your container ID
echo "features: keyctl=1,nesting=1" >> /etc/pve/lxc/100.conf
```

Now start the container:

```bash
pct start 100
```

### 3. Enter the container and install Docker

Open a shell into the container (Proxmox web UI → container → **Console**, or from the Proxmox host):

```bash
pct enter 100
```

Inside the container, install Docker using the official convenience script:

```bash
apt-get update && apt-get install -y curl
curl -fsSL https://get.docker.com | sh
```

Verify the installation:

```bash
docker --version
docker compose version
```

### 4. Clone the repository

```bash
apt-get install -y git
git clone https://github.com/pacioc193/evload.git
cd evload
```

### 5. Prepare configuration files

Create the required `.env` and `config.yaml` files from the provided examples:

```bash
cp backend/.env.example .env
cp backend/config.example.yaml config.yaml
```

Open `.env` and set at minimum:

```dotenv
DATABASE_URL=file:/app/backend/data/db.sqlite
JWT_SECRET=<replace-with-a-long-random-string>
```

Open `config.yaml` and configure the `proxy` section to point to your [TeslaBleHttpProxy](https://github.com/wimaha/TeslaBleHttpProxy) instance:

```yaml
proxy:
  url: http://<proxy-host>:8080
  vehicleId: <your-vehicle-VIN>
  vehicleName: My Tesla
```

Refer to the [Configuration](#configuration) section below for all available options.

### 6. Start the stack

```bash
docker compose up -d --build
```

The first build downloads dependencies and compiles the frontend, which may take a few minutes. Subsequent starts are instant.

Check that the container is running and healthy:

```bash
docker compose ps
docker compose logs -f
```

The application is available at:

```
http://<container-ip>:3001
```

Find the container IP with:

```bash
ip addr show eth0
```

### 7. First launch

Open the application in a browser and follow the on-screen prompt to set the application password.

### 8. Auto-start on Proxmox reboot

The `docker-compose.yml` already sets `restart: unless-stopped`, so evload restarts automatically whenever the LXC container is started.

To also start the container automatically when the Proxmox host boots:

1. In the Proxmox web UI, select the container.
2. Go to **Options** → **Start at boot** and enable it.

Or from the Proxmox host shell:

```bash
pct set 100 --onboot 1
```

### 9. Updating evload

To pull the latest changes and rebuild:

```bash
cd evload
git pull
docker compose up -d --build
```

Old images are replaced automatically and data volumes are preserved.

## Configuration

### Environment variables

Example file: `backend/.env.example`

The backend requires environment configuration at startup, typically via a `.env` file or injected process environment. Only a minimal subset is mandatory.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Required. Database connection string used by Prisma |
| `JWT_SECRET` | Required. Secret used to sign auth tokens |
| `TELEGRAM_BOT_TOKEN` | Optional. Can also be written from Notifications UI |
| `HA_CLIENT_ID` | Optional Home Assistant OAuth client id override |
| `HA_CLIENT_SECRET` | Optional Home Assistant OAuth client secret |
| `APP_URL` | Optional. If omitted, backend auto-detects a LAN URL for HA OAuth |
| `FRONTEND_URL` | Optional. Useful in dev to redirect OAuth callback to Vite frontend |
| `PORT` | Optional backend HTTP port (default `3001`) |
| `LOG_LEVEL` | Optional backend log level (default `info`) |
| `SESSION_HOURS` | Optional. JWT session duration in hours issued at login (default `24`) |
| `CORS_ORIGIN` | Optional. Allowed CORS origin in production; leave empty to allow all origins |

### YAML configuration

Example file: `backend/config.example.yaml`

Main sections:

- `demo`
- `charging`
- `climate`
- `homeAssistant`
- `telegram`
- `proxy`

Relevant proxy fields:

| Field | Meaning |
|---|---|
| `proxy.url` | Base URL of the Tesla proxy |
| `proxy.vehicleId` | Vehicle VIN/id used in proxy routes |
| `proxy.vehicleName` | Friendly display name shown in UI |
| `proxy.normalPollIntervalMs` | Full `vehicle_data` refresh interval |
| `proxy.scheduleLeadTimeSec` | Scheduler pre-wake lead time |
| `proxy.rejectUnauthorized` | TLS certificate validation for proxy HTTPS |

## Settings UI

The Settings page exposes four collapsible panels:

**Home Assistant**
- HA URL, Home Power Entity ID, Charger Power Entity ID
- OAuth flow (same-tab, mobile-safe)
- Live entity value readout
- Diagnostics card: connection status, retry count (X/3), last error message, manual reconnect warning

**Proxy**
- Proxy URL, Vehicle ID (VIN), Vehicle Name
- Normal poll interval, scheduler lead time
- TLS certificate verification toggle
- Status badge: green LIVE / yellow SLEEP / red OFFLINE
- Card: "Proxy reachable — vehicle sleeping" when proxy up but vehicle asleep
- Car reachability label: In garage / Sleeping / Not in garage
- Last successful proxy endpoint and timestamp

**Engine Options**
- Demo mode toggle
- Max Home Power, Ramp Interval, Battery Capacity, Energy Price per kWh
- Min/Max/Default charging amps, HA Resume Delay
- Stop Charging On Start toggle: if enabled, a manual start action sends stop instead of start

**YAML**
- Full raw config.yaml editor for advanced configuration

## Demo Mode And Simulator

When `demo: true`, EVLoad can operate against the built-in simulator instead of a real vehicle setup.

The simulator supports:

- `vehicle_data`
- `wake_up`
- `sleep`
- `charge_start`
- `charge_stop`
- `set_charging_amps`
- `set_temps`

This is useful for validating UI behavior and proxy contract assumptions without a live car.

## Development Commands

Root:

```bash
npm run dev
npm run build
npm run test
```

Backend only:

```bash
npm run dev --prefix backend
npm run build --prefix backend
npm run test --prefix backend
```

Frontend only:

```bash
npm run dev --prefix frontend
npm run build --prefix frontend
```

## API Surface Overview

Main backend groups:

- `/api/auth`
- `/api/engine`
- `/api/vehicle`
- `/api/sessions`
- `/api/schedule`
- `/api/settings`
- `/api/config`
- `/api/ha`
- `/api/health`

Useful endpoints for runtime operations:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health probe |
| `GET /api/engine/status` | Engine + failsafe status |
| `POST /api/engine/start` | Start charging engine |
| `POST /api/engine/stop` | Stop charging engine |
| `POST /api/engine/wake` | Force wake mode and send proxy `wake_up` |
| `GET /api/settings` | Structured settings read |
| `PATCH /api/settings` | Structured settings write |
| `GET /api/schedule/next-charge` | Resolve next real planned charge |

## Testing

Backend tests are implemented with Jest.

Run:

```bash
npm run test --prefix backend
```

Current repository validation path typically includes:

- backend TypeScript build
- frontend TypeScript/Vite build
- backend Jest suite

## Operational Notes

- The backend serves the built frontend in production mode.
- The WebSocket broadcaster pushes application state every second.
- Proxy health is intentionally modeled separately from interpreted vehicle connectivity: proxy can be LIVE while the car is sleeping.
- Manual YAML editing and structured settings editing both write the backend config file.
- Polling `GET /vehicle_data` is sleep-safe and does not establish a BLE connection when the vehicle is asleep.
- Commands (charge_start, charge_stop, set_charging_amps) automatically wake the vehicle via the proxy; EVLoad guards against sending them to a sleeping vehicle.
- The engine log carries over the last 20 lines from the previous session so stop-engine entries remain visible after a new session starts.

## Status And Roadmap Notes

Detailed implementation notes and acceptance backlog live in `features.md`.

For the current EVLoad-to-proxy runtime behavior, see the dedicated communication section in `features.md`.