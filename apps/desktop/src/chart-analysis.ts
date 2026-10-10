export interface AnalysisViewport {
  startMs: number;
  endMs: number;
}

export interface AnalysisSeries {
  channelId: number;
  type: "waveform" | "event";
  timesMs: ArrayLike<number>;
  values: ArrayLike<number>;
}

export interface AnalysisSession {
  firstMs: number;
  lastMs: number;
  enabled?: boolean;
}

export interface NumericStatistics {
  count: number;
  min: number;
  max: number;
  average: number;
  percentile50: number;
  percentile95: number;
}

export interface NearestPoint {
  index: number;
  timeMs: number;
  value: number;
  distanceMs: number;
}

export function lowerBound(values: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((values[mid] ?? Number.POSITIVE_INFINITY) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function percentileSorted(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const position = Math.max(0, Math.min(1, quantile)) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const fraction = position - low;
  const a = sorted[low] ?? 0;
  const b = sorted[high] ?? a;
  return a + (b - a) * fraction;
}

export function statistics(values: readonly number[]): NumericStatistics | undefined {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return undefined;
  const sorted = [...finite].sort((a, b) => a - b);
  const total = finite.reduce((sum, value) => sum + value, 0);
  return {
    count: finite.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    average: total / finite.length,
    percentile50: percentileSorted(sorted, 0.5),
    percentile95: percentileSorted(sorted, 0.95),
  };
}

export function valuesInViewport(series: AnalysisSeries, viewport: AnalysisViewport): number[] {
  if (viewport.endMs <= viewport.startMs || series.timesMs.length === 0) return [];
  const begin = lowerBound(series.timesMs, viewport.startMs);
  const end = lowerBound(series.timesMs, viewport.endMs);
  const result: number[] = [];
  for (let index = begin; index < end; index += 1) {
    const value = series.values[index];
    if (value !== undefined && Number.isFinite(value)) result.push(value);
  }
  return result;
}

export function channelStatistics(
  series: readonly AnalysisSeries[],
  channelId: number,
  viewport: AnalysisViewport,
): NumericStatistics | undefined {
  const values: number[] = [];
  for (const item of series) {
    if (item.channelId !== channelId) continue;
    values.push(...valuesInViewport(item, viewport));
  }
  return statistics(values);
}

export function countEvents(
  series: readonly AnalysisSeries[],
  channelId: number,
  viewport: AnalysisViewport,
): number {
  let count = 0;
  for (const item of series) {
    if (item.channelId !== channelId) continue;
    const begin = lowerBound(item.timesMs, viewport.startMs);
    const end = lowerBound(item.timesMs, viewport.endMs);
    count += Math.max(0, end - begin);
  }
  return count;
}

export function visibleTherapyDurationMs(
  sessions: readonly AnalysisSession[],
  viewport: AnalysisViewport,
): number {
  let total = 0;
  for (const session of sessions) {
    if (session.enabled === false) continue;
    const start = Math.max(session.firstMs, viewport.startMs);
    const end = Math.min(session.lastMs, viewport.endMs);
    if (end > start) total += end - start;
  }
  return total;
}

function localToleranceMs(series: AnalysisSeries, index: number): number {
  if (series.type === "event") return 0;
  const time = series.timesMs[index];
  if (time === undefined) return 0;
  const previous = index > 0 ? series.timesMs[index - 1] : undefined;
  const next = index + 1 < series.timesMs.length ? series.timesMs[index + 1] : undefined;
  const gaps = [previous === undefined ? undefined : time - previous, next === undefined ? undefined : next - time]
    .filter((gap): gap is number => gap !== undefined && Number.isFinite(gap) && gap > 0);
  const cadence = gaps.length ? Math.min(...gaps) : 1_000;
  return Math.max(1_000, Math.min(60_000, cadence * 2.5));
}

export function nearestPoint(series: AnalysisSeries, cursorMs: number): NearestPoint | undefined {
  if (series.timesMs.length === 0) return undefined;
  const first = series.timesMs[0];
  const last = series.timesMs[series.timesMs.length - 1];
  if (first === undefined || last === undefined || cursorMs < first || cursorMs > last) return undefined;

  const insertion = lowerBound(series.timesMs, cursorMs);
  const candidates = [Math.max(0, insertion - 1), Math.min(series.timesMs.length - 1, insertion)];
  let best: NearestPoint | undefined;
  for (const index of candidates) {
    const timeMs = series.timesMs[index];
    const value = series.values[index];
    if (timeMs === undefined || value === undefined || !Number.isFinite(value)) continue;
    const distanceMs = Math.abs(timeMs - cursorMs);
    if (!best || distanceMs < best.distanceMs) best = { index, timeMs, value, distanceMs };
  }
  if (!best) return undefined;
  if (series.type === "waveform" && best.distanceMs > localToleranceMs(series, best.index)) return undefined;
  return best;
}

export function eventsNearCursor(
  series: readonly AnalysisSeries[],
  cursorMs: number,
  viewport: AnalysisViewport,
  pixelTolerance = 7,
  plotWidth = 1_000,
): Array<{ channelId: number; timeMs: number; value: number; distanceMs: number }> {
  const toleranceMs = Math.max(500, ((viewport.endMs - viewport.startMs) / Math.max(1, plotWidth)) * pixelTolerance);
  const matches: Array<{ channelId: number; timeMs: number; value: number; distanceMs: number }> = [];
  for (const item of series) {
    if (item.type !== "event" || item.timesMs.length === 0) continue;
    const insertion = lowerBound(item.timesMs, cursorMs);
    for (const index of [insertion - 1, insertion]) {
      if (index < 0 || index >= item.timesMs.length) continue;
      const timeMs = item.timesMs[index];
      const value = item.values[index];
      if (timeMs === undefined || value === undefined) continue;
      const distanceMs = Math.abs(timeMs - cursorMs);
      if (distanceMs <= toleranceMs) matches.push({ channelId: item.channelId, timeMs, value, distanceMs });
    }
  }
  return matches.sort((a, b) => a.distanceMs - b.distanceMs || a.channelId - b.channelId);
}

export interface TherapyEventChannelMap {
  obstructive: number;
  clearAirway: number;
  hypopnea: number;
  unclassified: number;
  rera: number;
}

export interface TherapyWindowEventSummary {
  therapyHours: number;
  obstructive: number;
  clearAirway: number;
  hypopnea: number;
  unclassified: number;
  rera: number;
  ahi: number;
  rdi: number;
}

export function therapyWindowEventSummary(
  series: readonly AnalysisSeries[],
  sessions: readonly AnalysisSession[],
  viewport: AnalysisViewport,
  channels: TherapyEventChannelMap,
): TherapyWindowEventSummary {
  const therapyHours = visibleTherapyDurationMs(sessions, viewport) / 3_600_000;
  const obstructive = countEvents(series, channels.obstructive, viewport);
  const clearAirway = countEvents(series, channels.clearAirway, viewport);
  const hypopnea = countEvents(series, channels.hypopnea, viewport);
  const unclassified = countEvents(series, channels.unclassified, viewport);
  const rera = countEvents(series, channels.rera, viewport);
  const ahiEvents = obstructive + clearAirway + hypopnea + unclassified;
  return {
    therapyHours,
    obstructive,
    clearAirway,
    hypopnea,
    unclassified,
    rera,
    ahi: therapyHours > 0 ? ahiEvents / therapyHours : 0,
    rdi: therapyHours > 0 ? (ahiEvents + rera) / therapyHours : 0,
  };
}
