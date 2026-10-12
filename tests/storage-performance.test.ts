import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "../src/core/machine.js";
import { Session } from "../src/core/session.js";
import { EventListType } from "../src/core/event-list.js";
import { MachineType } from "../src/core/types.js";
import { CpapChannel as C } from "../src/core/cpap-channels.js";
import { OscarDatabase, SCHEMA_VERSION } from "../src/storage/database.js";
import { OscarQueries } from "../src/storage/queries.js";

test("schema v5 upgrades index metadata without changing therapy or user state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oscar-index-migration-"));
  const path = join(directory, "synthetic.sqlite");
  let db: OscarDatabase | undefined;
  let sql: DatabaseSync | undefined;
  try {
    db = new OscarDatabase(path);
    const profile = db.createProfile("Synthetic migration", "America/Toronto");
    db.setActiveProfile(profile.id);
    const start = Date.parse("2026-10-09T22:00:00Z");
    for (const machineId of [1, 2]) {
      const machine = new Machine(machineId, { type: MachineType.CPAP, brand: "Synthetic", serial: `MIGRATION-${machineId}` });
      machine.properties.set("synthetic", "yes");
      const session = new Session(1, MachineType.CPAP); // Public IDs may repeat across machines.
      session.setBounds(start, start + 120_000);
      session.addSlice({ start, end: start + 120_000, status: 2 });
      session.settings.set(1004, 14);
      session.addEventList(C.FlowRate, EventListType.Waveform, { rateMs: 40 }).addWaveform(start, new Int16Array(3000).fill(12), 120_000);
      session.addEventList(C.ObstructiveApnea, EventListType.Event, { secondField: true }).addEvent(start + 60_000, 1, 10);
      machine.addSession(session);
      db.saveMachine(machine, { profileId: profile.id });
    }
    db.setSessionEnabled(1, 1, false);
    db.setGraphPinned(1, "flow", true);
    db.setGraphHeight(1, "flow", 280);
    db.createGraphBookmark(1, "2026-10-09", "Synthetic view", start, start + 60_000);
    db.setMachineTimeZone(1, "Europe/Oslo");
    db.close(); db = undefined;
    sql = new DatabaseSync(path);
    // v6 changes only index metadata, so restoring this index and version
    // recreates the complete v5 schema, including its original constraints.
    sql.exec("CREATE INDEX idx_event_lists_session_channel ON event_lists(session_row_id, channel_id); UPDATE schema_version SET version=5;");
    const tables = ["profiles", "app_settings", "machines", "machine_properties", "sessions", "session_settings", "session_slices", "event_lists", "waveform_chunks", "graph_preferences", "graph_bookmarks"];
    const snapshot = () => tables.map(table => sql!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot();
    sql.close(); sql = undefined;

    for (let reopen = 0; reopen < 2; reopen++) {
      db = new OscarDatabase(path);
      assert.equal(SCHEMA_VERSION, 6);
      assert.equal(db.schemaVersion, 6);
      assert.equal(db.loadMachine(1)?.session(1)?.enabled, false);
      assert.equal(db.loadMachine(2)?.session(1)?.enabled, true);
      assert.deepEqual([...db.loadMachine(1)!.session(1)!.eventLists.get(C.FlowRate)![0]!.rawData()], new Array(3000).fill(12));
      assert.equal(db.getGraphPreferences(1)[0]?.height, 280);
      assert.equal(db.listGraphBookmarks(1, "2026-10-09").length, 1);
      db.close(); db = undefined;
      sql = new DatabaseSync(path);
      assert.deepEqual(snapshot(), before, "migration and repeated opens must preserve every stored row and BLOB");
      assert.equal(sql.prepare("SELECT name FROM sqlite_schema WHERE name='idx_event_lists_session_channel'").get(), undefined);
      const unique = sql.prepare("PRAGMA index_list(event_lists)").all().find((index: { unique: number }) => index.unique === 1);
      assert.ok(unique, "event-list uniqueness must remain enforced");
      assert.deepEqual(sql.prepare(`PRAGMA index_info(${unique.name})`).all().map((column: { name: string }) => column.name), ["session_row_id", "channel_id", "list_index"]);
      const plan = sql.prepare("EXPLAIN QUERY PLAN SELECT * FROM event_lists WHERE session_row_id=? AND channel_id=? ORDER BY list_index").all(1, C.ObstructiveApnea);
      assert.ok(plan.some((row: { detail: string }) => row.detail.includes("SEARCH event_lists USING INDEX") && row.detail.includes("channel_id=?")));
      assert.equal(sql.prepare("PRAGMA foreign_key_check").all().length, 0);
      sql.close(); sql = undefined;
    }
  } finally {
    sql?.close(); db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Daily and selected-channel charts do not read unrelated event payloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oscar-payload-reads-"));
  const path = join(directory, "synthetic.sqlite");
  const originalPrepare = DatabaseSync.prototype.prepare;
  let queries: OscarQueries | undefined;
  try {
    const start = Date.parse("2026-10-09T22:00:00Z");
    const machine = new Machine(1, { type: MachineType.CPAP, brand: "Synthetic", serial: "PAYLOAD-TEST" });
    const session = new Session(1, MachineType.CPAP);
    session.setBounds(start, start + 3_600_000);
    const oa = session.addEventList(C.ObstructiveApnea, EventListType.Event, { secondField: true });
    oa.addEvent(start, 1, 10);
    oa.addEvent(start + 60_000, 1, 20);
    const unrelated = session.addEventList(C.RespRate, EventListType.Event);
    for (let index = 0; index < 10_000; index++) unrelated.addEvent(start + index * 100, index % 20);
    const flow = session.addEventList(C.FlowRate, EventListType.Waveform, { rateMs: 40 });
    flow.addWaveform(start, new Int16Array(15_000).fill(7), 600_000);
    machine.addSession(session);
    const db = new OscarDatabase(path);
    try { db.saveMachine(machine); } finally { db.close(); }

    // Count bytes actually returned across the SQLite/JS boundary, rather than
    // asserting a fragile elapsed-time target or a particular SQL spelling.
    let payloadBytes = 0;
    DatabaseSync.prototype.prepare = function (query: string) {
      const statement = originalPrepare.call(this, query);
      const originalAll = statement.all.bind(statement);
      statement.all = (...args: unknown[]) => {
        const rows = originalAll(...args);
        for (const row of rows) {
          for (const value of Object.values(row)) if (value instanceof Uint8Array) payloadBytes += value.byteLength;
        }
        return rows;
      };
      return statement;
    };
    queries = new OscarQueries(path);
    const daily = queries.getDaily(1, "2026-10-09");
    assert.equal(daily.eventCounts.obstructive, 2);
    assert.equal(daily.ahi, 2);
    assert.ok(daily.availableChannels.includes(C.RespRate), "available-channel metadata must remain complete");
    assert.ok(payloadBytes < 4096, `Daily read ${payloadBytes} payload bytes for two counted events`);

    payloadBytes = 0;
    const events = queries.getChartSeries(1, "2026-10-09", [C.ObstructiveApnea]);
    assert.deepEqual([...events.series[0]!.timesMs], [start, start + 60_000]);
    assert.deepEqual([...events.series[0]!.values2!], [10, 20]);
    assert.ok(payloadBytes < 4096, "event-only chart must not read unrelated channels");

    payloadBytes = 0;
    assert.deepEqual(queries.getChartSeries(1, "2026-10-09", []).series, []);
    assert.equal(payloadBytes, 0, "an empty channel selection must not read event or waveform payloads");

    payloadBytes = 0;
    const window = queries.getChartSeries(1, "2026-10-09", [C.FlowRate], { startMs: start + 300_000, endMs: start + 360_000, maxPointsPerSeries: 2000 });
    assert.equal(window.series[0]!.sourcePointCount, 1500);
    assert.equal(window.series[0]!.values[0], 7);
    assert.equal(payloadBytes, 3000, "a minute window should read exactly its overlapping waveform chunk");
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    queries?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("event windows preserve noon boundaries, list ordering, and disabled sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oscar-event-window-"));
  const path = join(directory, "synthetic.sqlite");
  let queries: OscarQueries | undefined;
  try {
    const noon = Date.parse("2026-10-09T12:00:00Z");
    const machine = new Machine(2, { type: MachineType.CPAP, brand: "Synthetic", serial: "BOUNDARY-TEST" });
    const session = new Session(1, MachineType.CPAP);
    session.setBounds(noon - 60_000, noon + 86_400_000 + 60_000);
    const oa = session.addEventList(C.ObstructiveApnea, EventListType.Event, { secondField: true });
    for (const offset of [-1, 0, 600_000, 86_400_000]) oa.addEvent(noon + offset, 1, 10);
    const second = session.addEventList(C.ObstructiveApnea, EventListType.Event, { secondField: true });
    second.addEvent(noon + 300_000, 2, 15);
    const ca = session.addEventList(C.ClearAirway, EventListType.Event);
    ca.addEvent(noon + 200_000, 1);
    machine.addSession(session);
    const disabled = new Session(2, MachineType.CPAP);
    disabled.setBounds(noon, noon + 600_000);
    disabled.enabled = false;
    disabled.addEventList(C.ObstructiveApnea, EventListType.Event).addEvent(noon + 100_000, 1);
    machine.addSession(disabled);
    const db = new OscarDatabase(path);
    try { db.saveMachine(machine); } finally { db.close(); }
    queries = new OscarQueries(path);
    assert.equal(queries.getDaily(2, "2026-10-08").eventCounts.obstructive, 1);
    assert.equal(queries.getDaily(2, "2026-10-09").eventCounts.obstructive, 3);
    assert.equal(queries.getDaily(2, "2026-10-10").eventCounts.obstructive, 1);
    const window = queries.getChartSeries(2, "2026-10-09", [C.ObstructiveApnea, C.ObstructiveApnea], { startMs: noon, endMs: noon + 600_000 });
    assert.deepEqual(window.series.map(series => [...series.timesMs]), [[noon], [noon + 300_000]]);
    assert.deepEqual(window.series.map(series => series.listIndex), [0, 1]);
    assert.ok(window.series.every(series => !series.decimated));
    assert.deepEqual(queries.getChartSeries(2, "2026-10-09", [999999]).series, []);
  } finally {
    queries?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
