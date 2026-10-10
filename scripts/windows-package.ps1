$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "OSCAR Next 2.3 - Windows installer build" -ForegroundColor Cyan
node scripts/windows-check.mjs
if ($LASTEXITCODE -ne 0) { throw "Windows environment check failed ($LASTEXITCODE)." }
npm install
if ($LASTEXITCODE -ne 0) { throw "Root dependency installation failed ($LASTEXITCODE)." }
npm --prefix apps/desktop install
if ($LASTEXITCODE -ne 0) { throw "Desktop dependency installation failed ($LASTEXITCODE)." }
npm run test
if ($LASTEXITCODE -ne 0) { throw "Tests failed ($LASTEXITCODE)." }
npm run demo:smoke
if ($LASTEXITCODE -ne 0) { throw "Demo smoke failed ($LASTEXITCODE)." }
npm run desktop:package:win
if ($LASTEXITCODE -ne 0) { throw "Windows packaging failed ($LASTEXITCODE)." }
Write-Host "Installer output:" -ForegroundColor Green
Get-ChildItem apps/desktop/release/*Setup-x64.exe | Select-Object FullName, Length, LastWriteTime
