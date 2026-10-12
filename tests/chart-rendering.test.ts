import test from "node:test";
import assert from "node:assert/strict";
import { buildPlotGeometry, plotGeometry, createFrameQueue } from "../apps/desktop/src/chart-rendering.js";
import type { AnalysisSeries } from "../apps/desktop/src/chart-analysis.js";

function series(times: number[], values: number[]): AnalysisSeries {
  return { channelId: 100, type: "waveform", timesMs: Float64Array.from(times), values: Float32Array.from(values) };
}
test("plot geometry retains epoch-time precision, edge neighbors and independent recording gaps", () => {
  const epoch = Date.UTC(2026, 9, 9, 22);
  const s = series([epoch - 40, epoch, epoch + 40, epoch + 80, epoch + 120], [-1, 0, 1, 2, 3]);
  const g = buildPlotGeometry(s, { startMs: epoch, endMs: epoch + 80 }, 100);
  assert.equal(g.mode, "strip");
  assert.deepEqual([...g.vertices], [-0.5, -1, 0, 0, 0.5, 1, 1, 2]);
  const gap = buildPlotGeometry(series([epoch + 1000, epoch + 1040], [9, 10]), { startMs: epoch, endMs: epoch + 2000 }, 100);
  assert.deepEqual([...gap.vertices], [0.5, 9, Math.fround(0.52), 10]);
});
test("dense geometry preserves spikes and zero readings in bounded min/max segments", () => {
  const values = Array.from({ length: 1000 }, (_, i) => i === 555 ? 900 : i === 556 ? -800 : 0);
  const g = buildPlotGeometry(series(values.map((_, i) => i), values), { startMs: 0, endMs: 1000 }, 10);
  assert.equal(g.mode, "segments"); assert.ok(g.vertices.length <= 44);
  const physicalValues = [...g.vertices].filter((_, i) => i % 2 === 1);
  assert.ok(physicalValues.includes(900)); assert.ok(physicalValues.includes(-800)); assert.ok(physicalValues.includes(0));
});
test("geometry skips invalid samples and invalidates only when data, viewport or width changes", () => {
  const s = series([0, 1, 2, 3], [1, NaN, Infinity, 0]), viewport = { startMs: 0, endMs: 4 };
  assert.deepEqual([...buildPlotGeometry(s, viewport, 100).vertices], [0, 1, 0.75, 0]);
  const cached = plotGeometry(s, viewport, 100);
  assert.equal(plotGeometry(s, { ...viewport }, 100), cached);
  assert.ok(plotGeometry(s, viewport, 101) !== cached);
  assert.ok(plotGeometry(s, { startMs: 1, endMs: 4 }, 101) !== cached);
  assert.equal(buildPlotGeometry(series([], []), viewport, 100).vertices.length, 0);
});
test("frame queue coalesces bursts, retains final value, and cancels pending work", () => {
  let id = 0; const frames = new Map<number, () => void>(), values: Array<number | undefined> = [];
  const queue = createFrameQueue<number | undefined>(callback => { frames.set(++id, callback); return id; }, frame => { frames.delete(frame); }, value => values.push(value));
  for (let value = 0; value < 100; value++) queue.push(value);
  assert.equal(frames.size, 1); frames.get(1)!(); frames.delete(1);
  assert.deepEqual(values, [99]);
  queue.push(undefined); frames.get(2)!(); frames.delete(2);
  assert.deepEqual(values, [99, undefined]);
  queue.push(200); queue.cancel(); assert.equal(frames.size, 0); assert.equal(values.length, 2);
  queue.push(201); frames.get(4)!(); assert.deepEqual(values, [99, undefined, 201]);
});
