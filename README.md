# OSCAR Next — TypeScript migration

> **Codex handoff:** coding agents should read [`AGENTS.md`](AGENTS.md), [`CODEX_HANDOFF.md`](CODEX_HANDOFF.md), and [`CODEX_FIRST_TASK.md`](CODEX_FIRST_TASK.md) before making changes.

This repository is an incremental TypeScript migration of the `operativeF/oscar` CPAP analysis codebase. The migration preserves OSCAR data semantics first, then replaces the Qt desktop/UI layer later.

## Milestone 2.3 — Windows + Raspberry Pi desktop/headless deployment

2.3 adds native Windows Headless as a third deployment task while retaining the two Raspberry Pi tasks and one shared backend/React UI:

### Task A — Raspberry Pi ARM64 desktop

- Electron + React desktop application on 64-bit Raspberry Pi OS
- ARM64 `.deb` and AppImage targets
- existing removable-media detection, import workflow, SQLite storage, Daily/Overview/Statistics and graph interactions
- `./scripts/pi-desktop-package.sh` performs the Pi build/test/package flow

See [TASK-A-RASPBERRY-PI-DESKTOP.md](TASK-A-RASPBERRY-PI-DESKTOP.md).

### Task B — headless web service

- no Electron process at runtime
- Node.js service hosts the same React Daily/Overview/Statistics UI in a browser
- browser UI uses a REST adapter implementing the same `OscarApi` interface as Electron preload
- REST/OpenAPI/Swagger remain available from the same service
- bearer-token login for LAN use
- server-local SD-card/folder imports when `--allow-imports` is enabled
- optional Linux mounted-media watcher with `--watch-media`
- browser downloads for CSV and diagnostic bundles; printable HTML uses browser Print / Save as PDF
- native per-user systemd installer and an ARM64-compatible Docker deployment

See [TASK-B-HEADLESS.md](TASK-B-HEADLESS.md).

### Task C — Windows headless service

- native Windows Service (`OscarNextHeadless`) with automatic startup
- same React browser UI, REST/OpenAPI/Swagger and SQLite backend
- localhost-only mode by default; token-protected LAN mode
- Windows drive-letter SD-card detection
- optional unattended card import
- start/stop/status/uninstall PowerShell helpers

See [TASK-C-WINDOWS-HEADLESS.md](TASK-C-WINDOWS-HEADLESS.md).

Quick headless build/run:

```bash
npm install
npm --prefix apps/desktop install --ignore-scripts
npm run headless:build
export OSCAR_API_TOKEN='replace-with-a-strong-random-token'
node dist/src/headless/main.js --database ./data/oscar-next.sqlite --host 0.0.0.0 --port 3210 --allow-imports --watch-media --web-root ./apps/desktop/headless-dist
```

Then open `http://<raspberry-pi>:3210/`; Swagger remains at `/docs`.

## Milestone 2.1 — OpenAPI / Swagger interface

2.1 adds a local-first REST interface over the same OSCAR Next services used by Electron:

- OpenAPI 3.1 contract at `openapi/oscar-next.openapi.json` and `/openapi.json`
- Swagger UI at `/docs`
- Daily, Overview, Statistics, chart, profile, machine-time, session, graph-layout and bookmark endpoints
- optional CPAP import preview/import endpoints
- typed waveform arrays converted to normal JSON arrays for REST clients
- localhost-only binding by default
- non-loopback binding requires a bearer token
- filesystem imports require the explicit `--allow-imports` flag
- API integration/regression tests use the same SQLite/query classes as the desktop application

Start it with:

```powershell
npm run api -- --database .\oscar.sqlite
```

Then open `http://127.0.0.1:3210/docs`. See [OPENAPI.md](OPENAPI.md) for details.

## Milestone 2.0 — Windows-testable release

2.0 turns the existing backend/UI work into a repeatable Windows acceptance build. In addition to all prior ResMed, SQLite, Daily/Overview/Statistics, import, graph-layout and profile/timezone work, it adds:

- one-command PowerShell development/bootstrap and installer-build scripts
- cross-platform Node cleanup (no Unix-only `rm -rf` in npm scripts)
- an automated 14-night synthetic AirSense 11-style demo-card generator
- a first-run **Try demo data** path that uses the real ResMed importer and SQLite persistence
- a backend smoke workflow covering profile creation, import, Daily, Overview, Statistics, chart queries and diagnostic ZIP creation
- single-instance Electron locking to reduce concurrent SQLite access risk
- installed application version displayed in the desktop header
- Windows acceptance checklist and updated build/run documentation

