import { useEffect, useMemo, useState } from "react";
import type { OverviewDaySummary, StatisticsSummary, StoredMachineSummary } from "./types";
import { TherapyDateRange } from "./TherapyDateRange";

interface StatisticsProps {
  machine: StoredMachineSummary;
  machineId: number;
  defaultEndDate: string;
}

const DAY_MS = 86_400_000;
const SETTING_NAMES: Record<number, string> = {
  1000: "Mode", 1001: "ResMed raw mode", 1002: "Set pressure", 1003: "Minimum pressure", 1004: "Maximum pressure",
  1005: "EPAP", 1006: "IPAP", 1007: "Minimum EPAP", 1008: "Maximum EPAP", 1009: "Minimum IPAP", 1010: "Maximum IPAP",
  1011: "Pressure support", 1012: "Minimum pressure support", 1013: "Maximum pressure support",
  1100: "EPR mode", 1101: "EPR level", 1102: "Ramp enabled", 1103: "Ramp time", 1104: "Ramp pressure",
  1200: "SmartStart", 1201: "Antibacterial filter", 1202: "Climate control", 1203: "Mask type", 1204: "Patient access",
  1205: "Humidifier enabled", 1206: "Humidity level", 1207: "Temperature enabled", 1208: "Temperature", 1209: "Tube type",
};
const MODE_NAMES: Record<number, string> = { 0: "Unknown", 1: "CPAP", 2: "APAP", 3: "BiLevel Fixed", 4: "BiLevel Auto (Fixed PS)", 5: "BiLevel Auto (Variable PS)", 6: "ASV", 7: "ASV (Variable EPAP)", 8: "AVAPS" };
const PRESSURE_SETTING_IDS = new Set([1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012,1013,1104]);

