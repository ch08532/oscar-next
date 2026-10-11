# OSCAR Next 2.3.0 Windows validation — 2026-10-10

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
