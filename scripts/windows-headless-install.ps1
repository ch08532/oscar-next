[CmdletBinding()]
param(
  [string]$InstallDir = "$env:ProgramData\OSCAR Next Headless",
  [string]$DataDir = "$env:ProgramData\OSCAR Next Headless\data",
  [int]$Port = 3210,
  [switch]$Lan,
  [string]$ApiToken = "",
  [bool]$AllowImports = $true,
  [bool]$WatchMedia = $true,
  [bool]$AutoImportMedia = $false,
  [bool]$OpenBrowser = $true,
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$ServiceName = "OscarNextHeadless"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run this installer from an Administrator PowerShell." }
if ($Port -lt 1 -or $Port -gt 65535) { throw "Port must be between 1 and 65535." }
if ($AutoImportMedia -and (-not $WatchMedia -or -not $AllowImports)) { throw "AutoImportMedia requires WatchMedia and AllowImports." }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$major = [int](& $node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { throw "Node.js 22+ is required." }

if (-not $SkipBuild) {
  Write-Host "Building OSCAR Next headless..." -ForegroundColor Cyan
  npm install
  npm --prefix apps/desktop install --ignore-scripts
  npm run headless:build
  npm test
}

$AppDir = Join-Path $InstallDir "app"
$ServiceDir = Join-Path $InstallDir "service"
$LogDir = Join-Path $DataDir "logs"
$WebRoot = Join-Path $AppDir "web"
New-Item -ItemType Directory -Force -Path $AppDir,$ServiceDir,$DataDir,$LogDir,$WebRoot | Out-Null
Remove-Item -Recurse -Force (Join-Path $AppDir "dist") -ErrorAction SilentlyContinue
Copy-Item -Recurse -Force (Join-Path $Root "dist") (Join-Path $AppDir "dist")
Copy-Item -Recurse -Force (Join-Path $Root "apps\desktop\headless-dist\*") $WebRoot

$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw ".NET Framework C# compiler was not found. Enable/install .NET Framework 4.x, then rerun." }
$serviceExe = Join-Path $ServiceDir "OscarNextHeadlessService.exe"
& $csc /nologo /target:exe /out:$serviceExe /reference:System.ServiceProcess.dll (Join-Path $Root "deploy\windows-headless\OscarNextHeadlessService.cs")
if ($LASTEXITCODE -ne 0) { throw "Failed to compile the Windows Service wrapper." }

$hostAddress = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
if ($Lan -and [string]::IsNullOrWhiteSpace($ApiToken)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $ApiToken = -join ($bytes | ForEach-Object { $_.ToString("x2") })
}
$config = @(
  "NodePath=$node",
  "AppDir=$AppDir",
  "DatabasePath=$(Join-Path $DataDir 'oscar-next.sqlite')",
  "Host=$hostAddress",
  "Port=$Port",
  "WebRoot=$WebRoot",
  "LogDir=$LogDir",
  "AllowImports=$($AllowImports.ToString().ToLowerInvariant())",
  "WatchMedia=$($WatchMedia.ToString().ToLowerInvariant())",
  "AutoImportMedia=$($AutoImportMedia.ToString().ToLowerInvariant())",
  "ApiToken=$ApiToken"
)
$configPath = Join-Path $ServiceDir "service.conf"
Set-Content -Path $configPath -Value $config -Encoding UTF8
& icacls.exe $configPath /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)" | Out-Null

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force; $existing.WaitForStatus('Stopped','00:00:15') }
  & sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Milliseconds 750
}
& sc.exe create $ServiceName binPath= "`"$serviceExe`"" start= auto DisplayName= "OSCAR Next Headless" | Out-Null
& sc.exe description $ServiceName "OSCAR Next headless CPAP analysis web/API service" | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null

$ruleName = "OSCAR Next Headless TCP $Port"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
if ($Lan) { New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private | Out-Null }

Start-Service -Name $ServiceName
Start-Sleep -Seconds 1
$service = Get-Service -Name $ServiceName
if ($service.Status -ne 'Running') { throw "Service did not reach Running state. Check $ServiceDir\service-wrapper.log and $LogDir." }

$localUrl = "http://localhost:$Port/"
Write-Host "OSCAR Next Windows Headless installed." -ForegroundColor Green
Write-Host "Service: $ServiceName ($($service.Status))"
Write-Host "Web UI:  $localUrl"
Write-Host "Swagger: http://localhost:$Port/docs"
Write-Host "Data:    $DataDir"
if ($Lan) {
  Write-Host "LAN binding enabled. API token:" -ForegroundColor Yellow
  Write-Host $ApiToken -ForegroundColor Yellow
  Write-Host "The token is also stored with restricted ACLs in $configPath"
}
if ($AutoImportMedia) { Write-Host "Automatic mounted-card import is ENABLED." -ForegroundColor Yellow }
if ($OpenBrowser) { Start-Process $localUrl }
