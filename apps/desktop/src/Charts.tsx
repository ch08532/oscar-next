import { Pin, GripVertical, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Channel, DEFAULT_CHART_CHANNELS, EVENT_CHANNELS } from "./channels";
import type { ChartQueryResult, ChartSeries, DailySummary, GraphBookmark, GraphPreference } from "./types";
import { channelStatistics, countEvents, eventsNearCursor, lowerBound, nearestPoint, statistics, therapyWindowEventSummary, valuesInViewport } from "./chart-analysis";
import { EVENT_PRESENTATION } from "./event-presentation";
import type { GraphNavigation } from "./components/NightInspector";

type Viewport = { startMs: number; endMs: number };

type GraphDefinition = {
  key: string;
  title: string;
  channelIds: readonly number[];
  height?: number;
  zeroBaseline?: boolean;
  symmetric?: boolean;
  unitFallback?: string;
};

const GRAPHS: readonly GraphDefinition[] = [
  { key: "flow", title: "Flow Rate", channelIds: [Channel.FlowRate], height: 205, symmetric: true, unitFallback: "L/min" },
  { key: "pressure", title: "Pressure", channelIds: [Channel.Pressure, Channel.MaskPressureHigh, Channel.IPAP, Channel.EPAP], height: 180, zeroBaseline: true, unitFallback: "cmH₂O" },
  { key: "leak", title: "Leak Rate", channelIds: [Channel.Leak], height: 165, zeroBaseline: true, unitFallback: "L/min" },
  { key: "spo2", title: "SpO₂", channelIds: [Channel.SpO2], height: 145, unitFallback: "%" },
  { key: "pulse", title: "Pulse", channelIds: [Channel.Pulse], height: 145, zeroBaseline: true, unitFallback: "bpm" },
];

const EVENT_META: Readonly<Record<number, { label: string; name: string }>> = Object.freeze({
  [Channel.ObstructiveApnea]: { label: "OA", name: "Obstructive" },
  [Channel.Hypopnea]: { label: "H", name: "Hypopnea" },
  [Channel.ClearAirway]: { label: "CA", name: "Clear Airway" },
  [Channel.UnclassifiedApnea]: { label: "UA", name: "Unclassified" },
  [Channel.RERA]: { label: "RERA", name: "RERA" },
  [Channel.CSR]: { label: "CSR", name: "Cheyne-Stokes" },
});

function timeLabel(ms: number, withSeconds = false): string {
  const iso = new Date(ms).toISOString();
  return withSeconds ? iso.slice(11, 19) : iso.slice(11, 16);
}


function clampViewport(view: Viewport, bounds: Viewport, minimumMs = 30_000): Viewport {
  const boundDuration = Math.max(1, bounds.endMs - bounds.startMs);
  const minimumDuration = Math.min(minimumMs, boundDuration);
  const duration = Math.max(minimumDuration, Math.min(boundDuration, view.endMs - view.startMs));
  let start = view.startMs;
  let end = start + duration;
  if (start < bounds.startMs) { start = bounds.startMs; end = start + duration; }
  if (end > bounds.endMs) { end = bounds.endMs; start = end - duration; }
  return { startMs: Math.max(bounds.startMs, start), endMs: Math.min(bounds.endMs, end) };
}

