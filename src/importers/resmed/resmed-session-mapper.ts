import { basename } from "node:path";
import { CpapChannel } from "../../core/cpap-channels.js";
import { EventListType } from "../../core/event-list.js";
import { Session } from "../../core/session.js";
import { MachineType, type ChannelId } from "../../core/types.js";
import { readEdfFile } from "../edf/edf-parser.js";
import type { EdfAnnotation, EdfFile, EdfLocalDateTime, EdfSignalData } from "../edf/edf-types.js";
import type { ResMedEdfFile, ResMedEdfType } from "./resmed-files.js";
import { classifyResMedEventAnnotation, mapResMedSignal, type ResMedSignalMapping } from "./resmed-signals.js";
import { readResMedStrFile, sessionsFromStr } from "./resmed-str.js";

export interface ResMedSessionMapResult {
  sessions: Session[];
  warnings: string[];
}

export interface ResMedSessionMapOptions { air11?: boolean; }

/**
 * EDF timestamps contain no timezone. We normalize the device's wall-clock
 * fields onto a UTC epoch so importing the same card is deterministic on every
 * host. A future storage layer can attach an explicit device timezone.
 */
export function edfWallClockMs(value: EdfLocalDateTime): number {
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
}

export function edfBoundsMs(edf: EdfFile): { startMs: number; endMs: number } {
  const startMs = edfWallClockMs(edf.header.start);
  const lastOnset = edf.dataRecordOnsetsSeconds.length > 0
    ? Math.max(...edf.dataRecordOnsetsSeconds)
    : 0;
  const durationSeconds = edf.parsedDataRecordCount > 0
    ? lastOnset + edf.header.dataRecordDurationSeconds
    : 0;
  return { startMs, endMs: startMs + Math.max(0, durationSeconds * 1000) };
}

function updateBounds(session: Session, startMs: number, endMs: number): void {
  if (session.first === 0 && session.last === 0) {
    session.setBounds(startMs, endMs);
    return;
  }
  session.setBounds(Math.min(session.first, startMs), Math.max(session.last, endMs));
}

function overlaps(session: Session, startMs: number, endMs: number): boolean {
  return session.first < endMs && startMs < session.last;
}

function findOrCreateSession(sessions: Session[], startMs: number, endMs: number): Session {
  const existing = sessions.find((session) => overlaps(session, startMs, endMs));
  if (existing) {
    updateBounds(existing, startMs, endMs);
    return existing;
  }

  let id = Math.floor(startMs / 1000);
  while (sessions.some((session) => session.id === id)) id += 1;
  const session = new Session(id, MachineType.CPAP);
  session.setBounds(startMs, endMs);
  sessions.push(session);
  sessions.sort((a, b) => a.first - b.first);
  return session;
}

function bestOverlappingSession(sessions: readonly Session[], startMs: number, endMs: number): Session | undefined {
  let best: Session | undefined;
  let bestOverlap = 0;
  for (const session of sessions) {
    const overlapMs = Math.max(0, Math.min(session.last, endMs) - Math.max(session.first, startMs));
    if (overlapMs > bestOverlap) {
      best = session;
      bestOverlap = overlapMs;
    }
  }
  return best;
}

function signalDurationMs(edf: EdfFile): number {
  const { startMs, endMs } = edfBoundsMs(edf);
  return Math.max(0, endMs - startMs);
}

function scaledOptions(signal: EdfSignalData, mapping: ResMedSignalMapping, rateMs: number) {
  const multiplier = mapping.gainMultiplier ?? 1;
  return {
    gain: signal.definition.gain * multiplier,
    offset: signal.definition.offset,
    rateMs,
    dimension: mapping.dimension ?? signal.definition.physicalDimension,
  };
}

function addWaveformSignal(session: Session, edf: EdfFile, signal: EdfSignalData, mapping: ResMedSignalMapping): void {
  const samples = signal.digitalSamples;
  if (!samples || samples.length === 0) return;
  const durationMs = signalDurationMs(edf);
  if (durationMs <= 0) return;
  const startMs = edfWallClockMs(edf.header.start);
  const rateMs = durationMs / samples.length;
  const list = session.addEventList(mapping.channel, EventListType.Waveform, scaledOptions(signal, mapping, rateMs));
  list.addWaveform(startMs, samples, durationMs);
}

