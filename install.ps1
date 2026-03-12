Param()
$ErrorActionPreference = 'Stop'

# Ensure script is non-interactive and will attempt to install Node.js automatically if missing.
function Install-NodeIfMissing {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        return
    }

    Write-Host "[!] 'npm' non trovato. Provo ad installare Node.js automaticamente..." -ForegroundColor Cyan

    # Try winget first
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "[*] winget trovato: installo OpenJS.NodeJS.LTS (silently)"
        try {
            winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --silent
        } catch {
            Write-Host "[!] winget install fallito, provo chocolatey..." -ForegroundColor Yellow
        }
    }

    # If still not installed, try chocolatey
    if (-not (Get-Command npm -ErrorAction SilentlyContinue) -and (Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Host "[*] chocolatey trovato: installo nodejs-lts"
        try {
            choco install nodejs-lts -y --no-progress
        } catch {
            Write-Host "[!] choco install fallito." -ForegroundColor Yellow
        }
    }

    # Final check - try to find node in common install locations and update PATH for current session
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        $pf = [System.Environment]::GetEnvironmentVariable('ProgramFiles')
        $pf86 = [System.Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
        $localapp = [System.Environment]::GetEnvironmentVariable('LOCALAPPDATA')

        $possibleDirs = @()
        if ($pf) { $possibleDirs += Join-Path $pf 'nodejs' }
        if ($pf86) { $possibleDirs += Join-Path $pf86 'nodejs' }
        if ($localapp) { $possibleDirs += Join-Path $localapp 'Programs\nodejs' }

        $found = $false
        foreach ($d in $possibleDirs) {
            $nodePath = Join-Path $d 'node.exe'
            if (Test-Path $nodePath) {
                Write-Host "[*] Trovato node.exe in $d - aggiungo alla variabile PATH della sessione corrente"
                $env:Path = "$d;$env:Path"
                $found = $true
                break
            }
        }
        if ($found -and (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Host "[*] npm ora disponibile nella sessione corrente." -ForegroundColor Green
        } else {
            Write-Host "[ERROR] Impossibile installare automaticamente Node.js o aggiornare PATH. Apri un nuovo terminale e rilancia lo script." -ForegroundColor Red
            exit 1
        }
    }
}

Install-NodeIfMissing

Write-Host "[*] Starting install for evload (PowerShell)"

Write-Host "[*] Installing root dependencies..."
npm install --no-audit --no-fund

Write-Host "[*] Installing backend dependencies..."
npm --prefix backend install

Write-Host "[*] Ensuring backend .env exists"
$backendEnv = Join-Path "backend" ".env"
$backendEnvExample = Join-Path "backend" ".env.example"
if (-not (Test-Path $backendEnv) -and (Test-Path $backendEnvExample)) {
    Copy-Item $backendEnvExample $backendEnv
    # generate a secure JWT_SECRET (32 bytes hex)
    $bytes = New-Object 'System.Byte[]' 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $jwt = ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
    (Get-Content $backendEnv) -replace 'JWT_SECRET=".*?"', "JWT_SECRET=`"$jwt`"" | Set-Content $backendEnv
    Write-Host "[*] Created $backendEnv with a generated JWT_SECRET" -ForegroundColor Green
    Write-Host "[!] Al primo avvio il frontend ti chiedera' di scegliere la password UI." -ForegroundColor Cyan
}

Write-Host "[*] Installing frontend dependencies..."
npm --prefix frontend install

Write-Host "[*] Running Prisma generate in backend (if applicable)..."
try {
    npx --prefix backend prisma generate --ignore-existing
} catch {
    Write-Host "[!] Prisma generate failed or not present; continuing..."
}

Write-Host "[*] Install complete. To start development run: npm run dev"
Write-Host "    - In PowerShell: npm run dev"
Write-Host "    - Or open two terminals and run 'npm run dev --prefix backend' and 'npm run dev --prefix frontend'"