function visibleBounds(series: readonly ChartSeries[], viewport: Viewport): { min: number; max: number } | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const item of series) {
    const begin = Math.max(0, lowerBound(item.timesMs, viewport.startMs) - 1);
    const end = Math.min(item.timesMs.length, lowerBound(item.timesMs, viewport.endMs) + 1);
    for (let index = begin; index < end; index += 1) {
      const value = item.values[index];
      if (value === undefined || !Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined;
}

function setCanvasSize(canvas: HTMLCanvasElement, height: number): CanvasRenderingContext2D | undefined {
  const width = Math.max(320, canvas.clientWidth || 320);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d") ?? undefined;
  if (!context) return undefined;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}

const CHANNEL_META: Readonly<Record<number, { name: string; color: string }>> = Object.freeze({
  [Channel.FlowRate]: { name: "Flow", color: "#1769aa" },
  [Channel.MaskPressureHigh]: { name: "Mask Pressure", color: "#8b5cf6" },
  [Channel.Pressure]: { name: "Pressure", color: "#1769aa" },
  [Channel.IPAP]: { name: "IPAP", color: "#d97706" },
  [Channel.EPAP]: { name: "EPAP", color: "#0f8a73" },
  [Channel.Leak]: { name: "Leak", color: "#0f8a73" },
  [Channel.SpO2]: { name: "SpO₂", color: "#f43f5e" },
  [Channel.Pulse]: { name: "Pulse", color: "#f97316" },
  [Channel.ObstructiveApnea]: { name: "OA", color: "#b42318" },
  [Channel.Hypopnea]: { name: "H", color: "#d97706" },
  [Channel.ClearAirway]: { name: "CA", color: "#1769aa" },
  [Channel.UnclassifiedApnea]: { name: "UA", color: "#6b7280" },
  [Channel.RERA]: { name: "RERA", color: "#8b5cf6" },
  [Channel.CSR]: { name: "CSR", color: "#0f8a73" },
});

function channelColor(channelId: number): string { return EVENT_PRESENTATION[channelId]?.color ?? CHANNEL_META[channelId]?.color ?? "#3b82f6"; }

function canvasColor(token: string): string { return getComputedStyle(document.documentElement).getPropertyValue(token).trim(); }

function valuePrecision(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude >= 100) return 0;
  if (magnitude >= 10) return 1;
  return 2;
}

function formatReading(value: number, unit = ""): string {
  const text = value.toFixed(valuePrecision(value));
  return unit ? `${text} ${unit}` : text;
}

function combinedStatistics(series: readonly ChartSeries[], channelIds: readonly number[], viewport: Viewport) {
  const values: number[] = [];
  for (const item of series) {
    if (!channelIds.includes(item.channelId) || item.type !== "waveform") continue;
    values.push(...valuesInViewport(item, viewport));
  }
  return statistics(values);
}

function preferredStatistics(series: readonly ChartSeries[], channelIds: readonly number[], viewport: Viewport) {
  for (const channelId of channelIds) {
    const result = channelStatistics(series, channelId, viewport);
    if (result) return result;
  }
  return undefined;
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  yMin: number,
  yMax: number,
  unit: string,
): { left: number; right: number; top: number; bottom: number; plotWidth: number; plotHeight: number } {
  const left = 64;
  const right = 12;
  const top = 10;
  const bottom = 28;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);

  context.clearRect(0, 0, width, height);
  context.fillStyle = canvasColor("--canvas");
  context.fillRect(0, 0, width, height);
  context.font = "11px system-ui, sans-serif";
  context.textBaseline = "middle";
  context.strokeStyle = canvasColor("--grid");
  context.fillStyle = canvasColor("--muted");
  context.lineWidth = 1;

  for (let row = 0; row <= 4; row += 1) {
    const y = top + (plotHeight * row) / 4;
    context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
    const value = yMax - ((yMax - yMin) * row) / 4;
    context.textAlign = "right";
    context.fillText(Number.isFinite(value) ? value.toFixed(Math.abs(yMax - yMin) < 10 ? 1 : 0) : "", left - 8, y);
  }

  for (let column = 0; column <= 6; column += 1) {
    const x = left + (plotWidth * column) / 6;
    context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + plotHeight); context.stroke();
    const time = viewport.startMs + ((viewport.endMs - viewport.startMs) * column) / 6;
    context.textAlign = column === 0 ? "left" : column === 6 ? "right" : "center";
    context.fillText(timeLabel(time), x, height - 12);
  }

  if (unit) {
    context.save();
    context.translate(12, top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = "center";
    context.fillText(unit, 0, 0);
    context.restore();
  }
  return { left, right, top, bottom, plotWidth, plotHeight };
}

function drawSeries(
  context: CanvasRenderingContext2D,
  series: ChartSeries,
  viewport: Viewport,
  geometry: ReturnType<typeof drawGrid>,
  yMin: number,
  yMax: number,
): void {
  const { left, top, plotWidth, plotHeight } = geometry;
  const duration = Math.max(1, viewport.endMs - viewport.startMs);
  const ySpan = Math.max(1e-9, yMax - yMin);
  const startIndex = Math.max(0, lowerBound(series.timesMs, viewport.startMs) - 1);
  const endIndex = Math.min(series.timesMs.length, lowerBound(series.timesMs, viewport.endMs) + 1);
  if (endIndex <= startIndex) return;

  const xFor = (time: number) => left + ((time - viewport.startMs) / duration) * plotWidth;
  const yFor = (value: number) => top + (1 - (value - yMin) / ySpan) * plotHeight;
  context.strokeStyle = channelColor(series.channelId);
  context.lineWidth = 1;

  const visibleCount = endIndex - startIndex;
  if (visibleCount > plotWidth * 4) {
    const mins = new Float64Array(Math.ceil(plotWidth) + 1); mins.fill(Number.POSITIVE_INFINITY);
    const maxs = new Float64Array(Math.ceil(plotWidth) + 1); maxs.fill(Number.NEGATIVE_INFINITY);
    for (let point = startIndex; point < endIndex; point += 1) {
      const time = series.timesMs[point]; const value = series.values[point];
      if (time === undefined || value === undefined || !Number.isFinite(value)) continue;
      const bucket = Math.max(0, Math.min(mins.length - 1, Math.floor(xFor(time) - left)));
      mins[bucket] = Math.min(mins[bucket] ?? value, value);
      maxs[bucket] = Math.max(maxs[bucket] ?? value, value);
    }
    context.beginPath();
    for (let bucket = 0; bucket < mins.length; bucket += 1) {
      const min = mins[bucket]; const max = maxs[bucket];
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      const x = left + bucket;
      context.moveTo(x, yFor(min)); context.lineTo(x, yFor(max));
    }
    context.stroke();
    return;
  }

  context.beginPath();
  let started = false;
  for (let point = startIndex; point < endIndex; point += 1) {
    const time = series.timesMs[point]; const value = series.values[point];
    if (time === undefined || value === undefined || !Number.isFinite(value)) continue;
    const x = xFor(time); const y = yFor(value);
    if (!started) { context.moveTo(x, y); started = true; }
    else context.lineTo(x, y);
  }
  context.stroke();
}

interface InteractionProps {
  viewport: Viewport;
  bounds: Viewport;
  cursorMs?: number;
  setViewport: (viewport: Viewport) => void;
  setCursorMs: (cursor?: number) => void;
  resetViewport: () => void;
}

