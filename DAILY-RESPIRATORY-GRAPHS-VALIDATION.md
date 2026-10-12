# Daily respiratory graphs and channel analysis validation

## Night Statistics visibility fix — 2026-10-12

The generic `.table-scroll table` rule imposed a 680px minimum width on the
287.2px Night Inspector table container. In the synthetic browser reproduction,
the first numeric cell started at x=1402px while the container ended at x=1363px:
all values were populated but hidden beyond the horizontal viewport. Scoped the
nightly table to its container width with fixed columns and wrapping labels.

- Baseline `npm run verify`: PASS, 156 tests and synthetic demo smoke.
- Desktop and headless renderer builds: PASS.
- `node .validation/check-night-statistics-layout.mjs`: PASS at 1920, 1600,
  1440 and 1280px viewport widths. All 85 populated numeric cells fit within
  their container without clipped content. The original layout fails these
  geometry assertions. Uses the shared renderer with isolated synthetic data.
- No backend calculations or stored therapy data changed.

2026-10-12, Windows 11 x64 (OS 10.0.26200), Node v24.21.0, npm 11.19.0,
Electron 37.10.3. Only synthetic databases/cards were used. No real therapy
database or source media was opened for this task.

## Implemented channels and controls

The inventory, source IDs, EDF rates, units, and storage representation are in
`DAILY-RESPIRATORY-GRAPHS-PLAN.md`. Daily now has 18 data-driven graph choices:

| Graph | Channel IDs | Registry/display units |
| --- | --- | --- |
| Event Flags | 300–305 | event duration s |
| Flow Rate | 100 | L/min |
| Pressure (existing combined row) | 104, 101, 105, 106 | cmH₂O |
| Leak Rate | 107 | L/min |
| Flow Limitation | 112 | unitless |
| Snore | 111 | unitless |
| Mask Pressure | 103, 101 | cmH₂O |
| IPAP, EPAP | 105, 106 | cmH₂O |
| Respiratory Rate | 108 | breaths/min |
| Tidal Volume | 110 | mL |
| Minute Ventilation | 109 | L/min |
| Inspiratory Time, Expiratory Time | 114, 115 | s |
| I:E Ratio | 113 | unitless ratio |
| Target Minute Ventilation | 116 | L/min |
| SpO₂, Pulse | 201, 200 | %, bpm |

The registry supplies names and canonical units. No new transformations or
importer semantics were introduced. Available channels follow enabled detailed
sessions and the selected therapy date. Missing channels are omitted from the
selector; summary-only nights have no fabricated raw graphs/statistics.

Standard and Respiratory presets alter visibility explicitly. Startup preserves
custom visibility. Pinning, order, height, synchronized viewport/cursor,
wheel zoom, pan, reset, named bookmarks, chunk queries, and min/max decimation
continue through the existing Canvas graph system. The combined Pressure key
is preserved for existing layouts; separate pressure rows are optional.

## Statistics and leak calculations

- Night Inspector Summary shows a collapsible table with min, average, median,
  p95, max and units. Hovering a row exposes recording coverage. The new backend
  query is independent of graph visibility and chart decimation.
- All included detailed sessions contribute underlying samples; raw summary-only
  values are never fabricated. Source values retain waveform gain+offset and
  event-list gain-only conventions. Signed Flow and the uninterpreted respiratory
  trigger channel 102 do not get nightly table statistics. High-rate Mask
  Pressure remains available for analysis when recorded.
- Each waveform sample represents its stored interval, clipped to signal/session
  end, the therapy date, and merged mask-on slices. Sparse samples cover at most
  their known stored rate and stop at an earlier following sample. Missing
  intervals are not bridged. Samples without a reliable positive interval are
  omitted rather than assigned an invented elapsed duration.
- Average is sum(value × valid elapsed duration) / valid elapsed duration.
  Median and p95 are nearest-rank quantiles of the combined duration histogram.
  This matches existing sample nearest-rank conventions at uniform rates, and
  avoids rate/chunk/session weighting bias. Session percentiles are never averaged.
  Existing Daily metric cards, AHI/RDI and aggregate Statistics are unchanged.
- Leak time uses strictly `value > configured threshold`, merging above-threshold
  intervals. Percentage is 100 × above-threshold seconds / merged included
  mask-on therapy seconds, including summary-only therapy. Recording coverage
  is returned separately and the UI explains incomplete coverage. No leak
  samples means absent analysis, rather than a fabricated zero.
- Leak uses canonical L/min; an unexpected stored leak unit is not interpreted
  as L/min. Threshold defaults to 24 L/min and can be changed from 0–1000 L/min
  in Settings → Therapy Analysis. The optional dashed reference line includes
  threshold and units and participates in existing automatic scale bounds.
- Total Time in Apnea was intentionally omitted: EDF annotation duration is
  optional and the importer stores missing durations as zero. The current model
  cannot distinguish a complete duration record from missing duration data for
  every night, so a complete reliable total cannot be promised.

