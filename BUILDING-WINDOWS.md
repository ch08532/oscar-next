# OSCAR Next 2.3 — Windows build, desktop, and headless guide

## Optional OSCAR AI runtime

Before packaging OpenAI support, provision the verified Windows tunnel-client and
its hash/version manifest in `runtime/tunnel-client/`. Electron Builder places it
outside ASAR under `resources/tunnel-client`. Source control contains only the
provisioning README; cloud analysis reports unavailable until the runtime and
account credentials exist. See [OSCAR-AI.md](OSCAR-AI.md). End users configure keys,
model and tunnel through Settings; OSCAR starts/stops the child automatically.

## Requirements

- Windows 10 or Windows 11 x64
- Node.js 22.x or newer (64-bit)
- npm (included with Node.js)
- PowerShell 5.1+ or PowerShell 7

No Visual Studio toolchain is required for the current codebase because OSCAR Next 2.3 uses Node's built-in SQLite implementation and has no native npm addon.

## Fastest path: verify and launch

Extract the source ZIP, open PowerShell in the extracted folder, and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-dev.ps1
```

The script:

1. checks Windows/x64 and Node.js 22+
2. installs root and desktop npm dependencies
3. builds the TypeScript backend
4. runs the complete automated test suite
5. runs the synthetic ResMed end-to-end smoke workflow
6. builds the React/Vite renderer
7. launches Electron

The bootstrap and packaging scripts stop on failed native commands. The development
script clears an inherited `ELECTRON_RUN_AS_NODE` flag for the launch and restores
it afterward. Development launches use the root application package so the header
reports the product version rather than the Electron runtime version.

For actual results and remaining manual checks on Windows, see
[`WINDOWS-VALIDATION.md`](WINDOWS-VALIDATION.md).

On first launch choose **Try demo data**. This generates a synthetic 14-night AirSense 11-style card and imports it through the same ResMed importer used for real media.

## Optional local AI

For optional OSCAR Expert local AI, run
`powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-local-ai.ps1`.
This installs Ollama and downloads `qwen3.5:4b`, with cloud features disabled and
a loopback-only server. See [LOCAL-AI.md](LOCAL-AI.md) for configuration and the
required model compatibility check. The regular development bootstrap does not
install AI software or models.

## Create the Windows installer

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-package.ps1
```

The script runs the same verification gates and then creates the NSIS installer.

Expected output:

```text
apps\desktop\release\OSCAR-Next-2.3.0-Setup-x64.exe
```

The installer is per-user by default, offers an installation-directory choice, and creates Start Menu and Desktop shortcuts.

## Manual commands

If you prefer to run each step yourself:

```powershell
node scripts/windows-check.mjs
npm install
npm --prefix apps/desktop install
npm test
npm run demo:smoke
npm run desktop:build
npm run desktop:run
```

Build the installer manually with:

```powershell
npm run desktop:package:win
```

## Demo / smoke tools

Generate a standalone synthetic ResMed card folder:

```powershell
npm run demo:card
```

Run the full backend acceptance workflow without Electron:

```powershell
npm run demo:smoke
```

Keep the generated smoke database/card for inspection by supplying a work folder:

```powershell
npm run build
node dist/src/cli/main.js demo-smoke C:\Temp\oscar-next-smoke
```

## What to check in the desktop app

After **Try demo data**:

- the header should show `v2.3.0`
- the demo AirSense 11 machine should be selected
- Daily should open on the latest therapy night
- Usage should be more than 4 hours
- Flow, Pressure, Leak, SpO2/Pulse and Event Flags should display on the latest detailed nights
- Overview should contain 14 therapy days
- Statistics should show 14 used days and settings-history periods
- session enable/disable should immediately recalculate Daily and chart data
- graph order, size, pins and saved zoom ranges should persist after restart
- zoom into a range, optionally enter a **Graph view name**, and choose **Save view**; an empty name uses the time range
- **Diagnostics** should create a ZIP without therapy/database content

See `WINDOWS-ACCEPTANCE-CHECKLIST.md` for a fuller checklist.

## Real ResMed card validation

When an anonymized real card is available, copy it to disk first and run:

```powershell
$env:OSCAR_RESMED_FIXTURE = "C:\path\to\anonymized-card"
npm test
```

Then launch the desktop app and import that copied card. Compare Daily session boundaries, AHI, event breakdown, pressure, leak and settings with OSCAR for the same nights.

## Code signing

2.3.0 does not include a signing certificate. Windows can therefore show an **Unknown publisher** / SmartScreen warning for locally built installers. Public distribution should use an Authenticode code-signing certificate.

## Diagnostics and privacy

The desktop **Diagnostics** action creates a ZIP containing app/runtime/OS/schema information and structured logs. It does **not** include:

- the SQLite database
- therapy waveforms or event records
- profile names
- machine serial numbers
- SD-card or database paths

## Current packaging limitation

The `.exe` is built on Windows with the Electron/Vite npm packages installed.
The `windows-package.ps1` script is the release gate for that step. The 2026-10-10
validation built, installed, launched, restarted, and uninstalled an unsigned NSIS
package using synthetic data. Normal uninstall retains application user data;
the validation used an isolated user-data directory. See `WINDOWS-VALIDATION.md`
for the scope of those checks and the remaining acceptance work.


## Windows headless service

For a browser-based deployment that runs at boot without Electron, use the native Windows Service mode:

```powershell
# Administrator PowerShell
.\scripts\windows-headless-install.ps1
```

Open `http://localhost:3210/`. For access from phones/tablets/other PCs on your private LAN:

```powershell
.\scripts\windows-headless-install.ps1 -Lan
```

The LAN install generates an API token and a Private-profile Windows Firewall rule. Automatic SD-card detection is enabled; unattended import is separately opt-in with `-AutoImportMedia $true`. See `TASK-C-WINDOWS-HEADLESS.md`.