function useGraphInteractions(props: InteractionProps, plotLeft = 64, plotRight = 12) {
  const drag = useRef<{ x: number; viewport: Viewport } | undefined>(undefined);

  function timeAt(clientX: number, element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, rect.width - plotLeft - plotRight);
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left - plotLeft) / width));
    return props.viewport.startMs + fraction * (props.viewport.endMs - props.viewport.startMs);
  }

  function onWheel(event: ReactWheelEvent<HTMLElement>) {
    event.preventDefault();
    const pivot = timeAt(event.clientX, event.currentTarget);
    const currentDuration = props.viewport.endMs - props.viewport.startMs;
    const factor = event.deltaY < 0 ? 0.78 : 1.28;
    const duration = currentDuration * factor;
    const fraction = (pivot - props.viewport.startMs) / Math.max(1, currentDuration);
    const candidate = { startMs: pivot - duration * fraction, endMs: pivot + duration * (1 - fraction) };
    props.setViewport(clampViewport(candidate, props.bounds));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, viewport: props.viewport };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    props.setCursorMs(timeAt(event.clientX, event.currentTarget));
    if (!drag.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - plotLeft - plotRight);
    const duration = drag.current.viewport.endMs - drag.current.viewport.startMs;
    const shift = ((drag.current.x - event.clientX) / plotWidth) * duration;
    props.setViewport(clampViewport({ startMs: drag.current.viewport.startMs + shift, endMs: drag.current.viewport.endMs + shift }, props.bounds));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = undefined;
  }

  return {
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onPointerLeave: () => { if (!drag.current) props.setCursorMs(undefined); },
    onDoubleClick: props.resetViewport,
  };
}

function GraphPin({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return <button type="button" className={`graph-pin ${pinned ? "active" : ""}`} aria-pressed={pinned} title={pinned ? "Unpin graph" : "Pin graph to top"} onClick={onToggle}><Pin size={14} fill={pinned ? "currentColor" : "none"} /></button>;
}

function GraphDragHandle({ graphKey, onStart }: { graphKey: string; onStart: (key: string) => void }) {
  return <button
    type="button"
    className="graph-drag-handle"
    draggable
    title="Drag to reorder graph"
    aria-label="Drag to reorder graph"
    onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/x-oscar-graph-key", graphKey);
      onStart(graphKey);
    }}
  ><GripVertical size={15} /></button>;
}

function useResizableGraphHeight(initialHeight: number, onCommit: (height: number) => void) {
  const [height, setHeight] = useState(initialHeight);
  useEffect(() => setHeight(initialHeight), [initialHeight]);

  function onResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = height;
    let nextHeight = startHeight;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      nextHeight = Math.round(Math.max(100, Math.min(520, startHeight + move.clientY - startY)));
      setHeight(nextHeight);
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      onCommit(nextHeight);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
  }

  return { height, onResizePointerDown };
}

