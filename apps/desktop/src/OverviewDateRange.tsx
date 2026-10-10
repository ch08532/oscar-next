import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { dateAtOffset, dayOffset, rangeHandleOffset } from "./overview-date-range";
import type { OverviewDaySummary } from "./types";

type Edge = "start" | "end";

export function OverviewDateRange({ firstDate, lastDate, startDate, endDate, days, loading, onChange }: {
  firstDate: string;
  lastDate: string;
  startDate: string;
  endDate: string;
  days: readonly OverviewDaySummary[];
  loading: boolean;
  onChange(start: string, end: string): void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Edge | undefined>(undefined);
  const last = Math.max(0, dayOffset(firstDate, lastDate));
  const start = Math.max(0, Math.min(last, dayOffset(firstDate, startDate)));
  const end = Math.max(start, Math.min(last, dayOffset(firstDate, endDate)));
  const percent = (offset: number) => last ? offset / last * 100 : 50;
  const dataDays = days.filter((day) => day.sessionCount > 0);
  const disabled = loading || days.length === 0 || last === 0 || !startDate || !endDate;

  function update(edge: Edge, offset: number) {
    const next = edge === "start" ? Math.max(0, Math.min(end, offset)) : Math.max(start, Math.min(last, offset));
    onChange(edge === "start" ? dateAtOffset(firstDate, next) : startDate,
      edge === "end" ? dateAtOffset(firstDate, next) : endDate);
  }

  function move(edge: Edge, clientX: number) {
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return;
    update(edge, rangeHandleOffset((clientX - bounds.left) / bounds.width, last, edge === "start" ? end : start, edge));
  }

  function beginDrag(edge: Edge, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = edge;
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function keyDown(edge: Edge, event: KeyboardEvent<HTMLButtonElement>) {
    const current = edge === "start" ? start : end;
    const next: Record<string, number> = { ArrowLeft: current - 1, ArrowDown: current - 1, ArrowRight: current + 1, ArrowUp: current + 1, PageDown: current - 7, PageUp: current + 7, Home: edge === "start" ? 0 : start, End: edge === "start" ? end : last };
    if (next[event.key] === undefined) return;
    event.preventDefault();
    update(edge, next[event.key]!);
  }

  function applyPreset(dayCount: number) {
    const candidate = dateAtOffset(endDate, -(dayCount - 1));
    onChange(candidate < firstDate ? firstDate : candidate, endDate);
  }

  return <section className="overview-date-range" aria-label="Therapy history date range" aria-busy={loading}>
    <div className="overview-date-heading"><strong>Therapy history</strong><span>{loading ? "Loading history…" : `${dataDays.length} days with data`} · {startDate} — {endDate}</span></div>
    <div className="overview-range-toolbar overview-date-controls">
      <div className="overview-range-fields">
        <label>Start date<input type="date" min={firstDate} max={endDate} value={startDate} onChange={(event) => onChange(event.target.value, endDate)} /></label>
        <label>End date<input type="date" min={startDate} max={lastDate} value={endDate} onChange={(event) => onChange(startDate, event.target.value)} /></label>
      </div>
      <div className="range-presets"><span>Range</span>{[7, 30, 90].map((count) => <button key={count} type="button" className="secondary" onClick={() => applyPreset(count)}>{count} days</button>)}<button type="button" className="secondary" onClick={() => onChange(firstDate, lastDate)}>All</button></div>
    </div>
    <p id="overview-date-help">Drag either handle to select dates, or use the arrow keys. Marks show included sessions, including summary-only nights.</p>
    <div ref={track} className={`overview-date-track${start === end ? " single-day" : ""}`}>
      <div className="overview-date-selection" style={{ left: `${percent(start)}%`, width: `${percent(end) - percent(start)}%` }} />
      <svg className="overview-date-marks" viewBox="0 0 1000 48" preserveAspectRatio="none" role="img" aria-label="Days with included therapy sessions">
        {days.map((day) => {
          const offset = dayOffset(firstDate, day.date);
          const width = Math.max(1, Math.min(18, 800 / (last + 1)));
          const hasData = day.sessionCount > 0;
          return <rect key={day.date} x={percent(offset) * 10 - width / 2} y={hasData ? 12 : 20} width={width} height={hasData ? 24 : 8} rx="1" className={`${hasData ? "has-data" : "no-data"}${day.date >= startDate && day.date <= endDate ? " selected" : ""}`}>
            <title>{day.date}: {hasData ? `${day.sessionCount} included session(s), ${day.usageHours.toFixed(2)} h` : "No included sessions"}</title>
          </rect>;
        })}
      </svg>
      {(["start", "end"] as const).map((edge) => <button key={edge} type="button" role="slider" className={`overview-date-handle ${edge}`} disabled={disabled}
        aria-label={edge === "start" ? "Start therapy date" : "End therapy date"} aria-describedby="overview-date-help"
        aria-valuemin={edge === "start" ? 0 : start} aria-valuemax={edge === "start" ? end : last}
        aria-valuenow={edge === "start" ? start : end} aria-valuetext={edge === "start" ? startDate : endDate}
        style={{ left: `${percent(edge === "start" ? start : end)}%` }}
        onPointerDown={(event) => beginDrag(edge, event)} onPointerMove={(event) => { if (drag.current === edge) move(edge, event.clientX); }}
        onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={() => { drag.current = undefined; }}
        onKeyDown={(event) => keyDown(edge, event)} title={`${edge === "start" ? "Start" : "End"}: ${edge === "start" ? startDate : endDate}`}>{edge === "start" ? "‹" : "›"}</button>)}
    </div>
    <div className="overview-date-axis"><span>{firstDate}</span><span><i /> Days with data <i className="gap" /> No included sessions</span><span>{lastDate}</span></div>
  </section>;
}
