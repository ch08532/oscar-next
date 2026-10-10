import test from "node:test";
import assert from "node:assert/strict";
import { statisticsToCsv, statisticsToHtml } from "../src/reports/statistics-report.js";
import { CpapSetting } from "../src/core/cpap-settings.js";
import { CPAPMode, MachineType } from "../src/core/types.js";
import type { StoredMachineSummary } from "../src/storage/database.js";
import type { StatisticsSummary } from "../src/storage/queries.js";

const machine: StoredMachineSummary = {
  id: 1,
  brand: "ResMed",
  model: "AirSense 11 <AutoSet>",
  serial: "ABC,123",
  machineType: MachineType.CPAP,
  sessionCount: 2,
};

const stats: StatisticsSummary = {
  machineId: 1,
  startDate: "2026-10-01",
  endDate: "2026-10-02",
  totalDays: 2,
  usedDays: 2,
  compliantDays: 1,
  totalUsageHours: 10,
  averageUsageHours: 5,
  medianUsageHours: 4,
  eventCounts: { obstructive: 2, clearAirway: 1, hypopnea: 3, unclassified: 0, rera: 1 },
  eventIndices: { obstructive: 0.2, clearAirway: 0.1, hypopnea: 0.3, unclassified: 0, rera: 0.1 },
  ahi: 0.6,
  rdi: 0.7,
  pressure: { channelId: 104, count: 3, min: 8, max: 12, average: 10, percentile50: 10, percentile95: 12 },
  leak: { channelId: 107, count: 3, min: 4, max: 18, average: 10, percentile50: 8, percentile95: 18 },
  settingsHistory: [{
    startDate: "2026-10-01", endDate: "2026-10-02", firstMs: 1, lastMs: 2, sessionCount: 2,
    settings: { [CpapSetting.Mode]: CPAPMode.APAP, [CpapSetting.PressureMin]: 6, [CpapSetting.PressureMax]: 14 },
  }],
  days: [
    { date: "2026-10-01", sessionCount: 1, usageHours: 6, ahi: 0.5, rdi: 0.6, obstructive: 1, clearAirway: 1, hypopnea: 1, unclassified: 0, rera: 1, eventIndices: { obstructive: 0.4, clearAirway: 0.2, hypopnea: 0.6, unclassified: 0, rera: 0.2 }, pressureAverage: 9, pressure95: 11, leakAverage: 8, leak95: 14 },
    { date: "2026-10-02", sessionCount: 1, usageHours: 4, ahi: 0.75, rdi: 0.75, obstructive: 1, clearAirway: 0, hypopnea: 2, unclassified: 0, rera: 0, eventIndices: { obstructive: 0.1, clearAirway: 0, hypopnea: 0.1, unclassified: 0, rera: 0 }, pressureAverage: 11, pressure95: 12, leakAverage: 12, leak95: 18 },
  ],
};

test("statistics CSV contains summary, daily rows and settings history", () => {
  const csv = statisticsToCsv(machine, stats);
  assert.ok(csv.includes('Serial,"ABC,123"'));
  assert.ok(csv.includes("AHI,0.600"));
  assert.ok(csv.includes("2026-10-01,1,6.00"));
  assert.ok(csv.includes("Minimum pressure,6.0 cmH2O"));
});

test("statistics HTML escapes device text and includes report sections", () => {
  const html = statisticsToHtml(machine, stats);
  assert.ok(html.includes("AirSense 11 &lt;AutoSet&gt;"));
  assert.ok(!html.includes("AirSense 11 <AutoSet>"));
  assert.ok(html.includes("Event indices"));
  assert.ok(html.includes("Therapy settings history"));
  assert.ok(html.includes("APAP"));
});
