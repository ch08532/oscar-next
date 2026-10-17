# OSCAR Next 2.3.0 Windows validation — 2026-10-10

## Shared Expert provider interface — 2026-10-17

Environment remains Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0.
`npm run verify`: **PASS** (228 passed, 2 optional skips; demo smoke PASS).
`npx tsc -p apps/desktop/tsconfig.json --noEmit`,
`npm --prefix apps/desktop run build`, and
`npm --prefix apps/desktop run build:headless`: **PASS**. The shared Expert screen
uses Local Ollama or OpenAI with isolated conversations. Local generation retains
the original validated review/evidence path and needs no cloud configuration.
Seven added regressions pass. Manual GUI/provider-switch/evidence navigation and
real-model acceptance remain unclaimed. See [AI validation](OSCAR-AI-VALIDATION.md).

## OSCAR AI implementation checks — 2026-10-17

Environment: Microsoft Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0.
`npm install`, `npm --prefix apps/desktop install`, `npm run verify`,
`npx tsc -p apps/desktop/tsconfig.json --noEmit`,
`npm --prefix apps/desktop run build` and
`npm --prefix apps/desktop run build:headless`: **PASS**. Final verification:
221 passed, 2 optional Ollama checks skipped, demo smoke PASS. Desktop install
reported 10 audit findings; renderer builds emitted advisory Zod-comment/chunk
warnings. No real account/tunnel credentials or tunnel binary were used.

The synthetic/mocked tests and real owned-child termination test do not mark
Electron GUI, keychain, real tunnel, installer or Raspberry Pi checklist items
complete. See [OSCAR-AI-VALIDATION.md](OSCAR-AI-VALIDATION.md) for checks, fixes,
runtime provisioning and remaining blockers. Headless credentials remain
memory-only; forced-parent crash cleanup is not guaranteed.

## Respiratory-index fallback follow-up — 2026-10-12

- A read-only check of the default desktop database confirmed that the reported
  night has waveform data and positive stored STR summary AHI but no detailed
  respiratory event lists. No database, device identifiers, profiles, or therapy
  payloads were copied into repository artifacts; the database was not modified.
- Root cause: STR fallback was restricted to `summary_only` sessions, although
  waveform availability does not imply EVE event availability. Fallback now
  applies to sessions without detailed respiratory events. Whole-session event
  presence preserves exact-count precedence across noon. Counts and chart event
  records remain unchanged; summary rates do not fabricate detailed events.
- Night Inspector explains summary-based positive AHI and shows unavailable
  summary RERA as a dash. README/OpenAPI describe the fallback behavior.
- Baseline `npm run verify`: PASS, 156 tests and smoke. A new synthetic regression
  failed with `0 !== 6` before the fix and passes afterward. Final verification:
  PASS, 159 tests and smoke, including Daily/Overview/Statistics parity,
  exclusions, noon-boundary precedence and a REST integration regression.
  Desktop/headless builds, renderer TypeScript check and `git diff --check`: PASS.
- Rechecked the reported night using the rebuilt read-only query: positive AHI
  is returned without inventing event counts. No re-import is required.
  Visual confirmation of the inspector message and physical/Pi validation
  remain manual checks.

## Chart wheel zoom follow-up — 2026-10-12

- Root cause: React's delegated wheel listener is passive, so the chart's
  `preventDefault()` could not cancel page scrolling. The shared graph
  interaction hook now attaches a native non-passive listener to each plot
  container and removes it on cleanup. Pointer-centered zoom is preserved;
  zero vertical delta does not change the zoom.
- Baseline `npm run verify`: PASS, 156 tests and synthetic smoke.
  Final `npm test`, desktop/headless builds and renderer TypeScript check: PASS.
- `node .validation/check-chart-wheel.mjs`: the default-cancellation assertion
  failed before the fix and passes afterward for waveform and Event Flags
  plots, zooming in/out and at the full-range boundary. Shared viewport updates
  and ancestor scroll positions are checked in Chromium with synthetic data.
  These are dispatched DOM wheel events; physical mouse/trackpad validation
  remains a manual acceptance check.

## Scrollbar styling follow-up — 2026-10-12

- Shared renderer now uses 6px scrollbars with transparent tracks, rounded
  theme-aware thumbs and a clearer hover color. Other browser engines use
  their native thin scrollbar setting. Scrolling behavior remains available.
- `npm test`: PASS, 156 tests. Desktop and headless renderer builds: PASS.
  Visual verification of the scrollbar styling remains a manual check.

## Night Statistics visibility follow-up — 2026-10-12

- Sessions follow-up: scoped the compact Sessions table to fit the inspector
  without horizontal scrolling. `npm test`: PASS, 156 tests; desktop and
  headless builds: PASS. `node .validation/check-sessions-layout.mjs`: PASS at
  1920, 1600, 1440 and 1280px, with all inclusion/time/usage cells fitting the
  287.2px container without clipped content. Used isolated synthetic sessions.
- Confirmed the generic table minimum width hid all numeric columns outside
  the Night Inspector. Scoped the nightly table to fit its panel.
- `npm run verify`: PASS, 156 tests and smoke; desktop and headless renderer
  builds: PASS. Synthetic browser geometry checks: PASS at four viewport widths,
  with all 85 numeric cells visible. Details in
  [Daily respiratory graphs validation](DAILY-RESPIRATORY-GRAPHS-VALIDATION.md).

## Daily respiratory graphs follow-up — 2026-10-12

- Windows 11 x64 (OS 10.0.26200), Node v24.21.0, npm 11.19.0,
  Electron 37.10.3. Used isolated synthetic data only.
- `npm run verify`: PASS, 156 tests and synthetic demo smoke.
- `npm --prefix apps/desktop run build`,
  `npm --prefix apps/desktop run build:headless`, and
  `apps/desktop/node_modules/.bin/tsc.cmd --noEmit -p apps/desktop/tsconfig.json`:
  PASS.
- Actual Electron IPC and browser REST checks: PASS for graph availability,
  presets, visibility persistence, layout controls, synchronized cursors,
  zoom/pan/bookmarks, nightly statistics, leak threshold controls, excluded
  sessions, summary-only nights, and three desktop viewport sizes.
- Complete channel inventory, regression results, query plans, synthetic
  performance measurements, and remaining real-card/Pi/packaging checks:
  [Daily respiratory graphs validation](DAILY-RESPIRATORY-GRAPHS-VALIDATION.md).

## Native menu follow-up — 2026-10-12

- Windows 11 x64 (OS 10.0.26200), Node v24.21.0, npm 11.19.0,
  Electron 37.10.3.
- Windows desktop windows now use Electron's `autoHideMenuBar` option; the
  native menu remains installed and Alt reveals it. Other platforms retain
  their existing menu behavior.
- `npm run verify` baseline: PASS, 140 tests and synthetic demo smoke.
- `npm test`: PASS, 140 tests. `npm --prefix apps/desktop run build`: PASS.
- `node .validation/run-menu-bar-check.mjs`: PASS. Launched the actual updated
  desktop entry point with isolated empty user data; confirmed
  `isMenuBarAutoHide()` is true, `isMenuBarVisible()` is false, and the native
  application menu remains installed. The temporary process exited afterward.
