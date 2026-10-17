#requires -Version 5.1
<#
.SYNOPSIS
Installs Ollama and a downloaded local model for OSCAR Expert.
.DESCRIPTION
Uses Windows Package Manager when Ollama is absent. Persists local-only settings
for the current Windows account and restarts its Ollama processes. Active Ollama
chats/reviews in this session will be interrupted. No OSCAR data is read or sent.
.EXAMPLE
.\scripts\windows-local-ai.ps1
.EXAMPLE
.\scripts\windows-local-ai.ps1 -Model qwen3.5:9b
#>
[CmdletBinding()]
param([string]$Model = 'qwen3.5:4b')

$ErrorActionPreference = 'Stop'

function Find-OscarOllama {
    $command = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $installed = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (Test-Path -LiteralPath $installed -PathType Leaf) { return $installed }
    return $null
}

function Install-OscarOllama {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'Windows Package Manager is unavailable. Install Ollama from https://ollama.com/download/windows, then rerun this script.'
    }
    Write-Host 'Installing Ollama using Windows Package Manager...'
    winget install --id Ollama.Ollama --exact --source winget --scope user --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Ollama installation failed ($LASTEXITCODE). Install/update Ollama from https://ollama.com/download/windows, then rerun."
    }
}

function Set-OscarOllamaEnvironment {
    # User settings persist across logins; process settings reach the new server.
    foreach ($item in @{ OLLAMA_NO_CLOUD = '1'; OLLAMA_HOST = '127.0.0.1:11434' }.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($item.Key, $item.Value, 'User')
        [Environment]::SetEnvironmentVariable($item.Key, $item.Value, 'Process')
    }
}

function Test-OscarOllamaReachable {
    try {
        $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2 -MaximumRedirection 0
        return $true
    } catch { return $false }
}

function Start-OscarLocalOllama([string]$Executable) {
    $directory = (Split-Path $Executable -Parent).TrimEnd('\') + '\'
    $session = (Get-Process -Id $PID).SessionId
    # Restrict restarts to this session and this installation, never a service
    # or another user's server. Quit the tray first so it cannot respawn a child.
    foreach ($name in @('ollama app', 'ollama')) {
        Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
            $_.SessionId -eq $session -and $_.Path -and $_.Path.StartsWith($directory, [StringComparison]::OrdinalIgnoreCase)
        } | Stop-Process -Force
    }
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        if (-not (Test-OscarOllamaReachable)) { break }
        Start-Sleep -Milliseconds 500
    }
    if (Test-OscarOllamaReachable) {
        throw 'Port 11434 is still occupied. Stop the separately managed Ollama service/server and rerun; its cloud settings cannot be configured by this script.'
    }
    $server = Start-Process -FilePath $Executable -ArgumentList 'serve' -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $server.Refresh()
        if ($server.HasExited) { throw 'Ollama exited during startup. Check its logs and whether port 11434 is occupied.' }
        if (Test-OscarOllamaReachable) { return }
        Start-Sleep -Milliseconds 500
    }
    throw 'Ollama did not become reachable. Check its logs, then rerun the script.'
}

function Invoke-OscarLocalAiSetup([string]$SelectedModel) {
    if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
    # Only official-library style local names; no cloud markers, URLs or flags.
    if ($SelectedModel -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9][a-zA-Z0-9._-]*$' -or $SelectedModel -match 'cloud') {
        throw 'Choose a local model name with a tag, such as qwen3.5:4b. Cloud models and URLs are not allowed.'
    }
    Write-Host "OSCAR Expert local AI setup: $SelectedModel" -ForegroundColor Cyan
    Write-Host 'This downloads software/model weights and restarts Ollama in your Windows session.'
    $executable = Find-OscarOllama
    if (-not $executable) {
        Install-OscarOllama
        $executable = Find-OscarOllama
        if (-not $executable) { throw 'Ollama was not found after installation. Open a new PowerShell window and rerun.' }
    }
    Set-OscarOllamaEnvironment
    Start-OscarLocalOllama $executable
    Write-Host "Downloading $SelectedModel (existing weights are reused)..."
    & $executable pull $SelectedModel
    if ($LASTEXITCODE -ne 0) { throw "Model download failed ($LASTEXITCODE). Check Internet access, disk space and Ollama version; rerun to resume." }
    $detail = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/show' -Method Post -ContentType 'application/json' -Body (@{ model = $SelectedModel } | ConvertTo-Json) -TimeoutSec 30 -MaximumRedirection 0
    # LICENSE text can mention Alibaba Cloud even for downloaded local weights.
    # Only model-source declarations and explicit remote metadata signal cloud use.
    $cloudSource = [string]$detail.modelfile -match '(?im)^[ \t]*FROM[ \t]+[^\r\n]*cloud'
    if ($detail.remote_host -or $detail.remote_model -or $detail.remote -or $cloudSource -or -not $detail.model_info -or @($detail.model_info.PSObject.Properties).Count -eq 0) {
        throw 'Model metadata does not establish downloaded local weights. Select a local model and rerun.'
    }
    if (@($detail.capabilities) -notcontains 'tools') {
        throw 'Model does not advertise tool calling. Update Ollama or choose a model with tools support.'
    }
    Write-Host 'Installed local weights; application compatibility is still untested.' -ForegroundColor Green
    Write-Host "In OSCAR: Analysis > Expert > Local AI settings. Enable local reviews, set URL http://127.0.0.1:11434, refresh models, select $SelectedModel, choose context size 8192, save and test compatibility."
    Write-Host 'All compatibility checks must pass. Start with one demo night.'
    Write-Host 'After reboot, launch Ollama from Start if it is not running. For a Windows Service, configure Ollama under the service account separately (see LOCAL-AI.md).'
}

# Dot-sourcing exposes helpers for offline tests without installing anything.
if ($MyInvocation.InvocationName -ne '.') { Invoke-OscarLocalAiSetup $Model }
