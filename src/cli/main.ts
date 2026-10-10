import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { CpapChannel } from "../core/cpap-channels.js";
import { CpapSetting } from "../core/cpap-settings.js";
import { CPAPMode } from "../core/types.js";
import { readEdfFile } from "../importers/edf/edf-parser.js";
import { ImporterRegistry } from "../importers/registry.js";
import { discoverResMedEdfFiles } from "../importers/resmed/resmed-files.js";
import { ResMedLoader } from "../importers/resmed/resmed-loader.js";
import { OscarDatabase } from "../storage/database.js";
import { OscarQueries } from "../storage/queries.js";
import { statisticsToCsv, statisticsToHtml } from "../reports/statistics-report.js";
import { importSourceToDatabase } from "../importers/import-service.js";
import { formatWallClock } from "../core/device-time.js";
import { createDemoResMedCard } from "../demo/demo-card.js";
import { runDemoSmokeWorkflow } from "../demo/demo-smoke.js";

function usage(): void {
  console.log(`OSCAR Next 2.3\n\nUsage:\n  oscar-next inspect <sd-card-path>\n  oscar-next import <sd-card-path>\n  oscar-next store <sd-card-path> <database-file>\n  oscar-next demo-card <output-folder>\n  oscar-next demo-smoke [work-folder]\n  oscar-next db-list <database-file>\n  oscar-next profile-list <database-file>\n  oscar-next profile-create <database-file> <name> <IANA-timezone>\n  oscar-next machine-timezone <database-file> <machine-id> <IANA-timezone|profile>\n  oscar-next db-daily <database-file> <machine-id> <YYYY-MM-DD>\n  oscar-next db-overview <database-file> <machine-id> <start-date> <end-date>\n  oscar-next db-statistics <database-file> <machine-id> <start-date> <end-date>\n  oscar-next report-csv <database-file> <machine-id> <start-date> <end-date> <output.csv>\n  oscar-next report-html <database-file> <machine-id> <start-date> <end-date> <output.html>\n  oscar-next edf-info <edf-file>\n\nCommands:\n  inspect           Detect supported CPAP media, device identity, and EDF inventory\n  import            Parse detailed ResMed files into sessions and print a summary\n  store             Import CPAP media and persist it to SQLite\n  demo-card         Generate a synthetic AirSense-style SD card for UI testing\n  demo-smoke        Exercise profile -> import -> Daily/Overview/Statistics/charts/diagnostics\n  db-list           List stored machines, profiles, and device timezones\n  profile-list      List profiles and the active profile\n  profile-create    Create and activate a profile\n  machine-timezone  Override a CPAP device timezone, or use 'profile' to inherit\n  db-daily          Query one noon-to-noon therapy day\n  db-overview       Query a therapy-day range for Overview\n  db-statistics     Query aggregate statistics and settings history\n  report-csv        Export statistics and daily data as CSV\n  report-html       Export a printable statistics report as HTML\n  edf-info          Parse an EDF/EDF+ file and show its header/signals`);
}

function formatLocalStart(start: { year: number; month: number; day: number; hour: number; minute: number; second: number }): string {
  const p = (value: number) => String(value).padStart(2, "0");
  return `${start.year}-${p(start.month)}-${p(start.day)} ${p(start.hour)}:${p(start.minute)}:${p(start.second)}`;
}

function formatEpoch(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(".000Z", "Z");
}

function modeName(value: unknown): string {
  if (typeof value !== "number") return "(unknown)";
  return CPAPMode[value] ?? String(value);
}

function settingNumber(session: { settings: Map<number, unknown> }, setting: CpapSetting): number | undefined {
  const value = session.settings.get(setting);
  return typeof value === "number" ? value : undefined;
}

async function edfInfo(rawPath: string): Promise<void> {
  const path = resolve(rawPath);
  const edf = await readEdfFile(path, { includeData: false, strict: false });
  console.log(`EDF:      ${path}`);
  console.log(`Start:    ${formatLocalStart(edf.header.start)}`);
  console.log(`Mode:     ${edf.header.continuity}`);
  console.log(`Records:  ${edf.parsedDataRecordCount}`);
  console.log(`Duration: ${edf.header.dataRecordDurationSeconds}s / record`);
  console.log(`Signals:  ${edf.signals.length}`);
  for (const signal of edf.signals) {
    const d = signal.definition;
    console.log(`  ${d.label || "(unlabelled)"}: ${d.sampleRateHz.toFixed(3)} Hz, ${d.physicalDimension || "(unitless)"}, ${d.samplesPerRecord} samples/record${d.isAnnotation ? " [annotations]" : ""}`);
  }
  for (const warning of edf.warnings) console.log(`Warning: ${warning}`);
}

