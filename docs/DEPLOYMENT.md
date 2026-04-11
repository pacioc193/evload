# EVLoad Deployment Guide

## Deployment Strategy

**Golden Rule**: Always use **OTA (Over-The-Air) deployment** for production/remote servers unless OTA itself is broken.

## OTA Deployment (Recommended)

OTA (Over-The-Air) deployment automatically:
- Pulls the latest code from GitHub
- Compiles the application
- Restarts the service
- Preserves database and configuration

### Steps

1. **Verify local compilation first**:
   ```powershell
   .\scripts\pre-push-checks.ps1
   ```

2. **Push to GitHub**:
   ```powershell
   git add .
   git commit -m "your message"
   git push origin <branch>
   ```

3. **Deploy via OTA** (from Settings → Versioning → OTA Update):
   - Select the branch to deploy (e.g., `copilot/remove-unused-code-and-implementations`, `main`)
   - Click "Start Update"
   - Monitor the live logs in the panel

4. **Or use the PowerShell script**:
   ```powershell
   # Automatic OTA (detects current branch on server)
   .\Update-EvloadNative.ps1 -ServerIP 192.168.1.112 -ServerUser root
   ```

## Manual Deployment (Only if OTA is broken)

If OTA fails to start or is broken:

```powershell
# Full manual deploy with build verification
.\Update-EvloadNative.ps1 -ServerIP 192.168.1.112 -ServerUser root
```

This script will:
1. Connect to the remote server
2. Fetch latest code
3. Install dependencies
4. Run Prisma migrations
5. Build backend and frontend
6. Restart the service

## Pre-Push Checklist

**MANDATORY** before ANY `git push`:
```powershell
.\scripts\pre-push-checks.ps1
```

This ensures:
- ✅ Backend TypeScript compiles
- ✅ Frontend TypeScript + Vite builds
- ✅ No uncommitted changes are pushed

## Branch Strategy

- **main**: Stable releases
- **copilot/remove-unused-code-and-implementations**: Feature branch (WIP)

When deploying a feature branch via OTA, ensure it's selected in the OTA Update panel.

## Monitoring Deployment

### Via UI
1. Settings → Versioning → OTA Update
2. Watch the live log output
3. Check "Current" version after update completes

### Via SSH
```bash
ssh root@192.168.1.112
tail -f /opt/evload/logs/log | grep OTA
```

## Rollback

If the deployed version has issues:
1. Return to Settings → Versioning
2. Select a previous working version
3. Start OTA update to roll back

Or manually:
```bash
ssh root@192.168.1.112
cd /opt/evload
git checkout main  # or previous stable branch
./update.sh
```

## Database Persistence

Both OTA and manual deployment preserve:
- ✅ SQLite database (AppConfig, charging sessions, etc.)
- ✅ Configuration files (config.yaml)
- ✅ Log files

So updates are safe and non-destructive.

## Troubleshooting

**OTA won't start**:
- Check OTA guard reasons in Settings panel
- Ensure engine is not running
- No active charging session
- Proxy is connected
- Use "Force start (bypass guards)" only if necessary

**Build fails during OTA**:
- Check the live log for error details
- Run `npm audit` locally to identify dependency issues
- Fix locally, commit, push, retry OTA

**Service won't restart after update**:
- SSH into the server
- Check systemd status: `systemctl status evload`
- View logs: `journalctl -u evload -f`
