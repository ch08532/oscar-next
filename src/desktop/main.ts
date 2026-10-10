import { access, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { statisticsToCsv, statisticsToHtml } from "../reports/statistics-report.js";
import { OscarDatabase, type StoredMachineSummary } from "../storage/database.js";
import { systemTimeZone } from "../core/device-time.js";
import { OscarQueries, type ChartQueryOptions } from "../storage/queries.js";
import { importSourceToDatabase, previewImportSource } from "../importers/import-service.js";
import { createSystemVolumeProvider, RemovableMediaWatcher, type DetectedMedia } from "./removable-media.js";
import { StructuredLogger } from "./logger.js";
import { createDiagnosticBundle } from "./diagnostics.js";
import { createDemoResMedCard } from "../demo/demo-card.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | undefined;
let databasePath: string | undefined;
let mediaWatcher: RemovableMediaWatcher | undefined;
let pendingDetectedMedia: DetectedMedia | undefined;
let logger: StructuredLogger | undefined;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();
else app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const window = mainWindow as any;
  if (window.isMinimized?.()) window.restore?.();
  window.show?.();
  window.focus?.();
});

function defaultDatabasePath(): string {
  return join(app.getPath("userData"), "oscar-next.sqlite");
}

async function useDefaultDatabaseIfPresent(): Promise<void> {
  const path = defaultDatabasePath();
  try {
    await access(path);
    const db = new OscarDatabase(path);
    db.close();
    databasePath = path;
  } catch {
    // First run: the setup flow will create the database when the user confirms.
  }
}

function setupState() {
  if (!databasePath) return { databasePath: undefined, systemTimeZone: systemTimeZone(), profiles: [], activeProfile: undefined, needsSetup: true };
  const db = new OscarDatabase(databasePath);
  try {
    const profiles = db.listProfiles();
    const activeProfile = db.getActiveProfile();
    return { databasePath, systemTimeZone: systemTimeZone(), profiles, activeProfile, needsSetup: profiles.length === 0 };
  } finally { db.close(); }
}

function requireDatabase(): string {
  if (!databasePath) throw new Error("No OSCAR Next database is open");
  return databasePath;
}

function machineSummary(machineId: number): StoredMachineSummary {
  const db = new OscarDatabase(requireDatabase());
  try {
    const machine = db.listMachines().find((item) => item.id === machineId);
    if (!machine) throw new Error(`Machine ${machineId} not found`);
    return machine;
  } finally { db.close(); }
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "machine";
}


async function ensureDatabaseForImport(): Promise<string | undefined> {
  if (databasePath) return databasePath;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Create OSCAR Next database",
    defaultPath: join(app.getPath("documents"), "oscar-next.sqlite"),
    filters: [{ name: "SQLite database", extensions: ["sqlite"] }],
  });
  if (result.canceled || !result.filePath) return undefined;
  const db = new OscarDatabase(result.filePath);
  db.close();
  databasePath = result.filePath;
  return result.filePath;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: join(moduleDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devServer = process.env.OSCAR_RENDERER_URL;
  if (devServer) await mainWindow.loadURL(devServer);
  else if (app.isPackaged) await mainWindow.loadFile(join(app.getAppPath(), "dist/index.html"));
  else await mainWindow.loadFile(join(moduleDir, "../../../apps/desktop/dist/index.html"));
  logger?.info("window.ready", { packaged: Boolean(app.isPackaged) });

  mediaWatcher?.stop();
  mediaWatcher = new RemovableMediaWatcher({
    provider: createSystemVolumeProvider(),
    probe: previewImportSource,
    onDetected: (detected) => {
      pendingDetectedMedia = detected;
      logger?.info("media.detected", { importerName: detected.preview.importerName, brand: detected.preview.machine?.brand, model: detected.preview.machine?.model, sourcePath: detected.volume.rootPath });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("media:detected", detected);
    },
    probeExistingOnStart: true,
  });
  mediaWatcher.start();

  mainWindow.on("closed", () => {
    mediaWatcher?.stop();
    mediaWatcher = undefined;
    mainWindow = undefined;
  });
}

ipcMain.handle("app:getInfo", () => ({ version: app.getVersion(), packaged: Boolean(app.isPackaged), platform: process.platform, arch: process.arch }));

ipcMain.handle("setup:getState", () => setupState());