## Persistence and API

Schema v7 adds nullable `graph_preferences.visible`: NULL keeps default behavior
for existing layouts. Migration preserves disabled sessions, pin/order/height,
bookmarks, profiles, and waveform BLOBs. Analysis preferences use the existing
`app_settings` mechanism, scoped by machine. No waveform schema or importer
changes were needed.

The scoped OscarApi operations have matching preload/main and REST adapters:
nightly channel analysis, get/save therapy analysis preferences, and atomic graph
visibility updates. OpenAPI JSON and OPENAPI.md document the new endpoints and
response types. Authentication, loopback defaults, import permissions, and
renderer isolation remain in effect.

## Automated results

| Command/check | Result |
| --- | --- |
| Baseline `npm run verify` | PASS: 140 tests and demo smoke |
| `npm test` | PASS: 156 tests |
| Final `npm run verify` | PASS: 156 tests and demo smoke |
| `npm run build` (also included in verify/desktop:build) | PASS |
| `npm run desktop:build` | PASS |
| `npm --prefix apps/desktop run build:headless` | PASS |
| Renderer `tsc.cmd --noEmit -p apps/desktop/tsconfig.json` | PASS |
| `git diff --check` | PASS |

New/extended tests cover all respiratory channels through an actual synthetic
ResMed EDF import; graph availability/defaults/presets; split-night inclusion,
summary-only and missing channels; min/mean/median/p95/max; different rates;
mask-off gaps; noon clipping; sparse/irregular missing samples; zero readings;
default/custom/exact-equality/all-below/all-above leak thresholds; unexpected
units; chunk-size independence; machine isolation; v6-to-v7 migration/reopen;
visibility/settings round trips; authentication/input validation; REST adapter
parity with shared queries; and scoped preload forwarding. Existing query,
import, waveform, session and privacy tests also pass.

A targeted availability regression failed before the final boundary fix: a
waveform ending exactly at the selected day's noon was still listed as available.
The availability query now excludes that waveform while retaining event records
exactly at the inclusive start boundary. The targeted regression and full suite
pass after the fix.

## Performance and query plans

`node .validation/benchmark-daily-analysis.mjs` creates and removes a temporary
synthetic eight-hour night: Flow and high-rate Mask Pressure at 25Hz, fourteen
PLD channels at 0.5Hz. Five measured runs after warm-up: 120.30–133.80 ms;
median **123.08 ms** for all 15 relevant recorded statistics channels. Only
visible graph channels were requested for chart transport (10,672 returned
adaptive/exact points across eight selected channels). Histogram accumulation
does not create per-sample JS objects or SQLite rows. Raw BLOBs stay in the
backend; statistics are not recalculated when the graph viewport/cursor changes.
No persistent cache was warranted by this measurement.

EXPLAIN QUERY PLAN confirmed:

- sessions search `idx_sessions_machine_first` by machine and start time;
- event lists search their existing unique index by session and channel;
- waveform chunks search `idx_waveform_chunks_time` by list and time window.

Small ordering sorts remain for list chronology and chunk sample order. No new
indexes were added. Measurements describe this synthetic workload, not every
real card, machine, platform, or browser latency.

## Desktop and browser runtime results

Launched the actual updated Electron application with isolated synthetic user
data and a separate headless server with imports/media watching disabled. A
sandboxed Chromium browser loaded the headless UI over HTTP/REST. Automated
interaction checks passed in both modes:

1. Daily opens with 18 available graph choices and 17 channel statistics.
2. Respiratory preset shows the seven available preset rows; Standard shows its
   five expected rows. Additional Ti/Te/I:E/IPAP/EPAP/target ventilation choices
   render populated synchronized Canvas graphs.
3. Visibility persists across navigation. Pin/unpin, drag reorder, pointer-based
   resize, synchronized cursors, wheel zoom, pointer panning, reset and
   save/recall/delete bookmarks work. Synthetic
   bookmarks created by validation were removed.
4. Saving a 35 L/min threshold updates Leak Analysis and the Canvas reference
   label. Disabling the line removes it. Configuration persists in the database.
5. Excluding a session immediately halves recorded sample count and included
   therapy seconds in the two-equal-session fixture; restoring it restores data.
6. Summary-only nights have no available raw graph choices or fabricated channel
   statistics and show the existing no-data state.
7. At 1920×1080, 1600×900 and 1440×900 there is no document horizontal overflow;
   the inspector remains under 360px and graph workspace exceeds 600px.
8. Actual Electron IPC and browser REST return identical complete nightly analysis.

Ignored `.validation/` scripts/logs retain the exact synthetic checks. Real-card
comparison with OSCAR, physical removable-media behavior, Raspberry Pi runtime,
and installer packaging were not repeated. No clinical validation is claimed.
