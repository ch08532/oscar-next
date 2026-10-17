import type { ExpertFinding } from "./schemas.js";
import type { ToolResult } from "./tool-types.js";
import type { DailySummary, StatisticsSummary } from "../storage/queries.js";
import type { DailyChannelAnalysis } from "../core/therapy-analysis.js";

/** Descriptive measured facts only; no diagnosis, guessed causes or clinical cutoffs. */
export function measuredFindings(result: ToolResult): ExpertFinding[] {
  const data = result.data as Partial<DailySummary> & { analysis?: DailyChannelAnalysis; current?: StatisticsSummary; baseline?: StatisticsSummary };
  const facts: ExpertFinding[] = [];
  const add = (type: string, title: string, value: number, unit: string) => facts.push({ id: `${result.evidence.id}:${type}`, type, title, severity: "info", measurement: { value, unit }, evidence: [result.evidence.id] });
  if (typeof data.ahi === "number") add("ahi", "OSCAR-calculated AHI", data.ahi, "events/h");
  if (typeof data.usageHours === "number") add("usage", "Included therapy usage", data.usageHours, "h");
  if (data.analysis?.leak) add("leak-time", "Recorded time above configured leak threshold", data.analysis.leak.secondsAboveThreshold, "s");
  if (data.pressure) add("pressure95", "Recorded pressure 95th percentile", data.pressure.percentile95, "cmH2O");
  const oxygen = data.analysis?.channels.find(channel => channel.channelId === 201);
  if (oxygen) add("oxygen-min", "Minimum recorded SpO2; sensor validity is not established", oxygen.min, "%");
  if (data.current?.usedDays && data.baseline?.usedDays) {
    facts.push({ id: `${result.evidence.id}:ahi-change`,type:"ahi-change",title:"AHI compared with selected personal baseline",severity:"info",measurement:{ value:data.current.ahi,baseline:data.baseline.ahi,unit:"events/h" },evidence:[result.evidence.id] });
  }
  return facts;
}
