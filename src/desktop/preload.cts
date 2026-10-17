import { contextBridge, ipcRenderer } from "electron";

// Sandboxed Electron preloads require CommonJS, even when the main process uses ESM.

contextBridge.exposeInMainWorld("oscar", {
  getExpertSettings: () => ipcRenderer.invoke("expert:getSettings"),
  getAISettings: () => ipcRenderer.invoke("ai:settings"),
  getGroqSettings: () => ipcRenderer.invoke("ai:groqSettings"),
  configureGroq: (settings: unknown) => ipcRenderer.invoke("ai:groqConfigure", settings),
  testGroq: () => ipcRenderer.invoke("ai:groqCheck"),
  listGroqModels: () => ipcRenderer.invoke("ai:groqModels"),
  getAIStatus: () => ipcRenderer.invoke("ai:status"),
  configureAI: (settings: unknown) => ipcRenderer.invoke("ai:configure", settings),
  testAI: (component?: string) => ipcRenderer.invoke("ai:check", component),
  restartAITunnel: () => ipcRenderer.invoke("ai:restart"),
  startAI: (request: unknown) => ipcRenderer.invoke("ai:start", request),
  getAIJob: (id: string, scope: unknown, cursor: number) => ipcRenderer.invoke("ai:job", id, scope, cursor),
  watchAIJob: (id: string, scope: unknown, cursor: number, update: (job:any)=>void, error: ()=>void) => {
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const job=await ipcRenderer.invoke("ai:job",id,scope,cursor);if(stopped)return;cursor=job.nextCursor;update(job);if(job.state==="running")timer=setTimeout(()=>void poll(),200);}catch{if(!stopped)error();}};
    void poll();return ()=>{stopped=true;clearTimeout(timer);};
  },
  cancelAI: (id: string, scope: unknown) => ipcRenderer.invoke("ai:cancel", id, scope),
  clearAIHistory: (scope: unknown, conversationId?: string) => ipcRenderer.invoke("ai:clear", scope, conversationId),
  configureExpert: (settings: unknown) => ipcRenderer.invoke("expert:configure", settings),
  listExpertModels: () => ipcRenderer.invoke("expert:listModels"),
  testExpertModel: () => ipcRenderer.invoke("expert:check"),
  startExpertReview: (request: unknown) => ipcRenderer.invoke("expert:start", request),
  getExpertReview: (id: string, scope: unknown) => ipcRenderer.invoke("expert:job", id, scope),
  cancelExpertReview: (id: string, scope: unknown) => ipcRenderer.invoke("expert:cancel", id, scope),
  getExpertDiagnostics: () => ipcRenderer.invoke("expert:diagnostics"),
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
  getDailyChannelAnalysis: (machineId: number, date: string) => ipcRenderer.invoke("daily:getChannelAnalysis", machineId, date),
  getTherapyAnalysisPreferences: (machineId: number) => ipcRenderer.invoke("analysis:getPreferences", machineId),
  setTherapyAnalysisPreferences: (machineId: number, preferences: { leakThreshold: number; showLeakThreshold: boolean }) => ipcRenderer.invoke("analysis:setPreferences", machineId, preferences),
  setGraphVisibility: (machineId: number, visibility: Record<string, boolean>) => ipcRenderer.invoke("graphs:setVisibility", machineId, visibility),
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