The synthetic demo data contains no real patient information and is intended only for functional testing.


## Deployment modes in 2.3

OSCAR Next now supports four first-class deployment modes from the same backend and React UI:

| Mode | Runtime | UI | Best for |
|---|---|---|---|
| Windows Desktop | Electron + Node | Native desktop window | normal PC use |
| Windows Headless | Native Windows Service + Node | browser | always-on PC/server, phone/tablet access |
| Raspberry Pi Desktop | Electron ARM64 + Node | native Pi desktop window | dedicated Pi appliance with monitor |
| Raspberry Pi Headless | systemd/Docker + Node | browser | dedicated always-on appliance |

### Windows Headless quick start

Run **Administrator PowerShell**:

```powershell
.\scripts\windows-headless-install.ps1
```

Then open `http://localhost:3210/`. LAN access is enabled explicitly with `-Lan`, which requires/generates a bearer token. Automatic card detection is supported; fully unattended import is opt-in with `-AutoImportMedia $true`. See `TASK-C-WINDOWS-HEADLESS.md`.

## ResMed compatibility foundation

Implemented:

- Core OSCAR-style types (`MachineType`, `MachineInfo`, channel/session identifiers)
- Deterministic machine IDs derived from stable device identity (brand/model/serial)
- Stable OSCAR Next CPAP channel IDs and setting IDs
- `EventList` with event delta timing, gain semantics, waveform timing, min/max tracking, and typed-array snapshots
- `Session`, `Machine`, and `Day` models, including AHI/RDI aggregation
- `MachineLoader` interface and importer registry
- ResMed SD-card/root detection
- ResMed identity parsing for serial/model/model-number metadata from both legacy `Identification.tgt` and nested AirSense/AirCurve 11 `Identification.json` (JSON preferred when both exist)
- Recursive ResMed DATALOG discovery and EDF file classification (`STR`, `CSL`, `EVE`, `BRP`, `PLD`, `SAD`, `SA2`, `AEV`)
- Generic EDF/EDF+ parser:
  - fixed header and per-signal metadata
  - EDF+ 1985 two-digit-year rule
  - signed 16-bit little-endian samples
  - per-signal sample rates
  - digital-to-physical gain/offset conversion
  - EDF+ TAL annotations, onset times, durations, and record timekeeping
  - unknown (`-1`) record-count inference
  - header-only parsing
  - gzip-compressed `.edf.gz` support
- ResMed STR parser:
  - ResMed noon-to-noon therapy-day handling
  - authoritative Mask On / Mask Off session windows
  - multiple mask sessions per therapy day
  - multiple daily STR records
  - CPAP/APAP/Bilevel/ASV/iVAPS mode mapping
  - AirSense/AirCurve 11 raw mode remapping before legacy OSCAR mode classification (including AutoSet for Her, VAuto, ASV and ASVAuto)
  - fixed pressure and APAP min/max pressure settings
  - EPAP/IPAP and pressure-support settings used by bilevel/ASV/iVAPS devices, including derived IPAP limits when only EPAP + PS bounds are stored
  - additional VAuto/ASV/iVAPS, response, Easy-Breathe, rise-time, trigger/cycle and Ti min/max setting aliases
  - EPR mode and EPR level, including AirSense `S.EPR.*` fields
  - ramp enable/time/start pressure
  - SmartStart, mask, climate, humidifier, temperature, tube, filter and patient-access settings when present
  - summary-only sessions when STR has a therapy window but detailed EDF data is absent
  - STR summary AHI/AI/HI/OAI/CAI/UAI/CSR and leak-summary fields captured without polluting therapy-setting history
  - STR-only nights contribute weighted AHI/RDI and OA/CA/H/UA event indices to Daily, Overview and Statistics even when detailed EVE files are absent