- Physical Alt-key interaction remains a manual acceptance check.

## Application icon follow-up — 2026-10-12

- Same Windows/Node/npm/Electron environment as the native menu follow-up.
- Replaced the older SVG/PNG/ICO artwork with the sidebar's blue Lucide Activity
  mark. Added its ISC attribution and an Electron/Chromium rasterization helper:
  `npm --prefix apps/desktop run icons:generate`.
- Electron's main window explicitly loads the Windows ICO or Linux PNG from
  the development assets directory or packaged application assets. Existing
  electron-builder settings already include those assets and use the ICO for
  Windows packaging and PNG for Linux packaging.
- Baseline `npm run verify`: PASS, 140 tests and demo smoke. Final `npm test`:
  PASS, 140 tests. `npm --prefix apps/desktop run build`: PASS.
- `node .validation/run-app-icon-check.mjs`: PASS. Launched the actual desktop
  entry point with isolated empty user data; queried the window's native icon
  through Windows `WM_GETICON`, captured it, and visually confirmed the blue
  pulse artwork. The helper also decoded the 512px PNG and all seven ICO frames
  (16, 24, 32, 48, 64, 128, 256px). The temporary process exited afterward.
- An initial validation helper blocked Electron's event loop while querying
  its native window; switching the helper to asynchronous execution resolved
  this. Windows icon conversion rounds RGB channels by one, accounted for in
  the helper's color check. No application startup failure remained.
- Installer/executable shortcut icons were not rebuilt or manually checked;
  Linux runtime validation was not performed on this Windows machine.

## Environment and scope

- Windows x64 development machine: OS 10.0.26200, registry build 26200.9457,
  DisplayVersion 25H2. This build corresponds to Windows 11; the registry's
  `ProductName` still says `Windows 10 Pro`. Computer/user identity is omitted.
- Node v24.21.0; npm 11.19.0; Git 2.55.0.windows.5.
- Installed Electron 37.10.3 uses Node v22.21.1 and Chromium 138.
- Current PowerShell token is **not Administrator**. Unrestricted command
  execution did not supply an elevated Windows administrator token.
- Both package-lock files existed and were untracked before work began. They
  remain untracked. Installs reused existing dependencies; this was not a
  clean-cache or `npm ci` reproducibility test.
- Read AGENTS.md, CODEX_HANDOFF.md, CODEX_FIRST_TASK.md, README.md,
  BUILDING-WINDOWS.md, WINDOWS-ACCEPTANCE-CHECKLIST.md,
  TASK-C-WINDOWS-HEADLESS.md, OPENAPI.md, package manifests, relevant tests,
  Windows scripts, build/staging configuration, and runtime entry points before
  editing code. Initial assessment was reported before implementation.
- All therapy data used here is synthetic. No CPAP source media was used.
  Temporary databases, exports, automation helpers, and isolated user data are
  under ignored `.validation/`. They are not release source or committed data.

## Architecture and entry points

ResMed detection/import and EDF parsing populate the Machine/Session/Day/EventList
model. SQLite schema v5 stores sessions, settings, profiles, preferences, and
typed-array waveform chunks. Queries/reports are shared between desktop and
headless modes. React uses the scoped OscarApi boundary through Electron
preload/IPC or the REST adapter. The renderer remains sandboxed with
contextIsolation enabled and nodeIntegration disabled.

| Purpose | Entry point/build |
| --- | --- |
| CLI/demo smoke | `src/cli/main.ts` → `dist/src/cli/main.js` |
| Electron main | `src/desktop/main.ts` → `dist/src/desktop/main.js` |
| Sandboxed preload | `src/desktop/preload.cts` → `dist/src/desktop/preload.cjs` |
| Desktop renderer | `apps/desktop/src/main.tsx`, Vite → `apps/desktop/dist` |
| REST API | `src/api/main.ts`, `src/api/server.ts` |
| Headless runtime | `src/headless/main.ts` |
| Browser renderer | `apps/desktop/src/headless-main.tsx`, REST adapter, `vite.headless.config.ts` → `headless-dist` |
| Windows bootstrap/package | `scripts/windows-dev.ps1`, `scripts/windows-package.ps1` |
| Native service | `scripts/windows-headless-install.ps1`, `deploy/windows-headless/OscarNextHeadlessService.cs` |
| NSIS staging/config | `apps/desktop/scripts/stage-backend.mjs`, `electron-builder.yml` |

## Commands and results

Commands ran from the repository root unless indicated. Interactive Electron
checks used a loopback Chromium debugging endpoint and ignored local Node scripts
(`node .validation/cdp.mjs`, `node .validation/ui-check.mjs`). These scripts
inspect the actual renderer and invoke actual preload APIs; they are not mocked
React screens. Native input automation limitations are called out below.

| Command | Result |
| --- | --- |
| `node --version`, `npm --version`, `git --version`, `git status --short` | PASS; versions above; initially only the two untracked lockfiles |
| `npm install` | PASS; 2 packages audited, zero root vulnerabilities |
| `npm --prefix apps/desktop install` | PASS; 381 packages audited; 10 advisories (8 moderate, 2 high) |
| `npm run verify` before changes | PASS: 77 tests, zero failures; separate demo smoke PASS |
| `npm run desktop:build` before changes | PASS: root TypeScript + Vite renderer |
| `Set-ExecutionPolicy -Scope Process Bypass; .\scripts\windows-dev.ps1` | Gates passed; original Electron launch failed; original script incorrectly returned exit code 0 |
| `npm run verify` after fixes | PASS: **79 tests**, zero failures, zero reported skips; demo smoke PASS |
| `npm run desktop:build` after preload/startup fix | PASS |
| `npm --prefix apps/desktop run build` after final graph fix | PASS |
| `.\node_modules\.bin\tsc.cmd --noEmit` from `apps/desktop` | PASS; separate renderer type check |
| `npm run headless:build` after final graph fix | PASS |
| `npm --prefix apps/desktop audit --json` | Exit 1: 10 dependency advisories; no forced upgrades applied |
| `.\scripts\windows-package.ps1` without execution-policy bypass | FAIL: unsigned PowerShell script blocked by execution policy |
| `Set-ExecutionPolicy -Scope Process Bypass; $env:CSC_IDENTITY_AUTO_DISCOVERY='false'; .\scripts\windows-package.ps1` | First sandbox attempt failed on user-cache access; unrestricted retry PASS, NSIS produced |
| `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run desktop:package:win` | PASS; rebuilt installer with final graph fix |
| `Set-ExecutionPolicy -Scope Process Bypass; .\scripts\windows-headless-install.ps1 -SkipBuild -OpenBrowser $false` | BLOCKED: `Run this installer from an Administrator PowerShell.` No service registered |
| `node dist/src/headless/main.js --database .validation/headless.sqlite --host 127.0.0.1 --port 3210 --allow-imports --web-root ./apps/desktop/headless-dist` | PASS as foreground Node process; stopped after checks |
| HTTP GET `/`, `/docs`, `/openapi.json`, `/api/v1/health` on `http://127.0.0.1:3210` | PASS: all 200 without token; health version 2.3.0, web enabled, media watch/auto-import false |
| `git diff --check` | PASS; Git reports expected LF/CRLF conversion warnings |

