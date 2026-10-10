import test from "node:test";
import assert from "node:assert/strict";
import {
  channelStatistics,
  countEvents,
  eventsNearCursor,
  nearestPoint,
  visibleTherapyDurationMs,
  therapyWindowEventSummary,
  type AnalysisSeries,
} from "../apps/desktop/src/chart-analysis.js";

const waveform: AnalysisSeries = {
  channelId: 1,
  type: "waveform",
  timesMs: Float64Array.from([1_000, 2_000, 3_000, 4_000, 5_000]),
  values: Float32Array.from([1, 2, 3, 4, 100]),
};

const events: AnalysisSeries = {
  channelId: 10,
  type: "event",
  timesMs: Float64Array.from([1_500, 3_500, 7_500]),
  values: Float32Array.from([10, 11, 12]),
};

test("chart analysis computes statistics only inside the viewport", () => {
  const result = channelStatistics([waveform], 1, { startMs: 1_500, endMs: 4_500 });
  if (!result) throw new Error("expected statistics");
  assert.equal(result.count, 3);
  assert.equal(result.min, 2);
  assert.equal(result.max, 4);
  assert.equal(result.average, 3);
  assert.equal(result.percentile50, 3);
});

test("chart analysis counts events in half-open viewport", () => {
  assert.equal(countEvents([events], 10, { startMs: 1_500, endMs: 7_500 }), 2);
});

test("visible therapy time excludes gaps between split sessions", () => {
  const duration = visibleTherapyDurationMs([
    { firstMs: 0, lastMs: 60_000 },
    { firstMs: 120_000, lastMs: 180_000 },
  ], { startMs: 30_000, endMs: 150_000 });
  assert.equal(duration, 60_000);
});

test("nearest waveform point returns local sample and rejects large gaps", () => {
  const nearest = nearestPoint(waveform, 3_200);
  if (!nearest) throw new Error("expected nearest point");
  assert.equal(nearest.timeMs, 3_000);
  assert.equal(nearest.value, 3);

  const gapped: AnalysisSeries = {
    channelId: 1,
    type: "waveform",
    timesMs: Float64Array.from([0, 1_000, 100_000, 101_000]),
    values: Float32Array.from([1, 2, 3, 4]),
  };
  assert.equal(nearestPoint(gapped, 50_000), undefined);
});

test("event hover lookup uses a pixel-scaled time tolerance", () => {
  const found = eventsNearCursor([events], 3_520, { startMs: 0, endMs: 10_000 }, 7, 1_000);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.timeMs, 3_500);
});


test("zoomed AHI/RDI use visible therapy time rather than wall-clock gaps", () => {
  const summary = therapyWindowEventSummary(
    [
      { channelId: 10, type: "event", timesMs: Float64Array.from([10_000, 130_000]), values: Float32Array.from([10, 10]) },
      { channelId: 11, type: "event", timesMs: Float64Array.from([140_000]), values: Float32Array.from([10]) },
    ],
    [
      { firstMs: 0, lastMs: 60_000 },
      { firstMs: 120_000, lastMs: 180_000 },
    ],
    { startMs: 0, endMs: 180_000 },
    { obstructive: 10, clearAirway: 12, hypopnea: 13, unclassified: 14, rera: 11 },
  );
  assert.equal(summary.therapyHours, 2 / 60);
  assert.equal(summary.ahi, 60);
  assert.equal(summary.rdi, 90);
});