- ResMed detailed-session mapper:
  - detailed EDFs are attached to the best-overlapping STR session without changing authoritative STR bounds
  - fallback session creation from BRP/PLD/SAD/SA2 when STR mask windows are unavailable
  - BRP flow, high-rate mask pressure, and respiratory-event waveforms, including newer `TrigCycEvt.40ms` aliases
  - PLD therapy pressure, IPAP, EPAP, mask pressure, leak, respiratory rate, tidal volume, minute ventilation, snore, flow limitation, I:E, Ti/Te, and target ventilation
  - SAD/SA2 pulse and SpO2 data with `-1` missing-sample filtering and newer localized aliases (for example `Nabiz`)
  - EVE mapping for obstructive apnea, hypopnea, unclassified apnea, RERA/arousal, and central/clear-airway apnea
  - CSL mapping for Cheyne-Stokes/CSR spans
  - AEV files are recognized and structurally parsed for diagnostics, but no unsupported clinical semantics are invented
  - EVE/CSL annotations are assigned by timestamp after sessions are created, matching OSCAR's day-wide annotation behavior
  - OSCAR-compatible ResMed unit normalization: flow/leak L/s -> L/min and tidal volume L -> mL
- SQLite persistence using Node 22's built-in `node:sqlite`:
  - machines and machine properties
  - sessions and mask-on/off slices
  - strongly typed session settings (`boolean`, `number`, `string`, `Date`, `null`)
  - event lists and waveform series
  - one-minute waveform chunks in a dedicated indexed table, so a zoomed query reads only overlapping chunks
  - compact `Int16Array` waveform/event samples stored as BLOBs
  - automatic schema-v1 -> current-schema migration that converts legacy monolithic waveform BLOBs into chunks
  - legacy waveform BLOBs are cleared after migration to avoid duplicating high-rate data
  - `Uint32Array` event timestamp deltas stored as BLOBs
  - second event fields where used
  - per-machine session identity (session IDs may repeat across different machines)
  - transactional complete-snapshot updates, preventing duplicate sessions on re-import
  - schema version tracking (current schema v5) and WAL mode
- Read-only Daily/Overview query API on top of SQLite:
  - explicit noon-to-noon therapy-day ranges
  - Daily session list and usage hours
  - OA/CA/H/UA/RERA counts, AHI and RDI
  - pressure/leak min/max/average/95th-percentile statistics
  - typed session settings for the UI
  - available-channel discovery
  - contiguous Overview date ranges, including no-data days
  - chart-series retrieval for selected channels only
  - optional absolute chart `startMs`/`endMs` window bounds and a per-series point budget
  - exact event transfer; event flags are never decimated
  - exact waveform samples for small windows and min/max-preserving adaptive decimation for dense windows
  - chart metadata reports original source-point count and whether the returned series was decimated
  - `Float64Array` timestamps and `Float32Array` values ready for Electron/React charting
