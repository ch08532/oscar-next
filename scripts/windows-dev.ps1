$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "OSCAR Next 2.3 - Windows development bootstrap" -ForegroundColor Cyan
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
npm run desktop:build
if ($LASTEXITCODE -ne 0) { throw "Desktop build failed ($LASTEXITCODE)." }
Write-Host "Starting OSCAR Next..." -ForegroundColor Green
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
  # Editor/agent shells may inherit this flag from their own Electron host.
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  npm run desktop:run
  if ($LASTEXITCODE -ne 0) { throw "Electron launch failed ($LASTEXITCODE)." }
} finally {
  if ($null -eq $previousRunAsNode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
  else { $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode }
}