Demo smoke result: latest therapy date 2026-10-09, usage 8.28 h, AHI 0.36,
14 Overview days, 14 Statistics used days, 11 chart series, 977-byte diagnostic
ZIP. Smoke's own temporary files were removed.

The optional real-card test returns without importing when OSCAR_RESMED_FIXTURE
is absent, so its reported pass is **not real-card validation**. No fixture was
provided. The historical 77-test baseline was confirmed before changes; two
targeted regression tests account for the final 79.

## Reproduced failures and targeted fixes

1. **Inherited Node-only Electron flag.** The agent shell had
   `ELECTRON_RUN_AS_NODE=1`. Original bootstrap output:

   ```text
   file:///.../dist/src/desktop/main.js:4
   import { app, BrowserWindow, dialog, ipcMain } from "electron";
   SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
       at ModuleJob._instantiate (node:internal/modules/esm/module_job:226:21)
   Node.js v22.21.1
   ```

   Cleared the flag for the development child launch and restored the caller's
   value afterward. Added native exit-code checks to desktop bootstrap/package
   scripts: `$ErrorActionPreference = 'Stop'` alone did not stop on npm failure.
   A PowerShell regression test simulates a failed environment check and verifies
   neither script proceeds to npm. The later sandbox packaging failure correctly
   caused `Windows packaging failed (1).`

2. **Blank Electron renderer from ESM preload.** After clearing the flag,
   Electron started but `window.oscar` was undefined and React root was empty:

   ```text
   Unable to load preload script: .../dist/src/desktop/preload.js
   SyntaxError: Cannot use import statement outside a module
       at runPreloadScript (node:electron/js2c/sandbox_bundle:2:141537)
       at executeSandboxedPreloadScripts (node:electron/js2c/sandbox_bundle:2:140832)
   TypeError: Cannot read properties of undefined (reading 'getAppInfo')
   ```

   Renamed the preload source to `.cts`, included it in compilation, and pointed
   main at `.cjs`. A regression test executes the compiled artifact using the
   sandbox's CommonJS loading pattern and checks scoped IPC exposure. Isolation,
   sandboxing, and backend architecture are preserved.

3. **Wrong development version.** Launching the main JS file directly reported
   Electron version 37.10.3. Development now launches the root package (`electron
   ../..` from `apps/desktop`), allowing Electron to read product version 2.3.0.
   Confirmed in renderer header and main-process app info.

4. **Save view throws in Electron.** Direct runtime reproduction returned
   `prompt() is not supported.` Replaced `window.prompt` with an inline optional
   graph-view name input; unnamed saves retain the suggested time-range name.
   Actual renderer save, reset, recall, and delete were exercised successfully.

5. **Zoom into a data gap hides recovery controls.** A centered wheel zoom into
   the sparse demo night's detail gap removed every graph row and Reset zoom.
   Rows now use full-day channel availability while drawing windowed series.
   Verified an empty window reports zero points and retains reset/bookmark
   controls. Reset restores the full-night view. No waveform samples or clinical
   interpretation changed.

6. **Packaging environment failures.** Direct script execution was blocked by
   the host execution policy; the documented process-scoped bypass resolved it.
   Sandboxed NSIS packaging later failed:

   ```text
   EPERM: operation not permitted, mkdir '<user-local-appdata>/electron-builder'
       at Object.mkdir (node:internal/fs/promises:1564:10)
       at downloadAndExtract (.../app-builder-lib/src/util/electronGet.ts:392:3)
       at getNsisElevatePath (.../app-builder-lib/src/toolsets/windows.ts:274:25)
   Windows packaging failed (1).
   ```

   An unrestricted retry succeeded. No app workaround or dependency replacement
   was needed. Paths identifying the Windows account are redacted here.

Added ignores for generated desktop backend/headless/release output and local
validation artifacts. Corrected the checklist's stale 2.0 installer reference.
No importer, storage schema, auth defaults, or clinical semantics were changed.

## Desktop acceptance results

PASS below means the stated automated check passed, not full human acceptance.

| Checklist | Result and evidence |
| --- | --- |
| 1 Startup/version | PASS after fixes: actual development and installed Electron renderer loaded; header v2.3.0; packaged app info reports packaged=true |
| 1 Second instance | PASS for single-instance exit: second installed launch exited 0; original session remained. Visual focus behavior NOT TESTED |
| 2 First-run demo | PASS: clean isolated user-data directories showed first-run setup; clicked Try demo data; Demo Profile and synthetic AirSense 11 created; synthetic notice displayed; latest date selected |
| 3 Daily metrics | PASS: usage 8.28 h, AHI/RDI 0.36, pressure 95% 12.3, leak 95% 4.8 |
| 3 Graph rendering | PASS: six graph rows (Events, Flow, Pressure, Leak, SpO2, Pulse), twelve canvases; six base canvases have multiple painted pixel colors |
| 3 Wheel zoom | PASS via renderer WheelEvent: 8.28 h → 6.46 h shared viewport; empty-window reset regression checked |
| 3 Cursor | PASS via renderer PointerEvent: shared cursor time 22:05:00 with Flow, Leak, Pressure, SpO2 and Pulse readouts. Physical mouse feel NOT TESTED |
| 3 Pan | NOT TESTED: native Chromium pointer automation stalled and was stopped; no passing gesture claim |
| 3 Session inclusion | PASS via actual checkbox: disabled usage 0.00 h/no graphs; re-enabled 8.28 h/six rows |
| 4 Pin/unpin | PASS via renderer buttons; pinned Flow moves first; persisted across actual development restart |
| 4 Reorder | PASS via renderer drop event: Leak moved before Pressure; same stored order after installed app restart. Physical drag gesture NOT TESTED |
| 4 Resize | PARTIAL: actual preload setGraphHeight persisted 300 px; physical resize gesture and height after actual restart NOT TESTED |
| 4 Bookmarks | PASS via renderer: named save, reset, recall, delete; zero bookmarks afterward. Saved bookmark across actual restart NOT TESTED |
| 5 Overview | PASS: 14/14 used days, 116.6 total hours, non-negative trends |
| 5 Range controls | NOT TESTED manually for all 7/30/90/all choices |
| 5 Statistics | PASS: 14 used/compliant days, 8.33 h average, AHI/RDI 1.82, pressure/leak distributions and setting periods |
| 5 CSV | PASS through real preload/IPC export handler: 1,984 bytes, expected statistics heading/date range |
| 5 PDF | PASS through real preload/IPC handler and Electron printToPDF: 86,554 bytes, `%PDF-1.4` header. Full human PDF review NOT TESTED |
| 6 Profiles/time | PASS through real preload/IPC: second profile has zero machines; London inherited; Vancouver override survives profile change to UTC; inheritance restored to UTC; original profile restored to Toronto. Full profile dialog interaction NOT TESTED |
| 7 Diagnostics | PASS through real preload/IPC: readable 2,627-byte ZIP with diagnostics.json and logs/oscar-next.log only; no database/waveforms; no synthetic profile name/serial/validation path matches |
| 8 Real card/parity | NOT TESTED; no card supplied; no physical media, import parity, or clinical-equivalence claim |

