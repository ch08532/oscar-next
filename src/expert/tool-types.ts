import type { DailySummary, DailySessionSummary, StatisticsSummary } from "../storage/queries.js";
import type { DailyChannelAnalysis, DailyChannelStatistics } from "../core/therapy-analysis.js";
import type { EvidenceReference } from "./schemas.js";

export interface NightSummary extends Omit<DailySummary,"machineId" | "deviceTimeZone" | "sessions"> {
  includedSessions: Array<Pick<DailySessionSummary,"firstMs" | "lastMs" | "summaryOnly" | "settings">>;
  analysis: DailyChannelAnalysis;
  summaryDerivedIndices: boolean;
}
export interface ExactEvents { events: Array<{ channelId:number; timeMs:number; durationSeconds:number }>; total:number; truncated:boolean; }
export interface RangeComparison { current:StatisticsSummary; baseline:StatisticsSummary; change:{ ahi:number|null; rdi:number|null; averageUsageHours:number|null }; medianNightlyAhi:{ current:number|null; baseline:number|null }; }
export interface ChannelFeatures { therapySeconds:number; channels:DailyChannelStatistics[]; leak?:DailyChannelAnalysis["leak"] | null; sessionSettings?:Array<{ startMs:number; endMs:number; settings:DailySessionSummary["settings"] }>; }
export interface ExpertToolOutputs {
  get_night_summary:NightSummary; get_events:ExactEvents; get_statistics:StatisticsSummary;
  compare_ranges:RangeComparison; get_pressure_analysis:ChannelFeatures;
  get_leak_analysis:ChannelFeatures; get_oximetry_summary:ChannelFeatures; get_waveform_features:ChannelFeatures;
}
export type ToolResult<N extends keyof ExpertToolOutputs = keyof ExpertToolOutputs> = { evidence:EvidenceReference; data:ExpertToolOutputs[N]; limitations:string[] };
