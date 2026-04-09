import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { logger } from '../logger'

export type UpdaterState = 'idle' | 'running' | 'success' | 'error'

export interface CommitInfo {
  hash: string        // full SHA
  shortHash: string   // 7-char short SHA
  message: string     // subject line
  author: string
  date: string        // ISO date string
}

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
// Written by the bash script itself via `trap EXIT` — survives Node.js restarts
const EXIT_FILE = path.join(REPO_ROOT, 'updater.exit')

let cachedStatus: UpdaterStatus = loadStatus()

function loadStatus(): UpdaterStatus {
  try {
    const raw = fs.readFileSync(STATUS_FILE, 'utf-8')
    const s = JSON.parse(raw) as UpdaterStatus
    // If the service was restarted mid-update (e.g. by `systemctl restart evload` inside the
    // OTA script itself), the in-memory close handler never fires.  The bash script writes its
    // final exit code to EXIT_FILE via `trap EXIT`.  Reconcile here so the UI shows the correct
    // outcome instead of being stuck on 'running' or showing a false 'error'.
    if (s.state === 'running' || (s.state === 'error' && s.exitCode === null)) {
      // Also re-check when state is error+exitCode=null: signature of a signal-kill race where
      // the old Node.js wrote 'error' after bash was SIGTERM'd by systemd's cgroup kill.
      try {
        const exitCodeStr = fs.readFileSync(EXIT_FILE, 'utf-8').trim()
        if (!exitCodeStr) return s  // file exists but empty — still being written, keep as-is
        const exitCode = parseInt(exitCodeStr, 10)
        if (isNaN(exitCode)) return s  // invalid content, skip
        const resolved: UpdaterStatus = {
          ...s,
          state: exitCode === 0 ? 'success' : 'error',
          exitCode,
          endedAt: s.endedAt ?? new Date().toISOString(),
        }
        saveStatus(resolved)
        try { fs.unlinkSync(EXIT_FILE) } catch { /* ignore */ }
        logger.info('🔄 [UPDATER] Reconciled status from exit sentinel', { exitCode, state: resolved.state })
        return resolved
      } catch {
        // EXIT_FILE absent — update is genuinely still running or was hard-killed without a trace
      }
    }
    return s
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

// ── Git helpers ─────────────────────────────────────────────────────────────

function runGit(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd: REPO_ROOT })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0) logger.debug('git command non-zero exit', { args, code, err })
      resolve(out.trim())
    })
    proc.on('error', () => resolve(''))
  })
}

function parseCommitLine(raw: string): CommitInfo | null {
  if (!raw) return null
  const parts = raw.split('\x1f')
  if (parts.length < 5) return null
  return {
    hash: parts[0],
    shortHash: parts[1],
    message: parts[2],
    author: parts[3],
    date: parts[4],
  }
}

/** Commit details for the current HEAD */
export async function getLocalCommit(): Promise<CommitInfo | null> {
  const raw = await runGit(['log', '-1', '--format=%H\x1f%h\x1f%s\x1f%an\x1f%aI'])
  return parseCommitLine(raw)
}

/** Commit details for the tip of origin/<branch> (uses local remote-tracking refs — no network) */
export async function getRemoteCommit(branch: string): Promise<CommitInfo | null> {
  const raw = await runGit(['log', '-1', `origin/${branch}`, '--format=%H\x1f%h\x1f%s\x1f%an\x1f%aI'])
  return parseCommitLine(raw)
}

/** How many commits is origin/<branch> ahead of HEAD (reads local tracking refs) */
export async function getBehindCount(branch: string): Promise<number> {
  const raw = await runGit(['rev-list', '--count', `HEAD..origin/${branch}`])
  const n = parseInt(raw, 10)
  return isNaN(n) ? 0 : n
}

/** Fetch remote info without switching branch (background, best-effort) */
export async function fetchRemote(): Promise<void> {
  await runGit(['fetch', '--all', '--prune'])
}

/** Start the 60-second background fetch loop. Called once on server startup. */
export function startAutoFetch(): void {
  // Run immediately on start, then every 60 s — never during an active update
  const doFetch = () => {
    if (cachedStatus.state === 'running') return
    fetchRemote().catch((err) => {
      logger.debug('Updater: background git fetch failed', { err: String(err) })
    })
  }
  doFetch()
  setInterval(doFetch, 60_000)
  logger.info('🔄 [UPDATER] Auto-fetch started (interval: 60 s)')
}

export function getUpdaterStatus(): UpdaterStatus & { logSizeBytes: number } {
  cachedStatus = loadStatus()
  const logSizeBytes = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0
  return { ...cachedStatus, logSizeBytes }
}

