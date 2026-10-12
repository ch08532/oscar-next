import { lowerBound, type AnalysisSeries, type AnalysisViewport } from "./chart-analysis.js";

export interface PlotGeometry {
  /** Interleaved normalized X and physical Y; never store epoch times in float32. */
  vertices: Float32Array;
  mode: "strip" | "segments";
}

/** Preserve neighboring edge samples and per-pixel extrema in dense views. */
export function buildPlotGeometry(series: AnalysisSeries, viewport: AnalysisViewport, plotWidth: number): PlotGeometry {
  const begin = Math.max(0, lowerBound(series.timesMs, viewport.startMs) - 1);
  const end = Math.min(series.timesMs.length, series.values.length, lowerBound(series.timesMs, viewport.endMs) + 1);
  const duration = Math.max(1, viewport.endMs - viewport.startMs);
  const width = Math.max(1, plotWidth);
  const xFor = (time: number) => (time - viewport.startMs) / duration;
  if (end - begin > width * 4) {
    const size = Math.ceil(width) + 1;
    const mins = new Float32Array(size); mins.fill(Infinity);
    const maxs = new Float32Array(size); maxs.fill(-Infinity);
    for (let index = begin; index < end; index++) {
      const value = series.values[index]!, time = series.timesMs[index]!;
      if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
      const bucket = Math.max(0, Math.min(size - 1, Math.floor(xFor(time) * width)));
      mins[bucket] = Math.min(mins[bucket]!, value);
      maxs[bucket] = Math.max(maxs[bucket]!, value);
    }
    const vertices = new Float32Array(size * 4);
    let count = 0;
    for (let bucket = 0; bucket < size; bucket++) {
      if (!Number.isFinite(mins[bucket])) continue;
      vertices[count++] = bucket / width; vertices[count++] = mins[bucket]!;
      vertices[count++] = bucket / width; vertices[count++] = maxs[bucket]!;
    }
    return { vertices: vertices.subarray(0, count), mode: "segments" };
  }
  const vertices = new Float32Array(Math.max(0, end - begin) * 2);
  let count = 0;
  for (let index = begin; index < end; index++) {
    const value = series.values[index]!, time = series.timesMs[index]!;
    if (!Number.isFinite(value) || !Number.isFinite(time)) continue;
    vertices[count++] = xFor(time); vertices[count++] = value;
  }
  return { vertices: vertices.subarray(0, count), mode: "strip" };
}

// Each immutable query series retains only its most recent viewport geometry.
const geometryCache = new WeakMap<AnalysisSeries, { key: string; geometry: PlotGeometry }>();
export function plotGeometry(series: AnalysisSeries, viewport: AnalysisViewport, width: number): PlotGeometry {
  const key = `${viewport.startMs}:${viewport.endMs}:${width}`;
  const cached = geometryCache.get(series);
  if (cached?.key === key) return cached.geometry;
  const geometry = buildPlotGeometry(series, viewport, width);
  geometryCache.set(series, { key, geometry });
  return geometry;
}

/** Last update wins within a frame. Cancel pending work on unmount. */
export function createFrameQueue<T>(
  request: (callback: () => void) => number,
  cancel: (id: number) => void,
  commit: (value: T) => void,
) {
  let frame: number | undefined;
  let pending: T;
  return {
    push(value: T) {
      pending = value;
      if (frame !== undefined) return;
      frame = request(() => { frame = undefined; commit(pending); });
    },
    cancel() { if (frame !== undefined) cancel(frame); frame = undefined; },
  };
}