function makeRegistry(): ImporterRegistry {
  const registry = new ImporterRegistry();
  registry.register(new ResMedLoader());
  return registry;
}

async function inspect(rawPath: string): Promise<void> {
  const path = resolve(rawPath);
  const registry = makeRegistry();
  const importer = await registry.detect(path);
  if (!importer) {
    console.log(`No supported CPAP media detected at: ${path}`);
    process.exitCode = 1;
    return;
  }

  const info = await importer.peekInfo(path);
  console.log(`Detected: ${importer.name}`);
  console.log(`Path:     ${path}`);
  if (info) {
    console.log(`Brand:    ${info.brand || "(unknown)"}`);
    console.log(`Model:    ${info.model || "(unknown)"}`);
    console.log(`Model #:  ${info.modelNumber || "(unknown)"}`);
    console.log(`Serial:   ${info.serial || "(unknown)"}`);
  }

  if (importer.name === "ResMed") {
    const files = await discoverResMedEdfFiles(path);
    const counts = new Map<string, number>();
    for (const file of files) counts.set(file.type, (counts.get(file.type) ?? 0) + 1);
    console.log(`EDF files: ${files.length}`);
    for (const type of ["STR", "CSL", "EVE", "BRP", "PLD", "SAD", "SA2", "AEV"]) {
      const count = counts.get(type) ?? 0;
      if (count) console.log(`  ${type}: ${count}`);
    }
  }
}

async function importCard(rawPath: string): Promise<void> {
  const path = resolve(rawPath);
  const registry = makeRegistry();
  const importer = await registry.detect(path);
  if (!importer) {
    console.log(`No supported CPAP media detected at: ${path}`);
    process.exitCode = 1;
    return;
  }

  const result = await importer.open(path);
  console.log(`${result.machine.info.brand} ${result.machine.info.model}`.trim());
  console.log(`Sessions imported: ${result.sessionsImported}`);
  const sessions = [...result.machine.sessions.values()].sort((a, b) => a.first - b.first);
  for (const session of sessions) {
    const hours = session.hours();
    const ahiCount = session.count(CpapChannel.ObstructiveApnea) + session.count(CpapChannel.Hypopnea) +
      session.count(CpapChannel.UnclassifiedApnea) + session.count(CpapChannel.ClearAirway);
    const ahi = hours > 0 ? ahiCount / hours : 0;
    console.log(`\n${formatEpoch(session.first)} -> ${formatEpoch(session.last)} (${hours.toFixed(2)} h)`);
    console.log(`  AHI: ${ahi.toFixed(2)}  OA:${session.count(CpapChannel.ObstructiveApnea)} CA:${session.count(CpapChannel.ClearAirway)} H:${session.count(CpapChannel.Hypopnea)} UA:${session.count(CpapChannel.UnclassifiedApnea)} RERA:${session.count(CpapChannel.RERA)}`);
    const mode = session.settings.get(CpapSetting.Mode);
    if (mode !== undefined) {
      const minPressure = settingNumber(session, CpapSetting.PressureMin);
      const maxPressure = settingNumber(session, CpapSetting.PressureMax);
      const setPressure = settingNumber(session, CpapSetting.SetPressure);
      const pressure = setPressure !== undefined
        ? `${setPressure.toFixed(1)} cmH2O`
        : minPressure !== undefined && maxPressure !== undefined
          ? `${minPressure.toFixed(1)}-${maxPressure.toFixed(1)} cmH2O`
          : "(not present)";
      console.log(`  Mode: ${modeName(mode)}  Pressure: ${pressure}`);
      const eprMode = settingNumber(session, CpapSetting.EPRMode);
      const eprLevel = settingNumber(session, CpapSetting.EPRLevel);
      const rampEnabled = session.settings.get(CpapSetting.RampEnabled);
      if (eprMode !== undefined || rampEnabled !== undefined) {
        console.log(`  EPR: ${eprMode ?? "?"}${eprLevel !== undefined ? ` level ${eprLevel}` : ""}  Ramp: ${rampEnabled === true ? "on" : rampEnabled === false ? "off" : "?"}`);
      }
    }
    console.log(`  Channels: ${session.availableChannels().length}${session.summaryOnly ? " [summary-only]" : ""}`);
  }
  for (const warning of result.warnings) console.log(`Warning: ${warning}`);
}



