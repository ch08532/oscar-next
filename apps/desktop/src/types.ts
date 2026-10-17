import type { ExpertSettings, ExpertRequest, Compatibility, ReviewJob, ReviewResult } from "../../../src/expert/schemas.js";

export type { DailyChannelAnalysis, DailyChannelStatistics, TherapyAnalysisPreferences } from "../../../src/core/therapy-analysis.js";
import type { DailyChannelAnalysis, TherapyAnalysisPreferences } from "../../../src/core/therapy-analysis.js";

export interface ProfileSummary {
  id: number;
  name: string;
  timeZone: string;
  createdMs: number;
  updatedMs: number;
}

export interface MachineTimeSettings {
  machineId: number;
  profileId: number;
  deviceTimeZone: string;
  source: "profile" | "manual" | "unknown";
}

export interface SetupState {
  databasePath?: string;
  systemTimeZone: string;
  profiles: ProfileSummary[];
  activeProfile?: ProfileSummary;
  needsSetup: boolean;
}

export interface StoredMachineSummary {
  id: number;
  brand: string;
  model: string;
  serial: string;
  profileId?: number;
  deviceTimeZone?: string;
  sessionCount: number;
  firstSessionTime?: number;
  lastSessionTime?: number;
}

export interface DailySummary {
  machineId: number;
  date: string;
  deviceTimeZone: string;
  rangeStartMs: number;
  rangeEndMs: number;
  usageHours: number;
  ahi: number;
  rdi: number;
  eventCounts: {
    obstructive: number;
    clearAirway: number;
    hypopnea: number;
    unclassified: number;
    rera: number;
  };
  eventIndices: { obstructive: number; clearAirway: number; hypopnea: number; unclassified: number; rera: number };
  pressure?: { average: number; percentile95: number; max: number };
  leak?: { average: number; percentile95: number; max: number };
  availableChannels: number[];
  sessions: Array<{ id: number; firstMs: number; lastMs: number; usageHours: number; enabled?: boolean; summaryOnly: boolean; settings?: Record<number, unknown> }>;
}

export interface TherapyHistoryDay {
  date: string;
  sessionCount: number;
  usageHours: number;
}

export interface OverviewDaySummary {
  date: string;
  sessionCount: number;
  usageHours: number;
  ahi: number;
  rdi: number;
  obstructive: number;
  clearAirway: number;
  hypopnea: number;
  unclassified: number;
  rera: number;
  eventIndices: { obstructive: number; clearAirway: number; hypopnea: number; unclassified: number; rera: number };
  pressureAverage?: number;
  pressure95?: number;
  leakAverage?: number;
  leak95?: number;
}


export interface ChannelStatistics {
  count: number;
  min: number;
  max: number;
  average: number;
  percentile50: number;
  percentile95: number;
}

export interface StatisticsSummary {
  machineId: number;
  startDate: string;
  endDate: string;
  totalDays: number;
  usedDays: number;
  compliantDays: number;
  totalUsageHours: number;
  averageUsageHours: number;
  medianUsageHours: number;
  eventCounts: { obstructive: number; clearAirway: number; hypopnea: number; unclassified: number; rera: number };
  eventIndices: { obstructive: number; clearAirway: number; hypopnea: number; unclassified: number; rera: number };
  ahi: number;
  rdi: number;
  pressure?: ChannelStatistics;
  leak?: ChannelStatistics;
  settingsHistory: Array<{
    startDate: string;
    endDate: string;
    firstMs: number;
    lastMs: number;
    sessionCount: number;
    settings: Record<number, unknown>;
  }>;
  days: OverviewDaySummary[];
}

export interface ChartSeries {
  channelId: number;
  listIndex: number;
  type: "waveform" | "event";
  dimension: string;
  timesMs: Float64Array;
  values: Float32Array;
  values2?: Float32Array;
  sourcePointCount: number;
  decimated: boolean;
}

export interface ChartQueryOptions {
  startMs?: number;
  endMs?: number;
  maxPointsPerSeries?: number;
}

export interface ChartQueryResult {
  machineId: number;
  date: string;
  rangeStartMs: number;
  rangeEndMs: number;
  series: ChartSeries[];
}


export interface ImportProgress {
  current: number;
  total?: number;
  message?: string;
}

export interface ImportPreview {
  sourcePath: string;
  importerName: string;
  machine?: {
    brand: string;
    model: string;
    modelNumber: string;
    serial: string;
  };
  fileCount?: number;
  fileCounts?: Record<string, number | undefined>;
}

