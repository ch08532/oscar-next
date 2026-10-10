import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "../src/core/machine.js";
import { Session, SliceStatus } from "../src/core/session.js";
import { EventListType } from "../src/core/event-list.js";
import { CpapChannel } from "../src/core/cpap-channels.js";
import { CpapSetting } from "../src/core/cpap-settings.js";
import { CPAPMode, MachineType } from "../src/core/types.js";
import { OscarDatabase, SCHEMA_VERSION } from "../src/storage/database.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to be defined");
  return value;
}

test("SQLite storage round-trips machine, session, settings, slices and event lists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-db-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(42, {
      type: MachineType.CPAP,
      capabilities: 7,
      loaderName: "ResMed",
      brand: "ResMed",
      model: "AirSense 11 AutoSet",
      modelNumber: "39000",
      serial: "TEST123",
      series: "AirSense 11",
      lastImported: new Date("2026-10-09T12:00:00Z"),
      version: 1,
    });
    machine.properties.set("sourcePath", "E:\\");
    machine.untested = true;

    const session = new Session(1001, MachineType.CPAP);
    const first = Date.parse("2026-10-09T22:15:00Z");
    const last = Date.parse("2026-10-10T05:45:00Z");
    session.setBounds(first, last);
    session.addSlice({ start: first, end: last, status: SliceStatus.MaskOn });
    session.settings.set(CpapSetting.Mode, CPAPMode.APAP);
    session.settings.set(CpapSetting.PressureMin, 6);
    session.settings.set(CpapSetting.PressureMax, 14);
    session.settings.set(CpapSetting.RampEnabled, true);
    session.settings.set(9999, new Date("2026-10-09T22:15:00Z"));
    session.settings.set(9998, null);

    const flow = session.addEventList(CpapChannel.FlowRate, EventListType.Waveform, {
      gain: 0.1,
      offset: -1,
      rateMs: 40,
      dimension: "L/min",
    });
    flow.addWaveform(first, Int16Array.from([10, 20, -30, 40]), 160);

    const oa = session.addEventList(CpapChannel.ObstructiveApnea, EventListType.Event, {
      gain: 1,
      secondField: true,
      dimension: "event",
    });
    oa.addEvent(first + 60_000, 1, 10);
    oa.addEvent(first + 120_000, 2, 12);

    machine.addSession(session);

    const db = new OscarDatabase(path);
    assert.equal(db.schemaVersion, SCHEMA_VERSION);
    db.saveMachine(machine);

    const summaries = db.listMachines();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.sessionCount, 1);
    assert.equal(summaries[0]?.brand, "ResMed");

    const loaded = must(db.loadMachine(42));
    assert.equal(loaded.info.model, machine.info.model);
    assert.equal(loaded.info.lastImported?.toISOString(), machine.info.lastImported?.toISOString());
    assert.equal(loaded.properties.get("sourcePath"), "E:\\");
    assert.equal(loaded.untested, true);

    const loadedSession = must(loaded.session(1001));
    assert.equal(loadedSession.first, first);
    assert.equal(loadedSession.last, last);
    assert.equal(loadedSession.hours(), 7.5);
    assert.equal(loadedSession.settings.get(CpapSetting.Mode), CPAPMode.APAP);
    assert.equal(loadedSession.settings.get(CpapSetting.PressureMin), 6);
    assert.equal(loadedSession.settings.get(CpapSetting.RampEnabled), true);
    assert.equal((loadedSession.settings.get(9999) as Date).toISOString(), "2026-10-09T22:15:00.000Z");
    assert.equal(loadedSession.settings.get(9998), null);

    const loadedFlow = must(loadedSession.eventLists.get(CpapChannel.FlowRate)?.[0]);
    assert.equal(loadedFlow.type, EventListType.Waveform);
    assert.deepEqual([...loadedFlow.rawData()], [10, 20, -30, 40]);
    assert.equal(loadedFlow.gain, 0.1);
    assert.equal(loadedFlow.offset, -1);
    assert.equal(loadedFlow.rateMs, 40);
    assert.equal(loadedFlow.first, first);
    assert.equal(loadedFlow.duration, 160);

    const loadedOa = must(loadedSession.eventLists.get(CpapChannel.ObstructiveApnea)?.[0]);
    assert.deepEqual([...loadedOa.rawData()], [1, 2]);
    assert.deepEqual([...loadedOa.rawData2()], [10, 12]);
    assert.deepEqual([...loadedOa.timeDeltas()], [0, 60_000]);
    assert.equal(loadedOa.time(0), first + 60_000);
    assert.equal(loadedOa.time(1), first + 120_000);

    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("saving a machine twice replaces stale session snapshot instead of duplicating data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-db-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(1, { type: MachineType.CPAP, brand: "ResMed", serial: "ABC" });
    const session = new Session(10, MachineType.CPAP);
    session.setBounds(1000, 2000);
    machine.addSession(session);

    const db = new OscarDatabase(path);
    db.saveMachine(machine);
    session.settings.set(CpapSetting.SetPressure, 10);
    db.saveMachine(machine);

    assert.equal(db.listMachines()[0]?.sessionCount, 1);
    const loaded = db.loadMachine(1);
    assert.equal(loaded?.session(10)?.settings.get(CpapSetting.SetPressure), 10);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("waveform samples are stored in chunks and legacy v1 blobs migrate to schema v2", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-chunks-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(77, { type: MachineType.CPAP, brand: "ResMed", serial: "CHUNK77" });
    const session = new Session(700, MachineType.CPAP);
    const first = Date.parse("2026-10-09T22:00:00Z");
    session.setBounds(first, first + 130_000);
    const flow = session.addEventList(CpapChannel.FlowRate, EventListType.Waveform, { gain: 0.1, rateMs: 40, dimension: "L/min" });
    const samples = Int16Array.from({ length: 3250 }, (_, index) => (index % 200) - 100);
    flow.addWaveform(first, samples, samples.length * 40);
    machine.addSession(session);

    let db = new OscarDatabase(path);
    db.saveMachine(machine);
    db.close();

    let sql = new DatabaseSync(path);
    const chunks = sql.prepare("SELECT COUNT(*) AS count FROM waveform_chunks").get() as { count: number };
    assert.equal(chunks.count, 3);
    const stored = sql.prepare("SELECT id, raw_blob FROM event_lists WHERE list_type = 'waveform'").get() as { id: number; raw_blob: Uint8Array };
    assert.equal(stored.raw_blob.length, 0);

    // Simulate a v1 database by moving the chunk payload back into event_lists.
    const parts = sql.prepare("SELECT raw_blob FROM waveform_chunks WHERE event_list_id = ? ORDER BY chunk_index").all(stored.id) as Array<{ raw_blob: Uint8Array }>;
    const legacyBytes = new Uint8Array(parts.reduce((sum, part) => sum + part.raw_blob.length, 0));
    let offset = 0;
    for (const part of parts) { legacyBytes.set(part.raw_blob, offset); offset += part.raw_blob.length; }
    sql.prepare("UPDATE event_lists SET raw_blob = ? WHERE id = ?").run(legacyBytes, stored.id);
    sql.prepare("DELETE FROM waveform_chunks").run();
    sql.prepare("UPDATE schema_version SET version = 1").run();
    sql.close();

    db = new OscarDatabase(path);
    assert.equal(db.schemaVersion, SCHEMA_VERSION);
    const migrated = must(db.loadMachine(77));
    assert.deepEqual([...must(migrated.session(700)?.eventLists.get(CpapChannel.FlowRate)?.[0]).rawData()], [...samples]);
    db.close();

    sql = new DatabaseSync(path, { readOnly: true });
    const migratedChunks = sql.prepare("SELECT COUNT(*) AS count FROM waveform_chunks").get() as { count: number };
    const migratedBlob = sql.prepare("SELECT raw_blob FROM event_lists WHERE id = ?").get(stored.id) as { raw_blob: Uint8Array };
    assert.equal(migratedChunks.count, 3);
    assert.equal(migratedBlob.raw_blob.length, 0);
    sql.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("session inclusion and graph pin preferences persist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-user-state-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(88, { type: MachineType.CPAP, brand: "ResMed", serial: "STATE88" });
    const session = new Session(880, MachineType.CPAP);
    session.setBounds(1_000, 61_000);
    machine.addSession(session);

    let db = new OscarDatabase(path);
    db.saveMachine(machine);
    db.setSessionEnabled(88, 880, false);
    db.setGraphPinned(88, "flow", true);
    db.setGraphPinned(88, "leak", false);
    db.close();

    db = new OscarDatabase(path);
    assert.equal(db.loadMachine(88)?.session(880)?.enabled, false);
    assert.deepEqual(db.getGraphPreferences(88), [
      { key: "flow", pinned: true, sortOrder: 0 },
      { key: "leak", pinned: false, sortOrder: 1 },
    ]);
    db.setGraphPinned(88, "flow", false);
    assert.deepEqual(db.getGraphPreferences(88), [
      { key: "flow", pinned: false, sortOrder: 0 },
      { key: "leak", pinned: false, sortOrder: 1 },
    ]);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("schema v3 graph preferences migrate onto an existing v2 database", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-v3-migrate-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(89, { type: MachineType.CPAP, brand: "ResMed", serial: "MIGRATE89" });
    let db = new OscarDatabase(path);
    db.saveMachine(machine);
    db.close();

    const sql = new DatabaseSync(path);
    sql.prepare("DROP TABLE graph_preferences").run();
    sql.prepare("UPDATE schema_version SET version = 2").run();
    sql.close();

    db = new OscarDatabase(path);
    assert.equal(db.schemaVersion, SCHEMA_VERSION);
    db.setGraphPinned(89, "events", true);
    assert.equal(db.getGraphPreferences(89)[0]?.key, "events");
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("graph layout order, height, and bookmarks persist in schema v4", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-layout-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(90, { type: MachineType.CPAP, brand: "ResMed", serial: "LAYOUT90" });
    const db = new OscarDatabase(path);
    db.saveMachine(machine);

    db.setGraphPinned(90, "flow", true);
    db.setGraphHeight(90, "flow", 287.4);
    db.setGraphHeight(90, "leak", 40); // clamped to minimum
    db.setGraphOrder(90, ["leak", "flow", "pressure"]);

    const preferences = db.getGraphPreferences(90);
    assert.equal(preferences.find((item) => item.key === "flow")?.height, 287);
    assert.equal(preferences.find((item) => item.key === "leak")?.height, 100);
    assert.equal(preferences.find((item) => item.key === "leak")?.sortOrder, 0);
    assert.equal(preferences.find((item) => item.key === "flow")?.sortOrder, 1);

    const first = db.createGraphBookmark(90, "2026-10-09", "Before OA cluster", 10_000, 20_000);
    const second = db.createGraphBookmark(90, "2026-10-09", "After OA cluster", 30_000, 42_000);
    db.createGraphBookmark(90, "2026-10-10", "Other night", 50_000, 60_000);
    assert.deepEqual(db.listGraphBookmarks(90, "2026-10-09").map((item) => item.name), ["Before OA cluster", "After OA cluster"]);
    db.deleteGraphBookmark(90, first.id);
    assert.deepEqual(db.listGraphBookmarks(90, "2026-10-09").map((item) => item.id), [second.id]);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("schema v4 adds graph height and bookmark storage to a v3 database", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-v4-migrate-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(91, { type: MachineType.CPAP, brand: "ResMed", serial: "MIGRATE91" });
    let db = new OscarDatabase(path);
    db.saveMachine(machine);
    db.setGraphPinned(91, "events", true);
    db.close();

    const sql = new DatabaseSync(path);
    sql.prepare("DROP TABLE graph_bookmarks").run();
    // Recreate the old v3 graph_preferences shape without the height column.
    sql.exec(`
      ALTER TABLE graph_preferences RENAME TO graph_preferences_v4;
      CREATE TABLE graph_preferences (
        machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
        graph_key TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(machine_id, graph_key)
      );
      INSERT INTO graph_preferences(machine_id, graph_key, pinned, sort_order)
        SELECT machine_id, graph_key, pinned, sort_order FROM graph_preferences_v4;
      DROP TABLE graph_preferences_v4;
      UPDATE schema_version SET version = 3;
    `);
    sql.close();

    db = new OscarDatabase(path);
    assert.equal(db.schemaVersion, SCHEMA_VERSION);
    db.setGraphHeight(91, "events", 175);
    assert.equal(db.getGraphPreferences(91)[0]?.height, 175);
    const bookmark = db.createGraphBookmark(91, "2026-10-09", "Test", 100, 200);
    assert.equal(db.listGraphBookmarks(91, "2026-10-09")[0]?.id, bookmark.id);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("profiles isolate machines and profile timezone follows machines unless overridden", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-profiles-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const db = new OscarDatabase(path);
    const chris = db.createProfile("Chris", "America/Toronto");
    const travel = db.createProfile("Travel", "Europe/Oslo");
    db.setActiveProfile(chris.id);

    const machine = new Machine(501, { type: MachineType.CPAP, brand: "ResMed", serial: "PROFILE501" });
    db.saveMachine(machine, { profileId: chris.id });
    assert.equal(db.listMachines(chris.id).length, 1);
    assert.equal(db.listMachines(travel.id).length, 0);
    assert.deepEqual(db.getMachineTimeSettings(501), {
      machineId: 501,
      profileId: chris.id,
      deviceTimeZone: "America/Toronto",
      source: "profile",
    });

    db.updateProfile(chris.id, { timeZone: "America/Vancouver" });
    assert.equal(db.getMachineTimeSettings(501).deviceTimeZone, "America/Vancouver");

    db.setMachineTimeZone(501, "America/Toronto");
    db.updateProfile(chris.id, { timeZone: "Europe/London" });
    assert.equal(db.getMachineTimeSettings(501).deviceTimeZone, "America/Toronto");
    assert.equal(db.getMachineTimeSettings(501).source, "manual");

    db.moveMachineToProfile(501, travel.id);
    assert.equal(db.getMachineTimeSettings(501).profileId, travel.id);
    assert.equal(db.getMachineTimeSettings(501).deviceTimeZone, "America/Toronto");
    db.setMachineTimeZone(501); // back to profile time
    assert.equal(db.getMachineTimeSettings(501).deviceTimeZone, "Europe/Oslo");
    assert.equal(db.getMachineTimeSettings(501).source, "profile");
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("schema v5 migrates existing machines into a default profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-v5-migrate-"));
  const path = join(dir, "oscar.sqlite");
  try {
    let db = new OscarDatabase(path);
    const machine = new Machine(502, { type: MachineType.CPAP, brand: "ResMed", serial: "MIGRATE502" });
    db.saveMachine(machine);
    db.close();

    const sql = new DatabaseSync(path);
    sql.prepare("UPDATE schema_version SET version = 4").run();
    // Rebuild machines without v5 columns to accurately simulate a v4 database.
    sql.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE machines RENAME TO machines_v5;
      CREATE TABLE machines (
        id INTEGER PRIMARY KEY, machine_type INTEGER NOT NULL, capabilities INTEGER NOT NULL,
        loader_name TEXT NOT NULL, brand TEXT NOT NULL, model TEXT NOT NULL, model_number TEXT NOT NULL,
        serial TEXT NOT NULL, series TEXT NOT NULL, last_imported_ms INTEGER, info_version INTEGER NOT NULL,
        unsupported INTEGER NOT NULL DEFAULT 0, untested INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO machines (id, machine_type, capabilities, loader_name, brand, model, model_number, serial, series, last_imported_ms, info_version, unsupported, untested)
      SELECT id, machine_type, capabilities, loader_name, brand, model, model_number, serial, series, last_imported_ms, info_version, unsupported, untested FROM machines_v5;
      DROP TABLE machines_v5;
      DELETE FROM profiles;
      DELETE FROM app_settings;
      PRAGMA foreign_keys = ON;
    `);
    sql.close();

    db = new OscarDatabase(path);
    assert.equal(db.schemaVersion, SCHEMA_VERSION);
    assert.equal(db.listProfiles().length, 1);
    const summary = db.listMachines()[0];
    assert.equal(summary?.profileId, db.getActiveProfile()?.id);
    assert.ok(summary?.deviceTimeZone);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
