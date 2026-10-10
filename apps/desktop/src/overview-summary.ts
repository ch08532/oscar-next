import type { OverviewDaySummary } from "./types.js";

export function filterOverviewDays(history: readonly OverviewDaySummary[], startDate: string, endDate: string): OverviewDaySummary[] {
  return history.filter((day) => day.date >= startDate && day.date <= endDate);
}

function finiteAverage(values: readonly (number | undefined)[]): number {
  const finite = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

export interface OverviewSummary {
  usedDays: number;
  totalDays: number;
  totalUsage: number;
  averageUsage: number;
  ahi: number;
  rdi: number;
  compliantDays: number;
  pressure95: number;
  leak95: number;
}

export function summarizeOverviewDays(days: readonly OverviewDaySummary[]): OverviewSummary {
  const used = days.filter((day) => day.usageHours > 0);
  const totalUsage = used.reduce((sum, day) => sum + day.usageHours, 0);
  const weighted = (selector: (day: OverviewDaySummary) => number) => totalUsage > 0
    ? used.reduce((sum, day) => sum + selector(day) * day.usageHours, 0) / totalUsage : 0;
  return {
    usedDays: used.length,
    totalDays: days.length,
    totalUsage,
    averageUsage: used.length ? totalUsage / used.length : 0,
    ahi: weighted((day) => day.ahi),
    rdi: weighted((day) => day.rdi),
    compliantDays: used.filter((day) => day.usageHours >= 4).length,
    pressure95: finiteAverage(used.map((day) => day.pressure95)),
    leak95: finiteAverage(used.map((day) => day.leak95)),
  };
}
