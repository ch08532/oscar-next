import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "../src/core/machine.js";
import { Session, SliceStatus } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";
import { OscarDatabase } from "../src/storage/database.js";
import { OscarQueries } from "../src/storage/queries.js";

function session(id: number, first: string, last: string): Session {
  const value = new Session(id, MachineType.CPAP);
  value.setBounds(Date.parse(first), Date.parse(last));
  return value;
}

async function withHistory(run: (queries: OscarQueries, path: string) => void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "oscar-history-"));
  const path = join(root, "synthetic.sqlite");
  try {
    const machine = new Machine(1, { type: MachineType.CPAP, brand: "Synthetic", model: "Test", serial: "SYNTHETIC" });
    const split = session(1, "2026-10-01T22:00:00Z", "2026-10-02T06:00:00Z");
    split.addSlice({ start: Date.parse("2026-10-01T22:00:00Z"), end: Date.parse("2026-10-02T00:00:00Z"), status: SliceStatus.MaskOn });
    split.addSlice({ start: Date.parse("2026-10-02T00:00:00Z"), end: Date.parse("2026-10-02T02:00:00Z"), status: SliceStatus.MaskOff });
    split.addSlice({ start: Date.parse("2026-10-02T02:00:00Z"), end: Date.parse("2026-10-02T06:00:00Z"), status: SliceStatus.MaskOn });
    machine.addSession(split);
    // Summary-only nights still count without detailed events or waveforms.
    const summary = session(2, "2026-10-02T22:00:00Z", "2026-10-03T06:00:00Z");
    summary.summaryOnly = true;
    machine.addSession(summary);
    // A session spanning noon is counted in both days, including the exact end boundary.
    machine.addSession(session(3, "2026-10-04T10:00:00Z", "2026-10-05T12:00:00Z"));
    const disabled = session(4, "2026-10-06T22:00:00Z", "2026-10-07T06:00:00Z");
    disabled.enabled = false;
    machine.addSession(disabled);
    const fallback = session(5, "2026-10-07T22:00:00Z", "2026-10-08T06:00:00Z");
    fallback.addSlice({ start: fallback.first, end: fallback.last, status: SliceStatus.MaskOff });
    machine.addSession(fallback);
    const another = new Machine(2, { type: MachineType.CPAP, brand: "Synthetic", model: "Other", serial: "SYNTHETIC-OTHER" });
    another.addSession(session(6, "2026-10-01T22:00:00Z", "2026-10-02T06:00:00Z"));
    const db = new OscarDatabase(path);
    try { db.saveMachine(machine); db.saveMachine(another); } finally { db.close(); }
    const queries = new OscarQueries(path);
    try { run(queries, path); } finally { queries.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("lightweight history matches Overview availability and usage for split, summary-only and disabled sessions", async () => {
  await withHistory((queries) => {
    const history = queries.getTherapyHistory(1, "2026-10-01", "2026-10-08");
    const expected = queries.getOverview(1, "2026-10-01", "2026-10-08").map(({ date, sessionCount, usageHours }) => ({ date, sessionCount, usageHours }));
    assert.deepEqual(history, expected);
    assert.deepEqual(history.map((day) => day.usageHours), [6, 8, 2, 24, 0, 0, 8, 0]);
    assert.deepEqual(history.map((day) => day.sessionCount), [1, 1, 1, 1, 1, 0, 1, 0]);
  });
});

test("history clips usage at requested bounds and excludes other machines", async () => {
  await withHistory((queries) => {
    assert.deepEqual(queries.getTherapyHistory(1, "2026-10-01", "2026-10-01"), [{ date: "2026-10-01", sessionCount: 1, usageHours: 6 }]);
    assert.deepEqual(queries.getTherapyHistory(1, "2026-10-04", "2026-10-04"), [{ date: "2026-10-04", sessionCount: 1, usageHours: 24 }]);
    assert.deepEqual(queries.getTherapyHistory(1, "2026-10-05", "2026-10-05"), [{ date: "2026-10-05", sessionCount: 1, usageHours: 0 }]);
  });
});

test("history does not depend on event, waveform or settings tables", async () => {
  await withHistory((queries, path) => {
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA foreign_keys = OFF; DROP TABLE event_lists; DROP TABLE waveform_chunks; DROP TABLE session_settings;");
    } finally { db.close(); }
    assert.equal(queries.getTherapyHistory(1, "2026-10-01", "2026-10-08").length, 8);
    assert.throws(() => queries.getOverview(1, "2026-10-01", "2026-10-01"));
  });
});

test("history retains empty days for an unknown machine and leap-day ranges", async () => {
  await withHistory((queries) => {
    assert.deepEqual(queries.getTherapyHistory(999, "2024-02-28", "2024-03-01"), [
      { date: "2024-02-28", sessionCount: 0, usageHours: 0 },
      { date: "2024-02-29", sessionCount: 0, usageHours: 0 },
      { date: "2024-03-01", sessionCount: 0, usageHours: 0 },
    ]);
  });
});

test("history respects custom rollover hours", async () => {
  await withHistory((_queries, path) => {
    const queries = new OscarQueries(path, { rolloverHour: 0 });
    try {
      assert.deepEqual(queries.getTherapyHistory(1, "2026-10-01", "2026-10-08"), queries.getOverview(1, "2026-10-01", "2026-10-08").map(({ date, sessionCount, usageHours }) => ({ date, sessionCount, usageHours })));
    } finally { queries.close(); }
  });
});

test("history rejects malformed, nonexistent and reversed dates", async () => {
  await withHistory((queries) => {
    assert.throws(() => queries.getTherapyHistory(1, "2026-10-02", "2026-10-01"), /endDate/);
    assert.throws(() => queries.getTherapyHistory(1, "invalid", "2026-10-01"), /Invalid therapy date/);
    assert.throws(() => queries.getTherapyHistory(1, "2026-02-29", "2026-03-01"), /Invalid therapy date/);
  });
});