function GraphPanel({ definition, series, interaction, pinned, height: storedHeight, onTogglePin, onHeightCommit, onDragStart, onDropGraph }: {
  definition: GraphDefinition; series: ChartSeries[]; interaction: InteractionProps; pinned: boolean; height: number;
  onTogglePin: () => void; onHeightCommit: (height: number) => void; onDragStart: (key: string) => void; onDropGraph: (source: string, target: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const { height, onResizePointerDown } = useResizableGraphHeight(storedHeight, onHeightCommit);
  const events = useGraphInteractions(interaction);
  const unit = series.find((item) => item.dimension)?.dimension || definition.unitFallback || "";
  const channelNames = [...new Set(series.map((item) => CHANNEL_META[item.channelId]?.name).filter(Boolean))].join(" / ");
  const cursorPoints = useMemo(() => {
    if (interaction.cursorMs === undefined) return [];
    return series.flatMap((item) => {
      const point = nearestPoint(item, interaction.cursorMs!);
      if (!point) return [];
      return [{
        item,
        point,
        name: CHANNEL_META[item.channelId]?.name ?? String(item.channelId),
        unit: item.dimension || definition.unitFallback || "",
      }];
    });
  }, [definition.unitFallback, interaction.cursorMs, series]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const context = setCanvasSize(canvas, height); if (!context) return;
      const width = canvas.clientWidth;
      let bounds = visibleBounds(series, interaction.viewport) ?? { min: 0, max: 1 };
      if (definition.symmetric) {
        const extent = Math.max(Math.abs(bounds.min), Math.abs(bounds.max), 1);
        bounds = { min: -extent, max: extent };
      } else if (definition.zeroBaseline) bounds.min = Math.min(0, bounds.min);
      const padding = Math.max(0.1, (bounds.max - bounds.min) * 0.08);
      const yMin = definition.symmetric ? bounds.min : bounds.min - padding;
      const yMax = definition.symmetric ? bounds.max : bounds.max + padding;
      const geometry = drawGrid(context, width, height, interaction.viewport, yMin, yMax, unit);
      series.forEach((item) => drawSeries(context, item, interaction.viewport, geometry, yMin, yMax));
    };
    draw();
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    window.addEventListener("oscar-theme-change", draw);
    return () => { observer.disconnect(); window.removeEventListener("oscar-theme-change", draw); };
  }, [definition, height, interaction.viewport, series, unit]);

  useEffect(() => {
    const canvas = overlayRef.current; if (!canvas) return;
    const draw = () => {
      const context = setCanvasSize(canvas, height); if (!context) return;
      const width = canvas.clientWidth; const left = 64; const right = 12; const top = 10; const bottom = 28;
      const plotWidth = Math.max(1, width - left - right); const plotHeight = Math.max(1, height - top - bottom);
      context.clearRect(0, 0, width, height);
      if (interaction.cursorMs === undefined || interaction.cursorMs < interaction.viewport.startMs || interaction.cursorMs > interaction.viewport.endMs) return;
      const x = left + ((interaction.cursorMs - interaction.viewport.startMs) / Math.max(1, interaction.viewport.endMs - interaction.viewport.startMs)) * plotWidth;
      context.strokeStyle = canvasColor("--cursor"); context.lineWidth = 1; context.setLineDash([3, 3]);
      context.beginPath(); context.moveTo(x, top); context.lineTo(x, height - bottom); context.stroke(); context.setLineDash([]);

      let bounds = visibleBounds(series, interaction.viewport) ?? { min: 0, max: 1 };
      if (definition.symmetric) {
        const extent = Math.max(Math.abs(bounds.min), Math.abs(bounds.max), 1);
        bounds = { min: -extent, max: extent };
      } else if (definition.zeroBaseline) bounds.min = Math.min(0, bounds.min);
      const padding = Math.max(0.1, (bounds.max - bounds.min) * 0.08);
      const yMin = definition.symmetric ? bounds.min : bounds.min - padding;
      const yMax = definition.symmetric ? bounds.max : bounds.max + padding;
      const ySpan = Math.max(1e-9, yMax - yMin);
      const yFor = (value: number) => top + (1 - (value - yMin) / ySpan) * plotHeight;
      const xFor = (time: number) => left + ((time - interaction.viewport.startMs) / Math.max(1, interaction.viewport.endMs - interaction.viewport.startMs)) * plotWidth;

      for (const readout of cursorPoints) {
        context.fillStyle = channelColor(readout.item.channelId);
        context.beginPath(); context.arc(xFor(readout.point.timeMs), yFor(readout.point.value), 3.5, 0, Math.PI * 2); context.fill();
        context.strokeStyle = canvasColor("--canvas"); context.lineWidth = 1.5; context.stroke();
      }

      if (cursorPoints.length) {
        const lines = [timeLabel(interaction.cursorMs, true), ...cursorPoints.map((readout) => `${readout.name}: ${formatReading(readout.point.value, readout.unit)}`)];
        context.font = "11px system-ui, sans-serif";
        const boxWidth = Math.max(...lines.map((line) => context.measureText(line).width)) + 16;
        const lineHeight = 17; const boxHeight = lines.length * lineHeight + 8;
        const boxX = x + boxWidth + 18 > width ? Math.max(left, x - boxWidth - 10) : x + 10;
        const boxY = top + 6;
        context.fillStyle = canvasColor("--surface"); context.strokeStyle = canvasColor("--border"); context.lineWidth = 1;
        context.fillRect(boxX, boxY, boxWidth, boxHeight); context.strokeRect(boxX, boxY, boxWidth, boxHeight);
        context.textAlign = "left"; context.textBaseline = "middle"; context.fillStyle = canvasColor("--text");
        lines.forEach((line, index) => context.fillText(line, boxX + 8, boxY + 7 + lineHeight * index + lineHeight / 2));
      }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); window.addEventListener("oscar-theme-change", draw); return () => { observer.disconnect(); window.removeEventListener("oscar-theme-change", draw); };
  }, [cursorPoints, definition, height, interaction.cursorMs, interaction.viewport, series]);

  const headingDetail = cursorPoints.length
    ? cursorPoints.map((readout) => `${readout.name} ${formatReading(readout.point.value, readout.unit)}`).join(" · ")
    : (channelNames ? `${channelNames} · ${unit}` : unit);

  return <section className="therapy-graph graph-layout-item" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData("text/x-oscar-graph-key"); if (source) onDropGraph(source, definition.key); }}>
    <div className="graph-heading"><div className="graph-heading-title"><GraphDragHandle graphKey={definition.key} onStart={onDragStart} /><GraphPin pinned={pinned} onToggle={onTogglePin} /><strong>{definition.title}</strong></div><span className={cursorPoints.length ? "cursor-reading" : ""}>{headingDetail}</span></div>
    <div className="graph-canvas-wrap" {...events}>
      <canvas ref={canvasRef} aria-label={`${definition.title} graph`} />
      <canvas ref={overlayRef} className="graph-cursor-overlay" aria-hidden="true" />
    </div>
    <div className="graph-resize-handle" role="separator" aria-orientation="horizontal" title="Drag to resize graph" onPointerDown={onResizePointerDown}><span /></div>
  </section>;
}