Export automation replaced `dialog.showSaveDialog` **in the running main process
only**, through the local Node inspector, to supply `.validation` destinations.
Actual backend handlers, file writes, PDF rendering, and diagnostic creation ran.
Native Save dialog interaction remains NOT TESTED. No generic IPC/renderer
capability was added. Debugging listeners were loopback-only and app processes
were stopped afterward.

## Installer results

- Final artifact: `apps/desktop/release/OSCAR-Next-2.3.0-Setup-x64.exe`,
  92,838,121 bytes; Authenticode status **NotSigned**. No credentials were
  supplied and no certificate signing was configured. Builder logs mention
  signtool steps, but that does not establish a signed artifact.
- Installed with `Start-Process ... -ArgumentList '/S',
  '/D=C:\projects\oscar\oscar-next\oscar-next\.validation\installed'
  -WindowStyle Hidden -Wait -PassThru`: **PASS**, exit code 0.
- Launched installed `OSCAR Next.exe` with
  `--user-data-dir=C:\projects\oscar\oscar-next\oscar-next\.validation\installed-user`
  and loopback `--remote-debugging-port=9333`: **PASS**. First-run/demo, packaged
  version, restart, graph order retention, and second-instance exit exercised.
- Uninstalled isolated `Uninstall OSCAR Next.exe /S`: **PASS**, exit code 0;
  application executable removed; isolated synthetic database retained.
- Normal interactive installer pages, shortcut interaction, default user-data
  location, SmartScreen behavior, and clean-machine installation remain NOT
  TESTED. This was a per-user silent installation on the development machine.

## Native service and remaining blockers

**The native Windows Service was not registered or exercised.** Installation
stopped at its Administrator check. Therefore checklist 9 service Running state,
service-hosted UI, stop/start, service uninstall/data retention, and firewall
behavior are NOT TESTED. LAN service validation was not attempted because
localhost service validation did not complete. No unattended import was enabled.

The separate foreground localhost process returned HTTP 200 for UI/docs/contract/
health without a token. Existing API tests passed token enforcement and refusal
of non-loopback binding without auth. These do not establish real Windows Service
or cross-device LAN behavior. Swagger HTML loads assets from jsDelivr; serving
`/docs` is not proof of offline Swagger functionality.

Outstanding risks/checks:

1. Administrator session required for native service lifecycle and subsequent
   Private-network LAN/firewall checks.
2. Human Windows validation still needed for pan/resize, full range/profile
   dialogs, native save dialogs, focus behavior, and PDF appearance.
3. npm audit reports Electron/extract-zip high advisories and related moderate
   dependency advisories. This stabilization task did not force major upgrades;
   a security/dependency review remains necessary before distribution.
4. npm 11 warns about unapproved Electron, esbuild, and electron-winstaller install
   scripts. Existing binaries worked, but clean-install behavior with this npm
   policy is unproven. Root/desktop lockfiles need deliberate Git adoption for
   reproducible installs.
5. Windows service coverage is primarily source-text assertions; installer native
   commands do not all check exit codes. No service behavior was changed without
   an elevated runtime reproduction. windows-check reports architecture but does
   not actually reject non-x64 hosts despite the bootstrap documentation.
6. Electron emits a development Content-Security-Policy warning. Hardening was
   not changed as part of startup stabilization.
7. No real ResMed card or Raspberry Pi validation occurred. No new vendor,
   feature, storage architecture, framework, or auth policy was introduced.

The application/demo and Windows packaging path now run on this machine; the
entire manual Windows acceptance checklist is **not complete**.

## Follow-up — Overview date-range timeline (2026-10-10)

Requested addition: show dates with therapy data in Overview and adjust the
selected date range using draggable left/right handles.

- Added the timeline to the shared React Overview screen, with daily marks and
  tooltips, a selected-range band, separate start/end handles, and keyboard
  controls (arrows: one day; Page Up/Down: seven days; Home/End: bounds).
- Marks reflect included sessions, including summary-only nights. They do not
  assert that detailed waveform/event files were imported. Days with no included
  sessions have smaller outlined marks. Disabled-only days are shown as gaps.
- Handles snap to therapy dates and cannot cross; a single-day range remains
  selectable. Date fields, presets, metrics, and charts share the same range.
  All now restores both the first and last stored therapy dates.
- Existing OscarApi.getOverview supplies the full history once per machine/span;
  selected summaries are filtered locally. Date selection is not a dependency of
  the query effect, so dragging does not issue repeated history queries. Initial
  loading may be slower for long histories; large real-card histories were not
  performance-tested. No backend/API/schema or therapy-day semantics changed.
- Baseline before this addition: `npm run verify` PASS, 79 tests and demo smoke.
- Final: `npm run verify` PASS, **81 tests** and demo smoke. Added regression
  tests cover day snapping, non-crossing bounds, outside-track dragging,
  single-day bounds, DST-independent date arithmetic, leap days, and year changes.
- `npm run desktop:build`, `npm --prefix apps/desktop run build:headless`, and
  renderer `tsc.cmd --noEmit` all PASS. `git diff --check` PASS.
- Actual Electron renderer checks with isolated synthetic data: 14 marks and
  14/14 days initially; keyboard start shift gives 13/13; right-handle midpoint
  movement gives a seven-day range; dragging left past right clamps to one day;
  All restores both endpoints; seven-day preset stays synchronized. Screenshot
  inspected for timeline layout.
- Missing-day check: temporarily disabled the synthetic 2026-10-01 session through
  preload, remounted Overview, and confirmed 13 data marks plus one outlined gap
  with tooltip `2026-10-01: No included sessions`. Restored the session afterward.
- Pointer checks used renderer PointerEvents with pointer-capture methods stubbed
  only in the test instance; physical mouse/touch capture is not independently
  validated. Screenshot/helper artifacts remain in ignored `.validation/`.
- Browser/headless renderer builds passed; this follow-up did not repeat installer
  packaging or native service validation. No real health database was modified.

### Follow-up layout adjustment — unified date controls

Moved the Overview start/end fields and 7/30/90/All presets into the therapy-history
timeline component, above its draggable track. Removed the separate Overview
filter panel. The component uses the same controlled date range and preserves
preset behavior and date limits. Statistics keeps its existing layout.

Validation: `npm test` PASS (81 tests), `npm run desktop:build` PASS,
`npm --prefix apps/desktop run build:headless` PASS, and renderer
`tsc.cmd --noEmit` PASS. No new test was added for this presentation-only move.
Electron visual validation and packaging were not repeated for this adjustment.

### Follow-up — Overview unit coverage (2026-10-10)

- Environment: Windows, Node `v24.21.0`, npm `11.19.0`. Reading the Windows
  edition/version with `Get-CimInstance Win32_OperatingSystem` returned
  `Access denied`; the edition/version was not independently verified here.
- Dependency checks: `npm install --ignore-scripts --no-audit --no-fund` and
  `npm --prefix apps/desktop install --ignore-scripts --no-audit --no-fund`
  PASS. Install lifecycle scripts were intentionally not rerun.
