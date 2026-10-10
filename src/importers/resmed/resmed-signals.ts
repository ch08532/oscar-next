import { CpapChannel } from "../../core/cpap-channels.js";
import type { EdfSignalDefinition } from "../edf/edf-types.js";
import type { ResMedEdfType } from "./resmed-files.js";

export interface ResMedSignalMapping {
  channel: CpapChannel;
  gainMultiplier?: number;
  dimension?: string;
  missingRawValue?: number;
}

const PREFIXES = {
  flow: ["Flow", "Flow.40ms"],
  maskPressureHigh: ["Mask Pres", "Press.40ms"],
  respEvent: ["Resp Event", "TrigCycEvt.40ms"],
  maskPressure: ["Mask Pres", "MaskPress.2s"],
  pressure: ["Therapy Pres", "Press.2s"],
  ipap: ["Insp Pres", "IPAP", "S.BL.IPAP", "S.S.IPAP"],
  epap: ["Exp Pres", "EprPress.2s", "EPAP", "S.BL.EPAP", "S.S.EPAP", "EPRPress.2s"],
  leak: ["Leak", "Leck", "Fuites", "Fuite", "Fuga", "Lekk", "Läck", "Sızıntı", "Leak.2s"],
  respRate: ["RR", "AF", "FR", "RespRate.2s"],
  minuteVent: ["MV", "VM", "MinVent.2s"],
  tidalVolume: ["Vt", "VC", "TidVol.2s"],
  ieRatio: ["I:E", "IERatio.2s"],
  snore: ["Snore", "Snore.2s"],
  flowLimitation: ["FFL Index", "FlowLim.2s"],
  inspiratoryTime: ["Ti", "B5ITime.2s"],
  expiratoryTime: ["Te", "B5ETime.2s"],
  targetMinuteVent: ["TgMV", "TgtVent.2s"],
  pulse: ["Pulse", "Puls", "Pouls", "Pols", "Nabiz", "Pulse.1s"],
  spo2: ["SpO2", "SpO2.1s"],
} as const;

function startsWithAny(label: string, prefixes: readonly string[]): boolean {
  const normalized = label.trim().toLocaleLowerCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix.toLocaleLowerCase()));
}

export function mapResMedSignal(type: ResMedEdfType, signal: EdfSignalDefinition): ResMedSignalMapping | undefined {
  const label = signal.label.trim();
  if (!label || signal.isAnnotation || label.toLocaleLowerCase() === "crc16") return undefined;

  if (type === "BRP") {
    if (startsWithAny(label, PREFIXES.flow)) {
      return { channel: CpapChannel.FlowRate, gainMultiplier: 60, dimension: "L/min" };
    }
    if (startsWithAny(label, PREFIXES.maskPressureHigh)) {
      return { channel: CpapChannel.MaskPressureHigh };
    }
    if (startsWithAny(label, PREFIXES.respEvent)) {
      return { channel: CpapChannel.RespEvent };
    }
    return undefined;
  }

  if (type === "PLD") {
    if (startsWithAny(label, PREFIXES.snore)) return { channel: CpapChannel.Snore };
    if (startsWithAny(label, PREFIXES.pressure)) return { channel: CpapChannel.Pressure };
    if (startsWithAny(label, PREFIXES.ipap)) return { channel: CpapChannel.IPAP };
    if (startsWithAny(label, PREFIXES.epap)) return { channel: CpapChannel.EPAP };
    if (startsWithAny(label, PREFIXES.minuteVent)) return { channel: CpapChannel.MinuteVent };
    if (startsWithAny(label, PREFIXES.respRate)) return { channel: CpapChannel.RespRate };
    if (startsWithAny(label, PREFIXES.tidalVolume)) {
      return { channel: CpapChannel.TidalVolume, gainMultiplier: 1000, dimension: "mL" };
    }
    if (startsWithAny(label, PREFIXES.leak)) {
      return { channel: CpapChannel.Leak, gainMultiplier: 60, dimension: "L/min" };
    }
    if (startsWithAny(label, PREFIXES.flowLimitation)) return { channel: CpapChannel.FlowLimitation };
    if (startsWithAny(label, PREFIXES.maskPressure)) return { channel: CpapChannel.MaskPressure };
    if (startsWithAny(label, PREFIXES.ieRatio)) return { channel: CpapChannel.IERatio };
    if (startsWithAny(label, PREFIXES.inspiratoryTime)) return { channel: CpapChannel.InspiratoryTime };
    if (startsWithAny(label, PREFIXES.expiratoryTime)) return { channel: CpapChannel.ExpiratoryTime };
    if (startsWithAny(label, PREFIXES.targetMinuteVent)) return { channel: CpapChannel.TargetMinuteVent };
    return undefined;
  }

  if (type === "SAD" || type === "SA2") {
    if (startsWithAny(label, PREFIXES.pulse)) {
      return { channel: CpapChannel.Pulse, missingRawValue: -1 };
    }
    if (startsWithAny(label, PREFIXES.spo2)) {
      return { channel: CpapChannel.SpO2, missingRawValue: -1 };
    }
  }

  return undefined;
}

export type ResMedAnnotationKind = "oa" | "hypopnea" | "apnea" | "rera" | "central" | "recording-starts" | "unknown";

export function classifyResMedEventAnnotation(text: string): ResMedAnnotationKind {
  const normalized = text.trim().toLocaleLowerCase();
  if (normalized.startsWith("obstructive apnea")) return "oa";
  if (normalized.startsWith("hypopnea")) return "hypopnea";
  if (normalized === "apnea" || normalized.startsWith("apnea ")) return "apnea";
  if (normalized.startsWith("arousal") || normalized.startsWith("rera")) return "rera";
  if (normalized.startsWith("central apnea") || normalized.startsWith("clear airway")) return "central";
  if (normalized === "recording starts") return "recording-starts";
  return "unknown";
}
