import { useEffect, useMemo, useState } from "react";
import type { OverviewDaySummary, StoredMachineSummary, TherapyHistoryDay } from "./types";
import { TherapyDateRange } from "./TherapyDateRange";
import { summarizeOverviewDays } from "./overview-summary";
import { Card, MetricCard, CalculatingIndicator } from "./ui";
import { BarChart } from "./components/tremor/BarChart";
import { LineChart } from "./components/tremor/LineChart";
import type { AvailableChartColorsKeys } from "./components/tremor/chartColors";

type OverviewMetric = "usage" | "ahi" | "events" | "pressure" | "leak";

type SeriesDefinition = {
  label: string;
  getValue: (day: OverviewDaySummary) => number | undefined;
  className: string;
};

interface OverviewProps {
  machine: StoredMachineSummary;
  machineId: number;
  defaultEndDate: string;
  toolbarTarget?: HTMLElement | null;
}

const DAY_MS = 86_400_000;

function dateKeyFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date: string, amount: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  return dateKeyFromMs(ms + amount * DAY_MS);
}

function therapyDateFromTimestamp(ms: number): string {
  return dateKeyFromMs(ms - 12 * 3_600_000);
}

function formatHours(hours: number): string {
  return `${hours.toFixed(hours >= 10 ? 1 : 2)} h`;
}

function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
}

function TrendChart({ title, subtitle, days, series, kind = "line", threshold, unit = "" }: {
  title: string; subtitle: string; days: OverviewDaySummary[]; series: SeriesDefinition[];
  kind?: "line" | "bar" | "stacked"; threshold?: number; unit?: string;
}) {
  const chartData = days.map(day => Object.fromEntries([
    ["date", day.date], ...series.map(definition => {
      const value = definition.getValue(day);
      return [definition.label, value !== undefined && Number.isFinite(value) ? value : null];
    }),
  ]));
  const palette: Record<string, AvailableChartColorsKeys> = {
    "series-usage": "blue", "series-ahi": "blue", "series-rdi": "cyan",
    "series-oa": "violet", "series-ca": "cyan", "series-h": "blue", "series-ua": "gray", "series-rera": "amber",
    "series-pressure-average": "cyan", "series-pressure-95": "blue", "series-leak-average": "emerald", "series-leak-95": "amber",
  };
  const categories = series.map(definition => definition.label);
  const colors = series.map(definition => palette[definition.className] ?? "blue");
  const maximum = Math.max(threshold ?? 0, ...days.map(day => kind === "stacked"
    ? series.reduce((total, definition) => total + (definition.getValue(day) ?? 0), 0)
    : Math.max(0, ...series.map(definition => definition.getValue(day) ?? 0))));
  const shared = {
    data: chartData, index: "date", categories, colors, className: "h-64 w-full",
    valueFormatter: (value: number) => `${value.toFixed(1)}${unit ? ` ${unit}` : ""}`,
    yAxisWidth: 72, maxValue: niceMax(maximum), minValue: 0, legendPosition: "left" as const,
    referenceLine: threshold === undefined ? undefined : { value: threshold, label: `${threshold} ${unit}` },
  };
  return <Card className="overview-chart-card border-[var(--border)] bg-[var(--surface)] p-5 shadow-none dark:border-[var(--border)] dark:bg-[var(--surface)]">
    <div className="mb-4"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p></div>
    {days.length ? kind === "line" ? <LineChart {...shared} connectNulls={false} /> : <BarChart {...shared} type={kind === "stacked" ? "stacked" : "default"} /> : <div className="graph-empty">No values in this range</div>}
  </Card>;
}

