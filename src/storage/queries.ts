import { DatabaseSync } from "node:sqlite";
import { CpapChannel } from "../core/cpap-channels.js";
import { CpapSetting, isSummaryMetricSetting } from "../core/cpap-settings.js";
import { EventListType } from "../core/event-list.js";
import type { ChannelId, MachineId, SettingValue } from "../core/types.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface SessionRow {
  row_id: number;
  id: number;
  first_ms: number;
  last_ms: number;
  enabled: number;
  summary_only: number;
}

interface SliceRow {
  start_ms: number;
  end_ms: number;
  status: number;
}

interface EventListRow {
  id: number;
  channel_id: number;
  list_index: number;
  list_type: string;
  gain: number;
  offset: number;
  rate_ms: number;
  dimension: string;
  first_ms: number;
  duration_ms: number;
  second_field: number;
  raw_blob: Uint8Array;
  raw2_blob: Uint8Array | null;
  time_deltas_blob: Uint8Array | null;
}

interface SettingRow {
  channel_id: number;
  value_type: string;
  value_text: string | null;
}

interface WaveformChunkRow {
  start_sample: number;
  sample_count: number;
  start_ms: number;
  end_ms: number;
  raw_blob: Uint8Array;
}

export interface TherapyDayRange {
  date: string;
  startMs: number;
  endMs: number;
}

export interface EventCounts {
  obstructive: number;
  clearAirway: number;
  hypopnea: number;
  unclassified: number;
  rera: number;
}

export interface ChannelStatistics {
  channelId: ChannelId;
  count: number;
  min: number;
  max: number;
  average: number;
  percentile50: number;
  percentile95: number;
}

export interface DailySessionSummary {
  id: number;
  firstMs: number;
  lastMs: number;
  usageHours: number;
  enabled: boolean;
  summaryOnly: boolean;
  settings: Record<number, SettingValue>;
}

export interface DailySummary {
  machineId: MachineId;
  date: string;
  deviceTimeZone: string;
  rangeStartMs: number;
  rangeEndMs: number;
  sessions: DailySessionSummary[];
  usageHours: number;
  eventCounts: EventCounts;
  eventIndices: EventIndices;
  ahi: number;
  rdi: number;
  pressure?: ChannelStatistics;
  leak?: ChannelStatistics;
  availableChannels: ChannelId[];
}


export interface EventIndices {
  obstructive: number;
  clearAirway: number;
  hypopnea: number;
  unclassified: number;
  rera: number;
}

export interface SettingHistoryEntry {
  startDate: string;
  endDate: string;
  firstMs: number;
  lastMs: number;
  sessionCount: number;
  settings: Record<number, SettingValue>;
}

export interface StatisticsSummary {
  machineId: MachineId;
  startDate: string;
  endDate: string;
  totalDays: number;
  usedDays: number;
  compliantDays: number;
  totalUsageHours: number;
  averageUsageHours: number;
  medianUsageHours: number;
  eventCounts: EventCounts;
  eventIndices: EventIndices;
  ahi: number;
  rdi: number;
  pressure?: ChannelStatistics;
  leak?: ChannelStatistics;
  settingsHistory: SettingHistoryEntry[];
  days: OverviewDaySummary[];
}

export interface OverviewDaySummary {
  date: string;
  sessionCount: number;
  usageHours: number;
  ahi: number;
  rdi: number;
  obstructive: number;
  clearAirway: number;
  hypopnea: number;
  unclassified: number;
  rera: number;
  eventIndices: EventIndices;
  pressureAverage?: number;
  pressure95?: number;
  leakAverage?: number;
  leak95?: number;
}

export interface ChartSeries {
  channelId: ChannelId;
  listIndex: number;
  type: EventListType;
  dimension: string;
  timesMs: Float64Array;
  values: Float32Array;
  values2?: Float32Array;
  sourcePointCount: number;
  decimated: boolean;
}

export interface ChartQueryResult {
  machineId: MachineId;
  date: string;
  rangeStartMs: number;
  rangeEndMs: number;
  series: ChartSeries[];
}

export interface OscarQueryOptions {
  /** ResMed/OSCAR therapy-day rollover. Defaults to 12:00 (noon). */
  rolloverHour?: number;
}

export interface ChartQueryOptions {
  /** Optional absolute start time. Clamped to the selected therapy day. */
  startMs?: number;
  /** Optional absolute end time (exclusive). Clamped to the selected therapy day. */
  endMs?: number;
  /** Maximum returned points per waveform series. Events are never decimated. */
  maxPointsPerSeries?: number;
}

