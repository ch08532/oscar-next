# SQLite performance review

Reviewed 2026-10-12; pre-task source revision `cf30f32`.

## Current Schema

Inventory before this task: schema v5, Node `node:sqlite`, WAL writes,
read-only `OscarQueries`. All application SQL is in `src/storage/database.ts`
and `src/storage/queries.ts`; import orchestration uses those APIs.

| Table | Primary key / unique constraints | Foreign keys |
| --- | --- | --- |
| `schema_version` | None; one version row maintained by the application | None |
| `profiles` | Integer PK `id`; UNIQUE `name COLLATE NOCASE` | None |
| `app_settings` | Text PK `key` | None |
| `machines` | Integer PK `id` | `profile_id -> profiles.id`, no cascade |
| `machine_properties` | PK `(machine_id, key)` | Machine, delete cascade |
| `sessions` | Integer PK `row_id`; UNIQUE `(machine_id, id)` | Machine, delete cascade |
| `session_settings` | PK `(session_row_id, channel_id)` | Session, delete cascade |
| `session_slices` | PK `(session_row_id, slice_index)` | Session, delete cascade |
| `event_lists` | Integer PK `id`; UNIQUE `(session_row_id, channel_id, list_index)` | Session, delete cascade |
| `waveform_chunks` | PK `(event_list_id, chunk_index)` | Event list, delete cascade |
| `graph_preferences` | PK `(machine_id, graph_key)` | Machine, delete cascade |
| `graph_bookmarks` | Integer PK `id` | Machine, delete cascade |

Integer primary keys alias rowid; the other PK/UNIQUE constraints have implicit
SQLite indexes. `sqlite_sequence` is SQLite's AUTOINCREMENT bookkeeping table.
There is no per-event table, imported-files table, or materialized nightly summary.
Events use per-session/channel lists with typed-array value and time-delta BLOBs.
Waveforms use one-minute chunks, with an empty parent waveform `raw_blob` after
conversion. Settings are session-scoped. Sessions store device wall-clock bounds,
not a therapy-date column; all day queries retain noon rollover and interval overlap.

Migration history in `OscarDatabase.#migrate`: base schema creation, v2 legacy
waveform BLOB conversion, graph preference/bookmark schema, v4 height column,
v5 profiles and device-time metadata. CREATE statements are idempotent;
version-specific legacy transformations precede updating the version row.

## Current Indexes

Explicit indexes **before** changes:

| Index | Columns | Purpose |
| --- | --- | --- |
| `idx_sessions_machine_first` | sessions `(machine_id, first_ms)` | Machine history / day overlap, start-time ordering |
| `idx_event_lists_session_channel` | event_lists `(session_row_id, channel_id)` | Duplicates the left prefix of the UNIQUE constraint |
| `idx_waveform_chunks_time` | waveform_chunks `(event_list_id, start_ms, end_ms)` | Per-list overlap lookup |
| `idx_graph_bookmarks_machine_date` | graph_bookmarks `(machine_id, therapy_date, start_ms)` | Bookmarks for one machine/date |

## Query Hotspots

- Daily: session overlap `machine_id = ? AND first_ms < ? AND last_ms >= ?`,
  ordered by `first_ms, id`; per-session settings/slices, five event subtype
  counts, pressure/leak statistics, distinct available channels.
- Charts: the same session overlap; event-list selection; chunk overlap
  `event_list_id = ? AND end_ms > ? AND start_ms < ? ORDER BY start_sample`.
  Windowing/decimation already avoid reading every stored waveform chunk.
- Event counts: before this task, each subtype read all event-list columns and
  BLOBs, then discarded other channels in JavaScript. Chart selection and
  pressure/leak statistics used the same broad event-list helper.
- Overview calls Daily once per calendar day, including gaps. Statistics calls
  Overview, then calculates exact range pressure/leak percentiles and settings
  history. These operations decode/sort samples; indexes cannot cache that work.
- Lightweight therapy history batches session and slice metadata over a range;
  it intentionally avoids event/waveform payloads.
- Inclusion updates use UNIQUE `(machine_id, id)`. Settings/slices use their
  session-scoped PKs. Settings history visits enabled sessions in time order.
- Import loads the complete existing machine, merges sessions in memory, then
  saves a complete machine snapshot in a transaction. Child cascades use indexed
  FK prefixes. File discovery/parsing is outside SQLite; no file ledger exists.
- Profile/settings lookups, machine properties, graph layouts and bookmarks
  are small indexed metadata operations. Machine listing groups a sessions join
  for counts/min/max; profile filtering is on a small machines table.

The potentially large tables are `waveform_chunks`, `event_lists`, and
`sessions`; per-session settings/slices also grow with history.

