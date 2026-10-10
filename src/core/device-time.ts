export type WallClockResolution = "exact" | "ambiguous" | "nonexistent";

export interface WallClockInstantResolution {
  wallClockMs: number;
  timeZone: string;
  resolution: WallClockResolution;
  instantsMs: number[];
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function wallParts(ms: number): [number, number, number, number, number, number] {
  const date = new Date(ms);
  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
}

function zonedParts(instantMs: number, timeZone: string): [number, number, number, number, number, number] {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return [read("year"), read("month"), read("day"), read("hour"), read("minute"), read("second")];
}

function sameParts(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Resolve a floating device wall-clock timestamp into real instants for an IANA timezone.
 *
 * OSCAR Next stores EDF timestamps in a floating representation: UTC epoch fields are used
 * only as a stable container for the device's local YYYY-MM-DD HH:mm:ss. This function
 * attaches timezone meaning without mutating that source representation.
 *
 * During a fall-back transition a wall clock can map to two instants (ambiguous). During a
 * spring-forward gap it may map to none (nonexistent). Callers must choose how to handle
 * those cases instead of silently accepting a host-dependent conversion.
 */
export function resolveWallClockInstant(wallClockMs: number, timeZone: string): WallClockInstantResolution {
  if (!Number.isFinite(wallClockMs)) throw new RangeError("wallClockMs must be finite");
  if (!isValidIanaTimeZone(timeZone)) throw new RangeError(`Invalid IANA timezone: ${timeZone}`);

  const target = wallParts(Math.trunc(wallClockMs));
  const matches: number[] = [];
  const roundedWallMs = Math.floor(wallClockMs / 1000) * 1000;

  // Current IANA offsets are quarter-hour aligned. Scanning every 15 minutes across the
  // full legal UTC offset range is deterministic and also exposes DST overlaps cleanly.
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = roundedWallMs - offsetMinutes * 60_000;
    if (sameParts(zonedParts(candidate, timeZone), target)) matches.push(candidate);
  }

  matches.sort((a, b) => a - b);
  const unique = matches.filter((value, index) => index === 0 || value !== matches[index - 1]);
  return {
    wallClockMs,
    timeZone,
    resolution: unique.length === 0 ? "nonexistent" : unique.length === 1 ? "exact" : "ambiguous",
    instantsMs: unique,
  };
}

export function wallClockToInstant(
  wallClockMs: number,
  timeZone: string,
  ambiguity: "earlier" | "later" | "reject" = "earlier",
): number {
  const resolved = resolveWallClockInstant(wallClockMs, timeZone);
  if (resolved.resolution === "nonexistent") {
    throw new RangeError(`Device wall clock ${formatWallClock(wallClockMs)} does not exist in ${timeZone}`);
  }
  if (resolved.resolution === "ambiguous" && ambiguity === "reject") {
    throw new RangeError(`Device wall clock ${formatWallClock(wallClockMs)} is ambiguous in ${timeZone}`);
  }
  return ambiguity === "later"
    ? resolved.instantsMs[resolved.instantsMs.length - 1]!
    : resolved.instantsMs[0]!;
}

export function instantToWallClock(instantMs: number, timeZone: string): number {
  if (!Number.isFinite(instantMs)) throw new RangeError("instantMs must be finite");
  if (!isValidIanaTimeZone(timeZone)) throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  const [year, month, day, hour, minute, second] = zonedParts(instantMs, timeZone);
  return Date.UTC(year, month - 1, day, hour, minute, second, new Date(instantMs).getUTCMilliseconds());
}

export function formatWallClock(wallClockMs: number, includeSeconds = false): string {
  const iso = new Date(wallClockMs).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, includeSeconds ? 19 : 16)}`;
}
