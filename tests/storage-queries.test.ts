import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Machine } from "../src/core/machine.js";
import { Session, SliceStatus } from "../src/core/session.js";
import { EventListType } from "../src/core/event-list.js";
import { CpapChannel } from "../src/core/cpap-channels.js";
import { CpapSetting } from "../src/core/cpap-settings.js";
import { CPAPMode, MachineType } from "../src/core/types.js";
import { OscarDatabase } from "../src/storage/database.js";
import { OscarQueries, therapyDateForTimestamp, therapyDayRange } from "../src/storage/queries.js";

function addNight(machine: Machine, id: number, first: number, last: number, events: { oa: number; ca: number; h: number; rera: number }, pressure: number[], leak: number[]): void {
  const session = new Session(id, MachineType.CPAP);
  session.setBounds(first, last);
  session.addSlice({ start: first, end: last, status: SliceStatus.MaskOn });
  session.settings.set(CpapSetting.Mode, CPAPMode.APAP);
  session.settings.set(CpapSetting.PressureMin, 6);
  session.settings.set(CpapSetting.PressureMax, 14);

  const addFlags = (channel: CpapChannel, count: number) => {
    if (!count) return;
    const list = session.addEventList(channel, EventListType.Event, { gain: 0.1, secondField: true, dimension: "s" });
    for (let i = 0; i < count; i += 1) list.addEvent(first + 60_000 * (i + 1), 1, 10);
  };
  addFlags(CpapChannel.ObstructiveApnea, events.oa);
  addFlags(CpapChannel.ClearAirway, events.ca);
  addFlags(CpapChannel.Hypopnea, events.h);
  addFlags(CpapChannel.RERA, events.rera);

  const pressureList = session.addEventList(CpapChannel.Pressure, EventListType.Waveform, { gain: 0.1, rateMs: 60_000, dimension: "cmH2O" });
  pressureList.addWaveform(first, Int16Array.from(pressure.map((v) => Math.round(v * 10))), pressure.length * 60_000);
  const leakList = session.addEventList(CpapChannel.Leak, EventListType.Waveform, { gain: 1, rateMs: 60_000, dimension: "L/min" });
  leakList.addWaveform(first, Int16Array.from(leak), leak.length * 60_000);
  machine.addSession(session);
}

test("therapy day uses noon-to-noon rollover", () => {
  const range = therapyDayRange("2026-10-09");
  assert.equal(new Date(range.startMs).toISOString(), "2026-10-09T12:00:00.000Z");
  assert.equal(new Date(range.endMs).toISOString(), "2026-10-10T12:00:00.000Z");
  assert.equal(therapyDateForTimestamp(Date.parse("2026-10-10T02:00:00Z")), "2026-10-09");
  assert.equal(therapyDateForTimestamp(Date.parse("2026-10-10T13:00:00Z")), "2026-10-10");
});