## Query Plan Findings

Measured with SQLite 3.53.4 on 4,015 sessions, 5,475 event lists, and 525,600
waveform chunks. These are real prepared SQL statements, with synthetic data.

| Operation | Before | After |
| --- | --- | --- |
| Event lists for charts/statistics | `SEARCH event_lists USING INDEX sqlite_autoindex_event_lists_1 (session_row_id=?)` | `SEARCH event_lists USING INDEX sqlite_autoindex_event_lists_1 (session_row_id=? AND channel_id=?)` |
| Subtype counts | Same broad session lookup, returning all payload columns | Same session/channel index lookup, returning only `first_ms, time_deltas_blob`, filtering `list_type='event'` |
| Session overlap | `SEARCH sessions USING INDEX idx_sessions_machine_first (machine_id=? AND first_ms<?)` | Unchanged |
| Waveform window | `SEARCH waveform_chunks USING INDEX idx_waveform_chunks_time (event_list_id=? AND start_ms<?)` | Unchanged |
| Settings | `SEARCH session_settings USING INDEX sqlite_autoindex_session_settings_1 (session_row_id=?)` | Unchanged |
| Slices | `SEARCH session_slices USING INDEX sqlite_autoindex_session_slices_1 (session_row_id=?)` | Unchanged |

The chart helper uses parameterized `channel_id IN (...)`; a one-channel lookup
uses the equality plan shown above. Multiple channels retain channel/list order.
The overlap plans still filter the other interval bound as a residual predicate.
Session ordering needs a temporary B-tree for its last term, and chunk ordering
needs a temporary B-tree for `start_sample`. These sort the bounded result set;
they do not scan all machines or all stored waveform chunks. There was no global
`SCAN waveform_chunks`, `SCAN event_lists`, or `SCAN sessions` in these hot queries
to eliminate. Available-channel DISTINCT and range slice joins remain unchanged.

A separate 10,000-session metadata fixture confirmed the therapy-history slice
join searches `idx_sessions_machine_first` and the slices PK; inclusion updates
search UNIQUE `(machine_id, id)`. Snapshot session deletion uses covering indexes
for sessions and each child FK, including the retained event-list UNIQUE index.
Machine listing scans the small machines table and performs an indexed sessions
LEFT JOIN. Bookmarks search the existing machine/date index, then sort name/id
ties; graph layouts search their machine-key PK, then sort the small preference
set. None warrants an additional metadata index in this change.

The payload regression test measured **420,112 bytes** returned by the old Daily
logic for a session with two OA events and a larger unrelated data channel.
The new count query returns only the two timestamp deltas (**8 bytes**); chart
event values/durations remain available when requested. A one-minute Flow Rate
window reads exactly one 3,000-byte chunk in that fixture, and an empty channel
selection reads no payload. The test checks bytes across the SQLite/JS boundary,
not an elapsed-time threshold.

## Index Changes

No new indexes were justified. Schema **v6** removes
`idx_event_lists_session_channel`, already covered by UNIQUE
`(session_row_id, channel_id, list_index)`. The constraint index still supports
session/channel queries, ordered list reads, uniqueness, and FK cascades.

The v6 drop and version update run together in a transaction. Older migrations
still execute first. Fresh databases omit the redundant CREATE; repeated opens
do not recreate it. No table, column, waveform chunk, or persisted value changes.
This reduces redundant index maintenance during snapshot imports; it is not a
claim of a large import speedup. The matching synthetic database after snapshot
rewrites occupied 97,075,200 bytes versus 97,153,024 bytes before (77,824 bytes less,
about 0.08%). Freed pages in an existing migrated file need not shrink the file;
this task does not VACUUM user databases.

Query changes are limited to SQL channel selection for charts and channel
statistics, and narrow timestamp-only reads for event counts. Existing interval
clipping, exact events, offset/gain calculations, typed arrays, summary fallback,
disabled-session handling, and min/max decimation are unchanged.

## Rejected Indexes

- **`sessions(machine_id, therapy_date)`**: no therapy-date column exists. Adding
  one would duplicate noon-overlap semantics, including sessions crossing days.
- **`sessions(machine_id, last_ms, first_ms)`**: evaluated on the 4,015-session
  fixture. SQLite kept the current start-time index: median lookup 0.675 ms
  before, 0.679 ms after adding the candidate. Forcing the candidate gave
  0.015 ms for a recent day, but that is a different access policy and may hurt
  old windows. Do not add an unused index or hard-code INDEXED BY for that case.
  A separate adaptive overlap strategy would need historical-window benchmarks.
- **Enabled-only session index**: Daily also needs excluded sessions so users
  can re-enable them. Most sessions are enabled; maintaining another history
  index for reporting has no demonstrated benefit here.