export interface DetectedMedia {
  volume: { rootPath: string; label?: string; removable?: boolean };
  preview: ImportPreview;
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


export interface GraphPreference {
  key: string;
  pinned: boolean;
  sortOrder: number;
  height?: number;
  visible?: boolean;
}

export interface GraphBookmark {
  id: number;
  machineId: number;
  date: string;
  name: string;
  startMs: number;
  endMs: number;
}

export interface AppInfo { version: string; packaged: boolean; platform: string; arch: string; }

export interface OscarApi {
  getGroqSettings(): Promise<import("../../../src/ai/contracts.js").GroqSettingsView>;
  configureGroq(settings: import("../../../src/ai/contracts.js").GroqSettingsUpdate): Promise<import("../../../src/ai/contracts.js").GroqSettingsView>;
  testGroq(): Promise<import("../../../src/ai/contracts.js").GroqConnectionCheck>;
  listGroqModels(): Promise<string[]>;
  getAISettings(): Promise<import("../../../src/ai/contracts.js").AISettingsView>;
  getAIStatus(): Promise<import("../../../src/ai/contracts.js").AIDiagnostics>;
  configureAI(settings: import("../../../src/ai/contracts.js").AISettingsUpdate): Promise<import("../../../src/ai/contracts.js").AISettingsView>;
  testAI(component?: "all" | "openai" | "mcp" | "tunnel"): Promise<import("../../../src/ai/contracts.js").AIDiagnostics>;
  restartAITunnel(): Promise<import("../../../src/ai/contracts.js").TunnelStatus>;
  startAI(request: import("../../../src/ai/contracts.js").AIRequest): Promise<import("../../../src/ai/contracts.js").AIJob>;
  getAIJob(id: string, scope: {profileId:number;machineId:number}, cursor: number): Promise<import("../../../src/ai/contracts.js").AIJob>;
  watchAIJob(id: string, scope: {profileId:number;machineId:number}, cursor: number, update: (job:import("../../../src/ai/contracts.js").AIJob)=>void, error: ()=>void): ()=>void;
  cancelAI(id: string, scope: {profileId:number;machineId:number}): Promise<import("../../../src/ai/contracts.js").AIJob>;
  clearAIHistory(scope: {profileId:number;machineId:number}, conversationId?: string): Promise<void>;
  getExpertSettings(): Promise<ExpertSettings>;
  configureExpert(settings: ExpertSettings): Promise<ExpertSettings>;
  listExpertModels(): Promise<Array<{ name: string; digest: string }>>;
  testExpertModel(): Promise<Compatibility>;
  startExpertReview(request: ExpertRequest): Promise<ReviewJob>;
  getExpertReview(id: string, scope: { profileId: number; machineId: number }): Promise<ReviewJob>;
  cancelExpertReview(id: string, scope: { profileId: number; machineId: number }): Promise<ReviewJob>;
  getExpertDiagnostics(): Promise<{ tools: string[]; mcp: string; persistence: string; compatibility: Compatibility | null; lastTimings: ReviewResult["timings"] | null }>;
  getAppInfo(): Promise<AppInfo>;
  getSetupState(): Promise<SetupState>;
  completeSetup(name: string, timeZone: string): Promise<SetupState>;
  listProfiles(): Promise<{ profiles: ProfileSummary[]; activeProfile?: ProfileSummary }>;
  createProfile(name: string, timeZone: string): Promise<ProfileSummary>;
  updateProfile(id: number, updates: { name?: string; timeZone?: string }): Promise<ProfileSummary>;
  setActiveProfile(id: number): Promise<ProfileSummary | undefined>;
  getMachineTimeSettings(machineId: number): Promise<MachineTimeSettings>;
  setMachineTimeZone(machineId: number, timeZone?: string): Promise<MachineTimeSettings>;
  openDatabase(): Promise<string | undefined>;
  listMachines(profileId?: number): Promise<StoredMachineSummary[]>;
  chooseImportSource(): Promise<ImportPreview | undefined>;
  loadDemoData(): Promise<ImportStoreResult>;
  runImport(sourcePath: string, profileId?: number): Promise<ImportStoreResult | undefined>;
  onImportProgress(callback: (progress: ImportProgress) => void): () => void;
  getPendingDetectedMedia(): Promise<DetectedMedia | undefined>;
  onMediaDetected(callback: (detected: DetectedMedia) => void): () => void;
  getDaily(machineId: number, date: string): Promise<DailySummary>;
  getDailyChannelAnalysis(machineId: number, date: string): Promise<DailyChannelAnalysis>;
  getTherapyAnalysisPreferences(machineId: number): Promise<TherapyAnalysisPreferences>;
  setTherapyAnalysisPreferences(machineId: number, preferences: TherapyAnalysisPreferences): Promise<TherapyAnalysisPreferences>;
  setGraphVisibility(machineId: number, visibility: Record<string, boolean>): Promise<void>;
  setSessionEnabled(machineId: number, sessionId: number, enabled: boolean): Promise<void>;
  getGraphPreferences(machineId: number): Promise<GraphPreference[]>;
  setGraphPinned(machineId: number, key: string, pinned: boolean): Promise<void>;
  setGraphHeight(machineId: number, key: string, height: number): Promise<void>;
  setGraphOrder(machineId: number, keys: string[]): Promise<void>;
  listGraphBookmarks(machineId: number, date: string): Promise<GraphBookmark[]>;
  createGraphBookmark(machineId: number, date: string, name: string, startMs: number, endMs: number): Promise<GraphBookmark>;
  deleteGraphBookmark(machineId: number, bookmarkId: number): Promise<void>;
  getOverview(machineId: number, startDate: string, endDate: string): Promise<OverviewDaySummary[]>;
  getTherapyHistory(machineId: number, startDate: string, endDate: string): Promise<TherapyHistoryDay[]>;
  getChartSeries(machineId: number, date: string, channelIds: number[], options?: ChartQueryOptions): Promise<ChartQueryResult>;
  getStatistics(machineId: number, startDate: string, endDate: string): Promise<StatisticsSummary>;
  exportStatisticsCsv(machineId: number, startDate: string, endDate: string): Promise<string | undefined>;
  exportStatisticsPdf(machineId: number, startDate: string, endDate: string): Promise<string | undefined>;
  createDiagnosticBundle(): Promise<string | undefined>;
}

declare global {
  interface Window { oscar: OscarApi; }
}
