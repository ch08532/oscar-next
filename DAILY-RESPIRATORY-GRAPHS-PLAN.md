# Daily respiratory graphs and analysis plan

Inspection and baseline completed before implementation on 2026-10-12.
`npm run verify`: PASS (140 tests and synthetic demo smoke). Dependencies from
the earlier validated desktop work are already installed.

## Imported channel inventory

IDs and units come from `src/core/cpap-channels.ts`; mapping and actual intervals
come from `resmed-signals.ts` and `resmed-session-mapper.ts`. Rates are computed
from EDF duration/sample count, never assumed from a label. Typical suffixes are
40ms (25Hz), 2s (0.5Hz), and 1s (1Hz); other EDF rates remain supported.

| IDs | Channels | Registry units | Storage / source | Existing Daily exposure |
| --- | --- | --- | --- | --- |
| 100 | Flow Rate | L/min | BRP waveform, commonly 40ms; L/s converted by importer | Flow |
| 101 | Mask Pressure (High Rate) | cmH2O | BRP waveform, commonly 40ms | Combined Pressure |
| 102 | Respiratory Event Signal | unitless | BRP waveform | None; uninterpreted trigger signal stays unsupported |
| 103 | Mask Pressure | cmH2O | PLD waveform, commonly 2s | Missing |
| 104–106 | Therapy Pressure, IPAP, EPAP | cmH2O | PLD waveforms | Combined Pressure |
| 107 | Leak Rate | L/min | PLD waveform; importer converts L/s | Leak |
| 108 | Respiratory Rate | breaths/min | PLD waveform | Missing |
| 109 | Minute Ventilation | L/min | PLD waveform | Missing |
| 110 | Tidal Volume | mL | PLD waveform; importer converts L | Missing |
| 111–112 | Snore, Flow Limitation | unitless | PLD waveforms | Missing |
| 113 | I:E Ratio | unitless ratio | PLD waveform | Missing |
| 114–115 | Inspiratory, Expiratory Time | s | PLD waveforms | Missing |
| 116 | Target Minute Ventilation | L/min | PLD waveform | Missing |
| 200–201 | Pulse, SpO2 | bpm, % | SAD/SA2 sparse samples; missing -1 omitted; commonly 1s | Separate graphs |
| 300–305 | OA, H, UA, RERA, CA, CSR | s | EVE/CSL event records, irregular | Event Flags |

All PLD numeric channels are sampled scalar measurements represented by waveform
lists, even though the registry classifies them as Data. No derived respiratory
channels are needed. Waveforms use Int16 BLOB chunks with gain/offset and interval
metadata; sparse/event lists use Int16 values plus Uint32 timestamp deltas.

## Implementation decisions

- Reuse registry metadata in a pure shared graph definition module. Add separate
  Mask Pressure, IPAP and EPAP rows while keeping the existing combined Pressure
  row/layout key for compatibility. Add missing numeric respiratory graphs,
  including imported Target Minute Ventilation. Availability follows the selected
  night's included sessions; no fabricated graphs for absent channels.
- Add per-machine visibility, Standard/Respiratory presets, and a grouped graph
  selector. Preserve existing order, height, pin state and bookmarks. Presets are
  explicit user actions; never overwrite layouts on startup.
- Load only visible channels through existing bounded/decimated chart queries.
  Use existing Canvas interactions and exact detail loading for every new row.
- Extend graph preferences with nullable visibility (schema v7 migration);
  NULL preserves defaults for existing layouts. Store per-machine leak analysis
  preferences in the existing `app_settings` mechanism (default 24 L/min,
  reference line enabled). Desktop and REST expose identical scoped operations.
- Add a separate nightly analysis query, requested only by Daily. Stream raw
  waveform chunks into compact value histograms, never sample rows or large JS
  sample arrays. Use elapsed-valid-sample weighting for average/median/p95;
  nearest-rank quantiles match existing conventions at a uniform rate. Clip
  sample cells to therapy-day bounds, session bounds and MaskOn slices. Sparse
  samples cover at most their stored interval, never bridge missing periods.
- Leak time uses strictly greater than the configured threshold, merged intervals
  and actual included mask-on elapsed time. Return recorded leak coverage too;
  absent recordings produce no leak analysis, not a fabricated zero.
- Keep existing Daily/Overview/Statistics calculations unchanged. Do not introduce
  a persistent statistics cache; measure the new histogram query first.
- Omit total apnea time: EVE duration is optional and missing durations are stored
  as zero; the current model cannot establish a complete reliable nightly total.
- Show collapsible nightly statistics and coverage/leak analysis in the existing
  Summary inspector. Add Therapy Analysis controls in Settings. No unrelated tabs.

## Validation

Add synthetic graph availability/preset tests; real v6-to-v7 migration and reopen
tests; multi-session/gap/exclusion/noon/sparse-sample/chunk-size statistics tests;
default/custom/exact-threshold tests; REST/preload parity and validation tests.
Inspect EXPLAIN plans for new access paths. Run root tests/build/demo smoke,
desktop renderer build and typecheck, headless renderer build, and isolated
synthetic Electron/browser checks at 1920×1080, 1600×900 and 1440×900 where feasible.
Record actual results and limitations in DAILY-RESPIRATORY-GRAPHS-VALIDATION.md.
