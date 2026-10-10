import { useEffect, useMemo, useState } from "react";
import type { OverviewDaySummary, StoredMachineSummary } from "./types";
import { OverviewDateRange } from "./OverviewDateRange";

type OverviewMetric = "usage" | "ahi" | "events" | "pressure" | "leak";

type ChartPoint = { date: string; values: number[] };

type SeriesDefinition = {
  label: string;
  getValue: (day: OverviewDaySummary) => number | undefined;
  className: string;
};

interface OverviewProps {
  machine: StoredMachineSummary;
  machineId: number;
  defaultEndDate: string;
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

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function finite(values: readonly (number | undefined)[]): number[] {
  return values.filter((value): value is number => value !== undefined && Number.isFinite(value));
}

function formatHours(hours: number): string {
  return `${hours.toFixed(hours >= 10 ? 1 : 2)} h`;
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric overview-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function chartDateLabel(date: string): string {
  return date.slice(5);
}

function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function TrendChart({
  title,
  subtitle,
  days,
  series,
  kind = "line",
  threshold,
  unit = "",
}: {
  title: string;
  subtitle?: string;
  days: readonly OverviewDaySummary[];
  series: readonly SeriesDefinition[];
  kind?: "line" | "bar" | "stacked";
  threshold?: number;
  unit?: string;
}) {
  const width = 1000;
  const height = 280;
  const margin = { left: 58, right: 18, top: 26, bottom: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const chartPoints: ChartPoint[] = days.map((day) => ({
    date: day.date,
    values: series.map((item) => item.getValue(day) ?? 0),
  }));

  const rawMax = kind === "stacked"
    ? Math.max(0, ...chartPoints.map((point) => point.values.reduce((sum, value) => sum + Math.max(0, value), 0)))
    : Math.max(0, ...chartPoints.flatMap((point) => point.values));
  const yMax = niceMax(Math.max(rawMax, threshold ?? 0));
  const xFor = (index: number) => margin.left + (days.length <= 1 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth);
  const yFor = (value: number) => margin.top + plotHeight - (Math.max(0, value) / yMax) * plotHeight;
  const barWidth = Math.max(2, Math.min(22, (plotWidth / Math.max(1, days.length)) * 0.66));
  const labelStep = Math.max(1, Math.ceil(days.length / 8));

  return <article className="panel overview-chart-card">
    <div className="overview-chart-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><div className="overview-legend">{series.map((item) => <span key={item.label}><i className={item.className} />{item.label}</span>)}</div></div>
    <svg className="overview-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} trend chart`}>
      <rect x="0" y="0" width={width} height={height} className="chart-background" />
      {[0, 1, 2, 3, 4].map((row) => {
        const value = (yMax * (4 - row)) / 4;
        const y = margin.top + (plotHeight * row) / 4;
        return <g key={row}><line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="chart-grid" /><text x={margin.left - 9} y={y + 4} textAnchor="end" className="chart-axis-label">{value.toFixed(yMax < 10 ? 1 : 0)}{unit && row === 0 ? ` ${unit}` : ""}</text></g>;
      })}
      {threshold !== undefined && threshold <= yMax && <g><line x1={margin.left} x2={width - margin.right} y1={yFor(threshold)} y2={yFor(threshold)} className="chart-threshold" /><text x={width - margin.right} y={yFor(threshold) - 5} textAnchor="end" className="chart-threshold-label">{threshold}{unit}</text></g>}

      {kind === "bar" && chartPoints.map((point, index) => {
        const value = point.values[0] ?? 0;
        const x = xFor(index) - barWidth / 2;
        const y = yFor(value);
        return <rect key={point.date} x={x} y={y} width={barWidth} height={Math.max(0, margin.top + plotHeight - y)} rx="2" className={series[0]?.className ?? "series-primary"}><title>{point.date}: {value.toFixed(2)} {unit}</title></rect>;
      })}

      {kind === "stacked" && chartPoints.map((point, index) => {
        let cumulative = 0;
        return <g key={point.date}>{point.values.map((value, seriesIndex) => {
          const safe = Math.max(0, value);
          const from = cumulative;
          cumulative += safe;
          const yTop = yFor(cumulative);
          const yBottom = yFor(from);
          return <rect key={seriesIndex} x={xFor(index) - barWidth / 2} y={yTop} width={barWidth} height={Math.max(0, yBottom - yTop)} className={series[seriesIndex]?.className ?? "series-primary"}><title>{point.date} · {series[seriesIndex]?.label}: {safe.toFixed(2)}/h</title></rect>;
        })}</g>;
      })}

      {kind === "line" && series.map((definition, seriesIndex) => {
        const points = chartPoints.map((point, index) => ({ x: xFor(index), y: yFor(point.values[seriesIndex] ?? 0), value: point.values[seriesIndex] ?? 0, date: point.date }));
        return <g key={definition.label}>
          <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} className={`chart-line ${definition.className}`} />
          {points.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r={days.length <= 45 ? 3.5 : 2} className={`chart-point ${definition.className}`}><title>{point.date} · {definition.label}: {point.value.toFixed(2)} {unit}</title></circle>)}
        </g>;
      })}

      {days.map((day, index) => index % labelStep === 0 || index === days.length - 1 ? <text key={day.date} x={xFor(index)} y={height - 13} textAnchor="middle" className="chart-axis-label">{chartDateLabel(day.date)}</text> : null)}
    </svg>
  </article>;
}

export function Overview({ machine, machineId, defaultEndDate }: OverviewProps) {
  const machineFirst = machine.firstSessionTime !== undefined ? therapyDateFromTimestamp(machine.firstSessionTime) : addDays(defaultEndDate, -29);
  const machineLast = machine.lastSessionTime !== undefined ? therapyDateFromTimestamp(machine.lastSessionTime) : defaultEndDate;
  const [startDate, setStartDate] = useState(() => machineFirst > addDays(defaultEndDate, -29) ? machineFirst : addDays(defaultEndDate, -29));
  const [endDate, setEndDate] = useState(() => machineLast < defaultEndDate ? machineLast : defaultEndDate);
  const [history, setHistory] = useState<OverviewDaySummary[]>([]);
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
    setLoading(true);
    setError(undefined);
    window.oscar.getOverview(machineId, machineFirst, machineLast).then((result) => {
      if (!cancelled) setHistory(result);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, machineFirst, machineLast]);

  const days = useMemo(() => history.filter((day) => day.date >= startDate && day.date <= endDate), [history, startDate, endDate]);

  const stats = useMemo(() => {
    const used = days.filter((day) => day.usageHours > 0);
    const totalUsage = used.reduce((sum, day) => sum + day.usageHours, 0);
    const weighted = (selector: (day: OverviewDaySummary) => number) => totalUsage > 0
      ? used.reduce((sum, day) => sum + selector(day) * day.usageHours, 0) / totalUsage : 0;
    const pressure95 = finite(used.map((day) => day.pressure95));
    const leak95 = finite(used.map((day) => day.leak95));
    return {
      usedDays: used.length,
      totalDays: days.length,
      totalUsage,
      averageUsage: used.length ? totalUsage / used.length : 0,
      ahi: weighted((day) => day.ahi),
      rdi: weighted((day) => day.rdi),
      compliantDays: used.filter((day) => day.usageHours >= 4).length,
      pressure95: average(pressure95),
      leak95: average(leak95),
    };
  }, [days]);

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
    <OverviewDateRange firstDate={machineFirst} lastDate={machineLast} startDate={startDate} endDate={endDate} days={history} loading={loading} onChange={(start, end) => { setStartDate(start); setEndDate(end); }} />

    {error && <div className="error">{error}</div>}
    {loading && <div className="loading">Loading overview data…</div>}

    <section className="metrics overview-metrics">
      <MetricCard label="Days used" value={`${stats.usedDays} / ${stats.totalDays}`} detail={stats.totalDays ? `${((stats.usedDays / stats.totalDays) * 100).toFixed(0)}% of selected days` : "No days selected"} />
      <MetricCard label="Average usage" value={formatHours(stats.averageUsage)} detail={`${stats.totalUsage.toFixed(1)} h total`} />
      <MetricCard label="AHI" value={stats.ahi.toFixed(2)} detail={`RDI ${stats.rdi.toFixed(2)}`} />
      <MetricCard label="≥ 4 hours" value={`${stats.compliantDays}`} detail={stats.usedDays ? `${((stats.compliantDays / stats.usedDays) * 100).toFixed(0)}% of used days` : "No used days"} />
      <MetricCard label="Avg pressure 95%" value={stats.pressure95 ? `${stats.pressure95.toFixed(1)} cmH₂O` : "—"} />
      <MetricCard label="Avg leak 95%" value={stats.leak95 ? `${stats.leak95.toFixed(1)} L/min` : "—"} />
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
  </>;
}