async function generateDemoCard(rawOutputPath: string): Promise<void> {
  const result = await createDemoResMedCard(rawOutputPath, { days: 14, overwrite: true });
  console.log(`Created OSCAR Next demo ResMed card: ${result.rootPath}`);
  console.log(`Therapy days: ${result.firstTherapyDate} -> ${result.lastTherapyDate} (${result.days})`);
  console.log(`Model:        ${result.model}`);
  console.log(`Serial:       ${result.serial}`);
}

async function demoSmoke(rawWorkPath?: string): Promise<void> {
  const result = await runDemoSmokeWorkflow(rawWorkPath, Boolean(rawWorkPath));
  console.log("OSCAR Next 2.3 smoke workflow: PASS");
  console.log(`Database:       ${result.databasePath}`);
  console.log(`Machine:        ${result.machineId}`);
  console.log(`Therapy date:   ${result.latestTherapyDate}`);
  console.log(`Daily usage:    ${result.usageHours.toFixed(2)} h`);
  console.log(`Daily AHI:      ${result.ahi.toFixed(2)}`);
  console.log(`Overview days:  ${result.overviewDays}`);
  console.log(`Statistics days:${String(result.statisticsUsedDays).padStart(3)}`);
  console.log(`Chart series:   ${result.chartSeries}`);
  console.log(`Diagnostic ZIP: ${result.diagnosticBytes} bytes`);
  if (!rawWorkPath) console.log("Temporary smoke-test files were removed.");
}

async function storeCard(rawPath: string, rawDatabasePath: string): Promise<void> {
  const result = await importSourceToDatabase(rawPath, rawDatabasePath);
  console.log(`Stored machine ${result.machineId}: ${result.brand} ${result.model}`.trim());
  console.log(`Sessions read: ${result.sessionsImported} (${result.newSessions} new, ${result.updatedSessions} updated)`);
  console.log(`Stored total:  ${result.totalStoredSessions}`);
  console.log(`Database: ${result.databasePath}`);
  for (const warning of result.warnings) console.log(`Warning: ${warning}`);
}

async function listDatabase(rawDatabasePath: string): Promise<void> {
  const databasePath = resolve(rawDatabasePath);
  const db = new OscarDatabase(databasePath);
  try {
    const machines = db.listMachines();
    console.log(`Database: ${databasePath}`);
    console.log(`Schema:   ${db.schemaVersion}`);
    console.log(`Machines: ${machines.length}`);
    for (const machine of machines) {
      console.log(`\n${machine.id}  ${machine.brand} ${machine.model}`.trimEnd());
      console.log(`  Serial:   ${machine.serial || "(unknown)"}`);
      console.log(`  Profile:  ${machine.profileId ?? "(unassigned)"}`);
      console.log(`  Timezone: ${machine.deviceTimeZone ?? "(unknown)"}`);
      console.log(`  Sessions: ${machine.sessionCount}`);
      if (machine.firstSessionTime !== undefined) console.log(`  First:    ${formatEpoch(machine.firstSessionTime)}`);
      if (machine.lastSessionTime !== undefined) console.log(`  Last:     ${formatEpoch(machine.lastSessionTime)}`);
    }
  } finally {
    db.close();
  }
}


async function listProfiles(rawDatabasePath: string): Promise<void> {
  const db = new OscarDatabase(resolve(rawDatabasePath));
  try {
    const active = db.getActiveProfile();
    for (const profile of db.listProfiles()) console.log(`${profile.id === active?.id ? "*" : " "} ${profile.id}  ${profile.name}  ${profile.timeZone}`);
  } finally { db.close(); }
}

async function createProfile(rawDatabasePath: string, name: string, timeZone: string): Promise<void> {
  const db = new OscarDatabase(resolve(rawDatabasePath));
  try {
    const profile = db.createProfile(name, timeZone);
    db.setActiveProfile(profile.id);
    console.log(`Created profile ${profile.id}: ${profile.name} (${profile.timeZone})`);
  } finally { db.close(); }
}

async function setMachineTimeZone(rawDatabasePath: string, rawMachineId: string, timeZone: string): Promise<void> {
  const machineId = Number(rawMachineId);
  if (!Number.isInteger(machineId)) throw new Error(`Invalid machine id: ${rawMachineId}`);
  const db = new OscarDatabase(resolve(rawDatabasePath));
  try {
    const settings = db.setMachineTimeZone(machineId, timeZone === "profile" ? undefined : timeZone);
    console.log(`Machine ${machineId}: ${settings.deviceTimeZone} (${settings.source})`);
  } finally { db.close(); }
}

