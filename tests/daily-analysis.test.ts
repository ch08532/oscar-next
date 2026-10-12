import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "../src/core/machine.js";
import { Session, SliceStatus } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";
import { EventListType } from "../src/core/event-list.js";
import { CpapChannel as C } from "../src/core/cpap-channels.js";
import { OscarDatabase, SCHEMA_VERSION } from "../src/storage/database.js";
import { OscarQueries, therapyDayRange } from "../src/storage/queries.js";
import { availableDailyGraphs, graphPresetVisibility, selectedChartChannels, DAILY_GRAPHS } from "../apps/desktop/src/daily-graphs.js";

const date = "2026-10-09", start = therapyDayRange(date).startMs + 3_600_000;
function machine(id = 1) { return new Machine(id, { type: MachineType.CPAP, brand: "Synthetic", serial: `SYNTHETIC-${id}` }); }
function session(id: number, first: number, seconds: number) {
  const result = new Session(id, MachineType.CPAP); result.setBounds(first, first + seconds * 1000); return result;
}
function waveform(session: Session, channel: C, values: readonly number[], rateMs = 2000, first = session.first) {
  session.addEventList(channel, EventListType.Waveform, { rateMs, dimension: channel === C.Leak ? "L/min" : "" }).addWaveform(first, Int16Array.from(values), values.length * rateMs);
}
async function fixture(run: (path: string, db: OscarDatabase) => void | Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "oscar-daily-analysis-")), path = join(dir, "synthetic.sqlite");
  const db = new OscarDatabase(path);
  try { await run(path, db); } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
}
function analysis(path: string) { const queries = new OscarQueries(path); try { return queries.getDailyChannelAnalysis(1, date); } finally { queries.close(); } }

test("graph availability and explicit presets select only recorded channels", () => {
  const all = [...new Set(DAILY_GRAPHS.flatMap(graph => graph.channelIds))];
  assert.equal(availableDailyGraphs(all).length, 18);
  assert.deepEqual(availableDailyGraphs([]), []);
  const partial = availableDailyGraphs([C.FlowRate, C.RespRate, C.TidalVolume]);
  assert.deepEqual(partial.map(item => item.key), ["flow", "respiratory-rate", "tidal-volume"]);
  assert.deepEqual(graphPresetVisibility("Respiratory", partial), { flow: true, "respiratory-rate": true, "tidal-volume": true });
  const standard = graphPresetVisibility("Standard", availableDailyGraphs(all));
  assert.equal(standard["respiratory-rate"], false);
  const custom = [{ key: "respiratory-rate", pinned: true, sortOrder: 9, height: 320, visible: true }, { key: "flow", pinned: false, sortOrder: 2, visible: false }];
  assert.deepEqual(selectedChartChannels([C.FlowRate, C.RespRate, C.SpO2], custom), [C.RespRate, C.SpO2]);
  assert.equal(custom[0]?.height, 320);
  assert.equal(graphPresetVisibility("Respiratory", availableDailyGraphs([C.Pressure]))["pressure"], true);
});

for (const [name, values, threshold, seconds] of [
  ["all below", [0, 1, 2, 3], 24, 0], ["all above", [25, 26, 30, 40], 24, 8],
  ["crossing and exactly equal", [0, 24, 25, 40], 24, 4], ["custom", [0, 24, 25, 40], 30, 2],
  ["zero threshold", [0, 0, 1, 1], 0, 4],
] as const) test(`leak threshold: ${name}`, async () => fixture((path, db) => {
  const m = machine(), s = session(1, start, 8); waveform(s, C.Leak, values); m.addSession(s); db.saveMachine(m);
  if (threshold !== 24) db.setTherapyAnalysisPreferences(1, { leakThreshold: threshold, showLeakThreshold: false });
  const result = analysis(path);
  assert.equal(result.leak?.threshold, threshold); assert.equal(result.leak?.secondsAboveThreshold, seconds);
  assert.equal(result.leak?.recordedSeconds, 8); assert.equal(result.therapySeconds, 8);
  assert.equal(result.leak?.percentTherapyTimeAboveThreshold, seconds / 8 * 100);
}));

