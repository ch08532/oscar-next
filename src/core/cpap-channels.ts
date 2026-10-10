import { ChannelDataType, ChannelScope, ChannelType, type ChannelDefinition } from "./channel.js";
import { MachineType } from "./types.js";

/**
 * Stable OSCAR Next channel IDs. These are intentionally independent of the
 * legacy OSCAR runtime-assigned ChannelID values so persisted Node data remains
 * stable across releases.
 */
export enum CpapChannel {
  FlowRate = 100,
  MaskPressureHigh = 101,
  RespEvent = 102,
  MaskPressure = 103,
  Pressure = 104,
  IPAP = 105,
  EPAP = 106,
  Leak = 107,
  RespRate = 108,
  MinuteVent = 109,
  TidalVolume = 110,
  Snore = 111,
  FlowLimitation = 112,
  IERatio = 113,
  InspiratoryTime = 114,
  ExpiratoryTime = 115,
  TargetMinuteVent = 116,

  Pulse = 200,
  SpO2 = 201,

  ObstructiveApnea = 300,
  Hypopnea = 301,
  UnclassifiedApnea = 302,
  RERA = 303,
  ClearAirway = 304,
  CSR = 305,
}

function channel(
  id: CpapChannel,
  type: ChannelType,
  code: string,
  name: string,
  unit: string,
  description = name,
): ChannelDefinition {
  return {
    id,
    type,
    machineType: MachineType.CPAP,
    scope: ChannelScope.Session,
    code,
    name,
    description,
    label: name,
    unit,
    dataType: ChannelDataType.Double,
    enabled: true,
  };
}

export const CPAP_CHANNEL_DEFINITIONS: readonly ChannelDefinition[] = Object.freeze([
  channel(CpapChannel.FlowRate, ChannelType.Waveform, "CPAP_FlowRate", "Flow Rate", "L/min"),
  channel(CpapChannel.MaskPressureHigh, ChannelType.Waveform, "CPAP_MaskPressureHi", "Mask Pressure (High Rate)", "cmH2O"),
  channel(CpapChannel.RespEvent, ChannelType.Waveform, "CPAP_RespEvent", "Respiratory Event Signal", ""),
  channel(CpapChannel.MaskPressure, ChannelType.Data, "CPAP_MaskPressure", "Mask Pressure", "cmH2O"),
  channel(CpapChannel.Pressure, ChannelType.Data, "CPAP_Pressure", "Therapy Pressure", "cmH2O"),
  channel(CpapChannel.IPAP, ChannelType.Data, "CPAP_IPAP", "Inspiratory Pressure", "cmH2O"),
  channel(CpapChannel.EPAP, ChannelType.Data, "CPAP_EPAP", "Expiratory Pressure", "cmH2O"),
  channel(CpapChannel.Leak, ChannelType.Data, "CPAP_Leak", "Leak Rate", "L/min"),
  channel(CpapChannel.RespRate, ChannelType.Data, "CPAP_RespRate", "Respiratory Rate", "breaths/min"),
  channel(CpapChannel.MinuteVent, ChannelType.Data, "CPAP_MinuteVent", "Minute Ventilation", "L/min"),
  channel(CpapChannel.TidalVolume, ChannelType.Data, "CPAP_TidalVolume", "Tidal Volume", "mL"),
  channel(CpapChannel.Snore, ChannelType.Data, "CPAP_Snore", "Snore", ""),
  channel(CpapChannel.FlowLimitation, ChannelType.Data, "CPAP_FlowLimitation", "Flow Limitation", ""),
  channel(CpapChannel.IERatio, ChannelType.Data, "CPAP_IERatio", "I:E Ratio", ""),
  channel(CpapChannel.InspiratoryTime, ChannelType.Data, "CPAP_Ti", "Inspiratory Time", "s"),
  channel(CpapChannel.ExpiratoryTime, ChannelType.Data, "CPAP_Te", "Expiratory Time", "s"),
  channel(CpapChannel.TargetMinuteVent, ChannelType.Data, "CPAP_TargetMinuteVent", "Target Minute Ventilation", "L/min"),
  channel(CpapChannel.Pulse, ChannelType.Data, "OXI_Pulse", "Pulse", "bpm"),
  channel(CpapChannel.SpO2, ChannelType.Data, "OXI_SpO2", "SpO2", "%"),
  channel(CpapChannel.ObstructiveApnea, ChannelType.Flag, "CPAP_Obstructive", "Obstructive Apnea", "s"),
  channel(CpapChannel.Hypopnea, ChannelType.Flag, "CPAP_Hypopnea", "Hypopnea", "s"),
  channel(CpapChannel.UnclassifiedApnea, ChannelType.Flag, "CPAP_Apnea", "Unclassified Apnea", "s"),
  channel(CpapChannel.RERA, ChannelType.Flag, "CPAP_RERA", "RERA/Arousal", "s"),
  channel(CpapChannel.ClearAirway, ChannelType.Flag, "CPAP_ClearAirway", "Clear Airway/Central Apnea", "s"),
  channel(CpapChannel.CSR, ChannelType.Span, "CPAP_CSR", "Cheyne-Stokes Respiration", "s"),
]);

export const CPAP_RESPIRATORY_EVENT_CHANNELS = Object.freeze({
  hypopnea: CpapChannel.Hypopnea,
  obstructive: CpapChannel.ObstructiveApnea,
  apnea: CpapChannel.UnclassifiedApnea,
  clearAirway: CpapChannel.ClearAirway,
  rera: CpapChannel.RERA,
});
