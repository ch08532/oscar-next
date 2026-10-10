import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDiagnosticBundle } from "../desktop/diagnostics.js";
import { importSourceToDatabase, previewImportSource } from "../importers/import-service.js";
import { OscarDatabase } from "../storage/database.js";
import { OscarQueries, therapyDateForTimestamp } from "../storage/queries.js";
import { createDemoResMedCard } from "./demo-card.js";

export interface DemoSmokeResult {
  rootPath: string;
  databasePath: string;
  machineId: number;
  profileId: number;
  latestTherapyDate: string;
  usageHours: number;
  ahi: number;
  overviewDays: number;
  statisticsUsedDays: number;
  chartSeries: number;
  diagnosticBytes: number;
}

export async function runDemoSmokeWorkflow(rawWorkPath?: string, keep = false): Promise<DemoSmokeResult> {
  const rootPath = rawWorkPath ? resolve(rawWorkPath) : await mkdtemp(join(tmpdir(), "oscar-next-2-smoke-"));
  await mkdir(rootPath, { recursive: true });
  const cardPath = join(rootPath, "demo-card");
  const databasePath = join(rootPath, "oscar-next-demo.sqlite");
  try {
    const card = await createDemoResMedCard(cardPath, { days: 14, overwrite: true });
    const preview = await previewImportSource(cardPath);
    if (!preview || preview.importerName !== "ResMed") throw new Error("Smoke test failed: demo card was not detected as ResMed");

    const db = new OscarDatabase(databasePath);
    const profile = db.createProfile("Demo", "America/Toronto");
    db.setActiveProfile(profile.id);
    db.close();

    const imported = await importSourceToDatabase(cardPath, databasePath, undefined, { profileId: profile.id, deviceTimeZone: profile.timeZone });
    if (imported.totalStoredSessions < 10) throw new Error(`Smoke test failed: expected >=10 sessions, got ${imported.totalStoredSessions}`);
    if (imported.lastSessionTime === undefined) throw new Error("Smoke test failed: no latest session");

    const latestTherapyDate = therapyDateForTimestamp(imported.lastSessionTime);
    const queries = new OscarQueries(databasePath);
    const daily = queries.getDaily(imported.machineId, latestTherapyDate);
    const overview = queries.getOverview(imported.machineId, card.firstTherapyDate, card.lastTherapyDate);
    const statistics = queries.getStatistics(imported.machineId, card.firstTherapyDate, card.lastTherapyDate);
    const charts = queries.getChartSeries(imported.machineId, latestTherapyDate, daily.availableChannels, { maxPointsPerSeries: 2_000 });
    queries.close();

    if (daily.usageHours <= 0) throw new Error("Smoke test failed: Daily usage is zero");
    if (overview.length !== card.days) throw new Error(`Smoke test failed: expected ${card.days} Overview days, got ${overview.length}`);
    if (statistics.usedDays < card.days - 1) throw new Error("Smoke test failed: Statistics lost demo therapy days");
    if (charts.series.length === 0) throw new Error("Smoke test failed: no chart series returned");

    const diagnostic = await createDiagnosticBundle({ appVersion: "2.1.0-smoke", nodeVersion: process.version, databasePath });
    if (diagnostic.length < 100) throw new Error("Smoke test failed: diagnostic bundle is unexpectedly small");

    return {
      rootPath, databasePath, machineId: imported.machineId, profileId: profile.id, latestTherapyDate,
      usageHours: daily.usageHours, ahi: daily.ahi, overviewDays: overview.length,
      statisticsUsedDays: statistics.usedDays, chartSeries: charts.series.length, diagnosticBytes: diagnostic.length,
    };
  } finally {
    if (!keep && !rawWorkPath) await rm(rootPath, { recursive: true, force: true });
  }
}