test("night statistics combine samples across sessions and omit mask-off gaps and exclusions", async () => fixture((path, db) => {
  const m = machine(), first = session(1, start, 12), second = session(2, start + 20_000, 4);
  first.addSlice({ start, end: start + 4000, status: SliceStatus.MaskOn });
  first.addSlice({ start: start + 4000, end: start + 8000, status: SliceStatus.MaskOff });
  first.addSlice({ start: start + 8000, end: start + 12_000, status: SliceStatus.MaskOn });
  waveform(first, C.Leak, [0, 30, 999, 999, 24, 40]); waveform(second, C.Leak, [100, 100]);
  second.enabled = false; m.addSession(first); m.addSession(second); db.saveMachine(m);
  let result = analysis(path), leak = result.channels.find(item => item.channelId === C.Leak)!;
  assert.deepEqual([leak.min, leak.percentile50, leak.percentile95, leak.max, leak.average], [0, 24, 40, 40, 23.5]);
  assert.equal(result.therapySeconds, 8); assert.equal(result.leak?.secondsAboveThreshold, 4);
  assert.equal(result.leak?.percentTherapyTimeAboveThreshold, 50);
  db.setSessionEnabled(1, 2, true); result = analysis(path); leak = result.channels.find(item => item.channelId === C.Leak)!;
  assert.equal(result.therapySeconds, 12); assert.equal(result.leak?.secondsAboveThreshold, 8);
  assert.equal(leak.percentile50, 30); assert.equal(leak.percentile95, 100);
  const summary = session(3, start + 30_000, 4); summary.summaryOnly = true; m.addSession(summary); second.enabled = true; db.saveMachine(m);
  result = analysis(path); assert.equal(result.therapySeconds, 16); assert.equal(result.leak?.recordedSeconds, 12);
  assert.equal(result.leak?.percentTherapyTimeAboveThreshold, 50);
  db.setSessionEnabled(1, 1, false); db.setSessionEnabled(1, 2, false);
  result = analysis(path); assert.deepEqual(result.channels, []); assert.equal(result.leak, undefined); assert.equal(result.therapySeconds, 4);
}));

test("elapsed sample weighting handles different rates without averaging session percentiles", async () => fixture((path, db) => {
  const m = machine(), fast = session(1, start, 1), slow = session(2, start + 5000, 4);
  waveform(fast, C.RespRate, [10], 1000); waveform(slow, C.RespRate, [30], 4000);
  m.addSession(fast); m.addSession(slow); db.saveMachine(m);
  const channel = analysis(path).channels[0]!;
  assert.deepEqual([channel.count, channel.recordedSeconds, channel.average, channel.percentile50, channel.percentile95], [2, 5, 26, 30, 30]);
}));

test("Daily graph availability respects split nights, exclusions, missing channels and summary-only sessions", async () => fixture((path, db) => {
  const m = machine(), first = session(1, start, 4), second = session(2, start + 10_000, 4);
  waveform(first, C.RespRate, [12, 14]); waveform(second, C.MinuteVent, [6, 7]);
  m.addSession(first); m.addSession(second); db.saveMachine(m);
  const get = () => { const q = new OscarQueries(path); try { return availableDailyGraphs(q.getDaily(1, date).availableChannels).map(graph => graph.key); } finally { q.close(); } };
  assert.deepEqual(get(), ["respiratory-rate", "minute-ventilation"]);
  db.setSessionEnabled(1, 1, false); assert.deepEqual(get(), ["minute-ventilation"]);
  db.setSessionEnabled(1, 2, false); assert.deepEqual(get(), []);
  second.enabled = true; second.summaryOnly = true; first.enabled = false; db.saveMachine(m);
  assert.deepEqual(get(), []); assert.deepEqual(analysis(path).channels, []);
}));