- **Another start-time session index**: already covered by
  `idx_sessions_machine_first`. Appending end time does not solve arbitrary
  two-sided overlap or the `id` ordering requirement.
- **`waveform_chunks(event_list_id, end_ms, start_ms)`**: SQLite chose the
  candidate for a late-night ten-minute window (0.063 ms to 0.039 ms SQL-only,
  forced run 0.054 ms). That saves about 0.024 ms in this microbenchmark while
  adding a second time index across more than half a million chunk rows. It may
  scan more chunks for early windows. The public graph benchmark is already
  bounded and showed no measurable improvement from this task; retain the
  existing time index without changing chunk storage.
- **Events by session/type/time**: there are no individual SQL event rows or
  per-event timestamp columns to index. Channel/type filtering can narrow lists;
  event times inside a BLOB still require delta decoding. Adding a per-sample or
  per-event relational representation is outside this task.
- **Another session/channel event index, or one including `list_type`**: the
  UNIQUE prefix already selects a few lists. No evidence justifies another
  index to avoid inspecting their type. Removing the duplicate left the same
  UNIQUE-index SEARCH plan (0.025 ms before / 0.024 ms after SQL-only).
- **Settings/history index**: the session/channel PK already serves actual
  lookups. There is no machine/effective-time settings table.
- **Imported-files unique index/table**: no such ledger exists. Incremental
  imports merge public session IDs; indexes cannot skip full snapshot hydration
  or rewriting. File-ledger and incremental persistence changes require a
  separate design preserving re-import and disabled-session semantics.
- **More profile/bookmark/layout indexes**: small metadata tables are already
  covered by their PKs/UNIQUE constraints or the bookmark date index.

## Benchmark Results

Benchmark: `scripts/sqlite-performance.mjs`. It creates and removes its own
temporary synthetic database and never accepts a therapy database path.
It uses public storage/query APIs, 365 eight-hour detailed nights, 3,650 older
metadata-only nights, three waveform channels and twelve timestamped event/data
lists per detailed night. Flow is 1 Hz for most nights and 25 Hz for the latest
seven; pressure/leak are one sample/minute. This exposes indexed lookups and
payload selection without allocating ten years of high-rate signals.

The first separate-process v5/v6 runs had large timing variation (including
Statistics 2,675 / 10,033 ms). These are **not evidence of a Statistics speedup**.
To investigate, the final comparison loaded the unmodified pre-task query class
and new class against the same v6 fixture, warmed both, alternated execution
order, and explicitly collected JS garbage **outside** each timed operation.
This controls connection/data/GC scheduling better; it remains a synthetic
warm-cache benchmark, not a cold-disk, GUI, API-serialization, or real-card test.

Final paired medians, milliseconds (seven samples; three for year operations):

| Public operation | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Daily night | 4.800 | 4.123 | 14% faster |
| Ten-minute Flow Rate window, 15,000 exact samples | 1.744 | 1.828 | Roughly unchanged; 0.084 ms slower in this run |
| All detailed apnea/RERA/CSR events for a night | 1.402 | 1.124 | 20% faster |
| OA over 30 days (30 existing chart calls) | 26.165 | 22.074 | 16% faster |
| OA over 90 days (90 existing chart calls) | 81.024 | 65.422 | 19% faster |
| Overview, 30 days | 132.029 | 109.027 | 17% faster |
| Overview, 365 days | 1,612.801 | 1,272.420 | 21% faster |
| Statistics, 365 days | 2,632.673 | 2,257.298 | 14% faster |

All eight full result hashes matched before/after in both the separate-process
and paired comparisons. There is no new multi-day event endpoint: the event-range
measurements deliberately use the existing per-day API in a loop.

Separate-process snapshot rewrite medians were 23,293 ms before / 21,583 ms
after; result hashes matched. Those runs included filesystem/GC variability and
rewrote all detailed history, so do not attribute that difference to dropping
the index or describe it as an end-to-end importer speedup. Public import
discovery, parsing and merging were not included in those timings.

Reproduce current timings and optional candidate evaluation after building:

```powershell
npm run build
node scripts/sqlite-performance.mjs
node scripts/sqlite-performance.mjs --candidates
```

For paired comparison, provide a pre-task query module exporting `OscarQueries`:

```powershell
node --expose-gc scripts/sqlite-performance.mjs --baseline-module <baseline-module.mjs> --skip-writes
```