async function queryDaily(rawDatabasePath: string, rawMachineId: string, date: string): Promise<void> {
  const machineId = Number(rawMachineId);
  if (!Number.isInteger(machineId)) throw new Error(`Invalid machine id: ${rawMachineId}`);
  const databasePath = resolve(rawDatabasePath);
  const queries = new OscarQueries(databasePath);
  try {
    const daily = queries.getDaily(machineId, date);
    console.log(`Therapy day: ${daily.date} (12:00 -> next day 12:00)`);
    console.log(`Device time: ${daily.deviceTimeZone}`);
    console.log(`Usage:       ${daily.usageHours.toFixed(2)} h`);
    console.log(`Sessions:    ${daily.sessions.length}`);
    console.log(`AHI / RDI:   ${daily.ahi.toFixed(2)} / ${daily.rdi.toFixed(2)}`);
    console.log(`Events:      OA ${daily.eventCounts.obstructive}, CA ${daily.eventCounts.clearAirway}, H ${daily.eventCounts.hypopnea}, UA ${daily.eventCounts.unclassified}, RERA ${daily.eventCounts.rera}`);
    if (daily.pressure) console.log(`Pressure:    avg ${daily.pressure.average.toFixed(2)}, 95% ${daily.pressure.percentile95.toFixed(2)}, max ${daily.pressure.max.toFixed(2)} ${"cmH2O"}`);
    if (daily.leak) console.log(`Leak:        avg ${daily.leak.average.toFixed(2)}, 95% ${daily.leak.percentile95.toFixed(2)}, max ${daily.leak.max.toFixed(2)} L/min`);
    for (const session of daily.sessions) console.log(`  ${formatWallClock(session.firstMs)} -> ${formatWallClock(session.lastMs)}  ${session.usageHours.toFixed(2)} h${session.summaryOnly ? " [summary-only]" : ""}`);
  } finally {
    queries.close();
  }
}

async function queryOverview(rawDatabasePath: string, rawMachineId: string, startDate: string, endDate: string): Promise<void> {
  const machineId = Number(rawMachineId);
  if (!Number.isInteger(machineId)) throw new Error(`Invalid machine id: ${rawMachineId}`);
  const databasePath = resolve(rawDatabasePath);
  const queries = new OscarQueries(databasePath);
  try {
    const days = queries.getOverview(machineId, startDate, endDate);
    console.log(`Date        Hours    AHI    RDI   OA  CA   H  RERA   P95   L95`);
    for (const day of days) {
      const p95 = day.pressure95 === undefined ? "-" : day.pressure95.toFixed(1);
      const l95 = day.leak95 === undefined ? "-" : day.leak95.toFixed(1);
      console.log(`${day.date}  ${day.usageHours.toFixed(2).padStart(5)}  ${day.ahi.toFixed(2).padStart(5)}  ${day.rdi.toFixed(2).padStart(5)}  ${String(day.obstructive).padStart(2)}  ${String(day.clearAirway).padStart(2)}  ${String(day.hypopnea).padStart(2)}  ${String(day.rera).padStart(4)}  ${p95.padStart(5)}  ${l95.padStart(5)}`);
    }
  } finally {
    queries.close();
  }
}

async function queryStatistics(rawDatabasePath: string, rawMachineId: string, startDate: string, endDate: string): Promise<void> {
  const machineId = Number(rawMachineId);
  if (!Number.isInteger(machineId)) throw new Error(`Invalid machine id: ${rawMachineId}`);
  const databasePath = resolve(rawDatabasePath);
  const queries = new OscarQueries(databasePath);
  try {
    const stats = queries.getStatistics(machineId, startDate, endDate);
    console.log(`Range:        ${stats.startDate} -> ${stats.endDate}`);
    console.log(`Days used:    ${stats.usedDays}/${stats.totalDays} (${stats.compliantDays} >= 4 h)`);
    console.log(`Usage:        ${stats.totalUsageHours.toFixed(2)} h total, ${stats.averageUsageHours.toFixed(2)} h avg, ${stats.medianUsageHours.toFixed(2)} h median`);
    console.log(`AHI / RDI:    ${stats.ahi.toFixed(2)} / ${stats.rdi.toFixed(2)}`);
    console.log(`Indices:      OA ${stats.eventIndices.obstructive.toFixed(2)}, CA ${stats.eventIndices.clearAirway.toFixed(2)}, H ${stats.eventIndices.hypopnea.toFixed(2)}, UA ${stats.eventIndices.unclassified.toFixed(2)}, RERA ${stats.eventIndices.rera.toFixed(2)}`);
    if (stats.pressure) console.log(`Pressure:     median ${stats.pressure.percentile50.toFixed(1)}, 95% ${stats.pressure.percentile95.toFixed(1)}, max ${stats.pressure.max.toFixed(1)} cmH2O`);
    if (stats.leak) console.log(`Leak:         median ${stats.leak.percentile50.toFixed(1)}, 95% ${stats.leak.percentile95.toFixed(1)}, max ${stats.leak.max.toFixed(1)} L/min`);
    console.log(`Settings:     ${stats.settingsHistory.length} period(s)`);
  } finally { queries.close(); }
}

