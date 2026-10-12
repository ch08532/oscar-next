# OSCAR Next 2.3.0 — Codex Handoff

## Purpose

OSCAR Next is an incremental TypeScript migration/rewrite of the OSCAR CPAP analysis application. The project currently focuses on preserving OSCAR/ResMed data semantics while replacing the legacy Qt UI with a modern React/Electron UI and adding REST/headless deployment modes.

This handoff is intended for Codex or another coding agent taking over active development. Read this file, `AGENTS.md`, `README.md`, `OPENAPI.md`, and the relevant task/deployment guide before changing code.

## Current release

- Product version: **2.3.0**
- License: **GPL-3.0-only**
- Node requirement: **Node.js 22+**
- Root language: **TypeScript / ESM**
- Storage: **Node 22 built-in `node:sqlite`**
- UI: **React 19 + Vite + Electron**
- API: **local-first Node HTTP REST API + OpenAPI 3.1 + Swagger UI**

## What this repository is trying to achieve

Primary product goals:

1. Read CPAP SD-card data without modifying the source media.
2. Preserve OSCAR-compatible interpretation of ResMed therapy sessions, signals, settings, and events.
3. Provide Daily, Overview, Statistics, reports, and detailed waveform analysis.
4. Support the same React UI in both Electron desktop and browser/headless modes.
5. Support Windows and Raspberry Pi deployments.
6. Keep health-related data local by default and avoid leaking identifying/therapy information in diagnostics.

## Supported deployment modes

The same backend and React UI support four first-class modes:

1. **Windows Desktop** — Electron + Node.
2. **Windows Headless** — native Windows Service + browser UI.
3. **Raspberry Pi Desktop** — Electron ARM64 + Node.
4. **Raspberry Pi Headless** — Node service under systemd or Docker + browser UI.

See:

- `BUILDING-WINDOWS.md`
- `TASK-A-RASPBERRY-PI-DESKTOP.md`
- `TASK-B-HEADLESS.md`
- `TASK-C-WINDOWS-HEADLESS.md`
- `WINDOWS-ACCEPTANCE-CHECKLIST.md`

## Architecture

```text
ResMed SD card / copied card folder
              |
              v
      ResMed detector / importer
              |
              v
        EDF / EDF+ parser
              |
              v
       Core OSCAR-style model
   Machine / Session / Day / EventList
              |
              v
             SQLite
              |
      +-------+--------+
      |                |
      v                v
 query/report layer   import/profile/services
      |
      +-----------------------------+
      |                             |
      v                             v
 Electron preload/IPC          REST/OpenAPI
      |                             |
      +--------------+--------------+
                     v
                  React UI
```

## Important source locations

### Core model

- `src/core/machine.ts`
- `src/core/session.ts`
- `src/core/day.ts`
- `src/core/event-list.ts`
- `src/core/channel.ts`
- `src/core/cpap-channels.ts`
- `src/core/cpap-settings.ts`
- `src/core/device-time.ts`
- `src/core/identity.ts`

### EDF and ResMed import

- `src/importers/edf/edf-parser.ts`
- `src/importers/edf/edf-types.ts`
- `src/importers/import-service.ts`
- `src/importers/resmed/resmed-detector.ts`
- `src/importers/resmed/resmed-identification.ts`
- `src/importers/resmed/resmed-loader.ts`
- `src/importers/resmed/resmed-session-mapper.ts`
- `src/importers/resmed/resmed-signals.ts`
- `src/importers/resmed/resmed-str.ts`

### Persistence and queries

- `src/storage/database.ts`
- `src/storage/queries.ts`
- current SQLite schema version: **v7** (nullable graph visibility; existing layouts preserved)
- Daily respiratory graphs and raw-sample analysis: `DAILY-RESPIRATORY-GRAPHS-PLAN.md` and `DAILY-RESPIRATORY-GRAPHS-VALIDATION.md`
- Daily frame scheduling, drawing caches and WebGL/Canvas fallback: `DAILY-CHART-PERFORMANCE-PLAN.md` and `DAILY-CHART-PERFORMANCE-VALIDATION.md`
- SQLite index/query review and synthetic benchmark: `SQLITE-PERFORMANCE-REVIEW.md`

### Reports / diagnostics

- `src/reports/statistics-report.ts`
- `src/desktop/logger.ts`
- `src/desktop/diagnostics.ts`
- `src/desktop/zip.ts`

### Desktop application

Electron backend:

- `src/desktop/main.ts`
- `src/desktop/preload.cts` (sandbox-compatible CommonJS output)
- `src/desktop/removable-media.ts`

