import { CPAPMode, MachineType, type SettingValue } from "../../core/types.js";
import { CpapSetting } from "../../core/cpap-settings.js";
import { Session, SliceStatus } from "../../core/session.js";
import { digitalToPhysical, readEdfFile } from "../edf/edf-parser.js";
import type { EdfFile, EdfSignalData } from "../edf/edf-types.js";

export interface ResMedMaskWindow { startMs: number; endMs: number; }
export interface ResMedStrDay {
  /** ResMed therapy day begins at local/device noon, normalized here to UTC wall-clock. */
  noonMs: number;
  recordIndex: number;
  windows: ResMedMaskWindow[];
  settings: Map<number, SettingValue>;
}
export interface ResMedStrResult { days: ResMedStrDay[]; warnings: string[]; }
export interface ResMedStrParseOptions { air11?: boolean; }

const LABELS = {
  maskOn: ["Mask On", "MaskOn"], maskOff: ["Mask Off", "MaskOff"],
  mode: ["Mode", "Mod", "Modus", "Funktion", "模式"],
  setPressure: ["Set Pressure", "Eingest. Druck", "Ingestelde druk", "Pres. prescrite", "Inställt tryck", "Basıncı Ayarl", "S.C.Press"],
  minPressure: ["Min Pressure", "Min. Druck", "Min druk", "Pression min.", "Min tryck", "S.AS.MinPress", "S.A.MinPress", "S.AFH.MinPress"],
  maxPressure: ["Max Pressure", "Max. Druck", "Max druk", "Pression max.", "Max tryck", "S.AS.MaxPress", "S.A.MaxPress", "S.AFH.MaxPress"],
  ipap: ["Insp Pres", "IPAP", "S.BL.IPAP", "S.S.IPAP"], epap: ["Exp Pres", "EPAP", "S.BL.EPAP", "S.S.EPAP", "S.AV.EPAP", "S.i.EPAP"],
  epapMin: ["Min EPAP", "S.VA.MinEPAP", "S.AA.MinEPAP", "S.i.MinEPAP"], epapMax: ["Max EPAP", "S.VA.MaxEPAP", "S.AA.MaxEPAP", "S.i.MaxEPAP"],
  ipapMin: ["Min IPAP", "S.VA.MinIPAP"], ipapMax: ["Max IPAP", "S.VA.MaxIPAP"],
  ps: ["PS", "S.VA.PS"], psMin: ["Min PS", "S.AV.MinPS", "S.AA.MinPS", "S.i.MinPS"], psMax: ["Max PS", "S.AV.MaxPS", "S.AA.MaxPS", "S.i.MaxPS"],
  epapAuto: ["S.i.EPAPAuto"],
  epr: ["EPR"], eprLevel: ["EPR Level", "EPR-Stufe", "EPR-niveau", "Niveau EPR", "EPR-nivå", "EPR Düzeyi", "S.EPR.Level"],
  eprType: ["S.EPR.EPRType"], eprEnable: ["S.EPR.EPREnable"], eprClinEnable: ["S.EPR.ClinEnable"],
  rampEnable: ["S.RampEnable"], rampTime: ["S.RampTime"],
  cpapStartPressure: ["S.C.StartPress"], apapStartPressure: ["S.AS.StartPress", "S.A.StartPress", "S.AFH.StartPress"], bilevelStartPressure: ["S.BL.StartPress", "S.S.StartPress"],
  asvStartPressure: ["S.VA.StartPress", "S.AV.StartPress"], asvAutoStartPressure: ["S.AA.StartPress"], ivapsStartPressure: ["S.i.StartPress"],
  smartStart: ["S.SmartStart"], smartStop: ["S.SmartStop"], abFilter: ["S.ABFilter"], climateControl: ["S.ClimateControl"], mask: ["S.Mask"], patientAccess: ["S.PtAccess"],
  humidifierEnable: ["S.HumEnable"], humidityLevel: ["S.HumLevel"], temperatureEnable: ["S.TempEnable"], temperature: ["S.Temp"], tube: ["S.Tube"],
  response: ["S.AS.Comfort", "S.A.Comfort", "S.AFH.Comfort"], easyBreathe: ["S.EasyBreathe", "S.S.EasyBreathe"], riseEnable: ["S.RiseEnable", "S.S.RiseEnable"], riseTime: ["S.RiseTime", "S.S.RiseTime"],
  cycle: ["S.Cycle", "S.S.Cycle"], trigger: ["S.Trigger", "S.S.Trigger"], tiMax: ["S.TiMax", "S.S.TiMax"], tiMin: ["S.TiMin", "S.S.TiMin"],
  summaryDuration: ["Mask Dur", "Duration"], summaryAhi: ["AHI"], summaryAi: ["AI"], summaryHi: ["HI"], summaryUai: ["UAI"], summaryCai: ["CAI"], summaryOai: ["OAI"], summaryCsr: ["CSR"],
  summaryLeakMedian: ["Leak Med", "Leak Median"], summaryLeak95: ["Leak 95", "Leak 95%"], summaryLeakMax: ["Leak Max"],
} as const;