ipcMain.handle("setup:complete", (_event: unknown, name: string, timeZone: string) => {
  if (!databasePath) databasePath = defaultDatabasePath();
  const db = new OscarDatabase(databasePath);
  try {
    const existing = db.listProfiles().find((profile) => profile.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
    const profile = existing ?? db.createProfile(name, timeZone);
    if (existing) db.updateProfile(existing.id, { timeZone });
    db.setActiveProfile(profile.id);
    return setupState();
  } finally { db.close(); }
});

ipcMain.handle("profiles:list", () => {
  const db = new OscarDatabase(requireDatabase());
  try { return { profiles: db.listProfiles(), activeProfile: db.getActiveProfile() }; }
  finally { db.close(); }
});

ipcMain.handle("profiles:create", (_event: unknown, name: string, timeZone: string) => {
  const db = new OscarDatabase(requireDatabase());
  try { const profile = db.createProfile(name, timeZone); db.setActiveProfile(profile.id); return profile; }
  finally { db.close(); }
});

ipcMain.handle("profiles:update", (_event: unknown, id: number, updates: { name?: string; timeZone?: string }) => {
  const db = new OscarDatabase(requireDatabase());
  try { return db.updateProfile(id, updates); }
  finally { db.close(); }
});

ipcMain.handle("profiles:setActive", (_event: unknown, id: number) => {
  const db = new OscarDatabase(requireDatabase());
  try { db.setActiveProfile(id); return db.getActiveProfile(); }
  finally { db.close(); }
});

ipcMain.handle("machine:getTimeSettings", (_event: unknown, machineId: number) => {
  const db = new OscarDatabase(requireDatabase());
  try { return db.getMachineTimeSettings(machineId); }
  finally { db.close(); }
});

ipcMain.handle("machine:setTimeZone", (_event: unknown, machineId: number, timeZone?: string) => {
  const db = new OscarDatabase(requireDatabase());
  try { return db.setMachineTimeZone(machineId, timeZone); }
  finally { db.close(); }
});

ipcMain.handle("database:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open OSCAR Next database",
    properties: ["openFile"],
    filters: [
      { name: "SQLite database", extensions: ["sqlite", "db", "sqlite3"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return undefined;
  databasePath = selected;
  logger?.info("database.opened", { databasePath: selected });
  return selected;
});

ipcMain.handle("database:listMachines", (_event: unknown, profileId?: number) => {
  const db = new OscarDatabase(requireDatabase());
  try { return db.listMachines(profileId); }
  finally { db.close(); }
});

ipcMain.handle("import:chooseSource", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose CPAP SD card or backup folder",
    properties: ["openDirectory"],
  });
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return undefined;
  const preview = await previewImportSource(selected);
  if (!preview) throw new Error("No supported CPAP media was detected in that folder.");
  return preview;
});

ipcMain.handle("import:run", async (event: any, sourcePath: string, profileId?: number) => {
  const targetDatabase = await ensureDatabaseForImport();
  if (!targetDatabase) return undefined;
  const db = new OscarDatabase(targetDatabase);
  let profile = profileId !== undefined ? db.getProfile(profileId) : db.getActiveProfile();
  if (!profile) profile = db.createProfile("Default", systemTimeZone());
  db.setActiveProfile(profile.id);
  db.close();
  logger?.info("import.started", { sourcePath, profileId: profile.id });
  try {
    const result = await importSourceToDatabase(sourcePath, targetDatabase, (progress) => {
      event.sender.send("import:progress", progress);
    }, { profileId: profile.id, deviceTimeZone: profile.timeZone });
    logger?.info("import.completed", { machineBrand: result.brand, machineModel: result.model, sessionsImported: result.sessionsImported, newSessions: result.newSessions, updatedSessions: result.updatedSessions });
    return result;
  } catch (error) {
    logger?.error("import.failed", { error, sourcePath });
    throw error;
  }
});

ipcMain.handle("demo:load", async (event: any) => {
  if (!databasePath) databasePath = defaultDatabasePath();
  const db = new OscarDatabase(databasePath);
  let profile = db.getActiveProfile();
  if (!profile) profile = db.createProfile("Demo Profile", systemTimeZone());
  db.setActiveProfile(profile.id);
  db.close();

  const demoPath = join(app.getPath("userData"), "demo-resmed-card");
  const card = await createDemoResMedCard(demoPath, { days: 14, overwrite: true });
  logger?.info("demo.started", { profileId: profile.id, days: card.days });
  const result = await importSourceToDatabase(demoPath, databasePath, (progress) => {
    event.sender.send("import:progress", progress);
  }, { profileId: profile.id, deviceTimeZone: profile.timeZone });
  logger?.info("demo.completed", { machineId: result.machineId, sessionsImported: result.sessionsImported });
  return result;
});

ipcMain.handle("media:takePending", () => {
  const detected = pendingDetectedMedia;
  pendingDetectedMedia = undefined;
  return detected;
});

ipcMain.handle("daily:get", (_event: unknown, machineId: number, date: string) => {
  const queries = new OscarQueries(requireDatabase());
  try { return queries.getDaily(machineId, date); }
  finally { queries.close(); }
});

ipcMain.handle("daily:setSessionEnabled", (_event: unknown, machineId: number, sessionId: number, enabled: boolean) => {
  const db = new OscarDatabase(requireDatabase());
  try { db.setSessionEnabled(machineId, sessionId, enabled); }
  finally { db.close(); }
});

ipcMain.handle("graphs:getPreferences", (_event: unknown, machineId: number) => {
  const db = new OscarDatabase(requireDatabase());
  try { return db.getGraphPreferences(machineId); }
  finally { db.close(); }
});

ipcMain.handle("graphs:setPinned", (_event: unknown, machineId: number, key: string, pinned: boolean) => {
  const db = new OscarDatabase(requireDatabase());
  try { db.setGraphPinned(machineId, key, pinned); }
  finally { db.close(); }
});


