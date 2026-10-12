import test from "node:test";
import assert from "node:assert/strict";
import { filterOverviewDays, overviewChartRows, summarizeOverviewDays } from "../apps/desktop/src/overview-summary.js";
import { hasFiniteChartValues } from "../apps/desktop/src/chart-analysis.js";
import type { OverviewDaySummary } from "../apps/desktop/src/types.js";

function day(date: string, overrides: Partial<OverviewDaySummary> = {}): OverviewDaySummary {
  return {
    date, sessionCount: 1, usageHours: 4, ahi: 2, rdi: 3,
    obstructive: 0, clearAirway: 0, hypopnea: 0, unclassified: 0, rera: 0,
    eventIndices: { obstructive: 0, clearAirway: 0, hypopnea: 0, unclassified: 0, rera: 0 },
    ...overrides,
  };
}

const emptySummary = {
  usedDays: 0, totalDays: 0, totalUsage: 0, averageUsage: 0,
  ahi: 0, rdi: 0, compliantDays: 0, pressure95: 0, leak95: 0,
};

test("all overview charts distinguish empty calendar days from recorded zero values", () => {
  const series = [
    { label: "Usage", getValue: (day: OverviewDaySummary) => day.usageHours },
    { label: "AHI", getValue: (day: OverviewDaySummary) => day.ahi },
    { label: "OA", getValue: (day: OverviewDaySummary) => day.eventIndices.obstructive },
    { label: "Pressure", getValue: (day: OverviewDaySummary) => day.pressureAverage },
    { label: "Leak", getValue: (day: OverviewDaySummary) => day.leakAverage },
  ];
  const categories = series.map((item) => item.label);
  assert.deepEqual(overviewChartRows([], series), []);
  const emptyDay = day("2026-10-01", { sessionCount: 0, usageHours: 0, ahi: 0, pressureAverage: 0, leakAverage: 0 });
  const emptyRows = overviewChartRows([emptyDay], series);
  assert.deepEqual(emptyRows, [{ date: emptyDay.date, Usage: null, AHI: null, OA: null, Pressure: null, Leak: null }]);
  assert.equal(hasFiniteChartValues(emptyRows, categories), false);
  const recorded = day("2026-10-02", { usageHours: 0, ahi: 0, pressureAverage: 0, leakAverage: 0 });
  const rows = overviewChartRows([emptyDay, recorded], series);
  for (const category of categories) {
    assert.equal(rows[1]?.[category], 0);
    assert.equal(hasFiniteChartValues(rows, [category]), true);
  }
  assert.equal(emptyDay.pressureAverage, 0, "Chart preparation must not modify summaries");
});

test("overview chart gaps retain dates and do not discard summary-only metrics", () => {
  const series = [
    { label: "AHI", getValue: (day: OverviewDaySummary) => day.ahi },
    { label: "Pressure", getValue: (day: OverviewDaySummary) => day.pressureAverage },
    { label: "Leak", getValue: (day: OverviewDaySummary) => day.leakAverage },
  ];
  const rows = overviewChartRows([
    day("2026-10-01", { ahi: 7.5 }),
    day("2026-10-02", { sessionCount: 0, usageHours: 0 }),
    day("2026-10-03", { pressureAverage: NaN, leakAverage: Infinity }),
    day("2026-10-04", { pressureAverage: 8, leakAverage: 0 }),
  ], series);
  assert.deepEqual(rows, [
    { date: "2026-10-01", AHI: 7.5, Pressure: null, Leak: null },
    { date: "2026-10-02", AHI: null, Pressure: null, Leak: null },
    { date: "2026-10-03", AHI: 2, Pressure: null, Leak: null },
    { date: "2026-10-04", AHI: 2, Pressure: 8, Leak: 0 },
  ]);
});