function parseDateKey(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid therapy date '${date}', expected YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`Invalid therapy date '${date}'`);
  }
  return { year, month, day };
}

export function therapyDayRange(date: string, rolloverHour = 12): TherapyDayRange {
  if (!Number.isInteger(rolloverHour) || rolloverHour < 0 || rolloverHour > 23) {
    throw new RangeError("rolloverHour must be an integer between 0 and 23");
  }
  const { year, month, day } = parseDateKey(date);
  const startMs = Date.UTC(year, month - 1, day, rolloverHour, 0, 0, 0);
  return { date, startMs, endMs: startMs + DAY_MS };
}

export function therapyDateForTimestamp(timestampMs: number, rolloverHour = 12): string {
  const adjusted = new Date(timestampMs - rolloverHour * HOUR_MS);
  const year = adjusted.getUTCFullYear();
  const month = String(adjusted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(adjusted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
  const { startMs } = therapyDayRange(date, 0);
  return therapyDateForTimestamp(startMs + days * DAY_MS, 0);
}

function bytesToInt16(bytes: Uint8Array): Int16Array {
  const copy = Uint8Array.from(bytes);
  return new Int16Array(copy.buffer);
}

function bytesToUint32(bytes: Uint8Array): Uint32Array {
  const copy = Uint8Array.from(bytes);
  return new Uint32Array(copy.buffer);
}

function deserializeSetting(type: string, value: string | null): SettingValue {
  switch (type) {
    case "null": return null;
    case "date": return new Date(Number(value));
    case "boolean": return value === "1";
    case "number": return Number(value);
    case "string": return value ?? "";
    default: throw new Error(`Unsupported stored setting type: ${type}`);
  }
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(fraction * sortedValues.length) - 1));
  return sortedValues[index] ?? 0;
}

function overlapMs(start: number, end: number, rangeStart: number, rangeEnd: number): number {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));
}

export class OscarQueries {
  readonly path: string;
  readonly rolloverHour: number;
  readonly #db: DatabaseSync;

  constructor(path: string, options: OscarQueryOptions = {}) {
    this.path = path;
    this.rolloverHour = options.rolloverHour ?? 12;
    this.#db = new DatabaseSync(path, { readOnly: true });
    this.#db.exec("PRAGMA foreign_keys = ON;");
  }

