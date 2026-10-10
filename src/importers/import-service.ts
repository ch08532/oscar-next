import { resolve } from "node:path";
import { Machine } from "../core/machine.js";
import type { MachineInfo } from "../core/types.js";
import { OscarDatabase } from "../storage/database.js";
import type { ImportProgress } from "./machine-loader.js";
import { ImporterRegistry } from "./registry.js";
import { discoverResMedEdfFiles, type ResMedEdfType } from "./resmed/resmed-files.js";
import { ResMedLoader } from "./resmed/resmed-loader.js";

export interface ImportPreview {
  sourcePath: string;
  importerName: string;
  machine?: MachineInfo;
  fileCount?: number;
  fileCounts?: Partial<Record<ResMedEdfType, number>>;
}

export interface ImportStoreResult {
  databasePath: string;
  sourcePath: string;
  machineId: number;
  brand: string;
  model: string;
  serial: string;
  sessionsImported: number;
  newSessions: number;
  updatedSessions: number;
  totalStoredSessions: number;
  firstSessionTime?: number;
  lastSessionTime?: number;
  warnings: string[];
}

export function makeDefaultImporterRegistry(): ImporterRegistry {
  const registry = new ImporterRegistry();
  registry.register(new ResMedLoader());
  return registry;
}

export async function previewImportSource(rawPath: string): Promise<ImportPreview | undefined> {
  const sourcePath = resolve(rawPath);
  const registry = makeDefaultImporterRegistry();
  const importer = await registry.detect(sourcePath);
  if (!importer) return undefined;

  const machine = await importer.peekInfo(sourcePath);
  const preview: ImportPreview = { sourcePath, importerName: importer.name, ...(machine ? { machine } : {}) };

  if (importer.name === "ResMed") {
    const files = await discoverResMedEdfFiles(sourcePath);
    const fileCounts: Partial<Record<ResMedEdfType, number>> = {};
    for (const file of files) fileCounts[file.type] = (fileCounts[file.type] ?? 0) + 1;
    preview.fileCount = files.length;
    preview.fileCounts = fileCounts;
  }
  return preview;
}

/**
 * Merge a newly imported card snapshot with an existing stored machine.
 * The newly imported version wins on duplicate session IDs while sessions no
 * longer present on the card are retained. This is important because an SD
 * card may only hold a recent subset of the user's therapy history.
 */
export function mergeImportedMachine(existing: Machine | undefined, incoming: Machine): { machine: Machine; newSessions: number; updatedSessions: number } {
  if (!existing) return { machine: incoming, newSessions: incoming.sessions.size, updatedSessions: 0 };
  if (existing.id !== incoming.id) throw new Error("Cannot merge different machines");
  if (existing.info.type !== incoming.info.type) throw new Error("Cannot merge machines with different types");

  let newSessions = 0;
  let updatedSessions = 0;
  for (const [sessionId, incomingSession] of incoming.sessions) {
    const existingSession = existing.sessions.get(sessionId);
    if (existingSession) {
      updatedSessions += 1;
      // Session enable/disable is a user choice, not device data. Preserve it
      // when the same SD-card session is imported again.
      incomingSession.enabled = existingSession.enabled;
    } else newSessions += 1;
  }

  for (const [sessionId, session] of existing.sessions) {
    if (!incoming.sessions.has(sessionId)) incoming.addSession(session);
  }
  for (const [key, value] of existing.properties) {
    if (!incoming.properties.has(key)) incoming.properties.set(key, value);
  }

  return { machine: incoming, newSessions, updatedSessions };
}

export async function importSourceToDatabase(
  rawSourcePath: string,
  rawDatabasePath: string,
  onProgress?: (progress: ImportProgress) => void,
  options: { profileId?: number; deviceTimeZone?: string } = {},
): Promise<ImportStoreResult> {
  const sourcePath = resolve(rawSourcePath);
  const databasePath = resolve(rawDatabasePath);
  const registry = makeDefaultImporterRegistry();
  const importer = await registry.detect(sourcePath);
  if (!importer) throw new Error(`No supported CPAP media detected at: ${sourcePath}`);

  onProgress?.({ current: 0, message: `Detected ${importer.name} media` });
  const imported = await importer.open(sourcePath, onProgress ? { onProgress } : undefined);
  imported.machine.info.lastImported = new Date();
  imported.machine.properties.set("lastSourcePath", sourcePath);

  const db = new OscarDatabase(databasePath);
  try {
    const existing = db.loadMachine(imported.machine.id);
    const merged = mergeImportedMachine(existing, imported.machine);
    onProgress?.({ current: imported.sessionsImported, total: imported.sessionsImported, message: "Saving imported therapy data" });
    db.saveMachine(merged.machine, {
      ...(options.profileId !== undefined ? { profileId: options.profileId } : {}),
      ...(options.deviceTimeZone ? { deviceTimeZone: options.deviceTimeZone, timeZoneSource: "profile" as const } : {}),
    });
    onProgress?.({ current: imported.sessionsImported, total: imported.sessionsImported, message: "Import complete" });

    return {
      databasePath,
      sourcePath,
      machineId: merged.machine.id,
      brand: merged.machine.info.brand,
      model: merged.machine.info.model,
      serial: merged.machine.info.serial,
      sessionsImported: imported.sessionsImported,
      newSessions: merged.newSessions,
      updatedSessions: merged.updatedSessions,
      totalStoredSessions: merged.machine.sessions.size,
      ...(merged.machine.firstSessionTime !== undefined ? { firstSessionTime: merged.machine.firstSessionTime } : {}),
      ...(merged.machine.lastSessionTime !== undefined ? { lastSessionTime: merged.machine.lastSessionTime } : {}),
      warnings: imported.warnings,
    };
  } finally {
    db.close();
  }
}
