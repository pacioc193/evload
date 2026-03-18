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

- Sleep-aware proxy polling with separate `vehicle_data` refresh and `body_controller_state` heartbeat
- Home Assistant-based dynamic current throttling
- Manual, planned, and scheduled charging modes
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

The proxy integration is intentionally split into two concerns.

### 1. Full state polling

- Interval: `proxy.normalPollIntervalMs`
- Endpoint: `GET /api/1/vehicles/:vehicleId/vehicle_data`
- Purpose: charging state, SoC, voltage, current, range, climate, lock state, odometer, raw diagnostic payloads
- Fallback: `GET /api/1/vehicles/:vehicleId/vehicle_data?endpoints=charge_state` only when the full payload does not contain a usable `charge_state`

### 2. Lightweight heartbeat

- Interval: `proxy.reactivePollIntervalMs`
- Endpoint: `GET /api/1/vehicles/:vehicleId/body_controller_state`
- Purpose: keep proxy liveness updated and detect sleep / user presence without requiring full `vehicle_data`

### Poll modes

- `NORMAL`: full `vehicle_data` refresh is active
- `REACTIVE`: EVLoad relies on heartbeat and avoids unnecessary wake-ups

Switching rules:

- after repeated sleep confirmation and no active charging, EVLoad moves from `NORMAL` to `REACTIVE`
- if heartbeat detects user presence in the garage, EVLoad returns to `NORMAL`
- if heartbeat reports the vehicle awake, EVLoad returns to `NORMAL`
- `requestWakeMode(true)` forces `NORMAL`, restarts the timers, and sends `wake_up`

### Live state exposed to UI

Backend WebSocket state exposes these proxy-related fields separately:

- `proxy`: live proxy health based on successful proxy calls, including `body_controller_state`
- `vehicle`: current interpreted vehicle state
- `pollMode`: `NORMAL` or `REACTIVE`

This means the proxy can be shown as LIVE even if the car is sleeping.

## Features

- Load-aware charging using Home Assistant power entities
- Charging current ramp logic with configurable bounds and cadence
- Climate control commands and scheduling
- Charging schedules: `start_at`, `finish_by`, `start_end`, `weekly`
- Climate schedules: `start_at`, `start_end`, `weekly`
- Schedule lead wake support through `scheduleLeadTimeSec`
- Proxy diagnostics in Settings and raw proxy payload inspection in Dashboard
- Telegram notifications and test-event workflow
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

## Configuration

### Environment variables

Example file: `backend/.env.example`

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Database connection string used by Prisma |
| `JWT_SECRET` | Secret used to sign auth tokens |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `HA_CLIENT_ID` | Optional Home Assistant OAuth client id override |
| `HA_CLIENT_SECRET` | Home Assistant OAuth client secret |
| `APP_URL` | Public base URL used for OAuth callback and default Home Assistant client id |
| `PORT` | Backend HTTP port |

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
| `proxy.reactivePollIntervalMs` | `body_controller_state` heartbeat interval |
| `proxy.scheduleLeadTimeSec` | Scheduler pre-wake lead time |
| `proxy.rejectUnauthorized` | TLS certificate validation for proxy HTTPS |

## Settings UI

The Settings page exposes four main panels:

- Home Assistant
- Proxy
- Engine Options
- YAML

The Proxy panel currently covers:

- proxy URL
- vehicle id
- vehicle display name
- normal poll interval
- reactive / heartbeat interval
- scheduler lead time
- TLS certificate verification toggle
- proxy LIVE/OFFLINE status
- last successful proxy endpoint and timestamp

## Demo Mode And Simulator

When `demo: true`, EVLoad can operate against the built-in simulator instead of a real vehicle setup.

The simulator supports:

- `vehicle_data`
- `vehicle_data?endpoints=charge_state`
- `body_controller_state`
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
- Proxy health is intentionally modeled separately from interpreted vehicle connectivity.
- Manual YAML editing and structured settings editing both write the backend config file.

## Status And Roadmap Notes

Detailed implementation notes and acceptance backlog live in `features.md`.

For the current EVLoad-to-proxy runtime behavior, see the dedicated communication section in `features.md`.