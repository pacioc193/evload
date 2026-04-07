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
- Home Assistant-based dynamic current throttling with **linear ramp-up algorithm**
- **Connection recovery**: soft failsafe on proxy disconnect — charge session is suspended (not stopped) and automatically resumed on reconnect
- Manual, planned, and scheduled charging modes
- **Garage Panel** (`/garage`) — touch-friendly kiosk UI for Raspberry Pi 7" display, fully responsive on mobile; screen saver with Screen Wake Lock API
- **Google Drive Backup** — scheduled OAuth2 backup of `config.yaml` + SQLite DB, configurable folder picker, retention management, and restore
- **Native Proxmox/Ubuntu deployment** via PowerShell scripts (no Docker required)
- **Raspberry Pi 4 scripts** — full install (bash + PowerShell), remote update via rsync, kiosk setup, display rotation + DPMS
- **Deterministic dependency refresh on deploy/update**: install and update scripts now force a clean npm reinstall (`node_modules` purge + `npm ci`) to prevent partial or stale dependency trees (for example missing runtime modules like `googleapis`)
- **Resilient database schema sync** on deploy/update: scripts run `prisma migrate deploy` with automatic fallback to `prisma db push --accept-data-loss` when schema drift blocks startup (for example missing SQLite columns)
- **Automatic startup diagnostics**: if service/container restart fails, scripts print the latest runtime logs (`journalctl` or `docker compose logs`) before exiting with error
- **Charge-start disconnected guard**: when EVLoad detects a cable-disconnected or vehicle-disconnected charging state, it suspends repeated `charge_start` retries, emits a dedicated Telegram notification event (`charge_start_blocked`), and exposes a clear dashboard warning until the condition recovers
- **Prominent cable indicator**: Garage page shows a green "Cavo collegato" / orange "Cavo non collegato" badge in the status card, visible at a glance even without a charging session active
- **body_controller_state-driven sleep detection**: Sleep status is determined by polling `body_controller_state` (which never wakes the vehicle); `vehicleSleepStatus` and `userPresence` are surfaced in the Dashboard vehicle card. When asleep, the Dashboard shows a "Sleeping" badge
- **Two-timer vehicle_data polling**: `body_controller_state` runs on its own always-on timer at `bodyPollIntervalMs` (never wakes the vehicle). `vehicle_data` runs on a separate conditional timer: at `chargingPollIntervalMs` while charging/engine running, or `windowPollIntervalMs` while the data window is active. The body poll rate is never overridden by the window. Three configurable params (`chargingPollIntervalMs`, `windowPollIntervalMs`, `bodyPollIntervalMs`) plus `vehicleDataWindowMs`; all shown in Settings as seconds
- **Garage page redesigned**: action buttons split into "Opzioni Auto" (car commands) and "Opzioni Schermo" (screen saver), each with a section title and per-button context text
- **Settings UX**: all panels expanded by default (state persisted per-browser); proxy poll fields shown in seconds; logical section order (body → window → charging); vehicle sleep state shown in proxy status box
- **Versioning**: `VERSION` constant in `backend/src/version.ts` is the source of truth; update it together with all `package.json` files and add a `VERSION_HISTORY` entry on every release; latest-version check uses GitHub Releases API (set `GITHUB_TOKEN` env var for private repos); shows "—" instead of "Unknown" when check fails
- **Notifications builder templates updated**: `charge_start_blocked` now has a ready-to-use default template in the Notifications UI, aligned with the existing event template workflow
- **Collapsible navigation**: the left sidebar can now be hidden with a classic hamburger button (desktop collapse + mobile slide-out menu) for full-screen dashboard focus
- **Production-hardened routing**: root path intelligently serves React UI or Home Assistant OAuth identity
- **Sleep-aware and local-safe**: CSP configuration for LAN HTTP usage and sleep-safe proxy polling
- Plan mode remains armed across scheduled runs until explicitly switched to Off
- Scheduler starts charging plans only when engine mode is not Off
- Charging and climate scheduling, including weekly recurrence
- First-launch password setup and JWT-based session auth
- WebSocket-driven live dashboard and settings diagnostics
- **Robust energy tracking**: monotonic Wh counters with session logging to prevent resets during Amp changes
- **Vehicle energy baseline correction**: `charge_energy_added` from Tesla proxy is captured at session start and used as zero-point, so sessions that begin with a non-zero counter report correct session energy and efficiency
- **Dual vehicle energy display**: Dashboard Vehicle Details shows both the session-relative energy (used for efficiency) and the raw `charge_energy_added` value from the proxy for comparison
- **Safe charge start sequence** (`charging.startAmps`): `set_charging_amps(startAmps)` is sent and awaited **before** `charge_start` so Tesla has accepted the safe current setpoint before current begins to flow. This prevents inrush current spikes caused by a previously-high amperage setting. Ramp-up continues from `startAmps`, incrementing one amp per `rampIntervalSec` until `targetAmps`.
- **Offline-safe YAML editor**: Settings YAML panel uses a native textarea instead of Monaco Editor (which requires CDN access), ensuring the config editor works on isolated LAN deployments
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
│       ├── store/            Zustand stores
│       └── utils/            Frontend utilities (frontendLogger)
├── docker-compose.yml
├── Dockerfile
├── install.ps1
├── install.sh
├── docs/
│   └── SETUP_GUIDE.md            Full installation & configuration guide
├── scripts/
│   └── raspberry/                Raspberry Pi installation & update scripts
│       ├── install.sh / .ps1     Full RPi install (bash + PowerShell)
│       ├── update.sh / .ps1      Remote update via rsync (bash + PowerShell)
│       ├── setup-kiosk.sh / .ps1 Chromium kiosk + LXDE autostart
│       └── setup-display.sh/.ps1 Display rotation, DPMS, vcgencmd sudoers
└── features.md
```

## Garage Panel

The `/garage` route provides a kiosk-optimised full-screen dashboard for Raspberry Pi 4 + official 7" 800×480 touch display:

- Large battery SoC bar, charging power (kW), ETA, home consumption, current (A)
- Touch-friendly action buttons (≥88px): Start (with SOC slider), Stop, Unplug, Quick Defrost
- Screen saver: CSS overlay that dims after N minutes of inactivity, fully wakes on any touch/click; uses Screen Wake Lock API where available
- Physical display on/off via `vcgencmd display_power` (requires `GARAGE_MODE=true` in `.env`)
- Fully responsive — accessible from any phone browser via the nav menu

See [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md#7-garage-panel-kiosk-mode) for kiosk setup instructions.

## Google Drive Backup

Automatic encrypted backup of `config.yaml` and the SQLite database to your personal Google Drive:

- OAuth2 authentication — no service account needed
- Scheduled: `daily`, `weekly`, or `monthly` at a configurable HH:MM time
- Configurable **destination folder** — pick from a folder list or type a nested path (e.g. `Documenti/evload-backups`)
- Retention: keep the last N backups, auto-delete older ones
- One-click restore from the Settings panel

See [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md#6-google-drive-backup-setup) for OAuth setup instructions.

## Raspberry Pi Installation

Quick install on a Raspberry Pi 4 running Raspbian OS Desktop:

```bash
git clone https://github.com/pacioc193/evload.git ~/evload
cd ~/evload/scripts/raspberry
chmod +x *.sh
sudo ./install.sh
```

Remote update from your development machine:

```bash
# Unix/macOS
RPI_HOST=192.168.1.100 ./scripts/raspberry/update.sh

