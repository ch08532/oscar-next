import { contextBridge, ipcRenderer } from "electron";

// Sandboxed Electron preloads require CommonJS, even when the main process uses ESM.

contextBridge.exposeInMainWorld("oscar", {
  getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
  getSetupState: () => ipcRenderer.invoke("setup:getState"),
  completeSetup: (name: string, timeZone: string) => ipcRenderer.invoke("setup:complete", name, timeZone),
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  createProfile: (name: string, timeZone: string) => ipcRenderer.invoke("profiles:create", name, timeZone),
  updateProfile: (id: number, updates: { name?: string; timeZone?: string }) => ipcRenderer.invoke("profiles:update", id, updates),
  setActiveProfile: (id: number) => ipcRenderer.invoke("profiles:setActive", id),
  getMachineTimeSettings: (machineId: number) => ipcRenderer.invoke("machine:getTimeSettings", machineId),
  setMachineTimeZone: (machineId: number, timeZone?: string) => ipcRenderer.invoke("machine:setTimeZone", machineId, timeZone),
  openDatabase: (): Promise<string | undefined> => ipcRenderer.invoke("database:open"),
  listMachines: (profileId?: number) => ipcRenderer.invoke("database:listMachines", profileId),
  chooseImportSource: () => ipcRenderer.invoke("import:chooseSource"),
  loadDemoData: () => ipcRenderer.invoke("demo:load"),
  runImport: (sourcePath: string, profileId?: number) => ipcRenderer.invoke("import:run", sourcePath, profileId),
  onImportProgress: (callback: (progress: { current: number; total?: number; message?: string }) => void) => {
    const listener = (_event: unknown, progress: { current: number; total?: number; message?: string }) => callback(progress);
    ipcRenderer.on("import:progress", listener);
    return () => ipcRenderer.removeListener("import:progress", listener);
  },
  getPendingDetectedMedia: () => ipcRenderer.invoke("media:takePending"),
  onMediaDetected: (callback: (detected: { volume: { rootPath: string; label?: string; removable?: boolean }; preview: unknown }) => void) => {
    const listener = (_event: unknown, detected: { volume: { rootPath: string; label?: string; removable?: boolean }; preview: unknown }) => {
      void ipcRenderer.invoke("media:takePending");
      callback(detected);
    };
    ipcRenderer.on("media:detected", listener);
    return () => ipcRenderer.removeListener("media:detected", listener);
  },
  getDaily: (machineId: number, date: string) => ipcRenderer.invoke("daily:get", machineId, date),
  setSessionEnabled: (machineId: number, sessionId: number, enabled: boolean) => ipcRenderer.invoke("daily:setSessionEnabled", machineId, sessionId, enabled),
  getGraphPreferences: (machineId: number) => ipcRenderer.invoke("graphs:getPreferences", machineId),
  setGraphPinned: (machineId: number, key: string, pinned: boolean) => ipcRenderer.invoke("graphs:setPinned", machineId, key, pinned),
  setGraphHeight: (machineId: number, key: string, height: number) => ipcRenderer.invoke("graphs:setHeight", machineId, key, height),
  setGraphOrder: (machineId: number, keys: string[]) => ipcRenderer.invoke("graphs:setOrder", machineId, keys),
  listGraphBookmarks: (machineId: number, date: string) => ipcRenderer.invoke("graphs:listBookmarks", machineId, date),
  createGraphBookmark: (machineId: number, date: string, name: string, startMs: number, endMs: number) => ipcRenderer.invoke("graphs:createBookmark", machineId, date, name, startMs, endMs),
  deleteGraphBookmark: (machineId: number, bookmarkId: number) => ipcRenderer.invoke("graphs:deleteBookmark", machineId, bookmarkId),
  getOverview: (machineId: number, startDate: string, endDate: string) => ipcRenderer.invoke("overview:get", machineId, startDate, endDate),
  getTherapyHistory: (machineId: number, startDate: string, endDate: string) => ipcRenderer.invoke("therapyHistory:get", machineId, startDate, endDate),
  getChartSeries: (machineId: number, date: string, channelIds: number[], options?: { startMs?: number; endMs?: number; maxPointsPerSeries?: number }) => ipcRenderer.invoke("chart:get", machineId, date, channelIds, options),
  getStatistics: (machineId: number, startDate: string, endDate: string) => ipcRenderer.invoke("statistics:get", machineId, startDate, endDate),
  exportStatisticsCsv: (machineId: number, startDate: string, endDate: string): Promise<string | undefined> => ipcRenderer.invoke("statistics:exportCsv", machineId, startDate, endDate),
  exportStatisticsPdf: (machineId: number, startDate: string, endDate: string): Promise<string | undefined> => ipcRenderer.invoke("statistics:exportPdf", machineId, startDate, endDate),
  createDiagnosticBundle: (): Promise<string | undefined> => ipcRenderer.invoke("diagnostics:createBundle"),
});