async function exportStatisticsReport(rawDatabasePath: string, rawMachineId: string, startDate: string, endDate: string, rawOutputPath: string, format: "csv" | "html"): Promise<void> {
  const machineId = Number(rawMachineId);
  if (!Number.isInteger(machineId)) throw new Error(`Invalid machine id: ${rawMachineId}`);
  const databasePath = resolve(rawDatabasePath);
  const outputPath = resolve(rawOutputPath);
  const db = new OscarDatabase(databasePath);
  const machine = db.listMachines().find((item) => item.id === machineId);
  db.close();
  if (!machine) throw new Error(`Machine ${machineId} not found`);
  const queries = new OscarQueries(databasePath);
  try {
    const stats = queries.getStatistics(machineId, startDate, endDate);
    const content = format === "csv" ? statisticsToCsv(machine, stats) : statisticsToHtml(machine, stats);
    await writeFile(outputPath, content);
    console.log(`Wrote ${format.toUpperCase()}: ${outputPath}`);
  } finally { queries.close(); }
}

async function main(): Promise<void> {
  const [, , command, rawPath, rawSecondPath, rawThirdPath, rawFourthPath, rawFifthPath] = process.argv;
  if (!command || command === "--help" || command === "-h") { usage(); return; }
  if (command === "demo-smoke") { await demoSmoke(rawPath); return; }
  if (!rawPath) { usage(); process.exitCode = 2; return; }
  if (command === "demo-card") { await generateDemoCard(rawPath); return; }
  if (command === "inspect") { await inspect(rawPath); return; }
  if (command === "import") { await importCard(rawPath); return; }
  if (command === "store") {
    if (!rawSecondPath) { usage(); process.exitCode = 2; return; }
    await storeCard(rawPath, rawSecondPath);
    return;
  }
  if (command === "db-list") { await listDatabase(rawPath); return; }
  if (command === "profile-list") { await listProfiles(rawPath); return; }
  if (command === "profile-create") {
    if (!rawSecondPath || !rawThirdPath) { usage(); process.exitCode = 2; return; }
    await createProfile(rawPath, rawSecondPath, rawThirdPath);
    return;
  }
  if (command === "machine-timezone") {
    if (!rawSecondPath || !rawThirdPath) { usage(); process.exitCode = 2; return; }
    await setMachineTimeZone(rawPath, rawSecondPath, rawThirdPath);
    return;
  }
  if (command === "db-daily") {
    if (!rawSecondPath || !rawThirdPath) { usage(); process.exitCode = 2; return; }
    await queryDaily(rawPath, rawSecondPath, rawThirdPath);
    return;
  }
  if (command === "db-overview") {
    if (!rawSecondPath || !rawThirdPath || !rawFourthPath) { usage(); process.exitCode = 2; return; }
    await queryOverview(rawPath, rawSecondPath, rawThirdPath, rawFourthPath);
    return;
  }
  if (command === "db-statistics") {
    if (!rawSecondPath || !rawThirdPath || !rawFourthPath) { usage(); process.exitCode = 2; return; }
    await queryStatistics(rawPath, rawSecondPath, rawThirdPath, rawFourthPath);
    return;
  }
  if (command === "report-csv" || command === "report-html") {
    if (!rawSecondPath || !rawThirdPath || !rawFourthPath || !rawFifthPath) { usage(); process.exitCode = 2; return; }
    await exportStatisticsReport(rawPath, rawSecondPath, rawThirdPath, rawFourthPath, rawFifthPath, command === "report-csv" ? "csv" : "html");
    return;
  }
  if (command === "edf-info") { await edfInfo(rawPath); return; }
  usage();
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