test("irregular leak samples count only known intervals and unknown units are not interpreted as L/min", async () => fixture((path, db) => {
  const m = machine(), s = session(1, start, 8);
  const leak = s.addEventList(C.Leak, EventListType.Event, { rateMs: 2000, dimension: "L/min" });
  leak.addEvent(start, 30); leak.addEvent(start + 4000, 40); m.addSession(s); db.saveMachine(m);
  let result = analysis(path); assert.equal(result.leak?.secondsAboveThreshold, 4); assert.equal(result.leak?.recordedSeconds, 4); assert.equal(result.leak?.percentTherapyTimeAboveThreshold, 50);
  const sql = new DatabaseSync(path); try { sql.prepare("UPDATE event_lists SET dimension = ? WHERE channel_id = ?").run("unknown", C.Leak); } finally { sql.close(); }
  result = analysis(path); assert.equal(result.leak, undefined);
}));

test("sparse samples never bridge missing intervals and retain recorded zero", async () => fixture((path, db) => {
  const m = machine(), s = session(1, start, 6);
  const sparse = s.addEventList(C.SpO2, EventListType.Event, { rateMs: 1000, gain: 1, offset: 10, dimension: "%" });
  sparse.addEvent(start, 96); sparse.addEvent(start + 1000, 0); sparse.addEvent(start + 4000, 90);
  m.addSession(s); db.saveMachine(m);
  const channel = analysis(path).channels[0]!;
  assert.deepEqual([channel.min, channel.max, channel.percentile50, channel.recordedSeconds], [0, 96, 90, 3]);
  assert.equal(channel.average, 62); // Event-list offset is deliberately ignored by the model.
}));

test("analysis clips sample cells at noon and isolates machines, missing channels and summary-only nights", async () => fixture((path, db) => {
  const range = therapyDayRange(date), m = machine(), s = session(1, range.startMs - 1000, 4);
  waveform(s, C.Leak, [30, 0]); m.addSession(s);
  waveform(s, C.RespRate, [15], 1000); // Ends exactly at this therapy day's noon boundary.
  const last = session(2, range.endMs - 1000, 4); waveform(last, C.Leak, [0, 100]); m.addSession(last); db.saveMachine(m);
  const other = machine(2), otherSession = session(3, start, 10); waveform(otherSession, C.Leak, [999, 999, 999, 999, 999]); other.addSession(otherSession); db.saveMachine(other);
  const result = analysis(path);
  const availability = new OscarQueries(path);
  try { assert.equal(availability.getDaily(1, date).availableChannels.includes(C.RespRate), false); } finally { availability.close(); }
  assert.equal(result.therapySeconds, 4); assert.equal(result.leak?.recordedSeconds, 4); assert.equal(result.leak?.secondsAboveThreshold, 1);
  assert.equal(result.leak?.percentTherapyTimeAboveThreshold, 25); assert.equal(result.channels[0]?.max, 30);
  db.setSessionEnabled(1, 1, false); db.setSessionEnabled(1, 2, false);
  assert.deepEqual(analysis(path).channels, []);
  const queries = new OscarQueries(path); try { assert.equal(queries.getDailyChannelAnalysis(1, "2026-10-07").leak, undefined); } finally { queries.close(); }
}));