  close(): void { this.#db.close(); }

  getDaily(machineId: MachineId, date: string): DailySummary {
    const range = therapyDayRange(date, this.rolloverHour);
    const sessions = this.#sessionRows(machineId, range.startMs, range.endMs);
    const enabled = sessions.filter((session) => session.enabled !== 0);
    const summaries = sessions.map((session) => ({
      id: session.id,
      firstMs: session.first_ms,
      lastMs: session.last_ms,
      usageHours: this.#usageMs(session, range.startMs, range.endMs) / HOUR_MS,
      enabled: session.enabled !== 0,
      summaryOnly: session.summary_only !== 0,
      settings: this.#settings(session.row_id),
    }));

    const usageHours = enabled.reduce((total, session) => total + this.#usageMs(session, range.startMs, range.endMs), 0) / HOUR_MS;
    const eventCounts: EventCounts = {
      obstructive: this.#countEvents(enabled, CpapChannel.ObstructiveApnea, range.startMs, range.endMs),
      clearAirway: this.#countEvents(enabled, CpapChannel.ClearAirway, range.startMs, range.endMs),
      hypopnea: this.#countEvents(enabled, CpapChannel.Hypopnea, range.startMs, range.endMs),
      unclassified: this.#countEvents(enabled, CpapChannel.UnclassifiedApnea, range.startMs, range.endMs),
      rera: this.#countEvents(enabled, CpapChannel.RERA, range.startMs, range.endMs),
    };
    // Detailed EDF nights use exact event counts. STR-only nights expose per-hour
    // indices instead; combine both by therapy-hour weighting so backups with
    // only STR summary data still report meaningful AHI/subtype indices.
    let ahiWeightedEvents = eventCounts.obstructive + eventCounts.clearAirway + eventCounts.hypopnea + eventCounts.unclassified;
    let rdiWeightedEvents = ahiWeightedEvents + eventCounts.rera;
    const subtypeWeighted = {
      obstructive: eventCounts.obstructive, clearAirway: eventCounts.clearAirway, hypopnea: eventCounts.hypopnea,
      unclassified: eventCounts.unclassified, rera: eventCounts.rera,
    };
    for (const session of enabled) {
      if (session.summary_only === 0) continue;
      const hours = this.#usageMs(session, range.startMs, range.endMs) / HOUR_MS;
      if (hours <= 0) continue;
      const settings = this.#settings(session.row_id);
      const rate = (id: CpapSetting) => typeof settings[id] === "number" ? settings[id] as number : 0;
      const summaryAhi = rate(CpapSetting.SummaryAHI);
      ahiWeightedEvents += summaryAhi * hours;
      rdiWeightedEvents += summaryAhi * hours; // STR has no reliable RERA summary field.
      subtypeWeighted.obstructive += rate(CpapSetting.SummaryOAI) * hours;
      subtypeWeighted.clearAirway += rate(CpapSetting.SummaryCAI) * hours;
      subtypeWeighted.hypopnea += rate(CpapSetting.SummaryHI) * hours;
      subtypeWeighted.unclassified += rate(CpapSetting.SummaryUAI) * hours;
    }
    const perHour = (weighted: number) => usageHours > 0 ? weighted / usageHours : 0;
    const eventIndices: EventIndices = {
      obstructive: perHour(subtypeWeighted.obstructive), clearAirway: perHour(subtypeWeighted.clearAirway),
      hypopnea: perHour(subtypeWeighted.hypopnea), unclassified: perHour(subtypeWeighted.unclassified), rera: perHour(subtypeWeighted.rera),
    };
    const availableChannels = this.#availableChannels(enabled);

    const pressure = this.#channelStatistics(enabled, CpapChannel.Pressure, range.startMs, range.endMs);
    const leak = this.#channelStatistics(enabled, CpapChannel.Leak, range.startMs, range.endMs);
    return {
      machineId,
      date,
      deviceTimeZone: this.#deviceTimeZone(machineId),
      rangeStartMs: range.startMs,
      rangeEndMs: range.endMs,
      sessions: summaries,
      usageHours,
      eventCounts,
      eventIndices,
      ahi: perHour(ahiWeightedEvents),
      rdi: perHour(rdiWeightedEvents),
      ...(pressure ? { pressure } : {}),
      ...(leak ? { leak } : {}),
      availableChannels,
    };
  }

  getOverview(machineId: MachineId, startDate: string, endDate: string): OverviewDaySummary[] {
    const start = therapyDayRange(startDate, this.rolloverHour).startMs;
    const end = therapyDayRange(endDate, this.rolloverHour).startMs;
    if (end < start) throw new RangeError("endDate cannot be before startDate");
    const days = Math.floor((end - start) / DAY_MS) + 1;
    const result: OverviewDaySummary[] = [];
    for (let index = 0; index < days; index += 1) {
      const date = addDays(startDate, index);
      const daily = this.getDaily(machineId, date);
      result.push({
        date,
        sessionCount: daily.sessions.filter((session) => session.enabled).length,
        usageHours: daily.usageHours,
        ahi: daily.ahi,
        rdi: daily.rdi,
        obstructive: daily.eventCounts.obstructive,
        clearAirway: daily.eventCounts.clearAirway,
        hypopnea: daily.eventCounts.hypopnea,
        unclassified: daily.eventCounts.unclassified,
        rera: daily.eventCounts.rera,
        eventIndices: daily.eventIndices,
        ...(daily.pressure ? { pressureAverage: daily.pressure.average, pressure95: daily.pressure.percentile95 } : {}),
        ...(daily.leak ? { leakAverage: daily.leak.average, leak95: daily.leak.percentile95 } : {}),
      });
    }
    return result;
  }

  getStatistics(machineId: MachineId, startDate: string, endDate: string): StatisticsSummary {
    const startRange = therapyDayRange(startDate, this.rolloverHour);
    const endRange = therapyDayRange(endDate, this.rolloverHour);
    if (endRange.startMs < startRange.startMs) throw new RangeError("endDate cannot be before startDate");

    const days = this.getOverview(machineId, startDate, endDate);
    const totalDays = days.length;
    const used = days.filter((day) => day.usageHours > 0);
    const totalUsageHours = used.reduce((total, day) => total + day.usageHours, 0);
    const usageValues = used.map((day) => day.usageHours).sort((a, b) => a - b);
    const eventCounts: EventCounts = {
      obstructive: days.reduce((total, day) => total + day.obstructive, 0),
      clearAirway: days.reduce((total, day) => total + day.clearAirway, 0),
      hypopnea: days.reduce((total, day) => total + day.hypopnea, 0),
      unclassified: days.reduce((total, day) => total + day.unclassified, 0),
      rera: days.reduce((total, day) => total + day.rera, 0),
    };
    const weightedRate = (selector: (day: OverviewDaySummary) => number) => totalUsageHours > 0
      ? days.reduce((total, day) => total + selector(day) * day.usageHours, 0) / totalUsageHours : 0;
    const eventIndices: EventIndices = {
      obstructive: weightedRate((day) => day.eventIndices.obstructive),
      clearAirway: weightedRate((day) => day.eventIndices.clearAirway),
      hypopnea: weightedRate((day) => day.eventIndices.hypopnea),
      unclassified: weightedRate((day) => day.eventIndices.unclassified),
      rera: weightedRate((day) => day.eventIndices.rera),
    };

    const rangeEndExclusive = endRange.endMs;
    const sessions = this.#sessionRows(machineId, startRange.startMs, rangeEndExclusive).filter((session) => session.enabled !== 0);
    const pressure = this.#channelStatistics(sessions, CpapChannel.Pressure, startRange.startMs, rangeEndExclusive);
    const leak = this.#channelStatistics(sessions, CpapChannel.Leak, startRange.startMs, rangeEndExclusive);

    return {
      machineId,
      startDate,
      endDate,
      totalDays,
      usedDays: used.length,
      compliantDays: used.filter((day) => day.usageHours >= 4).length,
      totalUsageHours,
      averageUsageHours: used.length ? totalUsageHours / used.length : 0,
      medianUsageHours: usageValues.length ? percentile(usageValues, 0.5) : 0,
      eventCounts,
      eventIndices,
      ahi: weightedRate((day) => day.ahi),
      rdi: weightedRate((day) => day.rdi),
      ...(pressure ? { pressure } : {}),
      ...(leak ? { leak } : {}),
      settingsHistory: this.#settingsHistory(sessions),
      days,
    };
  }

  getChartSeries(machineId: MachineId, date: string, channelIds: readonly ChannelId[], options: ChartQueryOptions = {}): ChartQueryResult {
    const day = therapyDayRange(date, this.rolloverHour);
    const rangeStartMs = Math.max(day.startMs, options.startMs ?? day.startMs);
    const rangeEndMs = Math.min(day.endMs, options.endMs ?? day.endMs);
    if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) {
      throw new RangeError("Chart query endMs must be greater than startMs inside the selected therapy day");
    }
    const maxPointsPerSeries = Math.max(64, Math.min(100_000, Math.floor(options.maxPointsPerSeries ?? 6_000)));
    const sessions = this.#sessionRows(machineId, rangeStartMs, rangeEndMs).filter((session) => session.enabled !== 0);
    const requested = new Set(channelIds);
    const series: ChartSeries[] = [];

    for (const session of sessions) {
      const rows = this.#eventListRows(session.row_id).filter((row) => requested.has(row.channel_id));
      for (const row of rows) {
        if (row.list_type === EventListType.Waveform) {
          const waveform = this.#waveformSeries(row, rangeStartMs, rangeEndMs, maxPointsPerSeries);
          if (waveform.timesMs.length === 0) continue;
          series.push({
            channelId: row.channel_id,
            listIndex: row.list_index,
            type: EventListType.Waveform,
            dimension: row.dimension,
            timesMs: waveform.timesMs,
            values: waveform.values,
            sourcePointCount: waveform.sourcePointCount,
            decimated: waveform.decimated,
          });
          continue;
        }

        const raw = bytesToInt16(row.raw_blob);
        const deltas = row.time_deltas_blob ? bytesToUint32(row.time_deltas_blob) : new Uint32Array();
        const raw2 = row.raw2_blob ? bytesToInt16(row.raw2_blob) : new Int16Array();
        const times: number[] = [];
        const values: number[] = [];
        const values2: number[] = [];
        for (let index = 0; index < raw.length; index += 1) {
          const delta = deltas[index];
          const sample = raw[index];
          if (delta === undefined || sample === undefined) continue;
          const time = row.first_ms + delta;
          if (time < rangeStartMs || time >= rangeEndMs) continue;
          times.push(time);
          values.push(sample * row.gain);
          const second = raw2[index];
          if (row.second_field !== 0 && second !== undefined) values2.push(second);
        }
        if (times.length === 0) continue;
        series.push({
          channelId: row.channel_id,
          listIndex: row.list_index,
          type: EventListType.Event,
          dimension: row.dimension,
          timesMs: Float64Array.from(times),
          values: Float32Array.from(values),
          ...(values2.length ? { values2: Float32Array.from(values2) } : {}),
          sourcePointCount: times.length,
          decimated: false,
        });
      }
    }

    return { machineId, date, rangeStartMs, rangeEndMs, series };
  }

  #waveformSeries(row: EventListRow, startMs: number, endMs: number, maxPoints: number): { timesMs: Float64Array; values: Float32Array; sourcePointCount: number; decimated: boolean } {
    const rateMs = row.rate_ms;
    if (!(rateMs > 0)) return { timesMs: new Float64Array(), values: new Float32Array(), sourcePointCount: 0, decimated: false };

    const chunks = this.#db.prepare(`
      SELECT start_sample, sample_count, start_ms, end_ms, raw_blob
      FROM waveform_chunks
      WHERE event_list_id = ? AND end_ms > ? AND start_ms < ?
      ORDER BY start_sample
    `).all(row.id, startMs, endMs) as WaveformChunkRow[];

    // Compatibility fallback for databases that have not yet been opened through OscarDatabase v2.
    const sources: Array<{ startSample: number; raw: Int16Array }> = chunks.length
      ? chunks.map((chunk) => ({ startSample: chunk.start_sample, raw: bytesToInt16(chunk.raw_blob) }))
      : row.raw_blob.length ? [{ startSample: 0, raw: bytesToInt16(row.raw_blob) }] : [];

    const firstIndex = Math.max(0, Math.ceil((startMs - row.first_ms) / rateMs));
    const lastIndexExclusive = Math.max(firstIndex, Math.ceil((endMs - row.first_ms) / rateMs));
    let sourcePointCount = 0;
    for (const source of sources) {
      const localStart = Math.max(0, firstIndex - source.startSample);
      const localEnd = Math.min(source.raw.length, lastIndexExclusive - source.startSample);
      if (localEnd > localStart) sourcePointCount += localEnd - localStart;
    }
    if (sourcePointCount === 0) return { timesMs: new Float64Array(), values: new Float32Array(), sourcePointCount: 0, decimated: false };

    if (sourcePointCount <= maxPoints) {
      const times = new Float64Array(sourcePointCount);
      const values = new Float32Array(sourcePointCount);
      let output = 0;
      for (const source of sources) {
        const localStart = Math.max(0, firstIndex - source.startSample);
        const localEnd = Math.min(source.raw.length, lastIndexExclusive - source.startSample);
        for (let local = localStart; local < localEnd; local += 1) {
          const sample = source.raw[local];
          if (sample === undefined) continue;
          const absoluteIndex = source.startSample + local;
          times[output] = row.first_ms + absoluteIndex * rateMs;
          values[output] = sample * row.gain + row.offset;
          output += 1;
        }
      }
      return { timesMs: times.subarray(0, output), values: values.subarray(0, output), sourcePointCount, decimated: false };
    }

    // Preserve narrow peaks by retaining each time bucket's minimum and maximum in chronological order.
    const bucketCount = Math.max(1, Math.floor(maxPoints / 2));
    const duration = endMs - startMs;
    const minValues = new Float64Array(bucketCount); minValues.fill(Number.POSITIVE_INFINITY);
    const maxValues = new Float64Array(bucketCount); maxValues.fill(Number.NEGATIVE_INFINITY);
    const minTimes = new Float64Array(bucketCount);
    const maxTimes = new Float64Array(bucketCount);
    for (const source of sources) {
      const localStart = Math.max(0, firstIndex - source.startSample);
      const localEnd = Math.min(source.raw.length, lastIndexExclusive - source.startSample);
      for (let local = localStart; local < localEnd; local += 1) {
        const sample = source.raw[local];
        if (sample === undefined) continue;
        const absoluteIndex = source.startSample + local;
        const time = row.first_ms + absoluteIndex * rateMs;
        const value = sample * row.gain + row.offset;
        const bucket = Math.max(0, Math.min(bucketCount - 1, Math.floor(((time - startMs) / duration) * bucketCount)));
        if (value < minValues[bucket]!) { minValues[bucket] = value; minTimes[bucket] = time; }
        if (value > maxValues[bucket]!) { maxValues[bucket] = value; maxTimes[bucket] = time; }
      }
    }
    const times: number[] = [];
    const values: number[] = [];
    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const min = minValues[bucket];
      const max = maxValues[bucket];
      if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max)) continue;
      const minTime = minTimes[bucket] ?? 0;
      const maxTime = maxTimes[bucket] ?? 0;
      if (minTime <= maxTime) {
        times.push(minTime); values.push(min);
        if (maxTime !== minTime) { times.push(maxTime); values.push(max); }
      } else {
        times.push(maxTime); values.push(max);
        times.push(minTime); values.push(min);
      }
    }
    return { timesMs: Float64Array.from(times), values: Float32Array.from(values), sourcePointCount, decimated: true };
  }

  #sessionRows(machineId: MachineId, startMs: number, endMs: number): SessionRow[] {
    return this.#db.prepare(`
      SELECT row_id, id, first_ms, last_ms, enabled, summary_only
      FROM sessions
      WHERE machine_id = ? AND first_ms < ? AND last_ms >= ?
      ORDER BY first_ms, id
    `).all(machineId, endMs, startMs) as SessionRow[];
  }

  #settings(sessionRowId: number): Record<number, SettingValue> {
    const rows = this.#db.prepare(`
      SELECT channel_id, value_type, value_text
      FROM session_settings
      WHERE session_row_id = ?
      ORDER BY channel_id
    `).all(sessionRowId) as SettingRow[];
    const result: Record<number, SettingValue> = {};
    for (const row of rows) result[row.channel_id] = deserializeSetting(row.value_type, row.value_text);
    return result;
  }

  #deviceTimeZone(machineId: MachineId): string {
    const row = this.#db.prepare("SELECT device_time_zone FROM machines WHERE id = ?").get(machineId) as { device_time_zone: string } | undefined;
    return row?.device_time_zone || "UTC";
  }

  #usageMs(session: SessionRow, rangeStart: number, rangeEnd: number): number {
    const slices = this.#db.prepare(`
      SELECT start_ms, end_ms, status
      FROM session_slices
      WHERE session_row_id = ?
      ORDER BY slice_index
    `).all(session.row_id) as SliceRow[];
    const maskOn = slices.filter((slice) => slice.status === 2);
    if (maskOn.length === 0) return overlapMs(session.first_ms, session.last_ms, rangeStart, rangeEnd);
    return maskOn.reduce((total, slice) => total + overlapMs(slice.start_ms, slice.end_ms, rangeStart, rangeEnd), 0);
  }

  #eventListRows(sessionRowId: number): EventListRow[] {
    return this.#db.prepare(`
      SELECT id, channel_id, list_index, list_type, gain, offset, rate_ms, dimension,
             first_ms, duration_ms, second_field, raw_blob, raw2_blob, time_deltas_blob
      FROM event_lists
      WHERE session_row_id = ?
      ORDER BY channel_id, list_index
    `).all(sessionRowId) as EventListRow[];
  }

  #countEvents(sessions: readonly SessionRow[], channelId: ChannelId, startMs: number, endMs: number): number {
    let count = 0;
    for (const session of sessions) {
      const rows = this.#eventListRows(session.row_id).filter((row) => row.channel_id === channelId && row.list_type === EventListType.Event);
      for (const row of rows) {
        const deltas = row.time_deltas_blob ? bytesToUint32(row.time_deltas_blob) : new Uint32Array();
        for (const delta of deltas) {
          const time = row.first_ms + delta;
          if (time >= startMs && time < endMs) count += 1;
        }
      }
    }
    return count;
  }

  #channelStatistics(sessions: readonly SessionRow[], channelId: ChannelId, startMs: number, endMs: number): ChannelStatistics | undefined {
    const values: number[] = [];
    for (const session of sessions) {
      const rows = this.#eventListRows(session.row_id).filter((row) => row.channel_id === channelId);
      for (const row of rows) {
        if (row.list_type === EventListType.Waveform) {
          const waveform = this.#waveformSeries(row, startMs, endMs, 100_000);
          // Statistics must use every point. If the range exceeds the chart helper cap, stream the chunks directly.
          if (!waveform.decimated) { values.push(...waveform.values); continue; }
          const chunks = this.#db.prepare(`
            SELECT start_sample, sample_count, start_ms, end_ms, raw_blob
            FROM waveform_chunks WHERE event_list_id = ? AND end_ms > ? AND start_ms < ? ORDER BY start_sample
          `).all(row.id, startMs, endMs) as WaveformChunkRow[];
          const sources: Array<{ startSample: number; raw: Int16Array }> = chunks.length
            ? chunks.map((chunk) => ({ startSample: chunk.start_sample, raw: bytesToInt16(chunk.raw_blob) }))
            : row.raw_blob.length ? [{ startSample: 0, raw: bytesToInt16(row.raw_blob) }] : [];
          const firstIndex = Math.max(0, Math.ceil((startMs - row.first_ms) / row.rate_ms));
          const lastIndexExclusive = Math.max(firstIndex, Math.ceil((endMs - row.first_ms) / row.rate_ms));
          for (const source of sources) {
            const localStart = Math.max(0, firstIndex - source.startSample);
            const localEnd = Math.min(source.raw.length, lastIndexExclusive - source.startSample);
            for (let local = localStart; local < localEnd; local += 1) {
              const sample = source.raw[local];
              if (sample !== undefined) values.push(sample * row.gain + row.offset);
            }
          }
        } else {
          const raw = bytesToInt16(row.raw_blob);
          const deltas = row.time_deltas_blob ? bytesToUint32(row.time_deltas_blob) : new Uint32Array();
          for (let index = 0; index < raw.length; index += 1) {
            const delta = deltas[index];
            const sample = raw[index];
            if (delta === undefined || sample === undefined) continue;
            const time = row.first_ms + delta;
            if (time >= startMs && time < endMs) values.push(sample * row.gain);
          }
        }
      }
    }
    if (values.length === 0) return undefined;
    values.sort((a, b) => a - b);
    const sum = values.reduce((total, value) => total + value, 0);
    return {
      channelId,
      count: values.length,
      min: values[0] ?? 0,
      max: values[values.length - 1] ?? 0,
      average: sum / values.length,
      percentile50: percentile(values, 0.5),
      percentile95: percentile(values, 0.95),
    };
  }

  #settingsHistory(sessions: readonly SessionRow[]): SettingHistoryEntry[] {
    const history: SettingHistoryEntry[] = [];
    let currentKey: string | undefined;

    for (const session of [...sessions].sort((a, b) => a.first_ms - b.first_ms || a.id - b.id)) {
      const allSettings = this.#settings(session.row_id);
      const settings = Object.fromEntries(Object.entries(allSettings).filter(([id]) => !isSummaryMetricSetting(Number(id)))) as Record<number, SettingValue>;
      const key = Object.entries(settings)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([id, value]) => {
          const encoded = value instanceof Date ? `date:${value.getTime()}` : `${typeof value}:${String(value)}`;
          return `${id}=${encoded}`;
        })
        .join("|");
      const date = therapyDateForTimestamp(session.first_ms, this.rolloverHour);
      const previous = history[history.length - 1];
      if (previous && key === currentKey) {
        previous.endDate = date;
        previous.lastMs = Math.max(previous.lastMs, session.last_ms);
        previous.sessionCount += 1;
        continue;
      }
      history.push({
        startDate: date,
        endDate: date,
        firstMs: session.first_ms,
        lastMs: session.last_ms,
        sessionCount: 1,
        settings,
      });
      currentKey = key;
    }
    return history;
  }

  #availableChannels(sessions: readonly SessionRow[]): ChannelId[] {
    if (sessions.length === 0) return [];
    const rowIds = sessions.map((session) => session.row_id);
    const placeholders = rowIds.map(() => "?").join(",");
    const rows = this.#db.prepare(`
      SELECT DISTINCT channel_id
      FROM event_lists
      WHERE session_row_id IN (${placeholders})
      ORDER BY channel_id
    `).all(...rowIds) as Array<{ channel_id: number }>;
    return rows.map((row) => row.channel_id);
  }
}

// Referenced here so settings used by Daily UI remain part of this backend contract.
export const DAILY_PRIMARY_SETTINGS = Object.freeze([
  CpapSetting.Mode,
  CpapSetting.SetPressure,
  CpapSetting.PressureMin,
  CpapSetting.PressureMax,
  CpapSetting.EPRMode,
  CpapSetting.EPRLevel,
  CpapSetting.RampEnabled,
]);
