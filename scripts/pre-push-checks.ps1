#Requires -Version 7.0
<#
.SYNOPSIS
Pre-push validation script: enforces local compilation before pushing to GitHub.

.DESCRIPTION
This script is designed to be called before `git push` to ensure:
1. Backend TypeScript compiles without errors
2. Frontend TypeScript + Vite build succeeds
3. All production builds are up-to-date

Usage: .\scripts\pre-push-checks.ps1

.NOTES
Exit code:
  0 = Success, safe to push
  1 = Build failed, STOP push
#>

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   EVLoad Pre-Push Build Validation   " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$failed = $false

# Check if git is in a state ready to push
Write-Host "Checking git status..." -ForegroundColor Yellow
$gitStatus = git status --porcelain
if ($gitStatus) {
  Write-Host "⚠️  Working directory has uncommitted changes:" -ForegroundColor Yellow
  Write-Host $gitStatus
  Write-Host ""
}

# Step 1: Compile Backend
Write-Host "🔨 [1/2] Compiling backend (TypeScript)..." -ForegroundColor Cyan
try {
  Push-Location backend
  if (-not (Test-Path node_modules)) {
    Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
    npm ci --include=dev 2>&1 | Out-Null
  }
  
  $buildOutput = npm run build 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Backend compiled successfully" -ForegroundColor Green
  } else {
    Write-Host "❌ Backend compilation FAILED" -ForegroundColor Red
    Write-Host $buildOutput
    $failed = $true
  }
  Pop-Location
} catch {
  Write-Host "❌ Backend build error: $_" -ForegroundColor Red
  $failed = $true
}

# Step 2: Build Frontend
Write-Host ""
Write-Host "🔨 [2/2] Building frontend (TypeScript + Vite)..." -ForegroundColor Cyan
try {
  Push-Location frontend
  if (-not (Test-Path node_modules)) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    npm ci --include=dev 2>&1 | Out-Null
  }
  
  $buildOutput = npm run build 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Frontend built successfully" -ForegroundColor Green
  } else {
    Write-Host "❌ Frontend build FAILED" -ForegroundColor Red
    Write-Host $buildOutput
    $failed = $true
  }
  Pop-Location
} catch {
  Write-Host "❌ Frontend build error: $_" -ForegroundColor Red
  $failed = $true
}

# Final result
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($failed) {
  Write-Host "❌ BUILD VALIDATION FAILED" -ForegroundColor Red
  Write-Host "Fix the errors above before pushing." -ForegroundColor Yellow
  Write-Host "========================================" -ForegroundColor Cyan
  exit 1
} else {
  Write-Host "✅ ALL CHECKS PASSED - READY TO PUSH" -ForegroundColor Green
  Write-Host "Remember to use OTA (Update-EvloadNative.ps1)" -ForegroundColor Yellow
  Write-Host "for production deployment (unless OTA is broken)." -ForegroundColor Yellow
  Write-Host "========================================" -ForegroundColor Cyan
  exit 0
}