React/Vite:

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/Charts.tsx`
- `apps/desktop/src/Overview.tsx`
- `apps/desktop/src/Statistics.tsx`
- `apps/desktop/src/ImportDialog.tsx`
- `apps/desktop/src/ProfileDialog.tsx`
- `apps/desktop/src/chart-analysis.ts`
- `apps/desktop/src/styles.css`

### Headless/browser mode

- `src/headless/main.ts`
- `src/api/server.ts`
- `src/api/main.ts`
- `apps/desktop/src/rest-adapter.ts`
- `apps/desktop/src/headless-main.tsx`
- `apps/desktop/vite.headless.config.ts`

### API contract

- `openapi/oscar-next.openapi.json`
- `OPENAPI.md`

## Key product/data semantics — do not casually change

These rules are regression requirements, not implementation suggestions.

### Source media safety

- Treat CPAP SD-card content as **read-only**.
- Never write, rename, delete, normalize, or repair files on the source card.
- Imports may copy/read source data but must not mutate it.

### Therapy day

- ResMed therapy days use **noon-to-noon**, not calendar midnight.
- A 02:00 session belongs to the prior evening's therapy date.

### Session boundaries

- Where available, STR `Mask On` / `Mask Off` timing is authoritative.
- `EVE` files may cover more than one mask session; **do not use EVE to define session boundaries**.
- Detailed BRP/PLD/SAD/SA2 data should attach to the best overlapping established session without shrinking authoritative STR bounds.

### Re-import behavior

- Re-importing a card must **merge/refresh** known sessions without deleting older history that is no longer present on the card.
- A user's disabled/enabled session choice must survive re-import.

### Time handling

- ResMed EDF timestamps are device wall-clock values; timezone is metadata.
- Do not silently rewrite historical device timestamps when profile/computer timezone changes.
- Ambiguous/nonexistent DST wall-clock times should be represented explicitly rather than silently guessed.

### Waveforms and events

- High-rate waveform data is stored as compact typed-array BLOB chunks.
- Current waveform chunk size is approximately one minute.
- Windowed queries should read only overlapping chunks.
- Dense waveform decimation must preserve min/max excursions so narrow clinically relevant spikes are not erased.
- Event flags are exact and **must not be decimated**.

### Summary-only nights

- STR-only nights may have summary AHI/event-index information without detailed EVE event counts.
- UI/reporting must not misrepresent summary indices as exact detailed event counts.

### Diagnostics/privacy

Default diagnostic bundles must not include:

- the SQLite therapy database
- waveform/event records
- source SD-card paths
- profile names
- device serial numbers

Logs should redact identifying filesystem paths and obvious sensitive metadata where practical.

### Renderer security

Electron React code must not get unrestricted Node/filesystem/SQLite access.

Current intended boundary:

```text
React -> preload API -> Electron main/backend
```

Headless browser mode uses:

```text
React -> REST adapter -> HTTP API -> backend
```

Do not introduce direct renderer filesystem/database access for convenience.

## Current ResMed scope

Implemented or partially implemented:

- `Identification.tgt`
- newer/nested `Identification.json`
- `STR`
- `BRP`
- `PLD`
- `EVE`
- `CSL`
- `SAD`
- `SA2`
- `AEV` structural recognition only where semantics are not established
- AirSense/AirCurve 11 mode normalization
- CPAP / APAP / AutoSet for Her
- VAuto / bilevel
- ASV / ASVAuto
- iVAPS/AVAPS-related settings where known
- EPR/ramp/climate/humidifier/tube/mask settings where present
- summary-only STR nights

**Do not invent clinical semantics for unknown AEV or vendor fields.** Preserve/diagnose unknown data until meaning is supported by reliable evidence.

## UI status

The current UI source implements or scaffolds:

- first-run/demo setup
- profiles/timezone management
- Daily screen
- synchronized Flow/Pressure/Leak/SpO2/Pulse/Event graphs
- zoom/pan/shared cursor/tooltips
- visible-window statistics
- adaptive/windowed waveform fetching
- session enable/disable
- graph pinning/order/height
- saved zoom bookmarks
- Overview trends
- Statistics
- CSV/PDF/report paths
- Import Data workflow
- automatic removable-media detection
- Diagnostics
- headless/browser REST adapter

Important caveat: much of the React/Electron work has been statically type-checked and exercised via backend/demo tests, but **the project still needs thorough real Windows runtime/UI validation**.

The 2026-10-10 Windows validation exercised Electron demo startup and an unsigned
NSIS install/restart/uninstall. See `WINDOWS-VALIDATION.md` for exact results,
remaining manual UI checks, dependency risks, and the Administrator blocker for
native service validation.

## API / security model

The API is local-first.

Default:

- host: `127.0.0.1`
- port: `3210`
- Swagger: `/docs`
- OpenAPI JSON: `/openapi.json`

Rules:

- Non-loopback/LAN binding requires bearer-token authentication.
- Filesystem import endpoints require explicit import enablement.
- Windows/Pi headless auto-import is opt-in.

Do not weaken these defaults casually.

## Current tests

The last packaged milestone reported **77 passing tests**.

Important test files include:

- `tests/edf-parser.test.ts`
- `tests/resmed-str.test.ts`
- `tests/resmed-session-mapper.test.ts`
- `tests/resmed-compatibility.test.ts`
- `tests/resmed-real-fixture.test.ts`
- `tests/storage-database.test.ts`
- `tests/storage-queries.test.ts`
- `tests/chart-analysis.test.ts`
- `tests/import-service.test.ts`
- `tests/api-server.test.ts`
- `tests/windows-headless.test.ts`
- `tests/demo-workflow.test.ts`
- `tests/diagnostics.test.ts`

A real anonymized ResMed fixture can be supplied through the optional fixture path documented by the test suite/README. Avoid committing real health data or identifiers.

## Canonical commands

From repository root:

```bash
npm install
npm run build
npm test
npm run demo:smoke
npm run verify
```

Desktop dependencies:

```bash
npm --prefix apps/desktop install
```

Windows development:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-dev.ps1
```

