# Codex First Task — Real Windows 11 validation of OSCAR Next 2.3.0

## Objective

Validate OSCAR Next 2.3.0 on a real Windows 11 development machine and fix only the concrete issues required to get the existing demo workflow running reliably.

This is a **validation/stabilization task**, not an architecture redesign.

## Read first

Before changing code, read:

1. `AGENTS.md`
2. `CODEX_HANDOFF.md`
3. `README.md`
4. `BUILDING-WINDOWS.md`
5. `WINDOWS-ACCEPTANCE-CHECKLIST.md`
6. `TASK-C-WINDOWS-HEADLESS.md`
7. root `package.json`
8. `apps/desktop/package.json`

Then inspect the relevant tests and Windows scripts.

## Phase 1 — Repository assessment (no code changes yet)

Report:

1. your understanding of the architecture;
2. actual Node/npm/Git/Windows environment versions;
3. whether package-lock files are present and whether dependency installation is reproducible;
4. suspicious build/runtime assumptions you notice;
5. expected commands you will run;
6. the smallest validation plan.

Do not redesign the architecture during this phase.

## Phase 2 — Baseline build/test

Run from repository root:

```powershell
node --version
npm --version
git status --short
npm install
npm --prefix apps/desktop install
npm run verify
npm run desktop:build
```

Record exact failures.

If installation/build fails, diagnose and fix the smallest concrete issue. Keep dependency/toolchain fixes separate from application/domain changes.

Expected historical baseline from the handoff is **77 tests passing**, but trust the repository/tests you actually run over this note.

## Phase 3 — Launch Electron with demo data

Use the documented Windows dev flow:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-dev.ps1
```

If that script is broken, fix it minimally and document why.

Validate:

- Electron opens without a fatal dialog.
- Header reports version 2.3.0.
- First-run setup appears for a clean app/database state.
- **Try demo data** creates/loads the synthetic AirSense 11 demo.
- Daily opens on the latest therapy night.
- Flow/Pressure/Leak/Event/SpO2/Pulse graphs render.
- Wheel zoom, pan, and synchronized cursor work.
- Overview displays the synthetic history.
- Statistics loads and produces plausible non-negative metrics.
- CSV export works.
- PDF export works.
- Diagnostics creates a valid privacy-safe ZIP.

Do not compare visual styling to a concept mockup; validate the actual React implementation.

## Phase 4 — Persistence/interactions

Exercise:

- disable then re-enable a session;
- pin/unpin a graph;
- reorder graph rows;
- resize a graph;
- save/recall/delete a zoom bookmark;
- restart the app and confirm persisted preferences survive;
- create a second profile and switch profiles;
- change profile timezone and test machine override/inheritance.

## Phase 5 — Windows installer

Build:

```powershell
.\scripts\windows-package.ps1
```

Validate the produced NSIS installer on Windows if feasible:

- install;
- launch;
- demo data;
- restart;
- uninstall;
- confirm user data behavior matches docs.

Do not code-sign unless credentials are explicitly provided.

## Phase 6 — Windows Headless service

From Administrator PowerShell, validate default localhost mode first:

```powershell
.\scripts\windows-headless-install.ps1
.\scripts\windows-headless-status.ps1
```

Validate:

- `OscarNextHeadless` is Running;
- `http://localhost:3210/` loads the browser UI;
- `http://localhost:3210/docs` loads Swagger;
- localhost default works without a token as documented;
- stop/start scripts work;
- uninstall preserves data unless purge was explicitly requested.

Only after localhost mode works, validate LAN mode on a trusted Private network:

- bearer token is required;
- generated/configured token works;
- unauthenticated request is rejected;
- firewall rule is limited to Private profile;
- API is not accidentally exposed without auth.

Do **not** enable unattended media import during the first service validation.

## Phase 7 — Produce validation record

Create `WINDOWS-VALIDATION.md` containing:

- date;
- machine/Windows version;
- Node/npm versions;
- commands run;
- test counts;
- build results;
- checklist PASS/FAIL results;
- exact failures encountered;
- fixes made;
- remaining blockers;
- whether Electron runtime was actually launched;
- whether installer was actually installed;
- whether native Windows Service was actually registered and exercised.

Be explicit about anything not tested.

## Scope constraints

During this first task:

- Do not add new device vendors.
- Do not redesign the importer/domain model.
- Do not replace SQLite.
- Do not change the React framework/toolchain unless a concrete incompatibility requires a targeted fix.
- Do not weaken API auth/security defaults.
- Do not change ResMed clinical/data interpretation unless a reproducible test exposes a bug.
- Do not claim real-card compatibility; no real CPAP data is required for this task.

## Completion criteria

The task is complete when:

1. `npm run verify` passes on the Windows machine, or remaining failures are clearly documented with root cause;
2. the Electron demo workflow has been actually launched and exercised;
3. Windows build/package path has been exercised as far as the environment allows;
4. Windows Headless localhost service has been actually registered and exercised if Administrator access is available;
5. `WINDOWS-VALIDATION.md` accurately records results;
6. fixes are covered by tests where practical;
7. repository remains within the architecture/safety rules in `AGENTS.md`.

## Suggested commit structure

If changes are needed, prefer commits like:

```text
build(windows): fix clean install bootstrap
fix(desktop): correct Electron startup path on Windows
fix(headless): make native service lifecycle reliable
test(windows): cover discovered service/config regression
docs: record Windows 11 validation results
```

Do not squash unrelated behavior changes into one large commit unless explicitly requested.