test("statistics and leak duration are independent of waveform chunk size; query paths use existing indexes", async () => fixture((path, db) => {
  const m = machine(), s = session(1, start, 70), raw = Int16Array.from({ length: 70 }, (_, i) => i % 40);
  waveform(s, C.Leak, [...raw], 1000); m.addSession(s); db.saveMachine(m);
  const before = analysis(path), sql = new DatabaseSync(path);
  try {
    const id = Number(sql.prepare("SELECT id FROM event_lists WHERE channel_id = ?").get(C.Leak).id);
    sql.prepare("DELETE FROM waveform_chunks WHERE event_list_id = ?").run(id);
    for (let index = 0; index < raw.length; index += 3) {
      const part = raw.slice(index, index + 3);
      sql.prepare(`INSERT INTO waveform_chunks(event_list_id, chunk_index, start_sample, sample_count, start_ms, end_ms, min_raw, max_raw, raw_blob) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, Math.floor(index / 3), index, part.length, start + index * 1000, start + (index + part.length) * 1000, Math.min(...part), Math.max(...part), new Uint8Array(part.buffer));
    }
    assert.deepEqual(analysis(path), before);
    const plans = [
      sql.prepare("EXPLAIN QUERY PLAN SELECT * FROM event_lists WHERE session_row_id = ? AND channel_id IN (?, ?) ORDER BY channel_id, first_ms, list_index").all(1, C.Leak, C.RespRate),
      sql.prepare("EXPLAIN QUERY PLAN SELECT * FROM waveform_chunks WHERE event_list_id = ? AND end_ms > ? AND start_ms < ? ORDER BY start_sample").all(id, start, start + 70_000),
    ];
    for (const plan of plans) assert.ok(plan.some((row: { detail: string }) => row.detail.includes("SEARCH") && row.detail.includes("INDEX")));
  } finally { sql.close(); }
}));

test("schema v6 migration preserves layouts, disabled sessions and BLOBs; visibility and analysis preferences round-trip", async () => fixture((path, db) => {
  const m = machine(), s = session(1, start, 8); waveform(s, C.Leak, [0, 24, 30, 40]); s.enabled = false; m.addSession(s); db.saveMachine(m);
  db.setGraphPinned(1, "flow", true); db.setGraphHeight(1, "flow", 300); db.setGraphOrder(1, ["leak", "flow"]);
  db.createGraphBookmark(1, date, "Synthetic view", start, start + 4000);
  const layout = db.getGraphPreferences(1), sql = new DatabaseSync(path);
  const blobs = sql.prepare("SELECT raw_blob FROM waveform_chunks ORDER BY event_list_id, chunk_index").all();
  sql.exec("ALTER TABLE graph_preferences DROP COLUMN visible; UPDATE schema_version SET version = 6;"); sql.close();
  const reopened = new OscarDatabase(path);
  try {
    assert.equal(reopened.schemaVersion, SCHEMA_VERSION); assert.deepEqual(reopened.getGraphPreferences(1), layout);
    assert.equal(reopened.loadMachine(1)?.session(1)?.enabled, false); assert.equal(reopened.listGraphBookmarks(1, date).length, 1);
    assert.deepEqual(reopened.getTherapyAnalysisPreferences(1), { leakThreshold: 24, showLeakThreshold: true });
    reopened.setGraphVisibility(1, { flow: false, leak: true }); reopened.setTherapyAnalysisPreferences(1, { leakThreshold: 31.5, showLeakThreshold: false });
    assert.throws(() => reopened.setGraphVisibility(1, { flow: "bad" } as unknown as Record<string, boolean>));
    for (const value of [-1, NaN, Infinity, 1001]) assert.throws(() => reopened.setTherapyAnalysisPreferences(1, { leakThreshold: value, showLeakThreshold: true }));
  } finally { reopened.close(); }
  const again = new OscarDatabase(path);
  try { assert.equal(again.getGraphPreferences(1).find(item => item.key === "flow")?.visible, false); assert.deepEqual(again.getTherapyAnalysisPreferences(1), { leakThreshold: 31.5, showLeakThreshold: false }); assert.deepEqual(again.getTherapyAnalysisPreferences(2), { leakThreshold: 24, showLeakThreshold: true }); } finally { again.close(); }
  const check = new DatabaseSync(path); try { assert.deepEqual(check.prepare("SELECT raw_blob FROM waveform_chunks ORDER BY event_list_id, chunk_index").all(), blobs); assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(), []); } finally { check.close(); }
}));