Windows installer:

```powershell
.\scripts\windows-package.ps1
```

API:

```bash
npm run api -- --database ./oscar.sqlite
```

Headless:

```bash
npm run headless:build
node dist/src/headless/main.js --database ./data/oscar-next.sqlite --host 127.0.0.1 --port 3210 --web-root ./apps/desktop/headless-dist
```

Windows headless service:

```powershell
.\scripts\windows-headless-install.ps1
.\scripts\windows-headless-status.ps1
.\scripts\windows-headless-stop.ps1
.\scripts\windows-headless-start.ps1
.\scripts\windows-headless-uninstall.ps1
```

Raspberry Pi packaging/install:

```bash
./scripts/pi-desktop-package.sh
./scripts/pi-headless-install.sh
```

## Known limitations / validation gaps

These are important. Do not infer completion from the version number alone.

1. **Real ResMed card validation is limited.** Most parser/importer regression coverage uses synthetic fixtures.
2. **Windows Electron runtime/UI needs real-machine validation.** Static/type/backend validation is stronger than actual GUI runtime validation so far.
3. **Windows Service deployment needs real Windows validation.** The wrapper/scripts are implemented and tested statically/regression-wise, but service registration and removable-card behavior need hands-on verification.
4. **Raspberry Pi ARM64 packages need real Pi validation.** Packaging targets/scripts exist, but actual Pi performance and removable-media behavior still need testing.
5. **AEV semantics are intentionally incomplete** where vendor meaning is not established.
6. **Only ResMed is the serious importer target so far.** Do not start Philips Respironics support before ResMed correctness is validated unless explicitly directed.
7. Swagger UI may depend on external frontend assets depending on the current server implementation; verify offline behavior before claiming completely offline docs.

## Recommended next phase

Priority order:

1. Run the repository on a real Windows 11 machine.
2. Run `npm run verify` before changing behavior.
3. Build and launch Electron.
4. Exercise **Try demo data** end-to-end.
5. Complete `WINDOWS-ACCEPTANCE-CHECKLIST.md` and capture failures in a new `WINDOWS-VALIDATION.md`.
6. Build the Windows installer and test clean install/uninstall.
7. Install/test Windows Headless service: local mode first, then LAN token mode.
8. Verify removable SD-card detection without auto-import; then separately verify opt-in unattended import.
9. Obtain an anonymized real ResMed card copy and compare several nights against upstream OSCAR.
10. Only after ResMed parity is credible, consider additional device families.

## How to compare against upstream OSCAR

For each representative night compare at minimum:

- machine identification
- therapy date
- Mask On / Mask Off windows
- session count and boundaries
- usage duration
- therapy mode/settings
- AHI / RDI
- OA / CA / H / UA / RERA
- pressure average/95th/max
- leak average/95th/max
- Flow waveform timing/sample rate/scaling
- Pulse and SpO2 timing/scaling where present
- CSR spans

Do not optimize or refactor parser logic while unexplained parity differences remain.

## Change-management expectations

- Prefer small, reviewable commits.
- Keep behavior changes separate from formatting/refactors.
- Add or update regression tests for every parser/storage/query bug fixed.
- Do not delete existing compatibility aliases simply because they look redundant.
- Preserve backwards SQLite migration behavior unless a deliberate migration is added and tested.
- Document real-world validation results, including failures.
- Never claim clinical equivalence based solely on synthetic fixtures.

## First Codex task

Read `CODEX_FIRST_TASK.md` and execute it only after reading this file and `AGENTS.md`.