- First Electron/React desktop shell:
  - hardened Electron boundary with `contextIsolation: true`, `nodeIntegration: false`, and sandboxing
  - preload API instead of direct React filesystem/SQLite access
  - database file picker and machine selection
  - read-only Daily screen
  - usage, AHI/RDI, event counts, pressure/leak 95th-percentile cards
  - session table
  - Canvas-based Flow Rate, Pressure, Leak, SpO₂, Pulse, and Event Flags graphs
  - one shared time viewport across all graphs
  - mouse-wheel zoom around the pointer, drag-to-pan, and double-click/reset zoom
  - synchronized cursor across every graph without redrawing the underlying high-rate waveforms
  - per-pixel min/max downsampling for dense full-night waveforms
  - full-night graph loads request a bounded adaptive series instead of transferring every 25 Hz sample
  - zoom/pan triggers a debounced backend query for only the visible time window at higher resolution
  - coarse full-night data remains on screen while higher-resolution detail is loading
  - graph toolbar reports exact/adaptive point counts for the current data resolution
  - one Event Flags lane per OA/H/CA/UA/RERA/CSR event type, even across split sessions
  - CSR span rendering from stored durations
  - working Overview navigation and selectable 7/30/90-day or full-history ranges
  - Overview therapy-history timeline with per-day availability marks and draggable start/end handles; arrow keys step by a day and Page Up/Down by a week
  - start/end date fields and range presets are integrated into the timeline widget and stay synchronized with summaries and trends; All restores both ends of the machine history
  - Overview summary cards for days used, average/total usage, aggregate AHI/RDI, ≥4-hour adherence, average pressure 95%, and average leak 95%
  - Overview usage bars with a 4-hour reference line
  - AHI/RDI trend chart with a 5-events/hour reference line
  - stacked OA/CA/H/UA/RERA event-index bars normalized per therapy hour
  - nightly average/95th-percentile pressure and leak trend charts
  - database open defaults to the latest stored therapy night instead of the computer's current date
  - complete Statistics screen with 7/30/90-day/full-history range selection
  - Overview and Statistics share the therapy-history date filter, including availability marks, draggable handles, keyboard controls, date fields, and presets; All restores both history endpoints
  - timeline marks load through a lightweight session/usage query without waveform or event reads; detailed Overview metrics load only for the selected range, and both pages wait 150 ms after range changes before requesting metrics
  - range-level used days, ≥4-hour adherence, total/average/median usage, AHI and RDI
  - aggregate OA/CA/H/UA/RERA counts and event indices per therapy hour
  - pressure/leak average, median, 95th-percentile and maximum statistics across the selected range
  - consecutive therapy-setting history periods, including mode, pressure range, EPR, ramp, humidifier/climate and other stored settings
  - CSV export generated from the same backend Statistics object shown in the UI
  - printable HTML statistics report generation
  - Electron/Chromium PDF export through a sandboxed hidden report window; React never receives filesystem access
  - Daily graph cursor analysis: nearest real waveform sample markers and exact value readouts for Flow/Pressure/Leak/SpO₂/Pulse
  - hover tooltips rendered on the lightweight cursor overlay without redrawing underlying high-rate waveform canvases
  - Event Flags hover lookup with event label/time/duration details near the shared cursor
  - zoomed-window statistics that update continuously with pan/zoom: therapy hours, AHI/RDI, OA/CA/H/UA/RERA counts, pressure/leak 95th percentile, SpO₂ minimum and Flow range
  - zoomed AHI/RDI use actual visible therapy-session overlap, excluding wall-clock gaps between split sessions
  - desktop Import Data workflow with SD-card/backup-folder picker
  - import preflight showing detected loader, ResMed model/serial, and EDF family counts before any data is written
  - first import can create a new SQLite database directly from the import dialog
  - live EDF-file progress updates are sent through the hardened Electron preload boundary
  - successful imports refresh the machine list, select the imported device, and jump Daily to the latest stored therapy night
  - import completion summary distinguishes newly added sessions, refreshed sessions, and total stored sessions
  - import warnings are retained and displayed in an expandable completion section
  - re-imports merge card data with historical stored sessions so older nights no longer present on the SD card are preserved
  - automatic removable-volume discovery while the desktop app is running
  - Windows drive-letter monitoring via PowerShell/CIM, including card readers that report media as fixed disks
  - macOS `/Volumes` monitoring and Linux mounted-block-device discovery
  - newly inserted volumes are read-only probed through the existing importer registry before the UI is notified
  - existing supported media can be surfaced on app startup; unsupported drives are ignored after the signature probe
  - automatic prompt reuses the normal import preflight and shows device/model/serial plus EDF family counts
  - removing and reinserting the same card allows it to be detected again
  - pending detections are retained across renderer-startup timing so a card is not missed if it is found before React subscribes
  - Daily session inclusion controls persisted in SQLite; disabled sessions are excluded from usage, AHI/RDI, Overview, Statistics, and chart queries
  - session enable/disable state survives app restarts and re-importing the same SD-card sessions
  - per-machine graph layout preferences persisted in SQLite
  - star controls on Event Flags, Flow, Pressure, Leak, SpO₂, and Pulse rows move pinned graphs to the top while preserving the shared viewport/cursor behavior
  - graph pin state survives app restarts and remains independent for each stored CPAP machine
  - drag handles reorder graph rows within the pinned or unpinned group, with order persisted per machine
  - bottom resize grips adjust graph heights from 100–520 px and persist the chosen height per machine
  - named zoom bookmarks save a visible time range for the current therapy date and can be recalled or deleted from the graph toolbar
  - saved graph views are scoped by machine and therapy date so bookmarks from one night never bleed into another
  - first-run setup creates an application profile and default SQLite database in Electron user data storage
  - multiple profiles can be created and switched from the desktop header; machine lists are filtered to the active profile
  - each profile stores an IANA home timezone (for example `America/Toronto`)
  - imported machines inherit the active profile timezone by default
  - individual CPAP machines can override the profile timezone when the device clock was set for a different location
  - profile timezone edits automatically flow to machines that still inherit the profile setting, while manual device overrides remain unchanged
  - Daily labels session timestamps explicitly as CPAP device wall-clock time and never reinterprets them through the host computer timezone
  - deterministic device-wall-clock conversion helpers resolve IANA timezones and explicitly report DST fall-back ambiguity or spring-forward nonexistent local times
  - existing schema-v4 databases migrate into a default profile without changing stored therapy timestamps