test("Daily query returns usage, AHI/RDI, event counts, settings, statistics and channels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-query-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(7, { type: MachineType.CPAP, brand: "ResMed", model: "AirSense 11", serial: "Q7" });
    const first = Date.parse("2026-10-09T22:00:00Z");
    const last = Date.parse("2026-10-10T06:00:00Z");
    addNight(machine, 100, first, last, { oa: 2, ca: 1, h: 1, rera: 1 }, [8, 9, 10, 11, 12], [5, 10, 15, 20, 25]);

    const db = new OscarDatabase(path);
    db.saveMachine(machine);
    db.close();

    const queries = new OscarQueries(path);
    const daily = queries.getDaily(7, "2026-10-09");
    assert.equal(daily.sessions.length, 1);
    assert.equal(daily.usageHours, 8);
    assert.deepEqual(daily.eventCounts, { obstructive: 2, clearAirway: 1, hypopnea: 1, unclassified: 0, rera: 1 });
    assert.equal(daily.ahi, 0.5);
    assert.equal(daily.rdi, 0.625);
    assert.equal(daily.sessions[0]?.settings[CpapSetting.Mode], CPAPMode.APAP);
    assert.equal(daily.pressure?.average, 10);
    assert.equal(daily.pressure?.percentile95, 12);
    assert.equal(daily.leak?.average, 15);
    assert.equal(daily.leak?.percentile95, 25);
    assert.ok(daily.availableChannels.includes(CpapChannel.Pressure));
    assert.ok(daily.availableChannels.includes(CpapChannel.ObstructiveApnea));
    queries.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Overview returns contiguous therapy days including days with no data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-overview-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(8, { type: MachineType.CPAP, brand: "ResMed", serial: "Q8" });
    addNight(machine, 1, Date.parse("2026-10-09T23:00:00Z"), Date.parse("2026-10-10T05:00:00Z"), { oa: 1, ca: 0, h: 2, rera: 0 }, [8, 10], [4, 8]);
    addNight(machine, 2, Date.parse("2026-10-11T23:00:00Z"), Date.parse("2026-10-12T05:00:00Z"), { oa: 0, ca: 1, h: 0, rera: 1 }, [9, 11], [6, 10]);
    const db = new OscarDatabase(path); db.saveMachine(machine); db.close();

    const queries = new OscarQueries(path);
    const overview = queries.getOverview(8, "2026-10-09", "2026-10-11");
    assert.equal(overview.length, 3);
    assert.deepEqual(overview.map((d) => d.date), ["2026-10-09", "2026-10-10", "2026-10-11"]);
    assert.equal(overview[0]?.usageHours, 6);
    assert.equal(overview[1]?.usageHours, 0);
    assert.equal(overview[1]?.sessionCount, 0);
    assert.equal(overview[2]?.usageHours, 6);
    queries.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Chart query returns timestamped waveform and event series for requested channels only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-chart-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(9, { type: MachineType.CPAP, brand: "ResMed", serial: "Q9" });
    const first = Date.parse("2026-10-09T22:00:00Z");
    addNight(machine, 3, first, first + 2 * 3_600_000, { oa: 1, ca: 0, h: 0, rera: 0 }, [8, 9, 10], [5, 6, 7]);
    const db = new OscarDatabase(path); db.saveMachine(machine); db.close();

    const queries = new OscarQueries(path);
    const chart = queries.getChartSeries(9, "2026-10-09", [CpapChannel.Pressure, CpapChannel.ObstructiveApnea]);
    assert.equal(chart.series.length, 2);
    const pressure = chart.series.find((s) => s.channelId === CpapChannel.Pressure);
    const oa = chart.series.find((s) => s.channelId === CpapChannel.ObstructiveApnea);
    assert.deepEqual([...pressure?.values ?? []], [8, 9, 10]);
    assert.deepEqual([...pressure?.timesMs ?? []], [first, first + 60_000, first + 120_000]);
    assert.equal(oa?.values.length, 1);
    assert.equal(oa?.timesMs[0], first + 60_000);
    assert.deepEqual([...oa?.values2 ?? []], [10]);
    assert.ok(!chart.series.some((s) => s.channelId === CpapChannel.Leak));
    queries.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Overview exposes nightly AHI/RDI and pressure/leak trends for the renderer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-overview-trends-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(10, { type: MachineType.CPAP, brand: "ResMed", serial: "Q10" });
    addNight(machine, 10, Date.parse("2026-10-09T22:00:00Z"), Date.parse("2026-10-10T04:00:00Z"), { oa: 2, ca: 1, h: 3, rera: 2 }, [8, 10, 12], [6, 12, 18]);
    addNight(machine, 11, Date.parse("2026-10-10T22:00:00Z"), Date.parse("2026-10-11T04:00:00Z"), { oa: 0, ca: 0, h: 0, rera: 0 }, [9, 11, 13], [4, 8, 12]);
    const db = new OscarDatabase(path); db.saveMachine(machine); db.close();

    const queries = new OscarQueries(path);
    const overview = queries.getOverview(10, "2026-10-09", "2026-10-10");
    assert.equal(overview.length, 2);
    assert.equal(overview[0]?.usageHours, 6);
    assert.equal(overview[0]?.ahi, 1);
    assert.equal(overview[0]?.rdi, 8 / 6);
    assert.equal(overview[0]?.pressureAverage, 10);
    assert.equal(overview[0]?.pressure95, 12);
    assert.equal(overview[0]?.leakAverage, 12);
    assert.equal(overview[0]?.leak95, 18);
    assert.equal(overview[1]?.ahi, 0);
    assert.equal(overview[1]?.pressure95, 13);
    queries.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Statistics aggregates range metrics, percentiles and consecutive settings history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-statistics-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(11, { type: MachineType.CPAP, brand: "ResMed", model: "AirSense 11", serial: "Q11" });
    addNight(machine, 21, Date.parse("2026-10-09T22:00:00Z"), Date.parse("2026-10-10T04:00:00Z"), { oa: 2, ca: 1, h: 3, rera: 2 }, [8, 10, 12], [6, 12, 18]);
    addNight(machine, 22, Date.parse("2026-10-10T22:00:00Z"), Date.parse("2026-10-11T05:00:00Z"), { oa: 1, ca: 0, h: 1, rera: 0 }, [9, 11, 13], [4, 8, 12]);
    addNight(machine, 23, Date.parse("2026-10-11T22:00:00Z"), Date.parse("2026-10-12T01:00:00Z"), { oa: 0, ca: 0, h: 0, rera: 0 }, [10, 12, 14], [2, 4, 6]);
    machine.session(23)?.settings.set(CpapSetting.PressureMax, 16);
    const db = new OscarDatabase(path); db.saveMachine(machine); db.close();

    const queries = new OscarQueries(path);
    const stats = queries.getStatistics(11, "2026-10-09", "2026-10-11");
    assert.equal(stats.totalDays, 3);
    assert.equal(stats.usedDays, 3);
    assert.equal(stats.compliantDays, 2);
    assert.equal(stats.totalUsageHours, 16);
    assert.equal(stats.averageUsageHours, 16 / 3);
    assert.equal(stats.medianUsageHours, 6);
    assert.deepEqual(stats.eventCounts, { obstructive: 3, clearAirway: 1, hypopnea: 4, unclassified: 0, rera: 2 });
    assert.equal(stats.ahi, 8 / 16);
    assert.equal(stats.rdi, 10 / 16);
    assert.equal(stats.pressure?.percentile50, 11);
    assert.equal(stats.pressure?.percentile95, 14);
    assert.equal(stats.leak?.percentile50, 6);
    assert.equal(stats.leak?.percentile95, 18);
    assert.equal(stats.settingsHistory.length, 2);
    assert.equal(stats.settingsHistory[0]?.startDate, "2026-10-09");
    assert.equal(stats.settingsHistory[0]?.endDate, "2026-10-10");
    assert.equal(stats.settingsHistory[0]?.sessionCount, 2);
    assert.equal(stats.settingsHistory[1]?.startDate, "2026-10-11");
    assert.equal(stats.settingsHistory[1]?.settings[CpapSetting.PressureMax], 16);
    queries.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("Chart query reads a narrow waveform window and min/max decimates dense full-night data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-chart-window-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(12, { type: MachineType.CPAP, brand: "ResMed", serial: "Q12" });
    const first = Date.parse("2026-10-09T22:00:00Z");
    const session = new Session(120, MachineType.CPAP);
    const sampleCount = 15_000; // ten minutes at 25 Hz
    session.setBounds(first, first + sampleCount * 40);
    session.addSlice({ start: first, end: first + sampleCount * 40, status: SliceStatus.MaskOn });
    const flow = session.addEventList(CpapChannel.FlowRate, EventListType.Waveform, { gain: 0.1, rateMs: 40, dimension: "L/min" });
    const raw = new Int16Array(sampleCount);
    for (let i = 0; i < raw.length; i += 1) raw[i] = Math.round(100 * Math.sin(i / 20));
    raw[7_777] = 1_234;
    flow.addWaveform(first, raw, raw.length * 40);
    machine.addSession(session);
    const db = new OscarDatabase(path); db.saveMachine(machine); db.close();

    const queries = new OscarQueries(path);
    const full = queries.getChartSeries(12, "2026-10-09", [CpapChannel.FlowRate], { maxPointsPerSeries: 200 });
    const fullFlow = full.series[0];
    if (!fullFlow) throw new Error("expected full flow series");
    assert.equal(fullFlow.sourcePointCount, sampleCount);
    assert.equal(fullFlow.decimated, true);
    assert.ok(fullFlow.values.length <= 200);
    assert.ok([...fullFlow.values].some((value) => Math.abs(value - 123.4) < 0.001), "decimation must preserve narrow maximum spike");

    const windowStart = first + 7_700 * 40;
    const windowEnd = first + 7_900 * 40;
    const narrow = queries.getChartSeries(12, "2026-10-09", [CpapChannel.FlowRate], { startMs: windowStart, endMs: windowEnd, maxPointsPerSeries: 1_000 });
    const narrowFlow = narrow.series[0];
    if (!narrowFlow) throw new Error("expected narrow flow series");
    assert.equal(narrow.rangeStartMs, windowStart);
    assert.equal(narrow.rangeEndMs, windowEnd);
    assert.equal(narrowFlow.sourcePointCount, 200);
    assert.equal(narrowFlow.decimated, false);
    assert.equal(narrowFlow.values.length, 200);
    assert.ok([...narrowFlow.values].some((value) => Math.abs(value - 123.4) < 0.001));
    queries.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("disabled sessions are excluded from Daily statistics and chart series", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-session-toggle-"));
  const path = join(dir, "oscar.sqlite");
  try {
    const machine = new Machine(13, { type: MachineType.CPAP, brand: "ResMed", serial: "Q13" });
    const first = Date.parse("2026-10-09T22:00:00Z");
    addNight(machine, 130, first, first + 2 * 3_600_000, { oa: 4, ca: 0, h: 0, rera: 0 }, [8, 9, 10], [5, 6, 7]);
    addNight(machine, 131, first + 3 * 3_600_000, first + 5 * 3_600_000, { oa: 0, ca: 2, h: 0, rera: 0 }, [11, 12, 13], [8, 9, 10]);
    const db = new OscarDatabase(path);
    db.saveMachine(machine);
    db.setSessionEnabled(13, 130, false);
    db.close();

    const queries = new OscarQueries(path);
    const daily = queries.getDaily(13, "2026-10-09");
    assert.equal(daily.sessions.length, 2);
    assert.equal(daily.sessions.find((session) => session.id === 130)?.enabled, false);
    assert.equal(daily.usageHours, 2);
    assert.deepEqual(daily.eventCounts, { obstructive: 0, clearAirway: 2, hypopnea: 0, unclassified: 0, rera: 0 });
    assert.equal(daily.ahi, 1);
    const chart = queries.getChartSeries(13, "2026-10-09", [CpapChannel.Pressure, CpapChannel.ObstructiveApnea, CpapChannel.ClearAirway]);
    assert.ok(!chart.series.some((series) => series.channelId === CpapChannel.ObstructiveApnea));
    assert.ok(chart.series.some((series) => series.channelId === CpapChannel.ClearAirway));
    queries.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
