import type {
  AppInfo, ChartQueryOptions, ChartQueryResult, DailySummary, DetectedMedia, GraphBookmark, GraphPreference,
  ImportPreview, ImportProgress, ImportStoreResult, MachineTimeSettings, OscarApi, OverviewDaySummary,
  ProfileSummary, SetupState, StatisticsSummary, StoredMachineSummary, TherapyHistoryDay,
  DailyChannelAnalysis, TherapyAnalysisPreferences,
} from "./types.js";

interface ApiHealth {
  status: string;
  apiVersion: string;
  importsEnabled: boolean;
  mediaWatchEnabled?: boolean;
  webUiEnabled?: boolean;
  platform?: string;
  arch?: string;
}

interface ApiState extends SetupState { databaseOpen: boolean; }

function authHeaders(token?: string): HeadersInit {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function apiError(status: number, body: unknown): Error {
  const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`;
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

async function requestJson<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(authHeaders(token))) headers.set(key, String(value));
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const text = response.status === 204 ? "" : await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!response.ok) throw apiError(response.status, body);
  return body as T;
}

function chartFromJson(value: any): ChartQueryResult {
  return {
    ...value,
    series: (value.series ?? []).map((series: any) => ({
      ...series,
      timesMs: Float64Array.from(series.timesMs ?? []),
      values: Float32Array.from(series.values ?? []),
      ...(series.values2 ? { values2: Float32Array.from(series.values2) } : {}),
    })),
  } as ChartQueryResult;
}

function fileNameFromDisposition(value: string | null, fallback: string): string {
  const match = /filename="?([^";]+)"?/i.exec(value ?? "");
  return match?.[1] ?? fallback;
}

async function download(path: string, token: string | undefined, fallback: string): Promise<string> {
  const response = await fetch(path, { headers: authHeaders(token) });
  if (!response.ok) {
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    throw apiError(response.status, body);
  }
  const blob = await response.blob();
  const name = fileNameFromDisposition(response.headers.get("content-disposition"), fallback);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
  return name;
}

export function createRestOscarApi(token?: string): OscarApi {
  const json = <T,>(path: string, init?: RequestInit) => requestJson<T>(path, token, init);

  return {
    async getAppInfo(): Promise<AppInfo> {
      const health = await json<ApiHealth>("/api/v1/health");
      return { version: health.apiVersion, packaged: true, platform: health.platform ?? "linux", arch: health.arch ?? "arm64" };
    },
    async getSetupState(): Promise<SetupState> {
      const state = await json<ApiState>("/api/v1/state");
      return { systemTimeZone: state.systemTimeZone, profiles: state.profiles, ...(state.activeProfile ? { activeProfile: state.activeProfile } : {}), needsSetup: state.needsSetup, databasePath: "headless://server" };
    },
    async completeSetup(name: string, timeZone: string): Promise<SetupState> {
      const profile = await json<ProfileSummary>("/api/v1/profiles", { method: "POST", body: JSON.stringify({ name, timeZone }) });
      await json<ProfileSummary>("/api/v1/active-profile", { method: "PUT", body: JSON.stringify({ profileId: profile.id }) });
      return this.getSetupState();
    },
    async listProfiles() {
      const profiles = await json<ProfileSummary[]>("/api/v1/profiles");
      const activeProfile = await json<ProfileSummary | null>("/api/v1/active-profile");
      return { profiles, ...(activeProfile ? { activeProfile } : {}) };
    },
    async createProfile(name: string, timeZone: string) {
      return json<ProfileSummary>("/api/v1/profiles", { method: "POST", body: JSON.stringify({ name, timeZone }) });
    },
    async updateProfile(id: number, updates: { name?: string; timeZone?: string }) {
      return json<ProfileSummary>(`/api/v1/profiles/${id}`, { method: "PATCH", body: JSON.stringify(updates) });
    },
    async setActiveProfile(id: number) {
      return json<ProfileSummary>("/api/v1/active-profile", { method: "PUT", body: JSON.stringify({ profileId: id }) });
    },
    getMachineTimeSettings(machineId: number) { return json<MachineTimeSettings>(`/api/v1/machines/${machineId}/time-settings`); },
    setMachineTimeZone(machineId: number, timeZone?: string) {
      return json<MachineTimeSettings>(`/api/v1/machines/${machineId}/time-settings`, { method: "PUT", body: JSON.stringify({ timeZone: timeZone ?? null }) });
    },
    async openDatabase() { return undefined; },
    async listMachines(profileId?: number) {
      let id = profileId;
      if (id === undefined) id = (await json<ProfileSummary | null>("/api/v1/active-profile"))?.id;
      return id === undefined ? [] : json<StoredMachineSummary[]>(`/api/v1/profiles/${id}/machines`);
    },
    async chooseImportSource() {
      const sourcePath = window.prompt("Path on the Raspberry Pi/server to the mounted CPAP SD card or backup folder:", "/media/");
      if (!sourcePath?.trim()) return undefined;
      const preview = await json<ImportPreview | null>("/api/v1/imports/preview", { method: "POST", body: JSON.stringify({ sourcePath: sourcePath.trim() }) });
      return preview ?? undefined;
    },
    async loadDemoData() {
      const active = await json<ProfileSummary | null>("/api/v1/active-profile");
      return json<ImportStoreResult>("/api/v1/demo", { method: "POST", body: JSON.stringify({ ...(active ? { profileId: active.id } : {}), days: 14 }) });
    },
    async runImport(sourcePath: string, profileId?: number) {
      return json<ImportStoreResult>("/api/v1/imports", { method: "POST", body: JSON.stringify({ sourcePath, ...(profileId !== undefined ? { profileId } : {}) }) });
    },
    onImportProgress(_callback: (progress: ImportProgress) => void) { return () => undefined; },
    async getPendingDetectedMedia() {
      const detected = await json<DetectedMedia | null>("/api/v1/media/pending");
      if (detected) await json<void>("/api/v1/media/pending", { method: "DELETE" });
      return detected ?? undefined;
    },
    onMediaDetected(callback: (detected: DetectedMedia) => void) {
      let stopped = false;
      let lastKey = "";
      const poll = async () => {
        if (stopped) return;
        try {
          const detected = await json<DetectedMedia | null>("/api/v1/media/pending");
          if (detected) {
            const key = `${detected.volume.rootPath}:${detected.preview.machine?.serial ?? ""}`;
            if (key !== lastKey) { lastKey = key; callback(detected); }
            await json<void>("/api/v1/media/pending", { method: "DELETE" });
          }
        } catch { /* polling is best effort */ }
      };
      const timer = window.setInterval(() => { void poll(); }, 2_000);
      void poll();
      return () => { stopped = true; window.clearInterval(timer); };
    },
    getDaily(machineId: number, date: string) { return json<DailySummary>(`/api/v1/machines/${machineId}/daily/${date}`); },
    getDailyChannelAnalysis(machineId: number, date: string) { return json<DailyChannelAnalysis>(`/api/v1/machines/${machineId}/daily/${date}/channel-analysis`); },
    getTherapyAnalysisPreferences(machineId: number) { return json<TherapyAnalysisPreferences>(`/api/v1/machines/${machineId}/analysis-preferences`); },
    setTherapyAnalysisPreferences(machineId: number, preferences: TherapyAnalysisPreferences) { return json<TherapyAnalysisPreferences>(`/api/v1/machines/${machineId}/analysis-preferences`, { method: "PUT", body: JSON.stringify(preferences) }); },
    async setGraphVisibility(machineId: number, visibility: Record<string, boolean>) { await json<void>(`/api/v1/machines/${machineId}/graphs/visibility`, { method: "PUT", body: JSON.stringify({ visibility }) }); },
    async setSessionEnabled(machineId: number, sessionId: number, enabled: boolean) {
      await json<void>(`/api/v1/machines/${machineId}/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    },
    getGraphPreferences(machineId: number) { return json<GraphPreference[]>(`/api/v1/machines/${machineId}/graphs/preferences`); },
    async setGraphPinned(machineId: number, key: string, pinned: boolean) {
      await json<void>(`/api/v1/machines/${machineId}/graphs/preferences/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ pinned }) });
    },
    async setGraphHeight(machineId: number, key: string, height: number) {
      await json<void>(`/api/v1/machines/${machineId}/graphs/preferences/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ height }) });
    },
    async setGraphOrder(machineId: number, keys: string[]) {
      await json<void>(`/api/v1/machines/${machineId}/graphs/order`, { method: "PUT", body: JSON.stringify({ keys }) });
    },
    listGraphBookmarks(machineId: number, date: string) {
      return json<GraphBookmark[]>(`/api/v1/machines/${machineId}/graphs/bookmarks?date=${encodeURIComponent(date)}`);
    },
    createGraphBookmark(machineId: number, date: string, name: string, startMs: number, endMs: number) {
      return json<GraphBookmark>(`/api/v1/machines/${machineId}/graphs/bookmarks`, { method: "POST", body: JSON.stringify({ date, name, startMs, endMs }) });
    },
    async deleteGraphBookmark(machineId: number, bookmarkId: number) {
      await json<void>(`/api/v1/machines/${machineId}/graphs/bookmarks/${bookmarkId}`, { method: "DELETE" });
    },
    getOverview(machineId: number, startDate: string, endDate: string) {
      return json<OverviewDaySummary[]>(`/api/v1/machines/${machineId}/overview?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
    },
    getTherapyHistory(machineId: number, startDate: string, endDate: string) {
      return json<TherapyHistoryDay[]>(`/api/v1/machines/${machineId}/therapy-history?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
    },
    async getChartSeries(machineId: number, date: string, channelIds: number[], options: ChartQueryOptions = {}) {
      const params = new URLSearchParams({ channels: channelIds.join(",") });
      if (options.startMs !== undefined) params.set("startMs", String(options.startMs));
      if (options.endMs !== undefined) params.set("endMs", String(options.endMs));
      if (options.maxPointsPerSeries !== undefined) params.set("maxPointsPerSeries", String(options.maxPointsPerSeries));
      return chartFromJson(await json<any>(`/api/v1/machines/${machineId}/charts/${date}?${params}`));
    },
    getStatistics(machineId: number, startDate: string, endDate: string) {
      return json<StatisticsSummary>(`/api/v1/machines/${machineId}/statistics?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
    },
    exportStatisticsCsv(machineId: number, startDate: string, endDate: string) {
      return download(`/api/v1/machines/${machineId}/reports/statistics.csv?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, token, `oscar-next-${startDate}-${endDate}.csv`);
    },
    async exportStatisticsPdf(machineId: number, startDate: string, endDate: string) {
      const popup = window.open("", "_blank");
      const response = await fetch(`/api/v1/machines/${machineId}/reports/statistics.html?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, { headers: authHeaders(token) });
      if (!response.ok) throw apiError(response.status, await response.json().catch(() => undefined));
      const html = await response.text();
      if (popup) {
        popup.document.open(); popup.document.write(html); popup.document.close();
        popup.addEventListener("load", () => popup.print(), { once: true });
        return "browser print dialog (choose Save as PDF)";
      }
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob); window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return "printable report opened";
    },
    createDiagnosticBundle() {
      return download("/api/v1/diagnostics", token, `OSCAR-Next-Diagnostics-${new Date().toISOString().slice(0, 10)}.zip`);
    },
  };
}

export async function verifyApiToken(token?: string): Promise<ApiHealth> {
  return requestJson<ApiHealth>("/api/v1/health", token);
}

export async function verifyAuthorizedAccess(token?: string): Promise<void> {
  await requestJson<ProfileSummary[]>("/api/v1/profiles", token);
}