- CLI commands:
  - `inspect <path>` — identify ResMed media and inventory EDF files
  - `import <path>` — parse ResMed sessions and print event/therapy summaries
  - `store <path> <database>` — import a card/copy and persist it to SQLite
  - `demo-card <output-folder>` — generate a synthetic 14-night AirSense-style card
  - `demo-smoke [work-folder]` — run the 2.0 profile/import/query/chart/diagnostics acceptance workflow
  - `db-list <database>` — list stored machines, profiles, device timezones, and session date ranges
  - `profile-list <database>` — list profiles and the active profile
  - `profile-create <database> <name> <IANA-timezone>` — create and activate a profile
  - `machine-timezone <database> <machine-id> <IANA-timezone|profile>` — set a device timezone override or restore profile inheritance
  - `db-daily <database> <machine-id> <YYYY-MM-DD>` — query a therapy day
  - `db-overview <database> <machine-id> <start-date> <end-date>` — query Overview data
  - `db-statistics <database> <machine-id> <start-date> <end-date>` — query aggregate range statistics
  - `report-csv <database> <machine-id> <start-date> <end-date> <output.csv>` — export Statistics as CSV
  - `report-html <database> <machine-id> <start-date> <end-date> <output.html>` — export a printable HTML report
  - `edf-info <file>` — inspect any EDF/EDF+ file header and signals
- 75 passing built-in tests, including OpenAPI/REST/Swagger integration and the 2.0 demo-card/end-to-end smoke workflow, modern ResMed identification and mode mapping, STR-only summary fallback, profile/timezone isolation, DST edge cases, removable-media detection, import merging, persistent session/graph preferences, SQLite migrations, Daily/Overview/Statistics/reporting, adaptive chart queries, viewport analysis, diagnostics, and ZIP/privacy checks

## Current limitations / next migration slice

Daily, Overview, Statistics, reporting, import, graph customization, profiles/timezones, and the first ResMed compatibility-hardening pass are implemented. The next priorities are:

1. Run the new optional golden-fixture harness against an anonymized real ResMed SD-card copy and compare the same nights with OSCAR.
2. Extend STR summary fallback to additional pressure/respiratory percentiles after real-card labels are captured.
3. Validate AirSense 10/11, AirCurve VAuto/ASV and iVAPS settings against real cards rather than synthetic fixtures alone.
4. Add an optional user preference to disable automatic removable-media prompts or restrict detection to explicitly removable volumes.
5. Add profile export/backup and optional machine reassignment between profiles.
6. Once ResMed parity is verified, begin the Philips/PRS1 importer behind the same MachineLoader contract.

Philips/PRS1 remains a later importer milestone.

## Build and test

Requires Node.js 22+. TypeScript 5.8 is included as a development dependency, so a global TypeScript install is not required.

```bash
npm run build
npm test
```

Expected current result:

```text
# tests 75
# pass 75
# fail 0
```

`node:sqlite` is still marked experimental by Node 22, so Node may print an ExperimentalWarning. The storage interface is intentionally isolated so the SQLite driver can be swapped later without changing the core/import model.


## Optional real ResMed golden fixture

A real-card regression hook is included but does not require personal data to be committed to the repository. Copy/anonymize a ResMed card into a local folder, then run:

```bash
OSCAR_RESMED_FIXTURE=/path/to/anonymized/card npm test
```

On Windows PowerShell:

```powershell
$env:OSCAR_RESMED_FIXTURE = "E:\\copied-card"
npm test
```

The fixture test verifies media detection, product identity, structural import, and sane session bounds. Keep real card data outside Git; once available, expected per-night values can be added as a separate anonymized manifest for OSCAR-vs-OSCAR-Next golden comparisons.

## Desktop UI

The desktop shell lives in `apps/desktop`, while Electron main/preload code lives in `src/desktop` so it can call the tested backend directly.

Install the desktop-only packages once:

```bash
npm run desktop:install
```

Build the backend/Electron process and the React renderer:

```bash
npm run desktop:build
```

Then launch Electron:

