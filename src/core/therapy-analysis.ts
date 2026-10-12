export interface TherapyAnalysisPreferences {
  leakThreshold: number;
  showLeakThreshold: boolean;
}

export const DEFAULT_THERAPY_ANALYSIS: Readonly<TherapyAnalysisPreferences> = Object.freeze({ leakThreshold: 24, showLeakThreshold: true });

export function validateTherapyAnalysisPreferences(value: TherapyAnalysisPreferences): TherapyAnalysisPreferences {
  if (!Number.isFinite(value.leakThreshold) || value.leakThreshold < 0 || value.leakThreshold > 1000) throw new RangeError("leakThreshold must be between 0 and 1000 L/min");
  if (typeof value.showLeakThreshold !== "boolean") throw new TypeError("showLeakThreshold must be a boolean");
  return { leakThreshold: value.leakThreshold, showLeakThreshold: value.showLeakThreshold };
}

export function parseTherapyAnalysisPreferences(json?: string): TherapyAnalysisPreferences {
  return json ? validateTherapyAnalysisPreferences(JSON.parse(json) as TherapyAnalysisPreferences) : { ...DEFAULT_THERAPY_ANALYSIS };
}

export interface DailyChannelStatistics {
  channelId: number;
  label: string;
  unit: string;
  count: number;
  recordedSeconds: number;
  min: number;
  average: number;
  percentile50: number;
  percentile95: number;
  max: number;
}

export interface DailyChannelAnalysis {
  machineId: number;
  date: string;
  therapySeconds: number;
  channels: DailyChannelStatistics[];
  leak?: {
    threshold: number;
    unit: "L/min";
    secondsAboveThreshold: number;
    recordedSeconds: number;
    percentTherapyTimeAboveThreshold: number;
  };
}
