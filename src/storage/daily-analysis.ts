import type { DatabaseSync } from "node:sqlite";
import { CPAP_CHANNEL_DEFINITIONS, CpapChannel } from "../core/cpap-channels.js";
import { ChannelType } from "../core/channel.js";
import { parseTherapyAnalysisPreferences, type DailyChannelAnalysis, type DailyChannelStatistics } from "../core/therapy-analysis.js";

type Interval = { start: number; end: number };
type SampleList = {
  id: number; channel_id: number; list_type: string; first_ms: number; duration_ms: number;
  rate_ms: number; gain: number; offset: number; dimension: string;
  raw_blob: Uint8Array; time_deltas_blob: Uint8Array | null;
};
type Histogram = { weights: Map<number, number>; count: number; total: number; sum: number; intervals: Interval[]; unit: string };

function merge(intervals: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    if (interval.end <= interval.start) continue;
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

function append(intervals: Interval[], start: number, end: number): void {
  const previous = intervals.at(-1);
  if (previous && start >= previous.start && start <= previous.end) previous.end = Math.max(previous.end, end);
  else intervals.push({ start, end });
}

function elapsed(intervals: readonly Interval[]): number {
  return merge(intervals).reduce((sum, interval) => sum + interval.end - interval.start, 0);
}

function int16(bytes: Uint8Array): Int16Array { return new Int16Array(Uint8Array.from(bytes).buffer); }
function uint32(bytes: Uint8Array): Uint32Array { return new Uint32Array(Uint8Array.from(bytes).buffer); }

/** Raw-sample analysis; never uses chart decimation or averages session percentiles. */
export function queryDailyChannelAnalysis(db: DatabaseSync, machineId: number, date: string, startMs: number, endMs: number): DailyChannelAnalysis {
  const preference = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(`therapy_analysis:${machineId}`) as { value: string } | undefined;
  const { leakThreshold } = parseTherapyAnalysisPreferences(preference?.value);
  const sessions = db.prepare(`SELECT row_id, first_ms, last_ms, summary_only FROM sessions
    WHERE machine_id = ? AND enabled != 0 AND first_ms < ? AND last_ms > ? ORDER BY first_ms, row_id
  `).all(machineId, endMs, startMs) as Array<{ row_id: number; first_ms: number; last_ms: number; summary_only: number }>;
  // Signed high-rate Flow and the uninterpreted trigger signal have no nightly table statistics.
  const definitions = CPAP_CHANNEL_DEFINITIONS.filter(item => (item.type === ChannelType.Data || item.type === ChannelType.Waveform) && item.id !== CpapChannel.FlowRate && item.id !== CpapChannel.RespEvent);
  const ids = definitions.map(item => item.id);
  const histograms = new Map<number, Histogram>();
  const therapy: Interval[] = [];
  const above: Interval[] = [];
  for (const session of sessions) {
    const slices = db.prepare("SELECT start_ms, end_ms FROM session_slices WHERE session_row_id = ? AND status = 2 ORDER BY slice_index").all(session.row_id) as Array<{ start_ms: number; end_ms: number }>;
    const valid = merge((slices.length ? slices.map(slice => ({ start: slice.start_ms, end: slice.end_ms })) : [{ start: session.first_ms, end: session.last_ms }])
      .map(interval => ({ start: Math.max(interval.start, session.first_ms, startMs), end: Math.min(interval.end, session.last_ms, endMs) })));
    therapy.push(...valid);
    if (session.summary_only || valid.length === 0) continue;
    const lists = db.prepare(`SELECT id, channel_id, list_type, first_ms, duration_ms, rate_ms, gain, offset, dimension, raw_blob, time_deltas_blob
      FROM event_lists WHERE session_row_id = ? AND channel_id IN (${ids.map(() => "?").join(",")}) ORDER BY channel_id, first_ms, list_index
    `).all(session.row_id, ...ids) as SampleList[];
    for (const list of lists) {
      // An interval is necessary to weight sampled measurements. Do not infer one from gaps.
      if (!(list.rate_ms > 0) || !Number.isFinite(list.rate_ms)) continue;
      const definition = definitions.find(item => item.id === list.channel_id)!;
      const histogram = histograms.get(list.channel_id) ?? { weights: new Map<number, number>(), count: 0, total: 0, sum: 0, intervals: [], unit: definition.unit };
      histograms.set(list.channel_id, histogram);
      // Prefer registry units. Leak seconds are meaningful only in canonical L/min.
      if (list.channel_id === CpapChannel.Leak && list.dimension && list.dimension !== "L/min") continue;
      const sample = (raw: number, time: number, cellEnd: number) => {
        const value = raw * list.gain + (list.list_type === "waveform" ? list.offset : 0);
        if (!Number.isFinite(value)) return;
        let weight = 0;
        for (const interval of valid) {
          const start = Math.max(time, interval.start), end = Math.min(cellEnd, interval.end);
          if (end <= start) continue;
          weight += end - start;
          append(histogram.intervals, start, end);
          if (list.channel_id === CpapChannel.Leak && value > leakThreshold) append(above, start, end);
        }
        if (weight <= 0) return;
        histogram.count += 1;
        histogram.total += weight;
        histogram.sum += value * weight;
        histogram.weights.set(value, (histogram.weights.get(value) ?? 0) + weight);
      };
      if (list.list_type === "waveform") {
        const chunks = db.prepare(`SELECT start_sample, raw_blob FROM waveform_chunks
          WHERE event_list_id = ? AND end_ms > ? AND start_ms < ? ORDER BY start_sample
        `).all(list.id, startMs, endMs) as Array<{ start_sample: number; raw_blob: Uint8Array }>;
        const sources = chunks.length ? chunks : list.raw_blob.length ? [{ start_sample: 0, raw_blob: list.raw_blob }] : [];
        const first = Math.max(0, Math.floor((startMs - list.first_ms) / list.rate_ms));
        const end = Math.ceil((endMs - list.first_ms) / list.rate_ms);
        for (const source of sources) {
          const raw = int16(source.raw_blob);
          const begin = Math.max(0, first - source.start_sample), limit = Math.min(raw.length, end - source.start_sample);
          for (let index = begin; index < limit; index++) {
            const time = list.first_ms + (source.start_sample + index) * list.rate_ms;
            sample(raw[index]!, time, Math.min(time + list.rate_ms, list.first_ms + list.duration_ms));
          }
        }
      } else if (list.time_deltas_blob) {
        const raw = int16(list.raw_blob), deltas = uint32(list.time_deltas_blob);
        for (let index = 0; index < Math.min(raw.length, deltas.length); index++) {
          const time = list.first_ms + deltas[index]!;
          const next = deltas[index + 1];
          sample(raw[index]!, time, Math.min(time + list.rate_ms, next === undefined ? Infinity : list.first_ms + next));
        }
      }
    }
  }
  const channels: DailyChannelStatistics[] = [];
  for (const definition of definitions) {
    const histogram = histograms.get(definition.id);
    if (!histogram || !histogram.total) continue;
    const values = [...histogram.weights.keys()].sort((a, b) => a - b);
    const percentile = (fraction: number) => {
      let cumulative = 0;
      for (const value of values) { cumulative += histogram.weights.get(value)!; if (cumulative >= histogram.total * fraction) return value; }
      return values.at(-1)!;
    };
    channels.push({ channelId: definition.id, label: definition.name, unit: histogram.unit, count: histogram.count,
      recordedSeconds: elapsed(histogram.intervals) / 1000, min: values[0]!, max: values.at(-1)!,
      average: histogram.sum / histogram.total, percentile50: percentile(0.5), percentile95: percentile(0.95) });
  }
  const therapySeconds = elapsed(therapy) / 1000;
  const leak = channels.find(item => item.channelId === CpapChannel.Leak);
  const secondsAboveThreshold = elapsed(above) / 1000;
  return { machineId, date, therapySeconds, channels, ...(leak ? { leak: { threshold: leakThreshold, unit: "L/min" as const,
    secondsAboveThreshold, recordedSeconds: leak.recordedSeconds, percentTherapyTimeAboveThreshold: therapySeconds > 0 ? secondsAboveThreshold / therapySeconds * 100 : 0 } } : {}) };
}
