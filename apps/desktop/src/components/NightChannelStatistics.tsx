import { useEffect, useState } from "react";
import type { DailyChannelAnalysis, DailySummary } from "../types";

function duration(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 3600)}h ${Math.floor(rounded % 3600 / 60)}m ${rounded % 60}s`;
}
export function NightChannelStatistics({ daily }: { daily: DailySummary }) {
  const [analysis, setAnalysis] = useState<DailyChannelAnalysis>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    setAnalysis(undefined); setError(undefined);
    window.oscar.getDailyChannelAnalysis(daily.machineId, daily.date).then(value => { if (!cancelled) setAnalysis(value); })
      .catch(cause => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [daily]);
  return <section><details open><summary className="mb-3 cursor-pointer text-xs font-semibold uppercase tracking-wide">Night Statistics</summary>
    {error ? <p className="error" role="alert">Unable to calculate channel statistics: {error}</p> : !analysis ? <p role="status" className="text-sm text-[var(--muted)]">Calculating…</p> : <>
      {analysis.channels.length ? <div className="table-scroll"><table className="night-statistics text-xs"><thead><tr><th>Channel</th><th>Min</th><th>Avg</th><th>Median</th><th>95%</th><th>Max</th></tr></thead><tbody>{analysis.channels.map(channel => <tr key={channel.channelId} title={`Average ${channel.average.toFixed(2)} ${channel.unit}; recorded ${duration(channel.recordedSeconds)}`}><th scope="row">{channel.label.replace("SpO2", "SpO₂")}<small className="block font-normal text-[var(--muted)]">{channel.unit.replace("cmH2O", "cmH₂O")}</small></th>{[channel.min, channel.average, channel.percentile50, channel.percentile95, channel.max].map((value, index) => <td key={index}>{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>)}</tr>)}</tbody></table></div> : <p className="text-sm text-[var(--muted)]">No data</p>}
      <p className="mt-2 text-xs text-[var(--muted)]">Recorded samples only. Median and 95% are weighted by valid elapsed sample time. Hover a row for recording coverage.</p>
      <h3 className="mt-4">Leak Analysis</h3>{analysis.leak ? <dl><div><dt>Leak &gt;{analysis.leak.threshold} L/min</dt><dd>{duration(analysis.leak.secondsAboveThreshold)}</dd></div><div><dt>Therapy time</dt><dd>{duration(analysis.therapySeconds)}</dd></div><div><dt>Above threshold</dt><dd>{analysis.leak.percentTherapyTimeAboveThreshold.toFixed(2)}%</dd></div><div><dt>Leak recorded</dt><dd>{duration(analysis.leak.recordedSeconds)}</dd></div></dl> : <p className="text-sm text-[var(--muted)]">No data</p>}
      {analysis.leak && analysis.leak.recordedSeconds < analysis.therapySeconds && <p className="mt-2 text-xs text-[var(--muted)]">Leak coverage is incomplete. The percentage describes recorded time above threshold divided by included therapy time; missing readings are unknown.</p>}
    </>}
  </details></section>;
}