export async function getGitBranches(): Promise<string[]> {
  const out = await runGit(['branch', '-r'])
  return out
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b && !b.includes('->'))
    .map((b) => b.replace(/^origin\//, ''))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort()
}

export async function getCurrentBranch(): Promise<string> {
  const out = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])
  return out || 'unknown'
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

  try { fs.writeFileSync(LOG_FILE, '') } catch { /* ignore */ }
  try { fs.unlinkSync(EXIT_FILE) } catch { /* ignore */ }

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

  // Open the log file directly as the child's stdout/stderr.
  // This avoids a broken-pipe (SIGPIPE) when Node.js is restarted mid-update by
  // `systemctl restart evload` inside the OTA script — the bash process keeps
  // writing to the file even after the Node.js parent is gone.
  let logFd: number
  try {
    logFd = fs.openSync(LOG_FILE, 'w')
  } catch (err) {
    const msg = `Failed to open log file: ${String(err)}`
    logger.error('🚨 [UPDATER] ' + msg)
    cachedStatus = { ...cachedStatus, state: 'error', endedAt: new Date().toISOString(), exitCode: -1 }
    saveStatus(cachedStatus)
    return { started: false, reason: msg }
  }

  const proc = spawn('bash', [scriptPath], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' },
  })

  // Close the fd in the parent — the child has its own reference
  try { fs.closeSync(logFd) } catch { /* ignore */ }

  proc.on('close', (code, signal) => {
    if (code === null) {
      // Bash was killed by a signal (e.g. systemd cgroup kill during `systemctl restart evload`).
      // The bash script pre-writes updater.exit before calling systemctl, so the new Node.js
      // process will reconcile state correctly via loadStatus().  Do NOT overwrite status with
      // 'error' here — leave it as 'running' so the reconciliation path can resolve it.
      logger.warn('🔄 [UPDATER] Update process killed by signal — state will be reconciled by incoming process', { signal })
      return
    }
    // Normal exit path: Node.js was NOT restarted during the update
    cachedStatus = {
      ...cachedStatus,
      state: code === 0 ? 'success' : 'error',
      endedAt: new Date().toISOString(),
      exitCode: code,
    }
    saveStatus(cachedStatus)
    logger.info('🔄 [UPDATER] Update process finished', { exitCode: code })
    try { fs.unlinkSync(scriptPath) } catch { /* ignore */ }
    try { fs.unlinkSync(EXIT_FILE) } catch { /* ignore */ }
  })

  proc.on('error', (err) => {
    const msg = `\n❌ Spawn error: ${err.message}\n`
    try { fs.appendFileSync(LOG_FILE, msg) } catch { /* ignore */ }
    cachedStatus = { ...cachedStatus, state: 'error', endedAt: new Date().toISOString(), exitCode: -1 }
    saveStatus(cachedStatus)
  })

  proc.unref()
  return { started: true }
}

function buildUpdateScript(branch: string): string {
  const escapedRoot = REPO_ROOT.replace(/'/g, "'\\''")
  return `#!/usr/bin/env bash
set -e
export NODE_OPTIONS="--max-old-space-size=2048"
REPO='${escapedRoot}'

# Write our exit code to a sentinel file on exit so the new Node.js process can
# reconcile a stale 'running' state if the service was restarted mid-update.
trap 'echo $? > "$REPO/updater.exit"' EXIT

echo "╔══════════════════════════════════════════╗"
echo "║        EVLoad OTA Updater                ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Branch : ${branch}"
echo "  Started: $(date)"
echo ""

echo "🔄 [1/5] Fetching latest changes (branch: ${branch})..."
cd "$REPO"
git fetch --all
git checkout -B "${branch}" "origin/${branch}"
git reset --hard "origin/${branch}"
git branch --set-upstream-to="origin/${branch}" "${branch}" >/dev/null 2>&1 || true
echo "  Checked out branch: $(git rev-parse --abbrev-ref HEAD)"
echo "  Local HEAD: $(git log -1 --format='%h %s')"
echo "✅ Source updated to origin/${branch}"
echo ""

echo "📦 [2/5] Installing dependencies (may take a few minutes)..."
rm -rf "$REPO/backend/node_modules" "$REPO/frontend/node_modules"
npm --prefix "$REPO/backend" ci --include=dev
npm --prefix "$REPO/frontend" ci --include=dev
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
    echo "  → Restarting via systemctl..."
    # Pre-write success sentinel BEFORE restart.
    # systemd's default KillMode=control-group terminates this bash process (same cgroup as Node.js).
    # By writing the sentinel now, the new Node.js can reconcile state to 'success' even if
    # this process dies before the EXIT trap fires.
    printf '0' > "$REPO/updater.exit"
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
    echo "  → Restarting via pm2..."
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