# Windows PowerShell
.\scripts\raspberry\update.ps1 -RpiHost 192.168.1.100
```

See [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md#4-option-c--raspberry-pi-4--official-7-display) for the full guide.

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

EVLoad uses two independent polling timers:

1. **Body timer** (always on): polls `body_controller_state` at `proxy.bodyPollIntervalMs` (default 60 s) regardless of window or charging state. Never wakes the vehicle. Manages sleep/wake transitions and opens/closes the vehicle_data window.
2. **Vehicle data timer** (conditional): polls `vehicle_data` only when:
   - The vehicle is actively charging or the engine is running (interval: `proxy.chargingPollIntervalMs`, default 5 s), or
   - Within the vehicle_data window after a wake or connect event (interval: `proxy.windowPollIntervalMs`, default 10 s; window duration: `proxy.vehicleDataWindowMs`, default 5 min)
   - The timer stops automatically when neither condition is active.
- An immediate poll is triggered on engine start (no wait for the next scheduled tick)

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
- failsafe proxy handling is scoped to real proxy connectivity transitions, not to temporary `vehicle.connected=false` states

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
- Home Assistant anti-hammer: exponential backoff + manual-reconnect lock after 3 consecutive auth failures (400/401/403)
- HA diagnostics panel in Settings with explicit status modes: LIVE, ENTITIES, AUTHORIZED, AUTH LOCK, OFFLINE
- Token validity and entity validity are tracked separately: missing/invalid entities do not increment token retry lock counters
- Dashboard EV power prefers HA charger entity (`ha.chargerW`) with vehicle telemetry as fallback
- Sleep state label: Dashboard shows "Sleeping" instead of "Not in garage" for sleeping vehicle
- Engine mode selector remains available even when car is sleeping/offline (blocked only by loading/failsafe)
- Settings Proxy panel: yellow "SLEEP" badge and amber card when proxy up but vehicle sleeping
- Dashboard charging ETA source logic:
  - while charging: vehicle ETA if hardware setpoint is below software setpoint, otherwise EVLoad average charging power
  - while not charging: estimate from max current x 220V
- Dashboard vehicle details panel with current/voltage/power/energy/efficiency and current-vs-limit check
- Session energy split persisted in backend: meter energy (grid/charger side) and vehicle battery energy (`charge_energy_added`)
- Vehicle energy baseline correction at session start: non-zero `charge_energy_added` values are offset so session-relative energy is always accurate
- Dual vehicle energy tiles in Dashboard Vehicle Details: session-relative energy (for efficiency) and raw proxy value side by side
- Charging efficiency persisted per session in backend and surfaced in Dashboard and Statistics
- Configurable `startAmps`: `set_charging_amps(startAmps)` is sent **before** `charge_start` to prevent inrush current spikes from a previously-high setpoint; ramp then steps +1 A per `rampIntervalSec` from the commanded setpoint (not vehicle actual amps)
- Dashboard normal view uses backend meter energy; Vehicle Details → Vehicle Charged Energy uses vehicle battery energy
- Settings YAML editor is a native textarea — works offline and on isolated LAN without CDN dependency
- Version visibility in UI: current version in header and release history panel in Settings
- Expand/collapse state persisted for Dashboard diagnostic panels, Notifications sections, and Settings panels
- Statistics sessions can be deleted from the UI with a two-step confirmation flow
- Engine live log rendered newest-first (latest line on top)
- Climate control commands and scheduling
- Charging schedules: `start_at`, `finish_by`, `start_end`, `weekly`
- Climate schedules: `start_at`, `start_end`, `weekly`
- Schedule lead wake support through `scheduleLeadTimeSec`
- Proxy diagnostics in Settings and raw proxy payload inspection in Dashboard
- Failsafe protection with automatic reset on proxy reconnect, without latching on transient vehicle reachability drops
- Telegram notifications with dynamic event catalog and configurable rules
- Demo/simulator mode for development without a real Tesla
- **Verbose production logging**: every critical engine operation (`charge_start`, `charge_stop`, `set_charging_amps`, engine start/stop, HA throttle, failsafe, plan mode) emits a structured log entry with emoji-prefixed tag, context values (vehicleId, sessionId, before/after amps, reasons, costs) for post-mortem analysis of overnight sessions
- **Log download from Settings**: authenticated Settings panel lets operators download backend `combined.log` / `error.log` and frontend browser logs directly from the UI

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

Windows PowerShell (for local development):

```powershell
./install.ps1
```

Unix/macOS:

```bash
./install.sh
```

For **Native Deployment on Ubuntu/Proxmox (no Docker)**:

Use the provided PowerShell scripts from your Windows machine:
- `Deploy-EvloadNative.ps1`: complete first-time setup on a clean Ubuntu LXC/VM.
- `Update-EvloadNative.ps1`: pulls latest code, rebuilds, and restarts the service.

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
| `proxy.chargingPollIntervalMs` | Poll interval (ms) for vehicle_data while actively charging or engine running |
| `proxy.windowPollIntervalMs` | Poll interval (ms) for vehicle_data during the wake window (not charging) |
| `proxy.bodyPollIntervalMs` | Poll interval (ms) for body_controller_state — always active, independent of window/charging |
| `proxy.vehicleDataWindowMs` | Duration (ms) of the vehicle_data window after wake/connect (default 300000 = 5 min) |
| `proxy.scheduleLeadTimeSec` | Scheduler pre-wake lead time |
| `proxy.rejectUnauthorized` | TLS certificate validation for proxy HTTPS |

## Settings UI

The Settings page exposes five collapsible panels:

**Home Assistant**
- HA URL, Home Power Entity ID, Charger Power Entity ID
- OAuth flow (same-tab, mobile-safe)
- Live entity value readout
- Diagnostics card: explicit connection state + explanatory hint, retry count (X/3), last error message, manual reconnect warning
- Entity-read issues are shown explicitly and do not mark token auth as invalid
- Per-entity validation card in Settings: red background if entity does not exist in HA, green background with live value when entity exists

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
- Stop Charging On Start toggle:
  - **ON** — as soon as evload detects (via polling) that the car is charging from an external source (Tesla app, car's internal scheduler) while the engine is idle, it sends `charge_stop` immediately. The same applies when the engine is explicitly started manually or by a schedule and the car is already charging.
  - **OFF** — evload never interrupts an ongoing external charge; it only manages amps (throttling / hard-limit stop) to protect the home breaker.

**Security**
- Change login password

**YAML**
- Full raw config.yaml editor for advanced configuration

**Logs** *(requires authentication)*
- Download backend `combined.log` (all server log output)
- Download backend `error.log` (errors only)
- Download frontend log locally (browser-side circular buffer, up to 2 000 entries)
- Upload frontend log buffer to server and download the consolidated `frontend.log`
- Live preview of the last 20 frontend log entries with level color-coding

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
| `GET /api/settings/logs/backend?type=combined\|error` | Download backend log file (auth required) |
| `POST /api/settings/logs/frontend` | Ingest frontend log buffer on server (auth required) |
| `GET /api/settings/logs/frontend` | Download accumulated frontend log file (auth required) |

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
- Commands (charge_start, charge_stop, set_charging_amps) automatically wake the vehicle via the proxy; EVLoad guards against sending them to a sleeping vehicle during idle or stop operations, but explicitly wakes the vehicle when a charging session is started (manually or by schedule).
- The engine log carries over the last 20 lines from the previous session so stop-engine entries remain visible after a new session starts.
- Every critical engine action emits a structured `logger.info`/`logger.warn` with an emoji-prefixed tag (`🚀`, `🛑`, `🔌`, `⚡`, `🏁`, `🗓️`, `⛔`, `🚨`) and full context (vehicleId, sessionId, before/after values, reasons) to enable post-mortem analysis of overnight sessions.
- Backend log files are written to the `logs/` directory; they can be downloaded directly from the authenticated Settings → Logs panel.
- The frontend maintains a circular log buffer (`flog`) that persists to localStorage and can be uploaded to the server or downloaded locally from the same Logs panel.

## Status And Roadmap Notes

Detailed implementation notes and acceptance backlog live in `features.md`.

For the current EVLoad-to-proxy runtime behavior, see the dedicated communication section in `features.md`.