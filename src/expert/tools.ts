import * as z from "zod/v4";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { OscarQueries, therapyDayRange, type DailySummary } from "../storage/queries.js";
import { queryDailyChannelAnalysis } from "../storage/daily-analysis.js";
import { CpapChannel as C } from "../core/cpap-channels.js";
import { EventListType } from "../core/event-list.js";
import { dateSchema, rangeSchema, windowSchema, scopeSchema, type EvidenceReference } from "./schemas.js";
import type { ToolResult, ExpertToolOutputs } from "./tool-types.js";
import type { DailyChannelAnalysis } from "../core/therapy-analysis.js";
import { SCHEMA_VERSION } from "../storage/database.js";

const events = [C.ObstructiveApnea, C.ClearAirway, C.Hypopnea, C.UnclassifiedApnea, C.RERA, C.CSR];
const channels = [C.MaskPressureHigh, C.MaskPressure, C.Pressure, C.IPAP, C.EPAP, C.Leak, C.RespRate, C.MinuteVent, C.TidalVolume, C.Snore, C.FlowLimitation, C.IERatio, C.InspiratoryTime, C.ExpiratoryTime, C.TargetMinuteVent, C.Pulse, C.SpO2];
export const toolRegistry = {
  get_night_summary: { description: "Included-session measurements for one therapy night, with summary provenance; no identity or raw samples.", schema: z.object({ date: dateSchema }).strict() },
  get_events: { description: "Exact detailed event times in a half-open therapy-day window. Summary indices do not imply event records.", schema: z.object({ date: dateSchema, startMs: z.number().finite().optional(), endMs: z.number().finite().optional(), eventTypes: z.array(z.number().int()).max(6).optional() }).strict().refine(value => windowSchema.safeParse({ date: value.date, ...(value.startMs !== undefined ? { startMs: value.startMs } : {}), ...(value.endMs !== undefined ? { endMs: value.endMs } : {}) }).success, "Invalid therapy-day window") },
  get_statistics: { description: "Existing OSCAR aggregate and nightly measurements for 1–90 calendar days.", schema: rangeSchema },
  compare_ranges: { description: "Deterministic comparisons of two bounded ranges including personal nightly medians.", schema: z.object({ current: rangeSchema, baseline: rangeSchema }).strict() },
  get_pressure_analysis: { description: "Recorded pressure channel statistics and included-session settings for one night/window. No inferred pressure ceiling algorithm.", schema: windowSchema },
  get_leak_analysis: { description: "Elapsed-time leak statistics, configured threshold and time above it; missing coverage stays unknown.", schema: windowSchema },
  get_oximetry_summary: { description: "Existing SpO2/pulse statistics and coverage; no invented desaturation diagnosis.", schema: windowSchema },
  get_waveform_features: { description: "Existing raw-sample elapsed-weighted channel summaries, never raw arrays. Signed Flow features are unsupported.", schema: z.object({ date: dateSchema, startMs: z.number().finite(), endMs: z.number().finite(), channels: z.array(z.number().int()).min(1).max(8) }).strict().refine(value => value.endMs > value.startMs && value.endMs - value.startMs <= 3_600_000, "Feature window must be at most one hour") },
} as const;
export type ToolName = keyof typeof toolRegistry;
export function isToolName(name: string): name is ToolName { return Object.hasOwn(toolRegistry, name); }

