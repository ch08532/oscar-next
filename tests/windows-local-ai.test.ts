import test from "node:test";
import { execFile } from "node:child_process";

function powershell(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Explicit exit avoids PowerShell treating an expected, caught failure as
    // the process result through its last-command success flag.
    const wrapped = `try {\n${command}\n} catch { Write-Error $_; exit 1 }\nexit 0`;
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapped], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${stdout}\n${stderr}`));
      else resolve();
    });
  });
}

// Exercise the actual PowerShell entry point with no downloads, environment
// persistence, process termination, model inference or access to therapy data.
test("Windows local AI rejects unsafe models before any installation/configuration", { skip: process.platform !== "win32" }, async () => {
  await powershell(`
. ./scripts/windows-local-ai.ps1
function Find-OscarOllama { throw 'must not resolve before validation' }
foreach ($model in @('qwen3.5:cloud', 'https://example.com/model', '--help', 'qwen3.5', 'qwen3.5:4b;whoami')) {
  try { Invoke-OscarLocalAiSetup $model; throw 'unsafe model accepted' }
  catch { if ($_.Exception.Message -notlike 'Choose a local model*') { throw } }
}
`);
});

test("Windows local AI stops on installer failure before configuration or model download", { skip: process.platform !== "win32" }, async () => {
  await powershell(`
. ./scripts/windows-local-ai.ps1
function Find-OscarOllama { return $null }
function winget { $global:LASTEXITCODE = 23 }
function Set-OscarOllamaEnvironment { throw 'must not configure after installer failure' }
try { Invoke-OscarLocalAiSetup 'qwen3.5:4b'; throw 'failed installer accepted' }
catch { if ($_.Exception.Message -notlike 'Ollama installation failed (23)*') { throw } }
`);
});

test("Windows local AI reuses installation, checks weights and tools, and stops on pull failure", { skip: process.platform !== "win32" }, async () => {
  await powershell(`
. ./scripts/windows-local-ai.ps1
$global:events = [Collections.Generic.List[string]]::new()
$global:pullCode = 0
$global:metadata = [pscustomobject]@{ model_info = [pscustomobject]@{ architecture = 'synthetic' }; capabilities = @('tools'); modelfile = ('FROM local-weights' + [Environment]::NewLine + 'LICENSE """Copyright 2026 Alibaba Cloud"""') }
function Find-OscarOllama { return 'Test-OllamaCommand' }
function Install-OscarOllama { throw 'existing installation must be reused' }
function Set-OscarOllamaEnvironment { $global:events.Add('configure') }
function Start-OscarLocalOllama { $global:events.Add('start') }
function Test-OllamaCommand {
  if (($args -join ' ') -ne 'pull qwen3.5:4b') { throw 'Unexpected CLI command' }
  $global:events.Add('pull'); $global:LASTEXITCODE = $global:pullCode
}
function Invoke-RestMethod {
  param($Uri, $Method, $ContentType, $Body, $TimeoutSec, $MaximumRedirection)
  if ($Uri -ne 'http://127.0.0.1:11434/api/show' -or $MaximumRedirection -ne 0 -or ($Body | ConvertFrom-Json).model -ne 'qwen3.5:4b') { throw 'Unexpected HTTP request' }
  $global:events.Add('metadata'); return $global:metadata
}
Invoke-OscarLocalAiSetup 'qwen3.5:4b'
if (($global:events -join ',') -ne 'configure,start,pull,metadata') { throw 'Unexpected setup order' }
$global:events.Clear(); $global:pullCode = 17
try { Invoke-OscarLocalAiSetup 'qwen3.5:4b'; throw 'failed pull accepted' }
catch { if ($_.Exception.Message -notlike 'Model download failed (17)*') { throw } }
if (($global:events -join ',') -ne 'configure,start,pull') { throw 'Continued after failed pull' }
$global:pullCode = 0
$global:metadata | Add-Member remote_host 'https://example.com'
try { Invoke-OscarLocalAiSetup 'qwen3.5:4b'; throw 'remote model accepted' }
catch { if ($_.Exception.Message -notlike 'Model metadata does not establish*') { throw } }
$global:metadata.PSObject.Properties.Remove('remote_host')
$global:metadata.modelfile = 'FROM qwen3.5:cloud'
try { Invoke-OscarLocalAiSetup 'qwen3.5:4b'; throw 'cloud model source accepted' }
catch { if ($_.Exception.Message -notlike 'Model metadata does not establish*') { throw } }
$global:metadata.modelfile = 'FROM local-weights'
$global:metadata.capabilities = @('completion')
try { Invoke-OscarLocalAiSetup 'qwen3.5:4b'; throw 'model without tools accepted' }
catch { if ($_.Exception.Message -notlike 'Model does not advertise tool calling*') { throw } }
`);
});
