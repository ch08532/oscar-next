# UI refresh validation

Validation date: 2026-10-10. Windows x64, Node 24.21.0, npm 11.19.0.
The restricted environment denied the Windows OS-version query; no Windows
edition/build is claimed. All runtime validation used fresh isolated profiles
and synthetic ResMed demo databases under ignored `.validation/`. No real
therapy data, device serials, source cards, or user databases were inspected.

## Baseline and automated checks

Before broad changes, wrote UI-REFRESH-PLAN.md and inspected the shared renderer,
OscarApi, adapters, architecture/deployment instructions, and existing tests.
Dependency installation used `--ignore-scripts --no-audit --no-fund`; the existing
Electron binary was available. Restricted registry access required the normal
approved dependency-install escalation.

| Check | Before | After |
| --- | --- | --- |
| `npm run build` | PASS | PASS |
| `npm test` | PASS, 126 tests | PASS, 133 tests |
| `npm run demo:smoke` | PASS | PASS |
| `npm run desktop:build` | PASS | PASS |
| `npm run headless:build` | Not recorded separately | PASS |
| Renderer `tsc --noEmit -p apps/desktop/tsconfig.json` | PASS | PASS |

New tests cover inclusive/clamped 180/365-day presets, theme defaults and OS
preference resolution, chronological exact-event ordering across sessions,
wall-clock time formatting across midnight, and leaving dense waveform buffers
untouched. Existing importer, queries, API, security, exports, diagnostics,
storage, waveform-analysis, session, preference, and bookmark tests pass.

## Runtime / visual checks

Launched the production desktop application with a separate user-data directory
and loaded its 14-night synthetic demo through the existing import flow. Also
started a loopback headless service against a new synthetic database on port
3217, then opened it in a separate sandboxed Chromium/Electron window with no
preload and no renderer Node access. This exercises the actual REST adapter;
it is not a mocked backend. Screenshots and helper scripts stay ignored.

PASS in both desktop/preload and browser/REST modes:

- Five Daily metrics; exact chronological events; two-minute event jumps.
- Bookmark save, inspector listing, jump, deletion, and reset zoom.
- Graph pinning and session exclusion/reinclusion updating displayed metrics.
- Five Tremor Overview charts; statistics distributions/settings history.
- Reports, Sessions, Devices, Profiles, Settings, API, Diagnostics navigation.
- Profile dialog has modal semantics, initial focus, focus containment, and
  Escape dismissal; appearance controls switch to light mode.
- 1024x768 viewport has no document horizontal overflow; inspector drawer closes.
- No renderer exceptions during the completed automated navigation runs.

Additional desktop pointer checks exercised wheel zoom, synchronized cursor
readouts, drag gestures, stored resize height, and stored reordered graph keys.
The drag check reached the viewport boundary; arbitrary-range pan behavior is
covered by existing interaction code, rather than claimed from that boundary
check alone.

Additional browser timeline checks: keyboard ArrowRight advances the start by
one day, 7-day preset includes both endpoints, full 14-day history remains visible
after narrowing, and Statistics uses the same history widget. Date handles retain
pointer capture and keyboard support. Swagger `/docs` and `/openapi.json` return
HTTP 200. Dark chart tick contrast was corrected after inspecting screenshots.

Visually inspected Daily dark/light, Overview, and the small-window inspector
layout. Also captured Statistics. Validation used a roughly 1440-pixel desktop
window and a 1024x768 emulated viewport. The provided request contained textual
direction but no mockup image assets; no pixel-perfect match is claimed.

## Implementation / dependencies

- Tailwind 4 + Vite plugin in desktop and headless builds; shared semantic theme
  tokens, dark/light/system, visible focus states, and responsive layouts.
- Tremor Raw source in `components/tremor/`: Card, Badge, ProgressBar, BarChart,
  LineChart and supporting helpers. Lucide replaces upstream Remix icons;
  local changes include theme tokens, Recharts 3 tooltip compatibility, and
  reference lines. Upstream Apache license and notices are retained in source
  and distributed assets. React 19 and GPL-3.0-only remain unchanged.
- Dependencies: Lucide, Recharts, clsx, tailwind-merge, tailwind-variants, Radix Slot;
  development dependencies: Tailwind and its Vite plugin. No shadcn installation.
- Replaced shell/top navigation and SVG Overview trends. Retained custom Canvas
  algorithms and adaptive typed-array transfer; added theme repaint listeners
  and navigation/bookmark hooks around them. Overview loads lazily so its chart
  library does not inflate the initial Daily bundle.
- Added Sidebar, NightInspector, SessionsTable, AdminPages, reusable metric cards,
  dialog-focus hook, theme policy, event presentation, and exact-event list helper.
  Restyled profile/import dialogs. Shared timeline is wrapped in a Tremor Card.
- No source files removed. Legacy SVG trend implementation/styles were removed.
  No backend/domain/schema/OpenAPI changes were required.

## Remaining validation / supported limits

- Run the real Windows acceptance checklist for installer/package updates,
  physical SD-card detection/import, large real-world histories, and native
  save/print dialogs. This refresh did not repeat those physical workflows.