function startsWithAny(label: string, candidates: readonly string[]): boolean {
  const normalized = label.trim().toLocaleLowerCase();
  return candidates.some((candidate) => normalized.startsWith(candidate.toLocaleLowerCase()));
}
function findSignal(edf: EdfFile, candidates: readonly string[], occurrence = 0): EdfSignalData | undefined {
  return edf.signals.filter((signal) => startsWithAny(signal.definition.label, candidates))[occurrence];
}
function rawAt(signal: EdfSignalData | undefined, recordIndex: number, sampleIndex = 0): number | undefined {
  const samples = signal?.digitalSamples; if (!signal || !samples) return undefined;
  const value = samples[recordIndex * signal.definition.samplesPerRecord + sampleIndex];
  return value === undefined ? undefined : value;
}
function physicalAt(signal: EdfSignalData | undefined, recordIndex: number, sampleIndex = 0): number | undefined {
  const raw = rawAt(signal, recordIndex, sampleIndex); if (raw === undefined || !signal) return undefined;
  return digitalToPhysical(signal.definition, raw);
}
function setIfFinite(settings: Map<number, SettingValue>, key: CpapSetting, value: number | undefined): void {
  if (value !== undefined && Number.isFinite(value) && value >= 0) settings.set(key, value);
}
function boolSetting(settings: Map<number, SettingValue>, key: CpapSetting, value: number | undefined, air11 = false): void {
  if (value === undefined || !Number.isFinite(value) || value < 0) return;
  const normalized = air11 && value > 0 ? value - 1 : value;
  settings.set(key, normalized > 0);
}

/** AirSense/AirCurve 11 use a newer raw mode enumeration. Normalize to legacy ResMed values first. */
export function normalizeResMedMode(rawMode: number, air11 = false): number {
  if (!air11) return rawMode;
  const map: Readonly<Record<number, number>> = { 0: 10, 1: 1, 2: 11, 3: 0, 4: 3, 6: 7, 7: 8, 8: 6 };
  return map[rawMode] ?? rawMode;
}

export function resMedMode(rawMode: number): CPAPMode {
  if (rawMode === 11 || rawMode === 1) return CPAPMode.APAP;
  if (rawMode === 10) return CPAPMode.Unknown;
  if (rawMode === 9) return CPAPMode.AVAPS;
  if (rawMode === 8) return CPAPMode.ASVVariableEPAP;
  if (rawMode === 7) return CPAPMode.ASV;
  if (rawMode === 6) return CPAPMode.BiLevelAutoFixedPS;
  if (rawMode >= 2 && rawMode <= 5) return CPAPMode.BiLevelFixed;
  if (rawMode === 0) return CPAPMode.CPAP;
  return CPAPMode.Unknown;
}