- Baseline `npm run verify`: PASS, 81 tests and synthetic demo smoke.
- Extracted existing range-control and summary calculations into pure functions
  used by the shared renderer, without adding dependencies. The keyboard helper
  explicitly ignores unknown keys rather than looking them up on a plain object.
- Added 39 unit tests: inclusive and clamped presets, All restoring both ends,
  keyboard steps and bounds, single-day ranges, pointer rounding, backwards and
  leap-year date arithmetic, inclusive history filtering, empty/unused days,
  usage-weighted AHI/RDI, four-hour adherence, finite nightly pressure/leak
  averages, summary-only indices, and recalculation without mutating history.
- Final `npm run verify`: PASS, 120 tests and synthetic demo smoke.
- `npm --prefix apps/desktop run build`,
  `npm --prefix apps/desktop run build:headless`, and
  `apps/desktop/node_modules/.bin/tsc.cmd --noEmit -p apps/desktop/tsconfig.json`:
  PASS. `git diff --check`: PASS.
- Focused coverage command: `node --test --experimental-test-coverage --test-coverage-include='dist/apps/desktop/src/overview-*.js' dist/tests/overview-date-range.test.js dist/tests/overview-summary.test.js`.
  PASS, 41 focused tests; both `overview-date-range.js` and
  `overview-summary.js` report 100% line, branch, and function coverage.
  Run `npm run build` first to refresh the compiled test files.
- Coverage applies to these two logic modules, not the complete Overview UI.
  React event wiring, request counts/cancellation, physical pointer capture,
  Electron visual checks, installer packaging, and service validation were not
  exercised by this follow-up.

### Follow-up — shared Overview/Statistics date filter (2026-10-10)

- Extracted Overview's widget as `TherapyDateRange` and reused it in Statistics.
  Both pages now show the same timeline, date inputs, presets, draggable handles,
  and keyboard controls. Statistics export actions occupy the widget's optional
  actions slot, and the controls wrap on narrower screens.
- Statistics loads full-machine Overview history for availability marks separately
  from its selected-range Statistics query. A report refresh does not disable
  the timeline or reload its history. History errors are displayed separately.
  Selected dates still drive the existing backend report and export APIs.
- Statistics resets its initial range when the selected machine/date changes.
  All uses the shared tested preset behavior to restore both history endpoints.
- Baseline and final `npm run verify`: PASS, 120 tests and synthetic demo smoke.
- Desktop/headless renderer builds, renderer TypeScript check, and
  `git diff --check`: PASS.
- Ad hoc React server-render checks with synthetic props: PASS for one shared
  date filter per page, two slider handles, date fields, all presets, Statistics
  export buttons, availability/gap marks, and selected-day styling. This check
  surfaced a React warning about multiple SVG title children; the shared widget
  now provides a single tooltip string.
- Physical dragging, visual layout in Electron/browser, and export interactions
  were not manually exercised in this follow-up. Existing range unit tests cover
  the reused date arithmetic, keyboard limits, and All behavior; no new unit test
  was added solely to assert component reuse.

### Follow-up — faster therapy-history timeline (2026-10-10)

- Root cause: both pages requested full Overview metrics across the machine's
  entire history to draw timeline marks. `getOverview` calls `getDaily` for each
  date, including event counting and pressure/leak waveform statistics.
- Added `getTherapyHistory` to the shared query service, scoped Electron bridge,
  and REST adapter. `GET /api/v1/machines/{machineId}/therapy-history` returns
  only date, included-session count, and usage hours. It performs two metadata
  queries across the span, then computes day usage from session bounds/slices.
  It does not read waveform/event/settings payloads or change the schema.
- Reused the existing mask-on usage calculation. Regression tests preserve
  summary-only and disabled-session handling, mask-off gaps and duration
  fallback, sessions spanning noon, exact noon end-boundary counts, custom
  rollover hours, inclusive ranges, leap days, and machine isolation.
- Both timelines use lightweight history independently of metric loading.
  Overview requests detailed metrics only for the selected range. Both pages
  debounce metric requests by 150 ms and ignore stale completions. Clearing
  date inputs skips the metric request until a valid ordered range is present.
  Selecting All still calculates detailed metrics for the entire selected span
  and can remain expensive on large histories.
- Baseline `npm run verify`: PASS, 120 tests and synthetic demo smoke.
- Final `npm run verify`: PASS, 126 tests and synthetic demo smoke. REST
  integration checks cover response shape, missing/invalid/reversed dates,
  immediate disabled-session updates, and bearer authentication. The sandboxed
  preload test covers the new scoped IPC method. A storage regression confirms
  history works with waveform/event/settings tables removed from an isolated
  synthetic database, while full Overview fails as expected.
- `npm --prefix apps/desktop run build`,
  `npm --prefix apps/desktop run build:headless`, renderer
  `tsc.cmd --noEmit -p apps/desktop/tsconfig.json`, and `git diff --check`: PASS.
- Synthetic benchmark: `node .validation/benchmark-therapy-history.mjs`, 90
  eight-hour nights with pressure/leak waveforms, three repetitions on this
  machine. Median full Overview query: **380.97 ms**; lightweight history:
  **0.55 ms**. JSON payload: **29,791 bytes** versus **4,861 bytes**. Session
  count and usage parity: PASS. The temporary synthetic database was removed;
  the benchmark helper is ignored under `.validation/`.
- Measurements cover local queries, not browser rendering or network latency.
  No real therapy database was opened or modified during this follow-up.
  Manual browser/Electron dragging and performance on real long histories
  remain unverified. Restart the headless process and reload the browser to
  use the rebuilt server and UI.
### Follow-up — Daily Canvas/WebGL performance (2026-10-12)

- Windows build 26200, Node v24.21.0, npm 11.19.0; Intel Iris Xe via ANGLE/D3D11.
- `npm run verify`: PASS, 168 tests and synthetic demo smoke (baseline 159).
- Desktop/headless renderer builds and renderer TypeScript check: PASS. Initial
  headless build failed with EPERM replacing generated assets in the sandbox;
  rebuilding outside that restriction succeeded.
- Browser REST and actual Electron IPC runtime checks: PASS for cursor bursts,
  wheel cancellation, zoom/pan, bookmarks, DPR changes and GPU-to-Canvas fallback
  on context loss, unavailable WebGL, shader and allocation failures.
- 100 pointer moves: zero waveform redraws, fourteen cursor-overlay redraws.
  Physical mouse, other GPUs and Pi remain untested. Synthetic data only.
- See [Daily chart performance validation](DAILY-CHART-PERFORMANCE-VALIDATION.md)
  for methods, measured comparisons, exact checks and limitations.

### Follow-up — local AI setup script (2026-10-14)

- Windows NT 10.0.26200.0 (`[Environment]::OSVersion.VersionString`),
  Node v24.21.0, npm 11.19.0.
- Baseline `npm install`: PASS. Baseline `npm run verify`: PASS, 188 tests
  passed, one optional real-Ollama test skipped, synthetic demo smoke PASS.