The reviewed run used `src/storage/queries.ts` from revision `cf30f32`,
transpiled to ESM with its core imports pointing at the same built
core modules. Both query implementations therefore share the fixture and domain
types. `--skip-writes` skips the repeated snapshot benchmark, not fixture creation.
Candidate indexes exist only inside rolled-back transactions in temporary data;
`--candidates` after v6 treats duplicate-index removal as an already-absent no-op.

## AI Readiness

The compact storage design is appropriate for local analysis. Usage, adherence,
AHI/RDI, subtype indices, and settings history are already exposed by the query
layer, including STR-only summary fallback. AI should call structured query
tools rather than unrestricted SQL or raw waveform scans for statistical
questions. There is no AI implementation in this change.

However, full nightly aggregates are **not** materialized: Overview and Statistics
still calculate pressure/leak statistics by decoding their relevant samples,
and Statistics computes exact range percentiles again. Repeated six-month/year
questions should reuse results rather than repeat those reads. A high-OA-night
search currently evaluates nightly values; there is no SQL index on a derived
OA index. Event-cluster/hour-of-night analysis should decode selected event
channel deltas over selected sessions, fetching Flow only for targeted follow-up
windows. Existing nightly AI-like range queries would take seconds on this
fixture; avoid presenting current long-range analysis as instant.

## Night Summary Recommendation

**Design and implement later as a separate measured feature; do not add a table
in this task.** Repeated long-range analysis would benefit: optimized synthetic
year Overview still takes about 1.27 seconds and Statistics about 2.26 seconds.
Current STR session settings provide partial summary rates, not an equivalent
complete cache of Daily's detailed-night calculations. No complete nightly
summary/cache table currently exists.

A future cache needs UNIQUE `(machine_id, therapy_date)`, an algorithm/rollover
version and an explicit database-visible data revision. It must invalidate all
therapy days overlapped by changed sessions on enable/disable, re-import,
late-arriving files, replacement/deletion, or settings changes affecting derived
metrics. Separate desktop/headless connections/processes must observe those
revisions. Profile/timezone metadata edits must preserve floating timestamps;
display metadata should refresh without silently regrouping historical data.
Keep summary-only unknowns distinct from detailed counts and preserve excluded
session controls. Cache invalidation and migration/backfill are substantial
correctness work, not an extra index.

Daily aggregate caching cannot alone reproduce **exact range pressure/leak
percentiles**: averaging nightly medians/95th percentiles is incorrect. Statistics
would still need raw selected-channel samples or a separately validated exact
distribution representation. SpO2/pulse summaries would be new derived metrics,
requiring defined semantics and tests rather than speculative columns. First
evaluate batched metadata reads and a revision-aware query cache; use a persistent
summary table only when repeat-query/real-device profiling justifies its lifecycle.

## Validation

- Baseline `npm install --offline --no-audit --no-fund`: PASS.
- Baseline `npm run verify` (build, all existing tests, demo smoke): PASS.
- Baseline test count: 133 passed, zero failures.
- Regression-first `node --test dist/tests/storage-performance.test.js`: the
  payload test FAILED before the query change (420,112 bytes); the event boundary
  test passed. Afterward, all three new performance/migration tests passed.
- Final `npm run verify`: PASS, 136 tests plus synthetic demo smoke; includes
  `npm run build`, `npm test`, and `npm run demo:smoke`.
- `npm --prefix apps/desktop install --offline --no-audit --no-fund`: PASS using
  existing dependencies. npm warned that three install scripts are not approved;
  no approval settings were changed and existing binaries built successfully.
- `npm --prefix apps/desktop run build`: PASS.
- `npm --prefix apps/desktop run build:headless`: PASS.
- Node 22.21.1 embedded in Electron 37: 24 storage/database/query/import tests
  PASS using `ELECTRON_RUN_AS_NODE=1`, including the new tests. Crashpad printed
  sandbox access-denied diagnostics; all tests completed with exit 0. This is an
  embedded Node compatibility check, not a standalone Node 22 service acceptance run.
- Main suite/benchmarks used Node 24.21.0, npm 11.19.0, SQLite 3.53.4 on Windows
  x64 (OS build `10.0.26200`).
- New migration test restores the complete v5 index/version shape, then checks
  every stored table row/BLOB after upgrade and a repeated open, FK integrity,
  preserved disabled state across machines with identical public session IDs,
  waveform round-trip, profile/timezone, bookmarks, and graph pin/height state.
- Existing tests continue covering legacy v1-v5 migrations, STR fallback,
  inclusion/exclusion, waveform windows/peak decimation, import merge/re-import,
  API integration, and diagnostics privacy. Diagnostics' version assertion now
  uses the exported schema constant.
- Real therapy databases/cards, Pi/ARM64, packaged-app GUI, and real-device cold
  disk/import performance were not exercised. No clinical or importer behavior
  changes are claimed.