function EventFlags({ series, interaction, pinned, height: storedHeight, onTogglePin, onHeightCommit, onDragStart, onDropGraph }: {
  series: ChartSeries[]; interaction: InteractionProps; pinned: boolean; height: number;
  onTogglePin: () => void; onHeightCommit: (height: number) => void; onDragStart: (key: string) => void; onDropGraph: (source: string, target: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rows = useMemo(() => EVENT_CHANNELS.map((channelId) => ({
    channelId,
    series: series.filter((item) => item.channelId === channelId),
  })).filter((row) => row.series.length > 0), [series]);
  const minimumHeight = Math.max(108, rows.length * 26 + 34);
  const { height, onResizePointerDown } = useResizableGraphHeight(Math.max(minimumHeight, storedHeight), onHeightCommit);
  const events = useGraphInteractions(interaction, 86, 12);
  const visibleEventCount = useMemo(() => rows.reduce((sum, row) => sum + countEvents(series, row.channelId, interaction.viewport), 0), [interaction.viewport, rows, series]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const draw = () => {
      const context = setCanvasSize(canvas, height); if (!context) return;
      const width = canvas.clientWidth; const left = 86; const right = 12; const top = 8; const bottom = 24;
      const plotWidth = Math.max(1, width - left - right); const plotHeight = Math.max(1, height - top - bottom);
      const rowHeight = plotHeight / Math.max(1, rows.length);
      context.clearRect(0, 0, width, height); context.fillStyle = canvasColor("--canvas"); context.fillRect(0, 0, width, height);
      context.font = "11px system-ui, sans-serif"; context.textBaseline = "middle";
      const duration = Math.max(1, interaction.viewport.endMs - interaction.viewport.startMs);
      const xFor = (time: number) => left + ((time - interaction.viewport.startMs) / duration) * plotWidth;

      rows.forEach((row, index) => {
        const meta = EVENT_META[row.channelId] ?? { label: String(row.channelId), name: String(row.channelId) };
        const y = top + index * rowHeight;
        context.fillStyle = canvasColor("--muted"); context.textAlign = "right"; context.fillText(meta.label, left - 8, y + rowHeight / 2);
        context.strokeStyle = canvasColor("--grid"); context.beginPath(); context.moveTo(left, y + rowHeight); context.lineTo(width - right, y + rowHeight); context.stroke();
        for (const item of row.series) {
          const begin = lowerBound(item.timesMs, interaction.viewport.startMs); const end = lowerBound(item.timesMs, interaction.viewport.endMs);
          for (let point = begin; point < end; point += 1) {
            const time = item.timesMs[point]; if (time === undefined) continue;
            const x = xFor(time); const eventDurationSec = Math.max(0, item.values[point] ?? 0);
            context.fillStyle = channelColor(row.channelId);
            if (row.channelId === Channel.CSR && eventDurationSec > 0) {
              const startX = Math.max(left, xFor(time - eventDurationSec * 1000));
              context.globalAlpha = 0.22; context.fillRect(startX, y + 3, Math.max(2, x - startX), rowHeight - 6); context.globalAlpha = 1;
            } else {
              context.fillRect(Math.round(x) - 2, y + 3, 4, rowHeight - 6);
            }
          }
        }
      });

      context.fillStyle = canvasColor("--muted");
      for (let column = 0; column <= 6; column += 1) {
        const x = left + (plotWidth * column) / 6;
        const time = interaction.viewport.startMs + duration * column / 6;
        context.textAlign = column === 0 ? "left" : column === 6 ? "right" : "center";
        context.fillText(timeLabel(time), x, height - 10);
      }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); window.addEventListener("oscar-theme-change", draw); return () => { observer.disconnect(); window.removeEventListener("oscar-theme-change", draw); };
  }, [height, interaction.viewport, rows]);

  useEffect(() => {
    const canvas = overlayRef.current; if (!canvas) return;
    const draw = () => {
      const context = setCanvasSize(canvas, height); if (!context) return;
      const width = canvas.clientWidth; const left = 86; const right = 12; const top = 8; const bottom = 24;
      const plotWidth = Math.max(1, width - left - right);
      context.clearRect(0, 0, width, height);
      if (interaction.cursorMs === undefined || interaction.cursorMs < interaction.viewport.startMs || interaction.cursorMs > interaction.viewport.endMs) return;
      const x = left + ((interaction.cursorMs - interaction.viewport.startMs) / Math.max(1, interaction.viewport.endMs - interaction.viewport.startMs)) * plotWidth;
      context.strokeStyle = canvasColor("--cursor"); context.lineWidth = 1; context.setLineDash([3, 3]); context.beginPath(); context.moveTo(x, top); context.lineTo(x, height - bottom); context.stroke(); context.setLineDash([]);

      const nearby = eventsNearCursor(series, interaction.cursorMs, interaction.viewport, 7, plotWidth);
      if (nearby.length) {
        const lines = [timeLabel(nearby[0]?.timeMs ?? interaction.cursorMs, true), ...nearby.slice(0, 4).map((event) => {
          const meta = EVENT_META[event.channelId] ?? { label: String(event.channelId), name: String(event.channelId) };
          return event.value > 0 ? `${meta.label}: ${formatReading(event.value, "s")}` : meta.label;
        })];
        context.font = "11px system-ui, sans-serif";
        const boxWidth = Math.max(...lines.map((line) => context.measureText(line).width)) + 16;
        const lineHeight = 17; const boxHeight = lines.length * lineHeight + 8;
        const boxX = x + boxWidth + 18 > width ? Math.max(left, x - boxWidth - 10) : x + 10;
        const boxY = top + 5;
        context.fillStyle = canvasColor("--surface"); context.strokeStyle = canvasColor("--border"); context.lineWidth = 1;
        context.fillRect(boxX, boxY, boxWidth, boxHeight); context.strokeRect(boxX, boxY, boxWidth, boxHeight);
        context.textAlign = "left"; context.textBaseline = "middle"; context.fillStyle = canvasColor("--text");
        lines.forEach((line, index) => context.fillText(line, boxX + 8, boxY + 7 + lineHeight * index + lineHeight / 2));
      }
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); window.addEventListener("oscar-theme-change", draw); return () => { observer.disconnect(); window.removeEventListener("oscar-theme-change", draw); };
  }, [height, interaction.cursorMs, interaction.viewport, series]);

  return <section className="therapy-graph event-flags graph-layout-item" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData("text/x-oscar-graph-key"); if (source) onDropGraph(source, "events"); }}>
    <div className="graph-heading"><div className="graph-heading-title"><GraphDragHandle graphKey="events" onStart={onDragStart} /><GraphPin pinned={pinned} onToggle={onTogglePin} /><strong>Event Flags</strong></div><span>{visibleEventCount} events in view</span></div>
    <div className="graph-canvas-wrap" {...events}>
      <canvas ref={canvasRef} aria-label="Event flags graph" />
      <canvas ref={overlayRef} className="graph-cursor-overlay" aria-hidden="true" />
    </div>
    <div className="graph-resize-handle" role="separator" aria-orientation="horizontal" title="Drag to resize graph" onPointerDown={onResizePointerDown}><span /></div>
  </section>;
}