- Final `npm test` (includes TypeScript build): PASS, 191 passed, one optional
  real-Ollama test skipped. Three new PowerShell tests exercise the actual
  setup helpers with offline mocks: unsafe names are rejected before effects,
  failed installer/download commands stop setup, installed software is reused,
  and remote-backed or tool-incompatible model metadata is rejected.
- An initial test compile failed because the repository's minimal Buffer types
  do not support encoded-command construction. Tests now pass commands directly
  as `execFile` arguments. The first PowerShell test run then returned failure
  exit codes after expected caught exceptions; the test harness now explicitly
  exits zero after assertions and exits nonzero on unexpected exceptions.
- Actual `powershell -NoProfile -ExecutionPolicy Bypass -File
  .\scripts\windows-local-ai.ps1`: NOT RUN. This task created the installer;
  no Ollama installation, persistent user environment change, live process
  restart or multi-GB model download was performed in validation.
- Actual `qwen3.5:4b` inference, Expert UI compatibility checks, review quality,
  GPU acceleration, memory requirements and post-reboot startup: NOT RUN.
  The script checks installed metadata only; the application's synthetic
  compatibility probes remain required before reviews. No therapy data used.

### Follow-up — Qwen local-weight metadata rejection (2026-10-14)

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0; live Ollama 0.40.4.
- Root cause confirmed by read-only `/api/show` for installed `qwen3.5:4b`:
  no remote fields, nonempty model information, advertised tools, but license
  text contains `Copyright 2026 Alibaba Cloud`. Both the installer and provider
  previously searched the entire Modelfile for `cloud` and rejected it.
- `npm install`: PASS. Baseline `npm run verify`: PASS, 191 passed, one skipped,
  synthetic demo smoke PASS.
- Added regression fixtures containing the license text. Command:
  `npm run build`, then `node --test --test-name-pattern "license text|reuses installation"
  dist/tests/expert.test.js dist/tests/windows-local-ai.test.js`: two failures
  before the fix, two passes after. Cloud FROM declarations, explicit remote
  metadata and missing weights remain rejected. No therapy context used.
- Final `npm run verify`: PASS, 192 passed, one optional real-model test skipped,
  synthetic demo smoke PASS. `git diff --check`: PASS.
- Updated script checked against actual installed model metadata with install,
  environment, process-start and pull helpers replaced by no-op mocks: PASS.
  The live `/api/show` was used; no software reinstall, download, process restart
  or persistent environment changes were performed by this check.
- Real-model command: `$env:OSCAR_TEST_OLLAMA_MODEL = 'qwen3.5:4b'; node --test
  --test-name-pattern 'Optional real Ollama compatibility' dist/tests/expert.test.js`:
  PASS, one test, approximately 126 seconds. This checks downloaded local weights,
  actual chat, tool calling and schema-constrained JSON with synthetic prompts
  only. It does not validate therapy review accuracy or manual UI behavior.

### Follow-up — review type mismatch (2026-10-14)

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0.
- Root cause: model generation used a generic output schema permitting all three
  review types, then rejected output when it differed from the selected request.
  Generation now uses a literal request-specific type and repeats that type in
  the final instruction. Prompt version is 2; persisted/public schemas are unchanged.
  The existing mismatch, evidence and treatment-boundary checks remain active.
- `npm install`: PASS. Baseline `npm run verify`: PASS, 192 passed, one skipped,
  demo smoke PASS.
- `npm run build`, then `node --test --test-name-pattern 'constrains generated review type'
  dist/tests/expert.test.js`: regression FAIL before the fix (no literal type),
  PASS afterward across night, trend and question requests. An initial test
  compile needed an explicit undefined guard because the repository's minimal
  assertion typings do not narrow optional array entries.
- Final `npm run verify`: PASS, 193 passed, two opt-in real-model tests skipped;
  demo smoke PASS. Includes wrong-type output rejection and REST job lifecycle
  with prompt version 2. `git diff --check`: PASS.
- Added an opt-in complete synthetic night-review test using
  `OSCAR_TEST_OLLAMA_REVIEW_MODEL`, separate from the capability-only test. It
  creates and removes its own synthetic database; no real therapy data is read.
- Actual command: `$env:OSCAR_TEST_OLLAMA_REVIEW_MODEL = 'qwen3.5:4b'; node --test
  --test-name-pattern 'Optional real Ollama synthetic night review' dist/tests/expert.test.js`:
  PASS, approximately 99 seconds, context size 8192. The complete orchestrator
  returned a validated night review with existing evidence IDs and prompt version 2.
  This is synthetic integration validation, not clinical validation. Manual UI
  and actual user-data review behavior remain unverified.

### Follow-up — invalid structured review recovery (2026-10-14)

- The user clarified that the remaining message is `Invalid structured review;
  no result accepted`, not the earlier review-type mismatch. This originates in
  JSON parsing, before schema/evidence validation. The specific malformed output
  was not inspected; no real therapy prompts/responses were accessed or logged.
- Root and desktop `npm install`: PASS. Desktop reported existing dependency
  audit findings (8 moderate, 2 high); no dependency upgrades were made.
  Baseline `npm run verify`: PASS, 193 passed, two skipped, demo smoke PASS.