function parseSettings(edf: EdfFile, recordIndex: number, options: ResMedStrParseOptions): Map<number, SettingValue> {
  const settings = new Map<number, SettingValue>();
  const rawModeValue = physicalAt(findSignal(edf, LABELS.mode), recordIndex);
  const rawMode = rawModeValue === undefined ? undefined : Math.round(rawModeValue);
  const normalizedMode = rawMode === undefined ? undefined : normalizeResMedMode(rawMode, options.air11 === true);
  const mode = normalizedMode === undefined ? CPAPMode.Unknown : resMedMode(normalizedMode);
  if (rawMode !== undefined && rawMode >= 0) {
    settings.set(CpapSetting.ResMedRawMode, rawMode);
    settings.set(CpapSetting.ResMedNormalizedMode, normalizedMode ?? rawMode);
    settings.set(CpapSetting.Mode, mode);
  }

  setIfFinite(settings, CpapSetting.SetPressure, physicalAt(findSignal(edf, LABELS.setPressure), recordIndex));
  setIfFinite(settings, CpapSetting.PressureMin, physicalAt(findSignal(edf, LABELS.minPressure), recordIndex));
  setIfFinite(settings, CpapSetting.PressureMax, physicalAt(findSignal(edf, LABELS.maxPressure), recordIndex));
  setIfFinite(settings, CpapSetting.IPAP, physicalAt(findSignal(edf, LABELS.ipap), recordIndex));
  setIfFinite(settings, CpapSetting.EPAP, physicalAt(findSignal(edf, LABELS.epap), recordIndex));
  setIfFinite(settings, CpapSetting.EPAPMin, physicalAt(findSignal(edf, LABELS.epapMin), recordIndex));
  setIfFinite(settings, CpapSetting.EPAPMax, physicalAt(findSignal(edf, LABELS.epapMax), recordIndex));
  setIfFinite(settings, CpapSetting.IPAPMin, physicalAt(findSignal(edf, LABELS.ipapMin), recordIndex));
  setIfFinite(settings, CpapSetting.IPAPMax, physicalAt(findSignal(edf, LABELS.ipapMax), recordIndex));
  setIfFinite(settings, CpapSetting.PressureSupport, physicalAt(findSignal(edf, LABELS.ps), recordIndex));
  setIfFinite(settings, CpapSetting.PressureSupportMin, physicalAt(findSignal(edf, LABELS.psMin), recordIndex));
  setIfFinite(settings, CpapSetting.PressureSupportMax, physicalAt(findSignal(edf, LABELS.psMax), recordIndex));
  boolSetting(settings, CpapSetting.EPAPAuto, physicalAt(findSignal(edf, LABELS.epapAuto), recordIndex), options.air11);

  // ASV/iVAPS derive useful IPAP bounds from EPAP + pressure-support limits.
  if (mode === CPAPMode.ASV || mode === CPAPMode.AVAPS) {
    const epap = settings.get(CpapSetting.EPAP), minPs = settings.get(CpapSetting.PressureSupportMin), maxPs = settings.get(CpapSetting.PressureSupportMax);
    if (typeof epap === "number" && typeof minPs === "number" && !settings.has(CpapSetting.IPAPMin)) settings.set(CpapSetting.IPAPMin, epap + minPs);
    if (typeof epap === "number" && typeof maxPs === "number" && !settings.has(CpapSetting.IPAPMax)) settings.set(CpapSetting.IPAPMax, epap + maxPs);
  } else if (mode === CPAPMode.ASVVariableEPAP || mode === CPAPMode.BiLevelAutoFixedPS) {
    const minEpap = settings.get(CpapSetting.EPAPMin), maxEpap = settings.get(CpapSetting.EPAPMax), minPs = settings.get(CpapSetting.PressureSupportMin), maxPs = settings.get(CpapSetting.PressureSupportMax);
    if (typeof minEpap === "number" && typeof minPs === "number" && !settings.has(CpapSetting.IPAPMin)) settings.set(CpapSetting.IPAPMin, minEpap + minPs);
    if (typeof maxEpap === "number" && typeof maxPs === "number" && !settings.has(CpapSetting.IPAPMax)) settings.set(CpapSetting.IPAPMax, maxEpap + maxPs);
  }

  let epr = physicalAt(findSignal(edf, LABELS.epr), recordIndex);
  const eprType = physicalAt(findSignal(edf, LABELS.eprType), recordIndex);
  let eprLevel = physicalAt(findSignal(edf, LABELS.eprLevel), recordIndex);
  const eprEnable = physicalAt(findSignal(edf, LABELS.eprEnable), recordIndex);
  const eprClinEnable = physicalAt(findSignal(edf, LABELS.eprClinEnable), recordIndex);
  if (eprType !== undefined && eprType >= 0) epr = eprType + 1;
  if ((eprEnable !== undefined || eprClinEnable !== undefined) && !((eprEnable ?? 0) > 0 && (eprClinEnable ?? 0) > 0)) { epr = 0; eprLevel = 0; }
  if (epr !== undefined && epr >= 0) {
    settings.set(CpapSetting.EPRMode, epr);
    if (epr > 0 && eprLevel !== undefined && eprLevel >= 0) settings.set(CpapSetting.EPRLevel, eprLevel);
  } else if (eprLevel !== undefined && eprLevel >= 0) {
    settings.set(CpapSetting.EPRMode, eprLevel > 0 ? 1 : 0);
    if (eprLevel > 0) settings.set(CpapSetting.EPRLevel, eprLevel);
  }

  const rampEnable = physicalAt(findSignal(edf, LABELS.rampEnable), recordIndex);
  if (rampEnable !== undefined && rampEnable >= 0) {
    const rampOn = options.air11 ? rampEnable > 1 : rampEnable >= 1;
    settings.set(CpapSetting.RampEnabled, rampOn);
    if (rampOn) {
      setIfFinite(settings, CpapSetting.RampTimeMinutes, physicalAt(findSignal(edf, LABELS.rampTime), recordIndex));
      let rampPressure: number | undefined;
      if (normalizedMode === 0) rampPressure = physicalAt(findSignal(edf, LABELS.cpapStartPressure), recordIndex);
      else if (normalizedMode === 1 || normalizedMode === 11) rampPressure = physicalAt(findSignal(edf, LABELS.apapStartPressure), recordIndex);
      else if (mode === CPAPMode.BiLevelFixed || mode === CPAPMode.BiLevelAutoFixedPS) rampPressure = physicalAt(findSignal(edf, LABELS.bilevelStartPressure), recordIndex);
      else if (mode === CPAPMode.ASV) rampPressure = physicalAt(findSignal(edf, LABELS.asvStartPressure), recordIndex);
      else if (mode === CPAPMode.ASVVariableEPAP) rampPressure = physicalAt(findSignal(edf, LABELS.asvAutoStartPressure), recordIndex);
      else if (mode === CPAPMode.AVAPS) rampPressure = physicalAt(findSignal(edf, LABELS.ivapsStartPressure), recordIndex);
      setIfFinite(settings, CpapSetting.RampPressure, rampPressure);
    }
  }

  setIfFinite(settings, CpapSetting.SmartStart, physicalAt(findSignal(edf, LABELS.smartStart), recordIndex));
  setIfFinite(settings, CpapSetting.SmartStop, physicalAt(findSignal(edf, LABELS.smartStop), recordIndex));
  setIfFinite(settings, CpapSetting.AntibacterialFilter, physicalAt(findSignal(edf, LABELS.abFilter), recordIndex));
  setIfFinite(settings, CpapSetting.ClimateControl, physicalAt(findSignal(edf, LABELS.climateControl), recordIndex));
  setIfFinite(settings, CpapSetting.MaskType, physicalAt(findSignal(edf, LABELS.mask), recordIndex));
  setIfFinite(settings, CpapSetting.PatientAccess, physicalAt(findSignal(edf, LABELS.patientAccess), recordIndex));
  setIfFinite(settings, CpapSetting.HumidifierEnabled, physicalAt(findSignal(edf, LABELS.humidifierEnable), recordIndex));
  setIfFinite(settings, CpapSetting.HumidityLevel, physicalAt(findSignal(edf, LABELS.humidityLevel), recordIndex));
  setIfFinite(settings, CpapSetting.TemperatureEnabled, physicalAt(findSignal(edf, LABELS.temperatureEnable), recordIndex));
  setIfFinite(settings, CpapSetting.TemperatureC, physicalAt(findSignal(edf, LABELS.temperature), recordIndex));
  setIfFinite(settings, CpapSetting.TubeType, physicalAt(findSignal(edf, LABELS.tube), recordIndex));
  setIfFinite(settings, CpapSetting.Response, physicalAt(findSignal(edf, LABELS.response), recordIndex));
  setIfFinite(settings, CpapSetting.EasyBreathe, physicalAt(findSignal(edf, LABELS.easyBreathe), recordIndex));
  setIfFinite(settings, CpapSetting.RiseEnabled, physicalAt(findSignal(edf, LABELS.riseEnable), recordIndex));
  setIfFinite(settings, CpapSetting.RiseTimeMs, physicalAt(findSignal(edf, LABELS.riseTime), recordIndex));
  setIfFinite(settings, CpapSetting.CycleSensitivity, physicalAt(findSignal(edf, LABELS.cycle), recordIndex));
  setIfFinite(settings, CpapSetting.TriggerSensitivity, physicalAt(findSignal(edf, LABELS.trigger), recordIndex));
  setIfFinite(settings, CpapSetting.TiMaxSeconds, physicalAt(findSignal(edf, LABELS.tiMax), recordIndex));
  setIfFinite(settings, CpapSetting.TiMinSeconds, physicalAt(findSignal(edf, LABELS.tiMin), recordIndex));

  // Summary statistics allow STR-only nights to remain clinically useful.
  setIfFinite(settings, CpapSetting.SummaryMaskDurationHours, physicalAt(findSignal(edf, LABELS.summaryDuration), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryAHI, physicalAt(findSignal(edf, LABELS.summaryAhi), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryAI, physicalAt(findSignal(edf, LABELS.summaryAi), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryHI, physicalAt(findSignal(edf, LABELS.summaryHi), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryUAI, physicalAt(findSignal(edf, LABELS.summaryUai), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryCAI, physicalAt(findSignal(edf, LABELS.summaryCai), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryOAI, physicalAt(findSignal(edf, LABELS.summaryOai), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryCSRPercent, physicalAt(findSignal(edf, LABELS.summaryCsr), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryLeakMedian, physicalAt(findSignal(edf, LABELS.summaryLeakMedian), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryLeak95, physicalAt(findSignal(edf, LABELS.summaryLeak95), recordIndex));
  setIfFinite(settings, CpapSetting.SummaryLeakMax, physicalAt(findSignal(edf, LABELS.summaryLeakMax), recordIndex));
  return settings;
}

function noonForRecord(edf: EdfFile, recordIndex: number): number {
  const start = edf.header.start; return Date.UTC(start.year, start.month - 1, start.day + recordIndex, 12, 0, 0);
}
function parseWindows(edf: EdfFile, recordIndex: number, warnings: string[]): ResMedMaskWindow[] {
  const maskOn = findSignal(edf, LABELS.maskOn), maskOff = findSignal(edf, LABELS.maskOff); if (!maskOn || !maskOff) return [];
  const count = Math.min(maskOn.definition.samplesPerRecord, maskOff.definition.samplesPerRecord), noonMs = noonForRecord(edf, recordIndex), nextNoonMs = noonMs + 86_400_000;
  const starts: number[] = [], ends: number[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const onMinutes = rawAt(maskOn, recordIndex, slot), offMinutes = rawAt(maskOff, recordIndex, slot);
    starts.push(onMinutes !== undefined && onMinutes > 0 ? noonMs + onMinutes * 60_000 : 0);
    ends.push(offMinutes !== undefined && offMinutes > 0 ? noonMs + offMinutes * 60_000 : 0);
  }
  if (count > 0 && (starts[0] ?? 0) === 0 && (ends[0] ?? 0) > 0 && (rawAt(maskOn, recordIndex, 0) ?? -1) >= 0) starts[0] = noonMs;
  const last = count - 1; if (last >= 0 && (starts[last] ?? 0) > 0 && (ends[last] ?? 0) === 0 && (rawAt(maskOff, recordIndex, last) ?? -1) >= 0) ends[last] = nextNoonMs - 1000;
  const windows: ResMedMaskWindow[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const startMs = starts[slot] ?? 0, endMs = ends[slot] ?? 0;
    if (startMs > 0 && endMs > startMs) windows.push({ startMs, endMs });
    else if ((startMs > 0 || endMs > 0) && startMs !== endMs) warnings.push(`STR record ${recordIndex} mask slot ${slot} has incomplete Mask On/Off values`);
  }
  return windows;
}

export function parseResMedStrEdf(edf: EdfFile, options: ResMedStrParseOptions = {}): ResMedStrResult {
  const warnings = [...edf.warnings], days: ResMedStrDay[] = [];
  for (let recordIndex = 0; recordIndex < edf.parsedDataRecordCount; recordIndex += 1) {
    days.push({ noonMs: noonForRecord(edf, recordIndex), recordIndex, windows: parseWindows(edf, recordIndex, warnings), settings: parseSettings(edf, recordIndex, options) });
  }
  return { days, warnings };
}
export async function readResMedStrFile(path: string, options: ResMedStrParseOptions = {}): Promise<ResMedStrResult> {
  return parseResMedStrEdf(await readEdfFile(path, { strict: false }), options);
}
export function sessionsFromStr(days: readonly ResMedStrDay[]): Session[] {
  const sessions: Session[] = [], seen = new Set<string>();
  for (const day of days) for (const window of day.windows) {
    const key = `${window.startMs}:${window.endMs}`; if (seen.has(key)) continue; seen.add(key);
    let id = Math.floor(window.startMs / 1000); while (sessions.some((session) => session.id === id)) id += 1;
    const session = new Session(id, MachineType.CPAP); session.setBounds(window.startMs, window.endMs); session.addSlice({ start: window.startMs, end: window.endMs, status: SliceStatus.MaskOn });
    for (const [setting, value] of day.settings) session.settings.set(setting, value); sessions.push(session);
  }
  sessions.sort((a, b) => a.first - b.first); return sessions;
}