ipcMain.handle("graphs:setHeight", (_event: unknown, machineId: number, key: string, height: number) => {
  const db = new OscarDatabase(requireDatabase());
  try { db.setGraphHeight(machineId, key, height); }
  finally { db.close(); }
});

ipcMain.handle("graphs:setOrder", (_event: unknown, machineId: number, keys: string[]) => {
  const db = new OscarDatabase(requireDatabase());
  try { db.setGraphOrder(machineId, keys); }
  finally { db.close(); }
});

ipcMain.handle("graphs:listBookmarks", (_event: unknown, machineId: number, date: string) => {
  const db = new OscarDatabase(requireDatabase());
  try { return db.listGraphBookmarks(machineId, date); }
  finally { db.close(); }
});

ipcMain.handle("graphs:createBookmark", (_event: unknown, machineId: number, date: string, name: string, startMs: number, endMs: number) => {
  const db = new OscarDatabase(requireDatabase());
  try { return db.createGraphBookmark(machineId, date, name, startMs, endMs); }
  finally { db.close(); }
});

ipcMain.handle("graphs:deleteBookmark", (_event: unknown, machineId: number, bookmarkId: number) => {
  const db = new OscarDatabase(requireDatabase());
  try { db.deleteGraphBookmark(machineId, bookmarkId); }
  finally { db.close(); }
});

ipcMain.handle("overview:get", (_event: unknown, machineId: number, startDate: string, endDate: string) => {
  const queries = new OscarQueries(requireDatabase());
  try { return queries.getOverview(machineId, startDate, endDate); }
  finally { queries.close(); }
});

ipcMain.handle("chart:get", (_event: unknown, machineId: number, date: string, channelIds: number[], options?: ChartQueryOptions) => {
  const queries = new OscarQueries(requireDatabase());
  try { return queries.getChartSeries(machineId, date, channelIds, options); }
  finally { queries.close(); }
});

ipcMain.handle("statistics:get", (_event: unknown, machineId: number, startDate: string, endDate: string) => {
  const queries = new OscarQueries(requireDatabase());
  try { return queries.getStatistics(machineId, startDate, endDate); }
  finally { queries.close(); }
});

ipcMain.handle("statistics:exportCsv", async (_event: unknown, machineId: number, startDate: string, endDate: string) => {
  const machine = machineSummary(machineId);
  const queries = new OscarQueries(requireDatabase());
  let csv: string;
  try { csv = statisticsToCsv(machine, queries.getStatistics(machineId, startDate, endDate)); }
  finally { queries.close(); }

  const suggested = `oscar-next-${safeFilePart(machine.brand || machine.model)}-${startDate}-to-${endDate}.csv`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export OSCAR Next statistics as CSV",
    defaultPath: suggested,
    filters: [{ name: "CSV file", extensions: ["csv"] }],
  });
  if (result.canceled || !result.filePath) return undefined;
  await writeFile(result.filePath, csv);
  return result.filePath;
});

ipcMain.handle("statistics:exportPdf", async (_event: unknown, machineId: number, startDate: string, endDate: string) => {
  const machine = machineSummary(machineId);
  const queries = new OscarQueries(requireDatabase());
  let html: string;
  try { html = statisticsToHtml(machine, queries.getStatistics(machineId, startDate, endDate)); }
  finally { queries.close(); }

  const suggested = `oscar-next-${safeFilePart(machine.brand || machine.model)}-${startDate}-to-${endDate}.pdf`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export OSCAR Next statistics as PDF",
    defaultPath: suggested,
    filters: [{ name: "PDF file", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) return undefined;

  const reportWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await reportWindow.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
    await writeFile(result.filePath, pdf);
  } finally { reportWindow.destroy(); }
  return result.filePath;
});

ipcMain.handle("diagnostics:createBundle", async () => {
  await logger?.flush();
  const suggested = `OSCAR-Next-Diagnostics-${new Date().toISOString().slice(0, 10)}.zip`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Create OSCAR Next diagnostic bundle",
    defaultPath: join(app.getPath("documents"), suggested),
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) return undefined;
  const archive = await createDiagnosticBundle({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.version,
    logFilePath: logger?.filePath,
    previousLogFilePath: logger?.previousFilePath,
    databasePath,
  });
  await writeFile(result.filePath, archive);
  logger?.info("diagnostics.created", { filePath: result.filePath, databaseOpen: Boolean(databasePath) });
  return result.filePath;
});

app.whenReady().then(async () => {
  if (!singleInstanceLock) return;
  logger = new StructuredLogger(join(app.getPath("userData"), "logs"));
  await logger.init();
  logger.info("app.start", { appVersion: app.getVersion(), electronVersion: process.versions.electron, nodeVersion: process.version, platform: process.platform });
  await useDefaultDatabaseIfPresent();
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("before-quit", () => {
  logger?.info("app.quit");
  void logger?.flush();
  mediaWatcher?.stop();
  mediaWatcher = undefined;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