- Provider now recognizes empty structured content and Ollama's `done_reason:
  length`. The orchestrator regenerates empty, truncated or malformed JSON once
  with concise-output instructions, preserving the selected type, evidence,
  original deadline and tool limits. It discards invalid text, does not extract
  or repair JSON, and never retries schema/evidence/treatment-boundary failures.
  Prompt version is 3. A repeated failure distinguishes empty output, token-limit
  exhaustion and malformed JSON; type mismatch includes expected/received enums.
- Regression tests exercise recovery of all three failure categories, same
  schema/scope, absence of rejected output from retry context, exactly one retry,
  and native HTTP empty/truncation responses. `npm run verify`: PASS, 196 passed,
  two opt-in model tests skipped; demo smoke PASS. `git diff --check`: PASS.
- A repeat of the unchanged prompt-v2 synthetic real-model night review passed
  in approximately 62 seconds before these changes. This did not reproduce the
  user's malformed response; it does not establish their specific failure cause.
- Updated prompt-v3 real-model command:
  `$env:OSCAR_TEST_OLLAMA_REVIEW_MODEL = 'qwen3.5:4b'; node --test
  --test-name-pattern 'Optional real Ollama synthetic night review' dist/tests/expert.test.js`:
  PASS, approximately 51 seconds, context 8192, synthetic database only.
  The live test returned valid JSON directly; automatic recovery is validated
  by synthetic provider/HTTP fixtures, not by that successful live response.
  Manual UI and the user's actual failing review remain unverified.

### Follow-up — confirmed output-token exhaustion (2026-10-14)

- User's new error confirms Ollama ended structured generation at its token cap.
  Root cause in the integration: the generation schema permitted up to 24 long
  observations plus large prose/evidence lists, but both generation attempts
  used a 3,000-token output limit. Concise prose instructions alone did not
  constrain the schema. No failing therapy prompt or response was accessed.
- Prompt v4 uses a concise generation schema: at most two positive findings and
  two items to review, explanations at most 350 characters, summary at most 600,
  two short clinician questions, three short limitations and eight evidence IDs.
  Runtime validation enforces the same bounds. Public/persisted schemas remain
  unchanged. Structured generation is bounded to 4,096 tokens; tool-selection
  generation retains 3,000. The original scope/deadline, one regeneration and
  evidence/treatment checks remain enforced; truncated output is never accepted.
- `npm install`: PASS. Baseline `npm run verify`: PASS, 196 passed, two skipped,
  demo smoke PASS. Regression command `npm run build`, then `node --test
  --test-name-pattern 'constrains generated review type|reserves a larger'
  dist/tests/expert.test.js`: two FAIL before (12 items vs 2; 3,000 vs 4,096 tokens),
  PASS after. Additional coverage rejects oversized output without regeneration.
- Final `npm run verify`: PASS, 198 passed, two opt-in tests skipped, demo smoke
  PASS. `git diff --check`: PASS. A prompt-v4 real `qwen3.5:4b` synthetic night
  review using the compact schema/output budget passed in approximately 56 seconds.
  No real health data used. An experimental READY-phase instruction then caused
  the real model to request an invalid waveform window (longer than one hour).
  The guard correctly rejected it. That instruction was removed; no range/tool
  validation was relaxed. The fix retains the original tool-selection prompt.
- Final recovery command: `$env:OSCAR_TEST_OLLAMA_REVIEW_MODEL = 'qwen3.5:4b';
  $env:OSCAR_TEST_OLLAMA_FORCE_RETRY = '1'; node --test --test-name-pattern
  'Optional real Ollama synthetic night review' dist/tests/expert.test.js`:
  PASS, approximately 49 seconds, context 8192. The test injects a synthetic
  token-limit failure at the first structured attempt, then asks the actual model
  to regenerate. The resulting compact JSON passes all validation. This verifies
  the recovery path with a real model, not naturally occurring token exhaustion.
  User's original failing review and manual UI remain unverified.

### Follow-up — actual September 9 context-window exhaustion (2026-10-14)

- Root and architecture/provider/orchestrator docs and tests reviewed.
  `npm install`: PASS. Baseline `npm run verify`: PASS, 198 passed, two skipped,
  synthetic demo smoke PASS. Windows NT 10.0.26200.0, Node v24.21.0,
  npm 11.19.0, configured local `qwen3.5:4b`.
- User identified the failing night as 2026-09-09. Read-only local reproduction
  used the active profile's existing database through ExpertTools and the
  user's enabled loopback Ollama configuration. No database/settings/media
  writes, therapy payload files, raw prompt/response logs or identifiers.
  The ignored local helper emits only token counts, content lengths, completion
  reasons and JSON validity. Saved context was **4096**, not the tested 8192.
- Actual structured response: prompt 3,406 tokens, output 690 tokens,
  `done_reason: length`, malformed JSON. Total equals 4,096. Retry: prompt 3,477,
  output 619, total again 4,096. Neither reached the 4,096 output-token budget.
  This confirms the root cause is context exhaustion; the previous error label
  conflated two distinct limits.
- Same existing night and model, with a process-only context override of 8192:
  PASS. Structured prompt 5,549 tokens, output 935, `done_reason: stop`, complete
  JSON validated by the orchestrator. About 53 seconds. The user's saved setting
  was not overwritten; they must select 8192 in the UI, save, then test compatibility.
- Provider now identifies confirmed full-context completion from native prompt
  and generated token counts, and gives a context-setting error. Orchestrator
  avoids an ineffective regeneration in the same full context. Missing counters
  retain conservative generic handling. Public schemas/prompt v4 unchanged.
- Regression command `npm run build`, then `node --test --test-name-pattern
  'distinguishes a full context' dist/tests/expert.test.js`: FAIL before,
  PASS after. Includes separation from genuine output-token exhaustion and
  no-retry coverage for full context. Final `npm run verify`: PASS, 200 passed,
  two opt-in tests skipped; demo smoke PASS.
- Validation establishes local generation/JSON/schema/evidence compatibility,
  not clinical accuracy. Manual UI confirmation of the setting change is pending.

### Groq provider — 2026-10-17

- Windows NT 10.0.26200.0; Node v24.21.0; npm 11.19.0. Existing dependencies
  reused; no new dependencies. Baseline `npm run verify`: PASS, 228 passed,
  two optional skips; synthetic demo smoke PASS.
- Final `npm run verify`: PASS, 240 passed, two optional Ollama skips, demo
  smoke PASS. Twelve synthetic/mocked Groq tests cover tool and date guards,
  streaming, secrets, cancellation, history isolation and authenticated REST.
- `npx tsc -p apps/desktop/tsconfig.json --noEmit`: PASS.
  `npm --prefix apps/desktop run build`: PASS.
  `npm --prefix apps/desktop run build:headless`: PASS.
  Both builds emit advisory Zod comment-annotation and >500 kB chunk warnings.
- `node scripts/update-ai-openapi.mjs`: PASS. Groq shares the Expert UI,
  preload/REST boundary and read-only scoped tools; it needs no public MCP tunnel.
- PENDING: Live Groq key/model/account settings, inference and rate limits,
  manual UI interaction, actual OS-encrypted credential persistence after restart,
  installer and Raspberry Pi acceptance. No live Groq call or real therapy
  upload was made. See `OSCAR-AI-VALIDATION.md` and `GROQ.md`.

### AI backend folder organization — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0. Provider adapters moved
  into separate folders; shared configuration, tool guards and MCP transport
  grouped by responsibility. Runtime behavior and persisted formats unchanged.
- Baseline and final `npm run verify`: PASS, 240 passed, two optional Ollama
  skips; demo smoke PASS. Existing dependencies reused.
- `npx tsc -p apps/desktop/tsconfig.json --noEmit`: PASS.
  `npm --prefix apps/desktop run build`: PASS.
  `npm --prefix apps/desktop run build:headless`: PASS. Existing Zod annotation
  and >500 kB chunk advisories remain.
- OpenAPI generator runs from its new settings import; generated contract
  unchanged. `git diff --check`: PASS. No live-provider/manual UI checks added.

### Settings tabs and centralized AI settings — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0; existing session
  dependencies reused. All provider forms moved out of Expert into Settings →
  AI. Categories: General, Therapy & graphs, AI, Connection. Expert links to AI.
- Baseline and post-change `npm run verify`: PASS, 240 passed, two optional
  Ollama skips; demo smoke PASS. After final Groq message updates, `npm run build`
  and `node --test dist/tests/groq.test.js`: PASS, 12 tests.
- `npx tsc -p apps/desktop/tsconfig.json --noEmit`: PASS.
  `npm --prefix apps/desktop run build`: PASS.
  `npm --prefix apps/desktop run build:headless`: PASS. Existing Zod annotation
  and >500 kB chunk advisories remain. `git diff --check`: PASS.
- One-off esbuild/React server-render checks: PASS for tab/category markup and
  provider forms appearing only in Settings → AI. PENDING: actual Electron and
  browser navigation/layout, keyboard focus and preservation of draft values
  across tabs. No live AI calls or real health-data exports were made.

### Provider selector and selected settings only — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0. Provider choice moved
  to Settings → AI. Only its matching form mounts; Expert displays the active
  choice. Client preference is saved locally, with Local Ollama as the fallback.
- Existing session dependencies reused. Baseline/final `npm run verify`: PASS,
  240 passed, two optional skips; demo smoke PASS. Renderer TypeScript check,
  desktop and headless builds: PASS with existing annotation/chunk warnings.
- One-off esbuild/React render checks: PASS for Settings-only selector, selected
  form only, correct Expert label, stored preference and storage failures.
  `git diff --check`: PASS. PENDING: actual UI navigation/reload on Electron and
  browser. No live-provider requests or real therapy exports.

### Local Ollama settings appearance — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0; existing dependencies
  reused. Replaced the outer Local Ollama accordion with the same card heading,
  spacing, stacked controls and primary Save action used by the cloud providers.
  Diagnostics retains its own disclosure. No API/settings behavior changed.
- Baseline `npm run verify`: PASS, 240 passed, two optional skips, smoke PASS.
  Post-change renderer TypeScript, desktop and headless builds: PASS. Existing
  Zod annotation/chunk warnings remain. `git diff --check`: PASS.
- One-off React/esbuild desktop/browser render checks: PASS for visible card
  heading/actions, no outer accordion and retained diagnostics. Actual visual
  acceptance remains pending; no live provider or real therapy data was used.

### Groq save/test and unavailable-model recovery — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0. User's actual error was
  an unavailable model during the upstream probe. Added model discovery and a
  selection list, explicit save/key status, failed-save retry preservation and
  saving current form values before Refresh/Test. No plaintext secret storage.
- Existing dependencies reused. Baseline `npm run verify`: PASS, 240 passed,
  two optional skips; smoke PASS. New discovery tests fail before implementation.
  Final `npm run verify`: PASS, 242 passed, two optional skips; smoke PASS.
  Groq/preload tests: 15 PASS. Renderer TypeScript and desktop/headless builds:
  PASS; existing annotation/chunk advisories remain. OpenAPI generation and
  `git diff --check`: PASS.
- One-off mocked hook/action checks: PASS for failed/successful saves,
  save-before-test, discovery and model replacement. A hidden Electron synthetic
  storage probe produced no usable result; no Windows OS-storage PASS is claimed.
  PENDING: live account/model access, actual keychain persistence and interactive
  desktop/browser acceptance. No real key was read/logged or paid inference run.
  Desktop restart is required for the additional IPC/preload model-list method.

### Expert Markdown formatting — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0. Cloud assistant text
  now renders Markdown/GFM with themed headings, lists and scrollable tables.
  Raw HTML, unsafe links and external image loads are blocked. User text and
  structured local review cards keep their existing presentation.
- Baseline/final `npm run verify`: PASS, 242 passed, two optional skips, smoke
  PASS. `npm --prefix apps/desktop run test:markdown`: three PASS (failed before
  implementation). Renderer TypeScript, desktop/headless builds and
  `git diff --check`: PASS. Existing Zod/chunk-size warnings remain.
- Added react-markdown 10.1.0 and remark-gfm 4.0.1. Initial install failed with
  EPERM against the global npm cache; `npm --prefix apps/desktop install
  react-markdown remark-gfm --cache ./.cache/npm`: PASS. Desktop audit remains
  8 moderate/2 high findings, as previously recorded. Workspace cache ignored.
- PENDING: visual desktop/browser checks, both themes and narrow-screen table
  scrolling. All test text is synthetic; no real therapy payload was committed
  and no live AI or external image requests were made.

### Automatically enable the selected AI provider — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0; existing dependencies
  reused. Selected Settings forms enable their provider automatically, with
  saved configuration/credentials preserved. Removed the three provider enable
  checkboxes. Backend defaults, compatibility and explicit tunnel setup remain.
- Baseline/final `npm run verify`: PASS, 242 passed, two optional skips, smoke
  PASS. `npm --prefix apps/desktop run test:ui`: six PASS, including three new
  activation regressions that failed before implementation. Renderer TypeScript,
  desktop/headless builds and `git diff --check`: PASS. Existing annotation and
  chunk-size advisories remain. Test WebSockets disabled after an observed port
  conflict; final UI tests pass without that warning.
- PENDING: interactive desktop/browser provider selection. Synthetic/mocked
  settings only; no live provider request, real health-data export or schema
  change was performed.

### Groq 90-day trend failure diagnostics — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0; existing dependencies
  reused. User reported a 90-day trend failure. Root integration defect: HTTP
  413/422 and other statuses were labeled "service unavailable" without their
  code. Actual original upstream status remains unknown; no live inference run.
- Added distinct sanitized HTTP messages. Synthetic regression preserves a
  full 90-day scope and rejects partial-history reuse after a later-round 503.
  Both new regressions fail before and pass after the fix.
- Baseline `npm run verify`: PASS, 242 passed/two skipped, smoke PASS. Final:
  PASS, 244 passed/two skipped, smoke PASS. All 16 Groq tests and
  `git diff --check`: PASS. Renderer/API schema unchanged. PENDING: user's real
  model/account/range retry with the new status message. No real therapy upload
  or credential access was performed.

### Expert conversation alignment — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0; existing dependencies
  reused. User questions now sit in right-aligned themed bubbles. Expert answers
  remain left-aligned with full available width for Markdown tables and local
  review/evidence cards. Long text wraps; small screens use wider question
  bubbles. DOM conversation order and streaming logic are unchanged.
- Baseline `npm run verify`: PASS, 244 passed, two optional skips, smoke PASS.
  Post-change `npm --prefix apps/desktop run test:ui`: six PASS. Renderer
  TypeScript and desktop/headless builds: PASS. Existing Zod annotation/chunk
  advisories remain. `git diff --check`: PASS.
- PENDING: interactive visual acceptance in desktop/browser, both themes and
  narrow layouts. No live AI requests or therapy payloads were used.

### Fixed Expert panels and keyboard composer — 2026-10-17

- Windows NT 10.0.26200.0, Node v24.21.0, npm 11.19.0; existing dependencies
  reused. Criteria/provider summary remain at the top, the conversation scrolls
  independently, and message input/conversation actions remain at the bottom.
  Enter sends, Shift+Enter inserts a newline, IME/repeated keypresses are guarded.
- Baseline/post-composer `npm run verify`: PASS, 244 passed/two optional skips,
  smoke PASS. `npm --prefix apps/desktop run test:ui`: ten PASS. Renderer
  TypeScript and final desktop/headless builds: PASS. Existing Zod/chunk-size
  advisories remain. `git diff --check`: PASS.
- `node .validation/expert-layout-check.mjs`: PASS for synthetic Chrome fixtures
  at requested 1440×900 Daily/Compare dark, 800×700 Daily light, 390×844 Compare
  dark. Effective content heights: 748/548/692 px. Conversation scrolls without
  moving criteria/composer; composer remains visible. Browser checks found and
  verified fixes for inherited cross-axis alignment and narrow conversation space.
- Initial Chrome probe failed with sandbox/GPU access restrictions. Offline
  synthetic fixtures succeeded with test-only no-sandbox flags; no Electron
  renderer security settings were changed. Preview screenshot inspected.
  PENDING: manual running-app interaction. No paid AI calls or real therapy data.