export class ExpertTools {
  readonly queries: OscarQueries;
  readonly #db: DatabaseSync;
  readonly scope: { profileId: number; machineId: number };
  readonly evidence = new Map<string, EvidenceReference>();
  readonly #cache = new Map<string, ToolResult>();
  readonly #nights = new Map<string, DailySummary>();
  readonly #analyses = new Map<string, DailyChannelAnalysis>();
  constructor(path: string, scope: { profileId: number; machineId: number }) {
    this.scope = scopeSchema.parse(scope);
    this.#db = new DatabaseSync(path, { readOnly: true });
    try {
      this.#db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=2000");
      const schema = this.#db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version:number } | undefined;
      if (schema?.version !== SCHEMA_VERSION) throw new Error("Open this database in OSCAR Next to migrate it before using Expert tools");
      const machine = this.#db.prepare("SELECT profile_id FROM machines WHERE id=?").get(scope.machineId) as { profile_id: number } | undefined;
      if (!machine || machine.profile_id !== scope.profileId) throw new Error("Selected machine does not belong to this profile");
      this.queries = new OscarQueries(path);
    } catch (error) { this.#db.close(); throw error; }
  }
  close(): void { this.queries.close(); this.#db.close(); }
  clearCache(): void { this.#cache.clear(); this.#nights.clear(); this.#analyses.clear(); this.evidence.clear(); }
  night(date: string): DailySummary { let day = this.#nights.get(date); if (!day) { day=this.queries.getDaily(this.scope.machineId,date); this.#nights.set(date,day); } return day; }
  private analysis(date: string, start: number, end: number): DailyChannelAnalysis {
    const key = `${date}:${start}:${end}`; let result = this.#analyses.get(key);
    if (!result) { result=queryDailyChannelAnalysis(this.#db,this.scope.machineId,date,start,end); this.#analyses.set(key,result); } return result;
  }
  call<N extends ToolName>(name: N, raw: unknown): ToolResult<N>;
  call(name: string, raw: unknown): ToolResult;
  call(name: string, raw: unknown): ToolResult {
    if (!isToolName(name)) throw new Error("Unknown Expert tool");
    const input = toolRegistry[name].schema.parse(raw) as Record<string, unknown>;
    const key = `${name}:${JSON.stringify(input)}`;
    const cached = this.#cache.get(key); if (cached) return cached;
    const machineId = this.scope.machineId, limitations: string[] = [];
    let data: ExpertToolOutputs[ToolName], reference: Omit<EvidenceReference, "id" | "profileId" | "machineId">;
    if (name === "get_statistics" || name === "compare_ranges") {
      const get = (range: { startDate: string; endDate: string }) => this.queries.getStatistics(machineId, range.startDate, range.endDate);
      const range = (name === "compare_ranges" ? input.current : input) as { startDate: string; endDate: string };
      const current = get(range);
      reference = { ...range, label: name === "compare_ranges" ? "Period comparison" : "Period statistics" };
      if (name === "compare_ranges") {
        const baseline = get(input.baseline as typeof range);
        const median = (values: number[]) => { values.sort((a,b) => a-b); const i = Math.floor(values.length/2); return values.length ? (values[i]! + values[Math.floor((values.length-1)/2)]!)/2 : null; };
        const comparable = current.usedDays > 0 && baseline.usedDays > 0;
        data = { current, baseline, change: { ahi: comparable ? current.ahi-baseline.ahi : null, rdi: comparable ? current.rdi-baseline.rdi : null, averageUsageHours: comparable ? current.averageUsageHours-baseline.averageUsageHours : null }, medianNightlyAhi: { current: median(current.days.filter(day => day.usageHours > 0).map(day => day.ahi)), baseline: median(baseline.days.filter(day => day.usageHours > 0).map(day => day.ahi)) } };
        limitations.push("Comparisons describe measurements, not causes. Empty ranges are not a zero-valued personal baseline.");
      } else data = current;
    } else {
      const date = String(input.date), day = therapyDayRange(date);
      const startMs = typeof input.startMs === "number" ? input.startMs : day.startMs, endMs = typeof input.endMs === "number" ? input.endMs : day.endMs;
      windowSchema.parse({ date, startMs, endMs });
      reference = { date, startMs, endMs, label: name.replaceAll("_", " ") };
      if (name === "get_night_summary") {
        const { machineId: _machine, deviceTimeZone: _zone, sessions, ...night } = this.night(date);
        const analysis = this.analysis(date,startMs,endMs);
        const apneaHypopneaCount = night.eventCounts.obstructive + night.eventCounts.clearAirway + night.eventCounts.hypopnea + night.eventCounts.unclassified;
        data = { ...night, includedSessions: sessions.filter(s => s.enabled).map(({ firstMs, lastMs, summaryOnly, settings }) => ({ firstMs, lastMs, summaryOnly, settings })), analysis, summaryDerivedIndices: night.ahi > 0 && apneaHypopneaCount === 0 };
        limitations.push("Device wall-clock time; noon-to-noon therapy dates. Summary rates do not establish detailed events. Missing channels are unknown.");
        if (analysis.therapySeconds === 0) limitations.push("No included therapy data for this date; zero-valued rates are empty-summary defaults, not measured normal results.");
      } else if (name === "get_events") {
        const ids = (input.eventTypes ?? events) as number[];
        if (ids.some(id => !events.includes(id))) throw new Error("Unsupported event type");
        const chart = this.queries.getChartSeries(machineId, date, ids, { startMs, endMs });
        const records = chart.series.filter(s => s.type === EventListType.Event).flatMap(s => Array.from(s.timesMs, (time, i) => ({ channelId: s.channelId, timeMs: time, durationSeconds: s.values[i] ?? 0 }))).filter(e => e.timeMs >= startMs && e.timeMs < endMs).sort((a,b) => a.timeMs-b.timeMs);
        data = { events: records.slice(0,1000), total: records.length, truncated: records.length > 1000 };
        limitations.push("No detailed events does not imply zero AHI. At most 1000 exact event records returned.");
      } else {
        const analysis = this.analysis(date,startMs,endMs);
        const requested = name === "get_pressure_analysis" ? [C.MaskPressureHigh,C.MaskPressure,C.Pressure,C.IPAP,C.EPAP] : name === "get_leak_analysis" ? [C.Leak] : name === "get_oximetry_summary" ? [C.SpO2,C.Pulse] : input.channels as number[];
        if (requested.some(id => !channels.includes(id))) throw new Error("Unsupported feature channel; signed Flow/derived breath algorithms are not available");
        data = { therapySeconds: analysis.therapySeconds, channels: analysis.channels.filter(c => requested.includes(c.channelId)), ...(name === "get_leak_analysis" ? { leak: analysis.leak ?? null } : {}), ...(name === "get_pressure_analysis" ? { sessionSettings: this.night(date).sessions.filter(s => s.enabled && s.firstMs < endMs && s.lastMs > startMs).map(s => ({ startMs: Math.max(startMs,s.firstMs), endMs: Math.min(endMs,s.lastMs), settings: s.settings })) } : {}) };
        limitations.push("Recorded sample coverage only; missing measurements are unknown. No inferred pauses, desaturations or pressure-ceiling algorithm.");
      }
    }
    // Keep IDs bounded independently of the size of validated tool arguments.
    const id = `p${this.scope.profileId}:m${machineId}:${name}:${createHash("sha256").update(key).digest("hex").slice(0,24)}`;
    const evidence = { ...this.scope, ...reference, id };
    this.evidence.set(id, evidence);
    const result = { evidence, data, limitations };
    if (JSON.stringify(result).length > 120_000) throw new Error("Expert tool result exceeds context limit; request a shorter range/window");
    this.#cache.set(key, result); return result;
  }
}