function addSparseSignal(session: Session, edf: EdfFile, signal: EdfSignalData, mapping: ResMedSignalMapping): void {
  const samples = signal.digitalSamples;
  if (!samples || samples.length === 0) return;
  const durationMs = signalDurationMs(edf);
  if (durationMs <= 0) return;
  const startMs = edfWallClockMs(edf.header.start);
  const rateMs = durationMs / samples.length;
  const list = session.addEventList(mapping.channel, EventListType.Event, scaledOptions(signal, mapping, rateMs));
  for (let index = 0; index < samples.length; index += 1) {
    const raw = samples[index];
    if (raw === undefined || raw === mapping.missingRawValue) continue;
    list.addEvent(startMs + index * rateMs, raw);
  }
}

function mapDataSignals(
  session: Session,
  type: ResMedEdfType,
  edf: EdfFile,
  warnings: string[],
  path: string,
): void {
  for (const signal of edf.signals) {
    if (signal.definition.isAnnotation) continue;
    const mapping = mapResMedSignal(type, signal.definition);
    if (!mapping) {
      const label = signal.definition.label.trim();
      if (label && label.toLocaleLowerCase() !== "crc16") {
        warnings.push(`${basename(path)}: unrecognized ${type} signal '${label}'`);
      }
      continue;
    }
    if (mapping.missingRawValue !== undefined) addSparseSignal(session, edf, signal, mapping);
    else addWaveformSignal(session, edf, signal, mapping);
  }
}

function getOrCreateEventList(session: Session, channel: ChannelId) {
  const existing = session.eventLists.get(channel)?.[0];
  return existing ?? session.addEventList(channel, EventListType.Event, { gain: 0.1, dimension: "s" });
}

function sessionContaining(sessions: Session[], timeMs: number): Session | undefined {
  return sessions.find((session) => session.checkInside(timeMs));
}

function eventChannel(kind: ReturnType<typeof classifyResMedEventAnnotation>): CpapChannel | undefined {
  switch (kind) {
    case "oa": return CpapChannel.ObstructiveApnea;
    case "hypopnea": return CpapChannel.Hypopnea;
    case "apnea": return CpapChannel.UnclassifiedApnea;
    case "rera": return CpapChannel.RERA;
    case "central": return CpapChannel.ClearAirway;
    default: return undefined;
  }
}

function applyEventAnnotation(
  sessions: Session[],
  fileStartMs: number,
  annotation: EdfAnnotation,
  warnings: string[],
  sourceName: string,
): void {
  if (annotation.timekeeping && annotation.texts.length === 0) return;
  const timeMs = fileStartMs + annotation.onsetSeconds * 1000;
  for (const text of annotation.texts) {
    const kind = classifyResMedEventAnnotation(text);
    if (kind === "recording-starts") continue;
    const channel = eventChannel(kind);
    if (channel === undefined) {
      warnings.push(`${sourceName}: unrecognized EVE annotation '${text}'`);
      continue;
    }
    const session = sessionContaining(sessions, timeMs);
    if (!session) continue;
    const durationTenths = Math.max(0, Math.min(32767, Math.round((annotation.durationSeconds ?? 0) * 10)));
    getOrCreateEventList(session, channel).addEvent(timeMs, durationTenths);
  }
}

function applyEve(sessions: Session[], edf: EdfFile, warnings: string[], path: string): void {
  const startMs = edfWallClockMs(edf.header.start);
  for (const signal of edf.signals) {
    for (const annotation of signal.annotations ?? []) {
      applyEventAnnotation(sessions, startMs, annotation, warnings, basename(path));
    }
  }
}

function applyCsl(sessions: Session[], edf: EdfFile, warnings: string[], path: string): void {
  const startMs = edfWallClockMs(edf.header.start);
  let csrStartMs: number | undefined;

  for (const signal of edf.signals) {
    for (const annotation of signal.annotations ?? []) {
      const timeMs = startMs + annotation.onsetSeconds * 1000;
      for (const rawText of annotation.texts) {
        const text = rawText.trim().toLocaleLowerCase();
        if (text === "recording starts") continue;
        if (text === "csr start") {
          csrStartMs = timeMs;
          continue;
        }
        if (text === "csr end") {
          if (csrStartMs === undefined) {
            warnings.push(`${basename(path)}: CSR end without CSR start`);
            continue;
          }
          const session = sessionContaining(sessions, csrStartMs);
          if (session) {
            const durationTenths = Math.max(0, Math.min(32767, Math.round((timeMs - csrStartMs) / 100)));
            getOrCreateEventList(session, CpapChannel.CSR).addEvent(timeMs, durationTenths);
          }
          csrStartMs = undefined;
          continue;
        }
        if (text) warnings.push(`${basename(path)}: unrecognized CSL annotation '${rawText}'`);
      }
    }
  }
}

