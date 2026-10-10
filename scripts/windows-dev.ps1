$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "OSCAR Next 2.3 - Windows development bootstrap" -ForegroundColor Cyan
node scripts/windows-check.mjs
npm install
npm --prefix apps/desktop install
npm run test
npm run demo:smoke
npm run desktop:build
Write-Host "Starting OSCAR Next..." -ForegroundColor Green
npm run desktop:run
