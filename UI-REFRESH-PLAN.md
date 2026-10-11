# OSCAR Next UI refresh plan

## Baseline and renderer structure

2026-10-10: Node 24.21.0 / npm 11.19.0, Windows. Dependency checks used
`npm install --ignore-scripts --no-audit --no-fund` and the same desktop-prefix
command. `npm run verify` (126 tests plus synthetic demo smoke) and
`npm run desktop:build` passed before UI edits. Actual GUI validation follows
implementation. No mockup image files were supplied with the written brief.

- `App.tsx`: shared shell, profile/machine/date selection, imports, Daily fetching.
- `Charts.tsx`: Canvas waveforms/events, cursor overlays, adaptive viewport fetch,
  pin/order/resize preferences and persisted graph bookmarks.
- `Overview.tsx`: selected-range history metrics and SVG trend charts.
- `Statistics.tsx`: backend statistics, settings history, CSV/PDF exports.
- `TherapyDateRange.tsx`: shared lightweight timeline, date inputs and presets.
- `ImportDialog.tsx` / `ProfileDialog.tsx`: existing workflows.
- `types.ts`: OscarApi boundary. Desktop preload and browser REST adapter remain.
- `styles.css`: legacy presentation. Both Vite entrypoints currently import it.

## Keep / replace

Keep all Canvas algorithms, typed arrays, backend services, session semantics,
timezone rules, authentication, import confirmation/read-only source media,
adaptive data loading and lightweight timelines. Replace the top navigation with
a persistent collapsible sidebar and compact header; replace overview SVG trends
with Tremor analytics charts; restyle dialogs and tables. Daily gets a collapsible
Night Inspector with shared graph bookmarks and event navigation; it must not
maintain a separate zoom state from the graphs.

## Dependencies and configuration

Use current Tremor Raw source components rather than forcing an incompatible
legacy npm package onto React 19. Keep attribution/license in the vendored source
directory. Tremor Raw supports React 18.2+ and Tailwind 4+. Sources:
https://www.tremor.so/docs/getting-started/installation and
https://github.com/tremorlabs/tremor.

Add Tailwind CSS 4 and its Vite plugin to both renderer builds, lucide-react,
Recharts (Tremor Raw chart dependency), tailwind-variants, clsx, tailwind-merge,
and Radix Slot if required by the upstream Card. No shadcn or second icon library.
Configure semantic surface/text/border/accent tokens and class-driven dark mode.
Default dark; Light/System stored only as a browser appearance preference.

## Migration stages

1. Foundation: dependency compatibility, Tailwind, Tremor source, theme, sidebar,
   shared compact header. Check TypeScript and renderer builds.
2. Daily: five KPIs, event badges, Canvas surroundings, inspector, sessions,
   calendar, event/bookmark navigation. Preserve graph preferences and algorithms.
3. Overview: Tremor bar/line/stacked analytics, real backend data, references and
   shared timeline with extended presets. No synthetic comparisons or trends.
4. Statistics: compact KPIs, supported metric distribution table, settings/daily
   tables and unchanged exports.
5. Administration: Reports reuses Statistics export workflow; Sessions reuses
   Daily session operations; Devices, Profiles, Appearance, API and Diagnostics
   expose only existing capabilities. Notes has an explicit unsaved draft shell.
6. Polish: responsive sidebar/inspector, focus states, errors/empty/loading states,
   light/system themes, real synthetic-data Electron/headless visual validation.

## Risks and validation

- React 19 incompatibility in older Tremor npm packages: use official Raw sources,
  do not downgrade React or use legacy peer-dependency bypasses.
- Chart-library change applies only to low-rate Overview analytics. Verify data,
  labels, reference lines, gaps and legends; Canvas stays unchanged algorithmically.
- Canvas colors must read theme tokens and repaint on theme changes, including
  tooltip/grid/cursor colors. Resizing the inspector must resize existing canvases.
- Preserve wall-clock labels and summary-only event-index distinction. Never
  fabricate clinical values or per-session AHI unavailable in the API.
- Desktop does not run an HTTP API by default: no fabricated connected status or
  working Swagger link. Browser URLs use the actual service origin.
- Notes persistence and unavailable statistical signals remain explicitly
  unsupported; no schema changes or health-data storage in localStorage.
- Preserve both adapters, four deployments, API security and GPL license.
- Use only synthetic validation data. Record exact commands/results and missing
  real-machine checks in UI-VALIDATION.md. Do not stage data/ or generated output.

After major stages: TypeScript/build and relevant tests. Completion: `npm test`,
`npm run demo:smoke`, `npm run build`, `npm run desktop:build`, headless build,
renderer typecheck, plus visual/runtime checks when permitted. New behavior gets
targeted tests; styling-only edits do not require implementation-mirroring tests.
