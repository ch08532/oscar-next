$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "OSCAR Next 2.3 - Windows installer build" -ForegroundColor Cyan
node scripts/windows-check.mjs
npm install
npm --prefix apps/desktop install
npm run test
npm run demo:smoke
npm run desktop:package:win
Write-Host "Installer output:" -ForegroundColor Green
Get-ChildItem apps/desktop/release/*Setup-x64.exe | Select-Object FullName, Length, LastWriteTime
