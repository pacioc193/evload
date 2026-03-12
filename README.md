# EVLoad

Tesla charging and climate scheduling web application.

## Quick Start — VS Code

### Prerequisites
- [Node.js 20+](https://nodejs.org/)
- [VS Code](https://code.visualstudio.com/)
- When prompted, install the **recommended extensions** (`.vscode/extensions.json`)

### 1. Install dependencies

Open the integrated terminal and run:

```bash
npm run install
```

This installs dependencies for both `backend/` and `frontend/`.

### 2. Debug with F5

| Launch config | What it does |
|---|---|
| **Debug Backend** | Installs backend deps, starts the Node.js server with debugger attached. Config is saved to `./data/config.yml`, logs go to `./logs/`. |
| **Debug Backend Tests** | Runs the Jest test suite with the debugger so you can set breakpoints in tests. |
| **Open Frontend (Dev)** | Starts the Vite dev server (port 5173) and opens Chrome. |
| **Full Stack (Backend + Frontend)** | Starts backend debugger **and** frontend dev server together — press F5 with this config selected. |

Select the desired configuration from the **Run & Debug** panel (`Ctrl+Shift+D` / `⇧⌘D`) and press **F5**.

### 3. Available Tasks (`Ctrl+Shift+P` → *Tasks: Run Task*)

| Task | Description |
|---|---|
| `install:backend` | `npm install` inside `backend/` |
| `install:frontend` | `npm install` inside `frontend/` |
| `install:all` | Both installs in parallel |
| `dev:frontend` | Starts the Vite dev server in the background |
| `test:backend` | Runs Jest tests (`Ctrl+Shift+P` → *Tasks: Run Test Task*) |

## Docker

```bash
docker compose up --build
```

Backend on `:3001`, frontend on `:5173` (dev) or `:80` (Docker).

## Project Structure

```
evload/
├── backend/          Node.js + Express + WebSocket
│   └── src/
│       ├── charging/ Charging engine & balancing logic
│       ├── climate/  Climate scheduler (node-cron)
│       ├── config/   YAML config manager (thread-safe)
│       ├── proxy/    Tesla HTTP client (teslablehttpproxy)
│       ├── realtime/ WebSocket server
│       └── routes/   REST API routes
├── frontend/         React + Vite + TailwindCSS + Monaco Editor
│   └── src/
│       ├── components/
│       └── hooks/
├── data/             Runtime config (config.yml auto-generated, gitignored)
├── logs/             Application logs (gitignored)
└── .vscode/          VS Code launch, task, and workspace settings
```

## Configuration

All settings (VIN, proxy host/port, schedules, charge limits) are stored in `data/config.yml`.
The file is created automatically on first run with safe defaults. Edit it directly or use
the in-app YAML editor tab.