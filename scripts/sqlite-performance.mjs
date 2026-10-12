// Synthetic-only benchmark. Run `npm run build` first. Never opens user databases.
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "../dist/src/core/machine.js";
import { Session, SliceStatus } from "../dist/src/core/session.js";
import { EventListType } from "../dist/src/core/event-list.js";
import { CpapChannel as C } from "../dist/src/core/cpap-channels.js";
import { CpapSetting as S } from "../dist/src/core/cpap-settings.js";
import { MachineType } from "../dist/src/core/types.js";
import { OscarDatabase } from "../dist/src/storage/database.js";
import { OscarQueries } from "../dist/src/storage/queries.js";

const dayMs = 86_400_000;
const first = Date.parse("2025-01-01T22:00:00Z");
const date = index => new Date(first + index * dayMs).toISOString().slice(0, 10);
const directory = await mkdtemp(join(tmpdir(), "oscar-sqlite-perf-"));
const path = join(directory, "synthetic.sqlite");
let db, sql, queries, baselineQueries;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function measure(fn, repetitions = 7) {
  fn(); // Warm the connection/page cache; these are not cold-disk timings.
  const samples = [];
  let value;
  for (let index = 0; index < repetitions; index++) {
    const start = performance.now();
    value = fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: +samples[Math.floor(samples.length / 2)].toFixed(3), resultHash: hash(value) };
}
function compare(fn, currentQueries, repetitions) {
  const samples = { before: [], after: [] };
  const values = {};
  for (const connection of [baselineQueries, currentQueries]) { queries = connection; fn(); }
  for (let iteration = 0; iteration < repetitions; iteration++) {
    for (const name of iteration % 2 ? ["after", "before"] : ["before", "after"]) {
      queries = name === "before" ? baselineQueries : currentQueries;
      // Optional --expose-gc stabilizes GC scheduling between implementations;
      // collection itself is outside the measured operation.
      global.gc?.();
      const start = performance.now();
      values[name] = fn();
      samples[name].push(performance.now() - start);
    }
  }
  queries = currentQueries;
  const result = Object.fromEntries(Object.entries(samples).map(([name, times]) => {
    times.sort((a, b) => a - b);
    return [name, { medianMs: +times[Math.floor(times.length / 2)].toFixed(3), resultHash: hash(values[name]) }];
  }));
  if (result.before.resultHash !== result.after.resultHash) throw new Error("Query results changed");
  return result;
}
try {
  const machine = new Machine(1, { type: MachineType.CPAP, brand: "Synthetic", serial: "PERF-SYNTHETIC" });
  for (let index = 0; index < 365; index++) {
    const start = first + index * dayMs;
    const session = new Session(index + 1, MachineType.CPAP);
    session.setBounds(start, start + 8 * 3_600_000);
    session.addSlice({ start, end: session.last, status: SliceStatus.MaskOn });
    session.settings.set(S.Mode, 2);
    session.settings.set(S.PressureMin, 6);
    session.settings.set(S.PressureMax, index < 180 ? 14 : 15);
    const rateMs = index >= 358 ? 40 : 1000;
    const flow = session.addEventList(C.FlowRate, EventListType.Waveform, { rateMs, gain: 0.1 });
    const raw = Int16Array.from({ length: 8 * 3_600_000 / rateMs }, (_, n) => (n % 400) - 200);
    flow.addWaveform(start, raw, raw.length * rateMs);
    for (const channel of [C.Pressure, C.Leak]) {
      const list = session.addEventList(channel, EventListType.Waveform, { rateMs: 60_000, gain: 0.1 });
      list.addWaveform(start, Int16Array.from({ length: 480 }, (_, n) => 70 + ((n + index) % 70)), 8 * 3_600_000);
    }
    for (const [channel, count] of [[C.ObstructiveApnea, 8], [C.ClearAirway, 4], [C.Hypopnea, 12], [C.RERA, 3]]) {
      const list = session.addEventList(channel, EventListType.Event, { secondField: true });
      for (let n = 0; n < count; n++) list.addEvent(start + (n + 1) * 60_000, 1, 10 + n);
    }
    // Low-rate data channels also use timestamped event lists in the real format.
    for (const channel of [C.MinuteVent, C.TidalVolume, C.RespRate, C.Snore, C.FlowLimitation, C.IERatio, C.Pulse, C.SpO2]) {
      const list = session.addEventList(channel, EventListType.Event, { gain: 0.1 });
      for (let n = 0; n < 960; n++) list.addEvent(start + n * 30_000, 80 + n % 20);
    }
    machine.addSession(session);
  }
  db = new OscarDatabase(path);
  const saveStart = performance.now();
  db.saveMachine(machine);
  const initialSaveMs = performance.now() - saveStart;
  sql = new DatabaseSync(path);
  // Longer metadata history exposes candidate-set growth without allocating
  // decades of dense waveform samples. Disabled state is deliberately mixed.
  sql.exec("BEGIN");
  const insert = sql.prepare("INSERT INTO sessions (id,machine_id,machine_type,first_ms,last_ms,enabled,summary_only,no_settings,changed) VALUES (?,1,1,?,?,?,1,0,0)");
  for (let n = 1; n <= 3650; n++) {
    const start = first - n * dayMs;
    insert.run(365 + n, start, start + 8 * 3_600_000, n % 10 ? 1 : 0);
  }
  sql.exec("COMMIT");
  queries = new OscarQueries(path);
  const baselineFlag = process.argv.indexOf("--baseline-module");
  if (baselineFlag !== -1) {
    const baseline = await import(pathToFileURL(resolve(process.argv[baselineFlag + 1])).href);
    baselineQueries = new baseline.OscarQueries(path);
  }
  const start = first + 364 * dayMs;
  const windowStart = start + 7 * 3_600_000;
  const windowEnd = windowStart + 10 * 60_000;
  const eventChannels = [C.ObstructiveApnea, C.ClearAirway, C.Hypopnea, C.UnclassifiedApnea, C.RERA, C.CSR];
  const operations = {
    daily: () => queries.getDaily(1, date(364)),
    flow10Minutes: () => queries.getChartSeries(1, date(364), [C.FlowRate], { startMs: windowStart, endMs: windowEnd, maxPointsPerSeries: 20_000 }),
    allNightEvents: () => queries.getChartSeries(1, date(364), eventChannels),
    oa30Days: () => Array.from({ length: 30 }, (_, n) => queries.getChartSeries(1, date(335 + n), [C.ObstructiveApnea])),
    oa90Days: () => Array.from({ length: 90 }, (_, n) => queries.getChartSeries(1, date(275 + n), [C.ObstructiveApnea])),
    overview30Days: () => queries.getOverview(1, date(335), date(364)),
    overview365Days: () => queries.getOverview(1, date(0), date(364)),
    statistics365Days: () => queries.getStatistics(1, date(0), date(364)),
  };
  const currentQueries = queries;
  const results = Object.fromEntries(Object.entries(operations).map(([name, fn]) => [name, baselineQueries
    ? compare(fn, currentQueries, name.includes("365") ? 3 : 7)
    : measure(fn, name.includes("365") ? 3 : 7)]));
  const sessionRow = sql.prepare("SELECT row_id FROM sessions WHERE machine_id=1 AND id=365").get().row_id;
  const flowId = sql.prepare("SELECT id FROM event_lists WHERE session_row_id=? AND channel_id=?").get(sessionRow, C.FlowRate).id;
  const statements = {
    sessionOverlap: ["SELECT row_id,id,first_ms,last_ms,enabled,summary_only FROM sessions WHERE machine_id=? AND first_ms<? AND last_ms>=? ORDER BY first_ms,id", [1, start + 14 * 3_600_000, start - 10 * 3_600_000]],
    waveformWindow: ["SELECT start_sample,sample_count,start_ms,end_ms,raw_blob FROM waveform_chunks WHERE event_list_id=? AND end_ms>? AND start_ms<? ORDER BY start_sample", [flowId, windowStart, windowEnd]],
    allSessionLists: ["SELECT * FROM event_lists WHERE session_row_id=? ORDER BY channel_id,list_index", [sessionRow]],
    selectedChannel: ["SELECT * FROM event_lists WHERE session_row_id=? AND channel_id=? ORDER BY channel_id,list_index", [sessionRow, C.ObstructiveApnea]],
    eventCountDeltas: ["SELECT first_ms,time_deltas_blob FROM event_lists WHERE session_row_id=? AND channel_id=? AND list_type=? ORDER BY list_index", [sessionRow, C.ObstructiveApnea, "event"]],
    settings: ["SELECT channel_id,value_type,value_text FROM session_settings WHERE session_row_id=? ORDER BY channel_id", [sessionRow]],
    slices: ["SELECT start_ms,end_ms,status FROM session_slices WHERE session_row_id=? ORDER BY slice_index", [sessionRow]],
  };
  const plans = () => Object.fromEntries(Object.entries(statements).map(([name, [query, args]]) => [name, sql.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...args).map(row => row.detail)]));
  const baselinePlans = plans();
  const inventory = sql.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('table','index') ORDER BY type,name").all();
  const counts = Object.fromEntries(["sessions", "event_lists", "waveform_chunks"].map(table => [table, sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  const candidates = {};
  if (process.argv.includes("--candidates")) {
    for (const [name, ddl, operation, indexName] of [
      ["sessionLast", "CREATE INDEX candidate_sessions_last ON sessions(machine_id,last_ms,first_ms)", "sessionOverlap", "candidate_sessions_last"],
      ["chunkEnd", "CREATE INDEX candidate_chunks_end ON waveform_chunks(event_list_id,end_ms,start_ms)", "waveformWindow", "candidate_chunks_end"],
      ["removeRedundantEventIndex", "DROP INDEX IF EXISTS idx_event_lists_session_channel", "selectedChannel", null],
    ]) {
      sql.exec("BEGIN");
      try {
        const [query, args] = statements[operation];
        const before = measure(() => sql.prepare(query).all(...args), 31);
        sql.exec(ddl);
        const after = measure(() => sql.prepare(query).all(...args), 31);
        const forced = indexName ? query.replace(`FROM ${operation === "sessionOverlap" ? "sessions" : "waveform_chunks"}`, `$& INDEXED BY ${indexName}`) : query;
        candidates[name] = { before, after, planner: sql.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...args).map(row => row.detail), forced: measure(() => sql.prepare(forced).all(...args), 31) };
      } finally { sql.exec("ROLLBACK"); }
    }
  }
  queries.close(); queries = undefined;
  baselineQueries?.close(); baselineQueries = undefined;
  // Storage snapshot rewrite, not SD-card discovery/parsing or full importer cost.
  const snapshotRewrite = process.argv.includes("--skip-writes") ? undefined : measure(() => { db.saveMachine(machine); return db.listMachines().map(row => row.sessionCount); }, 3);
  sql.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  console.log(JSON.stringify({ node: process.version, sqlite: sql.prepare("SELECT sqlite_version() AS v").get().v, schema: db.schemaVersion,
    dataset: { detailedNights: 365, denseFlowNights: 7, metadataOnlyNights: 3650, counts },
    methodology: { alternatingBaseline: baselineFlag !== -1, explicitGc: !!global.gc, warmCache: true },
    initialSaveMs: +initialSaveMs.toFixed(3), snapshotRewrite, fileBytes: (await stat(path)).size,
    results, plans: baselinePlans, candidates, inventory }, null, 2));
} finally {
  if (queries !== baselineQueries) queries?.close();
  baselineQueries?.close(); sql?.close(); db?.close();
  await rm(directory, { recursive: true, force: true });
}