test("range filtering includes both boundary dates and retains source order", () => {
  const history = [day("2026-10-04"), day("2026-10-03"), day("2026-10-02"), day("2026-10-01")];
  const selected = filterOverviewDays(history, "2026-10-02", "2026-10-03");
  assert.deepEqual(selected.map((value) => value.date), ["2026-10-03", "2026-10-02"]);
  assert.equal(selected[0], history[1]);
  assert.deepEqual(history.map((value) => value.date), ["2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
});

test("range filtering supports one day, no matches, reversed ranges and empty history", () => {
  const history = [day("2026-10-01"), day("2026-10-02")];
  assert.deepEqual(filterOverviewDays(history, "2026-10-02", "2026-10-02"), [history[1]]);
  assert.deepEqual(filterOverviewDays(history, "2026-10-03", "2026-10-04"), []);
  assert.deepEqual(filterOverviewDays(history, "2026-10-02", "2026-10-01"), []);
  assert.deepEqual(filterOverviewDays([], "2026-10-01", "2026-10-02"), []);
});

test("range filtering works across year and leap-day boundaries", () => {
  const history = [day("2023-12-31"), day("2024-01-01"), day("2024-02-29"), day("2024-03-01")];
  assert.deepEqual(filterOverviewDays(history, "2023-12-31", "2024-02-29"), history.slice(0, 3));
});

test("empty history returns zero summaries without NaN or Infinity", () => {
  assert.deepEqual(summarizeOverviewDays([]), emptySummary);
});

test("unused dates count toward selected days but not usage or metric averages", () => {
  assert.deepEqual(summarizeOverviewDays([
    day("2026-10-01", { sessionCount: 0, usageHours: 0, ahi: 999, rdi: 999, pressure95: 999, leak95: 999 }),
    day("2026-10-02", { usageHours: 0 }),
  ]), { ...emptySummary, totalDays: 2 });
});

test("usage averages use used nights while AHI and RDI are weighted by therapy hours", () => {
  const result = summarizeOverviewDays([
    day("2026-10-01", { usageHours: 2, ahi: 10, rdi: 12 }),
    day("2026-10-02", { usageHours: 6, ahi: 2, rdi: 4 }),
    day("2026-10-03", { sessionCount: 0, usageHours: 0, ahi: 100, rdi: 100 }),
  ]);
  assert.deepEqual(result, {
    ...emptySummary, usedDays: 2, totalDays: 3, totalUsage: 8, averageUsage: 4,
    ahi: 4, rdi: 6, compliantDays: 1,
  });
});

test("adherence includes exactly four hours and counts nights rather than sessions", () => {
  const result = summarizeOverviewDays([
    day("2026-10-01", { usageHours: 3.999 }),
    day("2026-10-02", { usageHours: 4, sessionCount: 3 }),
    day("2026-10-03", { usageHours: 4.001 }),
  ]);
  assert.equal(result.usedDays, 3);
  assert.equal(result.compliantDays, 2);
});

test("pressure and leak use unweighted nightly averages and ignore unused nights", () => {
  const result = summarizeOverviewDays([
    day("2026-10-01", { usageHours: 1, pressure95: 10, leak95: 2 }),
    day("2026-10-02", { usageHours: 9, pressure95: 20, leak95: 8 }),
    day("2026-10-03", { usageHours: 0, pressure95: 100, leak95: 100 }),
  ]);
  assert.equal(result.pressure95, 15);
  assert.equal(result.leak95, 5);
});

test("optional pressure and leak values have independent finite denominators", () => {
  const result = summarizeOverviewDays([
    day("2026-10-01", { pressure95: 10 }),
    day("2026-10-02", { leak95: 6 }),
    day("2026-10-03", { pressure95: NaN, leak95: Infinity }),
    day("2026-10-04", { pressure95: Infinity, leak95: NaN }),
    day("2026-10-05", { pressure95: -Infinity, leak95: -Infinity }),
    day("2026-10-06", { pressure95: 0, leak95: 0 }),
  ]);
  assert.equal(result.pressure95, 5);
  assert.equal(result.leak95, 3);
});

test("missing or entirely nonfinite pressure and leak values return zero", () => {
  const result = summarizeOverviewDays([
    day("2026-10-01"), day("2026-10-02", { pressure95: NaN, leak95: Infinity }),
  ]);
  assert.equal(result.pressure95, 0);
  assert.equal(result.leak95, 0);
});

test("summary-only indices contribute even when detailed event counts are zero", () => {
  const result = summarizeOverviewDays([day("2026-10-01", { ahi: 7.5, rdi: 8.25 })]);
  assert.equal(result.ahi, 7.5);
  assert.equal(result.rdi, 8.25);
});

test("changing selected dates recalculates metrics from the same unchanged history", () => {
  const history = Object.freeze([
    Object.freeze(day("2026-10-01", { usageHours: 2, ahi: 10 })),
    Object.freeze(day("2026-10-02", { usageHours: 6, ahi: 2 })),
    Object.freeze(day("2026-10-03", { usageHours: 0, sessionCount: 0 })),
  ]);
  const all = summarizeOverviewDays(filterOverviewDays(history, "2026-10-01", "2026-10-03"));
  const narrowed = summarizeOverviewDays(filterOverviewDays(history, "2026-10-02", "2026-10-03"));
  assert.equal(all.ahi, 4);
  assert.equal(narrowed.ahi, 2);
  assert.equal(narrowed.totalUsage, 6);
  assert.equal(narrowed.totalDays, 2);
  assert.equal(narrowed.usedDays, 1);
  assert.deepEqual(summarizeOverviewDays(filterOverviewDays(history, "2026-10-01", "2026-10-03")), all);
});
