import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { logger } from '../logger'

export type UpdaterState = 'idle' | 'running' | 'success' | 'error'

export interface UpdaterStatus {
  state: UpdaterState
  branch: string | null
  startedAt: string | null
  endedAt: string | null
  exitCode: number | null
}

// The backend service runs with WorkingDirectory=/opt/evload/backend.
// Repo root is one level up.
const REPO_ROOT = path.resolve(process.cwd(), '..')
const LOG_FILE = path.join(REPO_ROOT, 'updater.log')
const STATUS_FILE = path.join(REPO_ROOT, 'updater.status.json')

let cachedStatus: UpdaterStatus = loadStatus()

function loadStatus(): UpdaterStatus {
  try {
    const raw = fs.readFileSync(STATUS_FILE, 'utf-8')
    return JSON.parse(raw) as UpdaterStatus
  } catch {
    return { state: 'idle', branch: null, startedAt: null, endedAt: null, exitCode: null }
  }
}

function saveStatus(s: UpdaterStatus): void {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(s, null, 2))
  } catch (err) {
    logger.error('Updater: failed to save status file', { err, path: STATUS_FILE })
  }
}

export function getUpdaterStatus(): UpdaterStatus & { logSizeBytes: number } {
  // Re-read from disk so restarts don't lose the last state
  cachedStatus = loadStatus()
  const logSizeBytes = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0
  return { ...cachedStatus, logSizeBytes }
}

export async function getGitBranches(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['branch', '-r'], { cwd: REPO_ROOT })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', () => {
      const branches = out
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b && !b.includes('->'))
        .map((b) => b.replace(/^origin\//, ''))
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort()
      resolve(branches)
    })
    proc.on('error', () => resolve([]))
  })
}

export async function getCurrentBranch(): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', () => resolve(out.trim() || 'unknown'))
    proc.on('error', () => resolve('unknown'))
  })
}

export function getUpdateLogs(fromByte = 0): { content: string; totalBytes: number } {
  if (!fs.existsSync(LOG_FILE)) return { content: '', totalBytes: 0 }
  const totalBytes = fs.statSync(LOG_FILE).size
  if (fromByte >= totalBytes) return { content: '', totalBytes }
  const fd = fs.openSync(LOG_FILE, 'r')
  const len = totalBytes - fromByte
  const buf = Buffer.alloc(len)
  fs.readSync(fd, buf, 0, len, fromByte)
  fs.closeSync(fd)
  return { content: buf.toString('utf-8'), totalBytes }
}

export function startUpdate(branch: string): { started: boolean; reason?: string } {
  if (cachedStatus.state === 'running') {
    return { started: false, reason: 'Update already in progress' }
  }

  // Clear previous log
  try { fs.writeFileSync(LOG_FILE, '') } catch { /* ignore */ }

  cachedStatus = {
    state: 'running',
    branch,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
  }
  saveStatus(cachedStatus)

  logger.info('🔄 [UPDATER] Starting OTA update', { branch, repoRoot: REPO_ROOT })

  const scriptPath = path.join(REPO_ROOT, '.evload-update.sh')
  const script = buildUpdateScript(branch)

  try {
    fs.writeFileSync(scriptPath, script, { mode: 0o755 })
  } catch (err) {
    const msg = `Failed to write update script: ${String(err)}`
    logger.error('🚨 [UPDATER] ' + msg)
    cachedStatus = { ...cachedStatus, state: 'error', endedAt: new Date().toISOString(), exitCode: -1 }
    saveStatus(cachedStatus)
    return { started: false, reason: msg }
  }

  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' })

  const proc = spawn('bash', [scriptPath], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' },
  })

  proc.stdout?.on('data', (d: Buffer) => logStream.write(d))
  proc.stderr?.on('data', (d: Buffer) => logStream.write(d))

  proc.on('close', (code) => {
    cachedStatus = {
      ...cachedStatus,
      state: code === 0 ? 'success' : 'error',
      endedAt: new Date().toISOString(),
      exitCode: code,
    }
    saveStatus(cachedStatus)
    logStream.end()
    logger.info('🔄 [UPDATER] Update process finished', { exitCode: code })
    try { fs.unlinkSync(scriptPath) } catch { /* ignore */ }
  })

  proc.on('error', (err) => {
    const msg = `Spawn error: ${err.message}`
    logStream.write(`\n❌ ${msg}\n`)
    cachedStatus = { ...cachedStatus, state: 'error', endedAt: new Date().toISOString(), exitCode: -1 }
    saveStatus(cachedStatus)
    logStream.end()
  })

  proc.unref()

  return { started: true }
}

function buildUpdateScript(branch: string): string {
  // Escape REPO_ROOT for single-quoted bash usage
  const escapedRoot = REPO_ROOT.replace(/'/g, "'\\''")
  return `#!/usr/bin/env bash
set -e
export NODE_OPTIONS="--max-old-space-size=2048"
REPO='${escapedRoot}'

echo "╔══════════════════════════════════════════╗"
echo "║        EVLoad OTA Updater                ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Branch: ${branch}"
echo "Started: $(date)"
echo ""

echo "🔄 [1/5] Fetching latest changes (branch: ${branch})..."
cd "$REPO"
git fetch --all
git reset --hard "origin/${branch}"
echo "✅ Source updated to origin/${branch}"
echo ""

echo "📦 [2/5] Installing dependencies (this may take a few minutes)..."
rm -rf "$REPO/backend/node_modules" "$REPO/frontend/node_modules"
npm --prefix "$REPO/backend" ci --include=dev
npm --prefix "$REPO/frontend" ci
echo "✅ Dependencies installed"
echo ""

echo "🗄️  [3/5] Running database migrations..."
cd "$REPO/backend"
npx prisma generate
if npx prisma migrate deploy; then
    echo "✅ Prisma migrate deploy completed."
else
    echo "⚠️  migrate deploy failed, trying prisma db push..."
    npx prisma db push --accept-data-loss
fi
cd "$REPO"
echo ""

echo "🏗️  [4/5] Building application (TypeScript + Vite)..."
chmod +x "$REPO/build-prod.sh"
bash "$REPO/build-prod.sh"
echo ""

echo "🚀 [5/5] Restarting service..."
if systemctl is-active --quiet evload 2>/dev/null; then
    echo "Restarting via systemctl..."
    systemctl restart evload
    sleep 3
    if systemctl is-active --quiet evload; then
        echo "✅ Service restarted successfully."
    else
        echo "❌ Service failed to restart. Last logs:"
        journalctl -u evload -n 50 --no-pager 2>/dev/null || true
        exit 1
    fi
elif command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q evload; then
    echo "Restarting via pm2..."
    pm2 restart evload
    echo "✅ Service restarted via pm2."
else
    echo "⚠️  No systemctl/pm2 service named 'evload' found."
    echo "   Please restart the service manually."
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅ UPDATE COMPLETED SUCCESSFULLY!       ║"
echo "╚══════════════════════════════════════════╝"
`
}