```bash
npm run desktop:run
```

For renderer development, run Vite from `apps/desktop` and set `OSCAR_RENDERER_URL` to the Vite URL before launching Electron. The current execution environment used to build this milestone could not complete package-registry installation, so Electron/Vite could not be launched here. The renderer source was statically checked with TypeScript using local React declaration stubs; the root backend/Electron entry points compile and all backend tests pass.

## First run, profiles, and device time

On first launch, the desktop app asks for a profile name and an IANA timezone such as `America/Toronto`. Confirming setup creates the default application database under Electron's user-data directory. You can instead choose **Open existing database** to continue from an earlier OSCAR Next database.

### Access desktop profiles and data from a web browser (Windows)

The Windows desktop app's default database is:

```text
%APPDATA%\oscar-next\oscar-next.sqlite
```

This normally expands to `C:\Users\<username>\AppData\Roaming\oscar-next\oscar-next.sqlite`.
If you opened a different database in the desktop app, use that file's path instead.

Desktop and web mode use different databases by default. Running
`npm run headless -- --allow-imports` uses `.\data\oscar-next.sqlite` relative to
the project folder. Profiles and therapy data live in the database, so a profile
created in the desktop app will appear in web mode only when both open the same
database.

To use the default desktop database, stop any running headless server with
**Ctrl+C**, then run this from the project folder in PowerShell:

```powershell
npm run headless -- --allow-imports --database "$env:APPDATA\oscar-next\oscar-next.sqlite"
```

