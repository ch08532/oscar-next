import { readFile } from "node:fs/promises";
import { platform, release, arch } from "node:os";
import { basename } from "node:path";
import { OscarDatabase } from "../storage/database.js";
import { createStoredZip, type ZipEntry } from "./zip.js";

export interface DiagnosticBundleOptions {
  appVersion: string;
  logFilePath?: string | undefined;
  previousLogFilePath?: string | undefined;
  databasePath?: string | undefined;
  generatedAt?: Date | undefined;
  electronVersion?: string | undefined;
  nodeVersion?: string | undefined;
}

async function optionalFile(path: string | undefined): Promise<Uint8Array | undefined> {
  if (!path) return undefined;
  try { return await readFile(path); } catch { return undefined; }
}

export async function createDiagnosticBundle(options: DiagnosticBundleOptions): Promise<Uint8Array> {
  const database = options.databasePath ? new OscarDatabase(options.databasePath) : undefined;
  let databaseSummary: unknown;
  try {
    if (database) {
      const profiles = database.listProfiles();
      const machines = database.listMachines();
      databaseSummary = {
        schemaVersion: database.schemaVersion,
        profileCount: profiles.length,
        machineCount: machines.length,
        machines: machines.map((machine) => ({
          brand: machine.brand,
          model: machine.model,
          machineType: machine.machineType,
          sessionCount: machine.sessionCount,
          deviceTimeZone: machine.deviceTimeZone,
        })),
      };
    }
  } finally { database?.close(); }

  const manifest = {
    product: "OSCAR Next",
    appVersion: options.appVersion,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    runtime: {
      node: options.nodeVersion ?? process.version,
      ...(options.electronVersion ? { electron: options.electronVersion } : {}),
    },
    operatingSystem: { platform: platform(), release: release(), arch: arch() },
    database: databaseSummary ?? { open: false },
    privacy: {
      therapyDataIncluded: false,
      databaseIncluded: false,
      serialNumbersIncluded: false,
      profileNamesIncluded: false,
      note: "This bundle contains diagnostics and logs only. It does not contain the OSCAR Next database or therapy signal/event records.",
    },
  };

  const entries: ZipEntry[] = [{ name: "diagnostics.json", data: JSON.stringify(manifest, null, 2) + "\n" }];
  const currentLog = await optionalFile(options.logFilePath);
  const previousLog = await optionalFile(options.previousLogFilePath);
  if (currentLog && options.logFilePath) entries.push({ name: `logs/${basename(options.logFilePath)}`, data: currentLog });
  if (previousLog && options.previousLogFilePath) entries.push({ name: `logs/${basename(options.previousLogFilePath)}`, data: previousLog });
  return createStoredZip(entries);
}