function dateKeyFromMs(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
function therapyDateFromTimestamp(ms: number): string { return dateKeyFromMs(ms - 12 * 3_600_000); }
function addDays(date: string, amount: number): string { return dateKeyFromMs(Date.parse(`${date}T00:00:00Z`) + amount * DAY_MS); }
function formatHours(hours: number): string { return `${hours.toFixed(hours >= 10 ? 1 : 2)} h`; }
function pct(n: number, d: number): string { return d ? `${((n / d) * 100).toFixed(0)}%` : "0%"; }

function settingValue(id: number, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (id === 1000 && typeof value === "number") return MODE_NAMES[value] ?? String(value);
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number" && PRESSURE_SETTING_IDS.has(id)) return `${value.toFixed(1)} cmH₂O`;
  if (id === 1103 && typeof value === "number") return `${value} min`;
  if (id === 1208 && typeof value === "number") return `${value} °C`;
  return String(value);
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric overview-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function Statistics({ machine, machineId, defaultEndDate }: StatisticsProps) {
  const machineFirst = machine.firstSessionTime === undefined ? defaultEndDate : therapyDateFromTimestamp(machine.firstSessionTime);
  const machineLast = machine.lastSessionTime === undefined ? defaultEndDate : therapyDateFromTimestamp(machine.lastSessionTime);
  const initialEnd = defaultEndDate < machineFirst || defaultEndDate > machineLast ? machineLast : defaultEndDate;
  const [startDate, setStartDate] = useState(() => machineFirst > addDays(initialEnd, -29) ? machineFirst : addDays(initialEnd, -29));
  const [endDate, setEndDate] = useState(initialEnd);
  const [stats, setStats] = useState<StatisticsSummary>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [exportMessage, setExportMessage] = useState<string>();
  const [history, setHistory] = useState<OverviewDaySummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string>();

  useEffect(() => {
    setEndDate(initialEnd);
    setStartDate(machineFirst > addDays(initialEnd, -29) ? machineFirst : addDays(initialEnd, -29));
  }, [machineId, machineFirst, initialEnd]);

  // The timeline shows the full machine history even when the report is narrowed.
  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setHistoryLoading(true);
    setHistoryError(undefined);
    window.oscar.getOverview(machineId, machineFirst, machineLast)
      .then((value) => { if (!cancelled) setHistory(value); })
      .catch((cause) => { if (!cancelled) setHistoryError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, machineFirst, machineLast]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(undefined);
    window.oscar.getStatistics(machineId, startDate, endDate)
      .then((value) => { if (!cancelled) setStats(value); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [machineId, startDate, endDate]);

  const settingIds = useMemo(() => {
    const ids = new Set<number>();
    for (const period of stats?.settingsHistory ?? []) for (const id of Object.keys(period.settings)) ids.add(Number(id));
    return [...ids].sort((a, b) => a - b);
  }, [stats]);

  async function exportFile(kind: "csv" | "pdf") {
    try {
      setExportMessage(undefined); setError(undefined);
      const path = kind === "csv"
        ? await window.oscar.exportStatisticsCsv(machineId, startDate, endDate)
        : await window.oscar.exportStatisticsPdf(machineId, startDate, endDate);
      if (path) setExportMessage(`Saved ${kind.toUpperCase()} to ${path}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return <>
    <TherapyDateRange firstDate={machineFirst} lastDate={machineLast} startDate={startDate} endDate={endDate}
      days={history} loading={historyLoading} onChange={(start, end) => { setStartDate(start); setEndDate(end); }}
      actions={<div className="statistics-export"><button className="secondary" onClick={() => exportFile("csv")}>Export CSV</button><button onClick={() => exportFile("pdf")}>Export PDF</button></div>} />

    {error && <div className="error">{error}</div>}
    {historyError && <div className="error">Unable to load therapy history: {historyError}</div>}
    {exportMessage && <div className="success">{exportMessage}</div>}
    {loading && <div className="loading">Calculating statistics…</div>}

    {stats && <>
      <section className="metrics overview-metrics statistics-metrics">
        <StatCard label="Days used" value={`${stats.usedDays} / ${stats.totalDays}`} detail={`${pct(stats.usedDays, stats.totalDays)} of selected days`} />
        <StatCard label="≥ 4 hours" value={`${stats.compliantDays}`} detail={`${pct(stats.compliantDays, stats.usedDays)} of used days`} />
        <StatCard label="Average usage" value={formatHours(stats.averageUsageHours)} detail={`${stats.totalUsageHours.toFixed(1)} h total`} />
        <StatCard label="Median usage" value={formatHours(stats.medianUsageHours)} />
        <StatCard label="AHI" value={stats.ahi.toFixed(2)} detail={`RDI ${stats.rdi.toFixed(2)}`} />
        <StatCard label="Pressure 95%" value={stats.pressure ? `${stats.pressure.percentile95.toFixed(1)} cmH₂O` : "—"} detail={stats.pressure ? `Median ${stats.pressure.percentile50.toFixed(1)} · Max ${stats.pressure.max.toFixed(1)}` : undefined} />
        <StatCard label="Leak 95%" value={stats.leak ? `${stats.leak.percentile95.toFixed(1)} L/min` : "—"} detail={stats.leak ? `Median ${stats.leak.percentile50.toFixed(1)} · Max ${stats.leak.max.toFixed(1)}` : undefined} />
      </section>

      <section className="statistics-grid">
        <article className="panel"><h2>Respiratory event indices</h2><table><thead><tr><th>Event</th><th>Total</th><th>Index / h</th></tr></thead><tbody>
          <tr><td>Obstructive apnea</td><td>{stats.eventCounts.obstructive}</td><td>{stats.eventIndices.obstructive.toFixed(2)}</td></tr>
          <tr><td>Clear airway / central</td><td>{stats.eventCounts.clearAirway}</td><td>{stats.eventIndices.clearAirway.toFixed(2)}</td></tr>
          <tr><td>Hypopnea</td><td>{stats.eventCounts.hypopnea}</td><td>{stats.eventIndices.hypopnea.toFixed(2)}</td></tr>
          <tr><td>Unclassified apnea</td><td>{stats.eventCounts.unclassified}</td><td>{stats.eventIndices.unclassified.toFixed(2)}</td></tr>
          <tr><td>RERA</td><td>{stats.eventCounts.rera}</td><td>{stats.eventIndices.rera.toFixed(2)}</td></tr>
        </tbody></table></article>

        <article className="panel"><h2>Pressure & leak distribution</h2><table><thead><tr><th>Signal</th><th>Average</th><th>Median</th><th>95%</th><th>Max</th></tr></thead><tbody>
          <tr><td>Pressure</td><td>{stats.pressure?.average.toFixed(1) ?? "—"}</td><td>{stats.pressure?.percentile50.toFixed(1) ?? "—"}</td><td>{stats.pressure?.percentile95.toFixed(1) ?? "—"}</td><td>{stats.pressure?.max.toFixed(1) ?? "—"}</td></tr>
          <tr><td>Leak</td><td>{stats.leak?.average.toFixed(1) ?? "—"}</td><td>{stats.leak?.percentile50.toFixed(1) ?? "—"}</td><td>{stats.leak?.percentile95.toFixed(1) ?? "—"}</td><td>{stats.leak?.max.toFixed(1) ?? "—"}</td></tr>
        </tbody></table></article>
      </section>

      <section className="panel statistics-section"><h2>Therapy settings history</h2>{stats.settingsHistory.length === 0 ? <p>No settings were stored for this range.</p> : <div className="table-scroll"><table><thead><tr><th>Period</th><th>Sessions</th>{settingIds.map((id) => <th key={id}>{SETTING_NAMES[id] ?? `Setting ${id}`}</th>)}</tr></thead><tbody>{stats.settingsHistory.map((period, index) => <tr key={`${period.startDate}-${index}`}><td>{period.startDate === period.endDate ? period.startDate : `${period.startDate} → ${period.endDate}`}</td><td>{period.sessionCount}</td>{settingIds.map((id) => <td key={id}>{settingValue(id, period.settings[id])}</td>)}</tr>)}</tbody></table></div>}</section>

      <section className="panel statistics-section"><h2>Daily statistics</h2><div className="table-scroll"><table><thead><tr><th>Date</th><th>Usage</th><th>AHI</th><th>RDI</th><th>OA</th><th>CA</th><th>H</th><th>RERA</th><th>P95</th><th>L95</th></tr></thead><tbody>{stats.days.map((day) => <tr key={day.date}><td>{day.date}</td><td>{day.usageHours.toFixed(2)} h</td><td>{day.ahi.toFixed(2)}</td><td>{day.rdi.toFixed(2)}</td><td>{day.obstructive}</td><td>{day.clearAirway}</td><td>{day.hypopnea}</td><td>{day.rera}</td><td>{day.pressure95?.toFixed(1) ?? "—"}</td><td>{day.leak95?.toFixed(1) ?? "—"}</td></tr>)}</tbody></table></div></section>
    </>}
  </>;
}