- Raspberry Pi desktop/headless ARM64 builds and physical-device validation were
  not available here. No Pi acceptance or clinical equivalence is claimed.
- Dedicated 1600x900/1920x1080, touchscreen tablet, and screen-reader checks remain.
  The narrow layout was tested through Chromium viewport emulation.
- Detailed respiratory rate/tidal volume/pulse distributions are not exposed by
  the current summary API and are not invented. Notes are temporary drafts.
  Diagnostics runtime/schema metadata remains in the existing bundle rather
  than displaying guessed values. Desktop HTTP state is not probed or managed.
- Native CSV/PDF/diagnostic export dialogs and import preflight were retained and
  covered by backend tests, but were not interactively completed in this UI run.

## Top-bar actions menu follow-up

The three-dot actions menu now closes when an action is selected, when clicking
outside it, when keyboard focus leaves it, or when pressing Escape. Escape
returns focus to the trigger. The menu previously relied on native `details`
toggling, which does not supply these dismissal behaviors. A shared
`TopBarActions` component adds dismissal without changing the actions or adapters.

Validation: production Electron demo checks passed for outside click, Escape
and focus restoration, focus departure, selecting Diagnostics and navigating,
and toggling closed. `npm run verify` passed (133 tests plus demo smoke), renderer
TypeScript and desktop/headless builds passed. No backend changes.

## Sticky therapy-history controls follow-up

Moved the single shared date-range widget into a full-width slot in the existing
sticky header on Overview and Statistics using a React portal. Date/query state
remains with its page, and history loading, pointer capture, keyboard stepping,
presets and export callbacks are unchanged. Compact header styling keeps the
whole timeline visible. Chart shortcut scroll margins follow the measured header
height so navigation accounts for the larger bar.

Validation: Electron with the isolated synthetic demo passed on both pages:
exactly one timeline inside the header; scrolling keeps the entire widget within
the viewport; 7-day preset and ArrowRight handle adjustment work while scrolled;
1024x768 has no horizontal overflow and the filter fits above the viewport
midpoint. Daily has no history toolbar. Visually inspected the scrolled Overview.
All 133 tests and demo smoke pass; renderer TypeScript and desktop/headless
builds pass. No backend or API changes.

## Header alignment follow-up

The primary header row now has its own shared 76px minimum height and alignment.
The history filter occupies a separate row below it inside the same sticky
header. Previously the height applied to the entire wrapping header, allowing
the extra history content to shift the title/actions on Overview and Statistics.

Electron synthetic-demo measurements at 1440px and 1024px confirmed identical
76px top rows, title X/Y positions, and Import button Y positions across Daily,
Overview, and Statistics. History stays visible when scrolled; neither width has
horizontal overflow. Renderer TypeScript, desktop/headless builds, and all 133
tests pass.

## Overview loading follow-up

Overview now replaces its metrics, shortcuts, and charts with a centered
accessible loading indicator until the selected-range request completes. The
sticky history filter remains available. Failed requests show an alert without
rendering zero-valued analytics. Initial loading and date-range reloads use the
same behavior.

Browser/REST checks with an intercepted synthetic-data request passed: pending
requests hide all analytics and show the indicator; successful completion reveals
six metrics and five charts and removes the indicator; range changes hide the
analytics again; request failure shows an error and hides analytics/indicator.
All 133 tests, renderer TypeScript, and desktop/headless builds pass.

## Shared calculating indicator

Overview and Statistics now render the same centered `CalculatingIndicator`:
a Lucide spinner above the visible text `Calculating…`, announced as a status.
The indicator respects reduced-motion preferences. Loading/data behavior and
sticky date filters remain unchanged. Renderer TypeScript, desktop/headless
builds, and all 133 tests pass.

## Three-dot menu stacking fix

The positioned history card painted over the dropdown because the menu had no
explicit stacking level. Before the fix, hit-testing on Overview found the
1-year preset, timeline SVG, and history axis covering three menu actions.
A local `z-index: 1` on the positioned menu now places it above the history card
within the header's stacking context, preserving higher modal/drawer layers.

Synthetic Electron checks passed at 1440px and 1024px on Daily, Overview, and
Statistics, before and after scrolling, with modal drawers dismissed: all four
menu actions win hit-testing. A real pointer click on the formerly covered
Diagnostics action navigates and dismisses the menu. All 133 tests and both
renderer builds pass.

## Daily empty-day message

Daily previously rendered its normal zero-filled metrics, graphs, and inspector
when the selected date had no imported sessions. It now shows an explicit
empty-day message with the selected date and a Go to latest night action.
The date arrows and date input remain available. Only an empty session list
triggers this message; summary-only and excluded sessions retain the normal UI.

An Electron regression check using synthetic data failed before the change and
passed afterward: navigating past the latest night displays the message and
hides metrics, graphs, and the inspector; the recovery button and previous-day
arrow restore populated nights. Detailed and STR-only nights remain visible.
Excluding every session retains the controls needed to re-enable them; the
check restored those synthetic sessions afterward. All 133 tests, renderer
TypeScript, and desktop/headless renderer builds pass. Browser runtime and
real-card validation were not repeated for this shared-renderer change.