export async function mapResMedSessions(files: readonly ResMedEdfFile[], onFileProgress?: (completed: number, total: number, file: ResMedEdfFile) => void, options: ResMedSessionMapOptions = {}): Promise<ResMedSessionMapResult> {
  const warnings: string[] = [];
  const strFiles = files.filter((file) => file.type === "STR");
  const detailedFiles = files.filter((file) => file.type !== "STR");
  const sessions: Session[] = [];
  let processedFiles = 0;
  const report = (file: ResMedEdfFile) => { processedFiles += 1; onFileProgress?.(processedFiles, files.length, file); };

  // STR is authoritative when Mask On/Off windows are available. Multiple STR
  // files can exist in backups, so exact duplicate windows are de-duplicated.
  for (const file of strFiles) {
    try {
      const parsed = await readResMedStrFile(file.path, options.air11 === undefined ? {} : { air11: options.air11 });
      warnings.push(...parsed.warnings.map((warning) => `${basename(file.path)}: ${warning}`));
      for (const session of sessionsFromStr(parsed.days)) {
        if (sessions.some((existing) => existing.first === session.first && existing.last === session.last)) continue;
        sessions.push(session);
      }
    } catch (error) {
      warnings.push(`${basename(file.path)}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      report(file);
    }
  }
  sessions.sort((a, b) => a.first - b.first);
  const hasAuthoritativeStrSessions = sessions.length > 0;

  const annotations: ResMedEdfFile[] = [];
  const sessionDataTypes = new Set<ResMedEdfType>(["BRP", "PLD", "SAD", "SA2"]);

  for (const file of detailedFiles) {
    if (file.type === "EVE" || file.type === "CSL") {
      annotations.push(file);
      continue;
    }
    if (file.type === "AEV") {
      // AEV exists on newer devices (including some AirSense 11 cards). Current
      // OSCAR recognizes the file family but does not yet assign clinical
      // semantics to it either. Parse it for structural diagnostics only.
      try {
        const edf = await readEdfFile(file.path, { strict: false });
        warnings.push(...edf.warnings.map((warning) => `${basename(file.path)}: ${warning}`));
        const labels = edf.signals.map((signal) => signal.definition.label.trim()).filter(Boolean);
        warnings.push(`${basename(file.path)}: AEV recognized; semantic mapping is not yet defined${labels.length ? ` (${labels.join(", ")})` : ""}`);
      } catch (error) {
        warnings.push(`${basename(file.path)}: ${error instanceof Error ? error.message : String(error)}`);
      } finally { report(file); }
      continue;
    }
    if (!sessionDataTypes.has(file.type)) {
      warnings.push(`${basename(file.path)}: ${file.type} session mapping is not implemented yet`);
      report(file);
      continue;
    }

    try {
      const edf = await readEdfFile(file.path, { strict: false });
      warnings.push(...edf.warnings.map((warning) => `${basename(file.path)}: ${warning}`));
      const bounds = edfBoundsMs(edf);
      if (bounds.endMs <= bounds.startMs) {
        warnings.push(`${basename(file.path)}: no usable data-record duration`);
        continue;
      }

      let session = bestOverlappingSession(sessions, bounds.startMs, bounds.endMs);
      if (!session) {
        session = findOrCreateSession(sessions, bounds.startMs, bounds.endMs);
        if (hasAuthoritativeStrSessions) session.noSettings = true;
      } else if (!hasAuthoritativeStrSessions) {
        // Legacy fallback: without STR windows, detailed files define/expand the session.
        updateBounds(session, bounds.startMs, bounds.endMs);
      }
      mapDataSignals(session, file.type, edf, warnings, file.path);
    } catch (error) {
      warnings.push(`${basename(file.path)}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      report(file);
    }
  }

  for (const file of annotations) {
    try {
      const edf = await readEdfFile(file.path, { strict: false });
      warnings.push(...edf.warnings.map((warning) => `${basename(file.path)}: ${warning}`));
      if (file.type === "EVE") applyEve(sessions, edf, warnings, file.path);
      else applyCsl(sessions, edf, warnings, file.path);
    } catch (error) {
      warnings.push(`${basename(file.path)}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      report(file);
    }
  }

  // STR-only windows remain useful as summary-only sessions even when detailed
  // EDF files are absent.
  for (const session of sessions) {
    if (session.availableChannels().length === 0) session.summaryOnly = true;
  }

  sessions.sort((a, b) => a.first - b.first);
  return { sessions, warnings };
}