export function GraphStack({ data, daily, navigation, bookmarkRevision = 0, onBookmarksChange }: {
  data: ChartQueryResult; daily: DailySummary; navigation?: GraphNavigation;
  bookmarkRevision?: number; onBookmarksChange?(bookmarks: GraphBookmark[]): void;
}) {
  const bounds = useMemo<Viewport>(() => {
    const enabled = daily.sessions.filter((session) => session.enabled !== false);
    if (enabled.length) return { startMs: Math.min(...enabled.map((session) => session.firstMs)), endMs: Math.max(...enabled.map((session) => session.lastMs)) };
    const points = data.series.flatMap((series) => series.timesMs.length ? [series.timesMs[0] ?? data.rangeStartMs, series.timesMs[series.timesMs.length - 1] ?? data.rangeEndMs] : []);
    return points.length ? { startMs: Math.min(...points), endMs: Math.max(...points) } : { startMs: data.rangeStartMs, endMs: data.rangeEndMs };
  }, [daily.sessions, data]);
  const [viewport, setViewport] = useState<Viewport>(bounds);
  const [cursorMs, setCursorMs] = useState<number>();
  const [detailData, setDetailData] = useState<ChartQueryResult>(data);
  const [detailLoading, setDetailLoading] = useState(false);
  const [graphPreferences, setGraphPreferences] = useState<GraphPreference[]>([]);
  const [bookmarks, setBookmarks] = useState<GraphBookmark[]>([]);
  const [bookmarkName, setBookmarkName] = useState("");

  useEffect(() => { onBookmarksChange?.(bookmarks); }, [bookmarks, onBookmarksChange]);
  useEffect(() => {
    if (navigation) setViewport(clampViewport(navigation, bounds));
  }, [navigation, bounds.startMs, bounds.endMs]);

  useEffect(() => {
    let cancelled = false;
    window.oscar.getGraphPreferences(data.machineId).then((preferences) => {
      if (!cancelled) setGraphPreferences(preferences);
    }).catch(() => {
      if (!cancelled) setGraphPreferences([]);
    });
    return () => { cancelled = true; };
  }, [data.machineId]);

  useEffect(() => {
    let cancelled = false;
    window.oscar.listGraphBookmarks(data.machineId, data.date).then((items) => {
      if (!cancelled) setBookmarks(items);
    }).catch(() => {
      if (!cancelled) setBookmarks([]);
    });
    return () => { cancelled = true; };
  }, [data.date, data.machineId, bookmarkRevision]);

  function graphPreference(key: string): GraphPreference | undefined {
    return graphPreferences.find((item) => item.key === key);
  }

  async function toggleGraphPinned(key: string) {
    const existing = graphPreference(key);
    const pinned = !(existing?.pinned ?? false);
    const sortOrder = existing?.sortOrder ?? (graphPreferences.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1);
    setGraphPreferences((current) => {
      const without = current.filter((item) => item.key !== key);
      return [...without, { key, pinned, sortOrder }];
    });
    try { await window.oscar.setGraphPinned(data.machineId, key, pinned); }
    catch {
      const preferences = await window.oscar.getGraphPreferences(data.machineId).catch(() => [] as GraphPreference[]);
      setGraphPreferences(preferences);
    }
  }


  function defaultGraphHeight(key: string): number {
    if (key === "events") return 170;
    return GRAPHS.find((definition) => definition.key === key)?.height ?? 170;
  }

  async function commitGraphHeight(key: string, height: number) {
    const existing = graphPreference(key);
    const sortOrder = existing?.sortOrder ?? (graphPreferences.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1);
    setGraphPreferences((current) => [
      ...current.filter((item) => item.key !== key),
      { key, pinned: existing?.pinned ?? false, sortOrder, height },
    ]);
    try { await window.oscar.setGraphHeight(data.machineId, key, height); }
    catch {
      const preferences = await window.oscar.getGraphPreferences(data.machineId).catch(() => [] as GraphPreference[]);
      setGraphPreferences(preferences);
    }
  }

  async function reorderGraph(sourceKey: string, targetKey: string) {
    if (!sourceKey || sourceKey === targetKey) return;
    const currentRows = graphRows;
    const source = currentRows.find((row) => row.key === sourceKey);
    const target = currentRows.find((row) => row.key === targetKey);
    if (!source || !target) return;
    const sourcePinned = graphPreference(sourceKey)?.pinned ?? false;
    const targetPinned = graphPreference(targetKey)?.pinned ?? false;
    if (sourcePinned !== targetPinned) return; // pinned graphs remain in their top group
    const keys = currentRows.map((row) => row.key);
    const from = keys.indexOf(sourceKey);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    keys.splice(from, 1);
    keys.splice(to, 0, sourceKey);
    setGraphPreferences((current) => keys.map((key, index) => {
      const existing = current.find((item) => item.key === key);
      return { key, pinned: existing?.pinned ?? false, sortOrder: index, ...(existing?.height !== undefined ? { height: existing.height } : {}) };
    }));
    try { await window.oscar.setGraphOrder(data.machineId, keys); }
    catch {
      const preferences = await window.oscar.getGraphPreferences(data.machineId).catch(() => [] as GraphPreference[]);
      setGraphPreferences(preferences);
    }
  }

  async function saveViewportBookmark() {
    const suggested = `${timeLabel(viewport.startMs, true)}–${timeLabel(viewport.endMs, true)}`;
    const name = bookmarkName.trim() || suggested;
    try {
      const created = await window.oscar.createGraphBookmark(data.machineId, data.date, name, viewport.startMs, viewport.endMs);
      setBookmarks((current) => [...current, created].sort((a, b) => a.startMs - b.startMs || a.name.localeCompare(b.name)));
      setBookmarkName("");
    } catch { /* keep graph interaction usable if bookmark storage fails */ }
  }

  async function deleteBookmark(bookmarkId: number) {
    try {
      await window.oscar.deleteGraphBookmark(data.machineId, bookmarkId);
      setBookmarks((current) => current.filter((item) => item.id !== bookmarkId));
    } catch { /* ignore and keep current view */ }
  }

  useEffect(() => {
    setViewport(bounds);
    setDetailData(data);
    setDetailLoading(false);
  }, [bounds.startMs, bounds.endMs, data]);

  const fullView = Math.abs(viewport.startMs - bounds.startMs) <= 1 && Math.abs(viewport.endMs - bounds.endMs) <= 1;
  useEffect(() => {
    if (fullView) { setDetailData(data); setDetailLoading(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setDetailLoading(true);
      window.oscar.getChartSeries(data.machineId, data.date, [...DEFAULT_CHART_CHANNELS], {
        startMs: viewport.startMs,
        endMs: viewport.endMs,
        maxPointsPerSeries: 12_000,
      }).then((next) => {
        if (!cancelled) setDetailData(next);
      }).catch(() => {
        // Keep the coarse full-day data visible if a detail fetch fails.
      }).finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    }, 140);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [data, fullView, viewport.endMs, viewport.startMs]);

  const detailCoversViewport = detailData.rangeStartMs <= viewport.startMs + 1 && detailData.rangeEndMs >= viewport.endMs - 1;
  const renderData = fullView || detailCoversViewport ? detailData : data;
  const interaction: InteractionProps = { viewport, bounds, cursorMs, setViewport, setCursorMs, resetViewport: () => setViewport(bounds) };
  // Keep rows and zoom controls available when a detail window falls in a data gap.
  const graphEntries = GRAPHS.filter((definition) => data.series.some((item) => definition.channelIds.includes(item.channelId)))
    .map((definition) => ({ definition, series: renderData.series.filter((item) => definition.channelIds.includes(item.channelId)) }));
  const eventChannelIds = EVENT_CHANNELS as readonly number[];
  const eventSeries = renderData.series.filter((item) => eventChannelIds.includes(item.channelId));
  const hasEventChannels = data.series.some((item) => eventChannelIds.includes(item.channelId));
  const graphRows = [
    ...(hasEventChannels ? [{ key: "events", kind: "events" as const, baseOrder: 0 }] : []),
    ...graphEntries.map((entry, index) => ({ key: entry.definition.key, kind: "graph" as const, baseOrder: index + 1, entry })),
  ].sort((a, b) => {
    const aPref = graphPreference(a.key);
    const bPref = graphPreference(b.key);
    const aPinned = aPref?.pinned ?? false;
    const bPinned = bPref?.pinned ?? false;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return (aPref?.sortOrder ?? a.baseOrder) - (bPref?.sortOrder ?? b.baseOrder);
  });
  const zoomed = !fullView;
  const windowStats = useMemo(() => {
    const events = therapyWindowEventSummary(renderData.series, daily.sessions, viewport, {
      obstructive: Channel.ObstructiveApnea,
      clearAirway: Channel.ClearAirway,
      hypopnea: Channel.Hypopnea,
      unclassified: Channel.UnclassifiedApnea,
      rera: Channel.RERA,
    });
    const pressure = preferredStatistics(renderData.series, [Channel.Pressure, Channel.MaskPressureHigh, Channel.IPAP], viewport);
    const leak = channelStatistics(renderData.series, Channel.Leak, viewport);
    const spo2 = channelStatistics(renderData.series, Channel.SpO2, viewport);
    const flow = combinedStatistics(renderData.series, [Channel.FlowRate], viewport);
    return { ...events, pressure, leak, spo2, flow };
  }, [daily.sessions, renderData.series, viewport]);

  const transfer = useMemo(() => {
    const source = renderData.series.reduce((sum, item) => sum + item.sourcePointCount, 0);
    const returned = renderData.series.reduce((sum, item) => sum + item.values.length, 0);
    const decimated = renderData.series.some((item) => item.decimated);
    return { source, returned, decimated };
  }, [renderData.series]);

  if (graphEntries.length === 0 && !hasEventChannels) return <div className="graph-empty">No detailed chart data is stored for this therapy day.</div>;

  return <div className="graph-stack">
    <div className="graph-toolbar">
      <div><strong>{timeLabel(viewport.startMs, true)} – {timeLabel(viewport.endMs, true)}</strong><span>{((viewport.endMs - viewport.startMs) / 3_600_000).toFixed(2)} h window · {windowStats.therapyHours.toFixed(2)} h therapy</span></div>
      <div className="graph-help">Wheel to zoom · drag to pan · double-click to reset{cursorMs !== undefined ? ` · cursor ${timeLabel(cursorMs, true)}` : ""}</div>
      <div className="graph-resolution" title={`${transfer.source.toLocaleString()} source points`}>{detailLoading ? "Loading detail…" : transfer.decimated ? `${transfer.returned.toLocaleString()} adaptive points` : `${transfer.returned.toLocaleString()} exact points`}</div>
      <button type="button" className="secondary" disabled={!zoomed} onClick={() => setViewport(bounds)}>Reset zoom</button>
    </div>
    <div className="graph-layout-toolbar">
      <div className="bookmark-actions">
        <input aria-label="Graph view name" placeholder="Graph view name (optional)" value={bookmarkName} onChange={(event) => setBookmarkName(event.target.value)} disabled={!zoomed} />
        <button type="button" className="secondary" disabled={!zoomed} onClick={() => void saveViewportBookmark()}>Save view</button>
        <select aria-label="Saved graph views" defaultValue="" onChange={(event) => {
          const bookmark = bookmarks.find((item) => item.id === Number(event.target.value));
          if (bookmark) setViewport(clampViewport({ startMs: bookmark.startMs, endMs: bookmark.endMs }, bounds));
          event.currentTarget.value = "";
        }}>
          <option value="">Saved views ({bookmarks.length})</option>
          {bookmarks.map((bookmark) => <option key={bookmark.id} value={bookmark.id}>{bookmark.name} · {timeLabel(bookmark.startMs, true)}–{timeLabel(bookmark.endMs, true)}</option>)}
        </select>
      </div>
      <div className="graph-layout-help">Drag ⋮⋮ to reorder · drag the bottom grip to resize · pinned graphs stay at the top</div>
    </div>
    {bookmarks.length > 0 && <div className="graph-bookmark-strip">{bookmarks.map((bookmark) => <div key={bookmark.id} className="graph-bookmark"><button type="button" onClick={() => setViewport(clampViewport({ startMs: bookmark.startMs, endMs: bookmark.endMs }, bounds))}><span>{bookmark.name}</span><small>{timeLabel(bookmark.startMs, true)}–{timeLabel(bookmark.endMs, true)}</small></button><button className="icon-button" aria-label={`Delete ${bookmark.name}`} title="Delete saved view" onClick={() => void deleteBookmark(bookmark.id)}><X size={13} /></button></div>)}</div>}
    <details className="viewport-statistics"><summary>Viewport statistics · AHI {windowStats.ahi.toFixed(2)} · {windowStats.therapyHours.toFixed(2)} h therapy</summary><div className="zoom-stat-strip" aria-label="Statistics for visible graph window">
      <div><span>AHI</span><strong>{windowStats.ahi.toFixed(2)}</strong></div>
      <div><span>RDI</span><strong>{windowStats.rdi.toFixed(2)}</strong></div>
      <div><span>Events</span><strong>{windowStats.obstructive + windowStats.clearAirway + windowStats.hypopnea + windowStats.unclassified + windowStats.rera}</strong><small>OA {windowStats.obstructive} · CA {windowStats.clearAirway} · H {windowStats.hypopnea} · RERA {windowStats.rera}</small></div>
      <div><span>Pressure 95%</span><strong>{windowStats.pressure ? windowStats.pressure.percentile95.toFixed(1) : "—"}</strong><small>{windowStats.pressure ? "cmH₂O" : "No data"}</small></div>
      <div><span>Leak 95%</span><strong>{windowStats.leak ? windowStats.leak.percentile95.toFixed(1) : "—"}</strong><small>{windowStats.leak ? "L/min" : "No data"}</small></div>
      <div><span>SpO₂ min</span><strong>{windowStats.spo2 ? windowStats.spo2.min.toFixed(0) : "—"}</strong><small>{windowStats.spo2 ? "%" : "No data"}</small></div>
      <div><span>Flow range</span><strong>{windowStats.flow ? `${windowStats.flow.min.toFixed(0)}…${windowStats.flow.max.toFixed(0)}` : "—"}</strong><small>{windowStats.flow ? "L/min" : "No data"}</small></div>
    </div>
    </details>
    {graphRows.map((row) => row.kind === "events"
      ? <EventFlags key={row.key} series={eventSeries} interaction={interaction} pinned={graphPreference(row.key)?.pinned ?? false} height={graphPreference(row.key)?.height ?? defaultGraphHeight(row.key)} onTogglePin={() => void toggleGraphPinned(row.key)} onHeightCommit={(height) => void commitGraphHeight(row.key, height)} onDragStart={() => undefined} onDropGraph={(source, target) => void reorderGraph(source, target)} />
      : <GraphPanel key={row.key} definition={row.entry.definition} series={row.entry.series} interaction={interaction} pinned={graphPreference(row.key)?.pinned ?? false} height={graphPreference(row.key)?.height ?? defaultGraphHeight(row.key)} onTogglePin={() => void toggleGraphPinned(row.key)} onHeightCommit={(height) => void commitGraphHeight(row.key, height)} onDragStart={() => undefined} onDropGraph={(source, target) => void reorderGraph(source, target)} />)}
  </div>;
}
