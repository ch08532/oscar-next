# AGENTS.md — OSCAR Next repository instructions

These instructions apply to the entire repository unless a deeper `AGENTS.md` overrides them.

## Before editing

1. Read `CODEX_HANDOFF.md`.
2. Read the relevant architecture/deployment docs for the task.
3. Inspect existing tests before changing semantics.
4. Run a baseline when the environment permits:

```bash
npm install
npm run verify
```

For desktop work also install:

```bash
npm --prefix apps/desktop install
```

Do not report a baseline as passing if dependencies/platform constraints prevented it from running.

## Engineering principles

### Preserve domain semantics before refactoring

This project is a compatibility-focused migration of OSCAR. Correct interpretation of CPAP data matters more than code elegance.

When changing importer/core logic:

- keep noon-to-noon therapy-day behavior;
- preserve STR session boundaries where available;
- do not derive session boundaries from EVE;
- preserve wall-clock timestamps and timezone metadata separately;
- preserve source-card read-only behavior;
- do not invent unknown clinical semantics;
- add targeted regression tests.

### Health-data safety

Treat imported therapy data as sensitive health information.

Never:

- include real therapy databases or source-card copies in commits;
- commit serial numbers/profile names from real devices;
- add therapy payloads to diagnostic bundles by default;
- log raw filesystem/card paths when a redacted alternative is sufficient;
- write to source CPAP media.

### Renderer boundary

Keep Electron renderer/browser UI isolated from backend capabilities.

Electron:

```text
React -> preload API -> main/backend
```

Headless:

```text
React -> REST adapter -> API/backend
```

Do not enable `nodeIntegration` in the renderer or expose generic filesystem/SQLite primitives through preload.

### One UI, two adapters

Desktop and headless should reuse the same React screens and concepts. Do not create separate divergent UI implementations if the existing `OscarApi`/adapter boundary can support the feature.

### API security

- Loopback-only is the default.
- LAN/non-loopback requires bearer auth.
- Imports require explicit permission/flags.
- Automatic removable-media import remains opt-in.

Do not weaken these defaults without an explicit product decision and tests.

## Testing requirements

At minimum for behavior changes:

```bash
npm run build
npm test
```

For broad/release work:

```bash
npm run verify
```

For UI changes, also build the renderer when dependencies/platform allow:

```bash
npm --prefix apps/desktop run build
```

For API/OpenAPI changes:

- update `openapi/oscar-next.openapi.json`;
- keep `OPENAPI.md` accurate;
- add/update API integration tests.

For schema/storage changes:

- increment schema version intentionally;
- add migration logic;
- add migration and round-trip tests;
- preserve user state such as disabled sessions and graph preferences.

## Windows work

Use `WINDOWS-ACCEPTANCE-CHECKLIST.md` for real-machine validation.

Prefer recording actual results in `WINDOWS-VALIDATION.md` with:

- Windows version;
- Node/npm versions;
- exact command;
- PASS/FAIL per checklist item;
- error output/stack traces;
- fixes applied;
- remaining blockers.

Do not silently skip failures to make the checklist look green.

## Raspberry Pi work

Target 64-bit ARM64 Raspberry Pi OS. Test desktop and headless separately. Mounted-media detection is not the same as physical-device detection; on Pi OS Lite an automount policy may be required.

## Code style

- TypeScript, ESM.
- Keep dependencies modest; prefer platform/Node capabilities where they are adequate.
- Avoid broad rewrites during validation/debug tasks.
- Use explicit types at subsystem boundaries.
- Keep typed arrays for waveform/event paths where already used.
- Avoid converting dense waveforms into per-sample database rows or large ordinary JS arrays internally.
- Keep comments focused on non-obvious semantics and compatibility decisions.

## Git/change hygiene

- Make small logical commits when Git is available.
- Separate dependency/build fixes from domain behavior fixes.
- Do not commit generated `dist`, installer outputs, databases, real SD-card content, diagnostic ZIPs, or dependency directories.
- If changing public behavior, update relevant docs in the same change.

## What not to do without explicit direction

- Do not add Philips Respironics or another vendor before ResMed validation is credible.
- Do not replace SQLite/storage architecture wholesale.
- Do not switch UI frameworks merely for aesthetics.
- Do not replace custom chart behavior with a new chart library unless performance/behavior parity is demonstrated.
- Do not alter GPL licensing.
- Do not expose the API to the LAN unauthenticated.
- Do not claim the application is clinically validated or equivalent to OSCAR based only on synthetic tests.

## Definition of done for a bug fix

A fix is complete when:

1. root cause is identified;
2. smallest reasonable code change is made;
3. a regression test fails before/fixes after when feasible;
4. existing relevant tests pass;
5. docs are updated if behavior/setup changed;
6. unresolved validation limitations are stated plainly.
