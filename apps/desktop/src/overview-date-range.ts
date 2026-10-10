const DAY_MS = 86_400_000;

/** Date-only therapy keys use UTC arithmetic so host DST never changes a day step. */
export function dayOffset(first: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS);
}

export function dateAtOffset(first: string, offset: number): string {
  return new Date(Date.parse(`${first}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

export function rangeHandleOffset(fraction: number, lastOffset: number, otherOffset: number, edge: "start" | "end"): number {
  const offset = Math.round(Math.max(0, Math.min(1, fraction)) * lastOffset);
  return edge === "start" ? Math.min(offset, otherOffset) : Math.max(offset, otherOffset);
}