export function Overview({ machine, machineId, defaultEndDate, toolbarTarget }: OverviewProps) {
  const machineFirst = machine.firstSessionTime !== undefined ? therapyDateFromTimestamp(machine.firstSessionTime) : addDays(defaultEndDate, -29);
  const machineLast = machine.lastSessionTime !== undefined ? therapyDateFromTimestamp(machine.lastSessionTime) : defaultEndDate;
  const [startDate, setStartDate] = useState(() => machineFirst > addDays(defaultEndDate, -29) ? machineFirst : addDays(defaultEndDate, -29));
  const [endDate, setEndDate] = useState(() => machineLast < defaultEndDate ? machineLast : defaultEndDate);
  const [history, setHistory] = useState<TherapyHistoryDay[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string>();
  const [days, setDays] = useState<OverviewDaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [activeMetric, setActiveMetric] = useState<OverviewMetric>("usage");

  useEffect(() => {
    const nextLast = machine.lastSessionTime !== undefined ? therapyDateFromTimestamp(machine.lastSessionTime) : defaultEndDate;
    const nextFirst = machine.firstSessionTime !== undefined ? therapyDateFromTimestamp(machine.firstSessionTime) : addDays(nextLast, -29);
    setEndDate(nextLast);
    setStartDate(nextFirst > addDays(nextLast, -29) ? nextFirst : addDays(nextLast, -29));
  }, [machineId, machine.firstSessionTime, machine.lastSessionTime, defaultEndDate]);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setHistoryLoading(true);
    setHistoryError(undefined);
    window.oscar.getTherapyHistory(machineId, machineFirst, machineLast).then((result) => {
      if (!cancelled) setHistory(result);
    }).catch((cause) => {
      if (!cancelled) setHistoryError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, machineFirst, machineLast]);

  useEffect(() => {
    let cancelled = false;
    setDays([]);
    setLoading(true);
    setError(undefined);
    if (!startDate || !endDate || endDate < startDate) {
      setLoading(false);
      return;
    }
    // Avoid expensive metric requests for intermediate positions during a drag.
    const timer = window.setTimeout(() => {
      window.oscar.getOverview(machineId, startDate, endDate).then((result) => {
        if (!cancelled) setDays(result);
      }).catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [machineId, startDate, endDate]);
  const stats = useMemo(() => summarizeOverviewDays(days), [days]);

  const usageSeries: SeriesDefinition[] = [{ label: "Usage", getValue: (day) => day.usageHours, className: "series-usage" }];
  const ahiSeries: SeriesDefinition[] = [
    { label: "AHI", getValue: (day) => day.ahi, className: "series-ahi" },
    { label: "RDI", getValue: (day) => day.rdi, className: "series-rdi" },
  ];
  const eventSeries: SeriesDefinition[] = [
    { label: "OA", getValue: (day) => day.eventIndices.obstructive, className: "series-oa" },
    { label: "CA", getValue: (day) => day.eventIndices.clearAirway, className: "series-ca" },
    { label: "H", getValue: (day) => day.eventIndices.hypopnea, className: "series-h" },
    { label: "UA", getValue: (day) => day.eventIndices.unclassified, className: "series-ua" },
    { label: "RERA", getValue: (day) => day.eventIndices.rera, className: "series-rera" },
  ];
  const pressureSeries: SeriesDefinition[] = [
    { label: "Average", getValue: (day) => day.pressureAverage, className: "series-pressure-average" },
    { label: "95%", getValue: (day) => day.pressure95, className: "series-pressure-95" },
  ];
  const leakSeries: SeriesDefinition[] = [
    { label: "Average", getValue: (day) => day.leakAverage, className: "series-leak-average" },
    { label: "95%", getValue: (day) => day.leak95, className: "series-leak-95" },
  ];

  return <>
    <TherapyDateRange toolbarTarget={toolbarTarget} firstDate={machineFirst} lastDate={machineLast} startDate={startDate} endDate={endDate} days={history} loading={historyLoading} onChange={(start, end) => { setStartDate(start); setEndDate(end); }} />

    {error && <div className="error" role="alert">{error}</div>}
    {historyError && <div className="error">Unable to load therapy history: {historyError}</div>}
    {loading && <CalculatingIndicator />}

    {!loading && !error && <>
    <section className="metrics overview-metrics">
      <MetricCard label="Days used" value={`${stats.usedDays} / ${stats.totalDays}`} detail={stats.totalDays ? `${((stats.usedDays / stats.totalDays) * 100).toFixed(0)}% of selected days` : "No days selected"} />
      <MetricCard label="Average usage" value={formatHours(stats.averageUsage)} detail={`${stats.totalUsage.toFixed(1)} h total`} />
      <MetricCard label="AHI" value={stats.ahi.toFixed(2)} detail={`RDI ${stats.rdi.toFixed(2)}`} />
      <MetricCard label="≥ 4 hours" value={`${stats.compliantDays}`} detail={stats.usedDays ? `${((stats.compliantDays / stats.usedDays) * 100).toFixed(0)}% of used days` : "No used days"} />
      <MetricCard label="Avg pressure 95%" value={stats.pressure95 ? `${stats.pressure95.toFixed(1)} cmH₂O` : "—"} />
      <MetricCard label="Avg leak 95%" value={days.some(day => day.usageHours > 0 && day.leak95 !== undefined) ? `${stats.leak95.toFixed(1)} L/min` : "—"} />
    </section>

    <section className="overview-tabs" aria-label="Overview metric shortcuts">
      {(["usage", "ahi", "events", "pressure", "leak"] as const).map((metric) => <button key={metric} className={activeMetric === metric ? "active" : "secondary"} onClick={() => { setActiveMetric(metric); document.getElementById(`overview-${metric}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>{metric === "ahi" ? "AHI / RDI" : metric[0]?.toUpperCase() + metric.slice(1)}</button>)}
    </section>

    {days.length === 0 && !loading ? <section className="empty"><h2>No therapy data in this range</h2><p>Choose another date range or machine.</p></section> : <section className="overview-grid">
      <div id="overview-usage"><TrendChart title="Usage" subtitle="Hours of mask-on therapy per night" days={days} series={usageSeries} kind="bar" threshold={4} unit="h" /></div>
      <div id="overview-ahi"><TrendChart title="AHI / RDI" subtitle="Respiratory events per therapy hour" days={days} series={ahiSeries} threshold={5} unit="/h" /></div>
      <div id="overview-events"><TrendChart title="Event Indices" subtitle="OA, CA, hypopnea, unclassified and RERA events per therapy hour" days={days} series={eventSeries} kind="stacked" unit="/h" /></div>
      <div id="overview-pressure"><TrendChart title="Pressure" subtitle="Nightly average and 95th-percentile therapy pressure" days={days} series={pressureSeries} unit="cmH₂O" /></div>
      <div id="overview-leak"><TrendChart title="Leak Rate" subtitle="Nightly average and 95th-percentile leak" days={days} series={leakSeries} unit="L/min" /></div>
    </section>}
    </>}
  </>;
}
