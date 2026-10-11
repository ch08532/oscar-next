const DAY_MS = 86_400_000;

export type RangeEdge = "start" | "end";

/** Date-only therapy keys use UTC arithmetic so host DST never changes a day step. */
export function dayOffset(first: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS);
}

export function dateAtOffset(first: string, offset: number): string {
  return new Date(Date.parse(`${first}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

export function rangeHandleOffset(fraction: number, lastOffset: number, otherOffset: number, edge: RangeEdge): number {
  const offset = Math.round(Math.max(0, Math.min(1, fraction)) * lastOffset);
  return edge === "start" ? Math.min(offset, otherOffset) : Math.max(offset, otherOffset);
}

export function clampRangeOffset(offset: number, last: number, other: number, edge: RangeEdge): number {
  return edge === "start" ? Math.max(0, Math.min(other, offset)) : Math.max(other, Math.min(last, offset));
}

export function keyboardRangeOffset(key: string, current: number, last: number, other: number, edge: RangeEdge): number | undefined {
  let next: number;
  switch (key) {
    case "ArrowLeft": case "ArrowDown": next = current - 1; break;
    case "ArrowRight": case "ArrowUp": next = current + 1; break;
    case "PageDown": next = current - 7; break;
    case "PageUp": next = current + 7; break;
    case "Home": next = edge === "start" ? 0 : other; break;
    case "End": next = edge === "start" ? other : last; break;
    default: return undefined;
  }
  return clampRangeOffset(next, last, other, edge);
}

export function presetDateRange(firstDate: string, lastDate: string, endDate: string, preset: 7 | 30 | 90 | 180 | 365 | "all"): { startDate: string; endDate: string } {
  if (preset === "all") return { startDate: firstDate, endDate: lastDate };
  const candidate = dateAtOffset(endDate, -(preset - 1));
  return { startDate: candidate < firstDate ? firstDate : candidate, endDate };
}