Open or refresh [http://localhost:3210/](http://localhost:3210/) in your browser.
Keep the terminal running; **Ctrl+C** stops the server. `--allow-imports` enables
server-local CPAP imports and demo data. The server binds to localhost by default;
access from another device requires LAN binding and a bearer token as described
in [TASK-B-HEADLESS.md](TASK-B-HEADLESS.md).

Use **Profiles & time** to:

- rename the active profile or change its home timezone
- create and switch to another profile
- inspect the timezone attached to the selected CPAP machine
- let the machine inherit the profile timezone or apply a manual device-timezone override

ResMed EDF data contains local device clock fields but no timezone. OSCAR Next therefore stores source timestamps as **floating device wall-clock values**. Attaching a timezone does not rewrite the stored session times. A separate conversion layer can resolve those wall-clock fields to real UTC instants when required; DST overlaps return both possible instants and DST gaps are reported as nonexistent instead of silently shifted.

## Import from the desktop UI

Click **Import data** in the Electron app and choose the root of a CPAP SD card or a copied backup folder. OSCAR Next first performs a read-only preflight and shows the detected device plus EDF inventory. Confirming the import parses the data with live progress and stores it in the currently open database. If no database is open, the app asks where to create one.

After a successful import, the app refreshes the machine list and opens Daily on the latest stored therapy night. Re-importing is incremental: nights still on the card refresh matching stored sessions, new nights are added, and older history absent from the card is preserved.

### Daily session controls and custom graph layouts

Each Daily session has an **Included** switch. Turning a session off updates the stored session state and removes that session from Daily usage/AHI/RDI, Overview/Statistics aggregation, and detailed chart queries. The choice is persistent and is preserved if the same session is later refreshed from the SD card.

Each graph row has a star control. Starred rows are pinned above unpinned rows for that machine. Use the **⋮⋮** handle to drag rows into a preferred order within their pinned/unpinned group, and drag the bottom grip to resize a graph. Order, pin state, and height are stored per machine.

When you zoom into an interesting portion of a night, choose **Save view** to name the current time range. Saved views are stored for that machine and therapy date, appear as quick-access chips above the graphs, and can be recalled or deleted later.

### Automatic card detection

While the desktop app is open, OSCAR Next polls mounted volumes for newly inserted media. A supported ResMed card opens the same read-only preflight dialog automatically with an **Import this card** action. The watcher does not parse EDF files until you confirm the import. Remove and reinsert the card to make it eligible for a new prompt.

Windows uses logical-drive discovery, macOS watches `/Volumes`, and Linux enumerates mounted block devices (with `/proc/mounts` as a fallback). The watcher logic is covered by automated tests; physical hot-plug behavior still needs validation on real Windows/macOS/Linux hardware.

## Inspect a ResMed SD card or copied card

```bash
npm run cli -- inspect /path/to/sd-card
```

Windows example:

```powershell
npm run cli -- inspect E:\
```

## Import sessions without saving

```bash
npm run cli -- import /path/to/sd-card
```

The command prints each imported mask-on session, duration, AHI, OA/CA/H/UA/RERA event counts, therapy mode, pressure settings, EPR/ramp state, and channel count. STR-only sessions are marked `summary-only`.

## Import and store in SQLite

```bash
npm run cli -- store /path/to/sd-card ./oscar.sqlite
```

Windows example:

```powershell
npm run cli -- store E:\ .\oscar.sqlite
```

Re-importing the same machine merges the newly read card snapshot with existing history: matching session IDs are refreshed, new sessions are added, and older stored sessions that are no longer on the card are retained.

List what is stored:

```bash
npm run cli -- db-list ./oscar.sqlite
```

Query one OSCAR/ResMed therapy day (noon-to-noon):

```bash
npm run cli -- db-daily ./oscar.sqlite 123456789 2026-10-09
```

Query an Overview range:

```bash
npm run cli -- db-overview ./oscar.sqlite 123456789 2026-10-01 2026-10-09
```

Query a Statistics range:

```bash
npm run cli -- db-statistics ./oscar.sqlite 123456789 2026-10-01 2026-10-09
```

Export the same Statistics data as CSV or printable HTML:

```bash
npm run cli -- report-csv ./oscar.sqlite 123456789 2026-10-01 2026-10-09 ./statistics.csv
npm run cli -- report-html ./oscar.sqlite 123456789 2026-10-01 2026-10-09 ./statistics.html
```

The desktop Statistics tab adds a PDF export action. PDF rendering uses Electron's Chromium `printToPDF()` path so the backend does not need a second PDF-layout implementation.

Example shape:

```text
Database: .../oscar.sqlite
Schema:   4
Machines: 1

123456789  ResMed AirSense 11 AutoSet
  Serial:   ***********
  Sessions: 31
  First:    2026-09-09 22:14:00Z
  Last:     2026-10-10 06:48:00Z
```

## Inspect an EDF file

```bash
npm run cli -- edf-info /path/to/file.edf
```

Compressed backups are also supported:

```bash
npm run cli -- edf-info /path/to/file.edf.gz
```

## Timestamp policy

EDF files do not encode a timezone. OSCAR Next stores the ResMed fields as deterministic floating device wall-clock timestamps and separately attaches an IANA timezone through the profile/machine time model. Changing the host computer timezone does not rewrite historical therapy timestamps; DST overlaps/gaps are explicitly resolved by the device-time conversion layer when a real UTC instant is required.

## Storage model

The current schema is deliberately normalized for metadata but compact for high-volume samples:

```text
machines
  └── sessions
       ├── session_settings
       ├── session_slices
       └── event_lists
            ├── raw Int16 BLOB
            ├── optional second-field Int16 BLOB
            └── optional event-delta Uint32 BLOB
```

A session's public OSCAR-style ID is unique within its machine. SQLite uses an internal `row_id` for foreign keys so different machines can safely contain the same session ID.

## Design rules

1. Preserve OSCAR data semantics before refactoring algorithms.
2. Keep import/device code out of the UI.
3. Use typed arrays for high-volume waveform boundaries.
4. Keep device importers independently testable.
5. Compare TypeScript results against known OSCAR outputs using golden-data tests.
6. Treat EDF as a generic transport layer; keep ResMed-specific signal/channel mapping outside the EDF parser.
7. Do not use EVE files as session-boundary sources; assign their annotations to already-established sessions by timestamp.
8. Prefer STR Mask On/Off as the ResMed session grouping authority when present.
9. Keep persistence behind a small storage API so the driver/schema can evolve independently of importers and UI.
10. Treat a CPAP therapy day as noon-to-noon by default; do not group overnight sessions by midnight.

## License

This migration is derived from OSCAR/SleepyHead concepts and code structure and is licensed GPL-3.0-only. See `LICENSE`.

## Windows 2.0 quick start

On Windows 10/11 x64 with Node.js 22+:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-dev.ps1
```

This installs dependencies, runs all 69 tests, runs the full demo smoke workflow, builds the React renderer, and launches Electron. On first run choose **Try demo data** to populate a synthetic 14-night AirSense 11 history through the normal importer.

To build the installer instead:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-package.ps1
```

See `BUILDING-WINDOWS.md` and `WINDOWS-ACCEPTANCE-CHECKLIST.md`.

## Windows packaging and diagnostics

2.0 retains the 1.9 installer/diagnostic work and adds automated Windows bootstrap and smoke verification:

- x64 NSIS installer configuration through `electron-builder`.
- Product/version metadata and a Windows application icon.
- Start Menu and optional Desktop shortcuts.
- Reproducible `npm run desktop:package:win` packaging command.
- Structured JSONL application logging with size-based rotation.
- Privacy-safe **Diagnostics** action in the desktop header.
- Diagnostic ZIP contains app/runtime/OS/schema information plus current/previous logs.
- Diagnostic ZIP does **not** include the SQLite database, therapy waveforms/events, profile names, machine serial numbers, or import/database paths.
- Sensitive path-shaped values are redacted from structured logs.

See [`BUILDING-WINDOWS.md`](BUILDING-WINDOWS.md) for Windows build and installer instructions.

### Windows installer

On a Windows 10/11 x64 development machine with Node.js 22+:

```powershell
npm --prefix apps/desktop install
npm run desktop:package:win
```

Expected output:

```text
apps\desktop\release\OSCAR-Next-2.3.0-Setup-x64.exe
```

The 2.0 test installer is intentionally unsigned. Windows may show an **Unknown publisher** warning until an Authenticode certificate is configured for release distribution.

## Shared analytics workstation UI

Desktop and browser modes use the same React 19 application, with a collapsible
sidebar, compact Daily workspace, historical Overview charts, Statistics tables,
and administration pages. Appearance defaults to dark; choose Light, Dark, or
System in **Settings**. The preference is stored locally in this client.

Daily retains the custom Canvas waveform/event renderer, synchronized cursor,
shared zoom/pan, adaptive queries, pin/order/resize controls, and saved graph
views. **Night Inspector** provides Summary, chronological Events, temporary
Notes, and persisted Bookmarks. Selecting an event opens a two-minute analysis
window. Notes are explicitly unsaved drafts, cleared when leaving the night.
Viewport statistics can be expanded below the graph toolbar. On smaller displays
the sidebar becomes compact and the inspector becomes a dismissible drawer.

Overview and Statistics share the same **therapy-history timeline**: draggable
and keyboard-accessible date handles, custom date inputs, 7/30/90-day, 6-month
(180-day), 1-year (365-day), and All History presets. It retains the lightweight
history query; changing the selected range does not reload the full timeline.
Statistics exports continue using the existing desktop PDF/CSV and browser
printable-report/download workflows. Missing backend statistics display `—`.

The presentation stack uses Tailwind CSS 4 (`@tailwindcss/vite` in both builds),
Lucide React, and vendored **Tremor Raw** Card, Badge, ProgressBar, BarChart, and
LineChart components. Tremor Raw supports the existing React version; the older
`@tremor/react` npm package is not required. Recharts renders only historical
analytics, and is loaded with Overview on demand. Dense Daily signals remain
Canvas. Supporting dependencies are `clsx`, `tailwind-merge`, `tailwind-variants`,
and Radix Slot. See `apps/desktop/src/components/tremor/NOTICE.md` and its Apache
license, also included in built assets under `licenses/tremor-LICENSE.txt`.
The application remains GPL-3.0-only.

UI components use the existing `OscarApi` boundary: Electron preload on desktop,
REST in a browser. They never access SQLite or the filesystem directly. The API
page shows the connected browser origin and documentation links; the desktop
client does not manage or assume a running HTTP service. Import permissions,
loopback/auth defaults, timezone rules, and diagnostic redaction remain intact.

```powershell
npm install
npm --prefix apps/desktop install
npm run verify
npm run desktop:build
npm run desktop:run
# Browser UI; choose an explicit database path as documented above:
npm run headless -- --database .\data\oscar-next.sqlite --allow-imports
```

See [UI-REFRESH-PLAN.md](UI-REFRESH-PLAN.md) for implementation decisions and
[UI-VALIDATION.md](UI-VALIDATION.md) for results and remaining device validation.

### Always-visible history controls

On Overview and Statistics, the shared therapy-history filter is integrated into
the sticky top bar. Custom date fields, presets, the complete timeline and its
handles stay visible as charts/tables scroll. Statistics export buttons remain
with the date selection. The compact header wraps its controls at laptop widths.
