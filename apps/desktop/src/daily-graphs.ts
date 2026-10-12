import { CPAP_CHANNEL_DEFINITIONS } from "../../../src/core/cpap-channels.js";
import { Channel, EVENT_CHANNELS } from "./channels.js";
import type { GraphPreference } from "./types.js";

export type GraphGroup = "Standard" | "Respiratory" | "Oximetry";
export interface GraphDefinition {
  key: string; title: string; channelIds: readonly number[]; group: GraphGroup; defaultVisible: boolean;
  height?: number; zeroBaseline?: boolean; symmetric?: boolean; unitFallback?: string;
}
export const CHANNEL_METADATA = Object.fromEntries(CPAP_CHANNEL_DEFINITIONS.map(item => [item.id, { name: item.name, unit: item.unit.replace("cmH2O", "cmH₂O").replace("SpO2", "SpO₂") }]));
function graph(key: string, channelId: number, group: GraphGroup, defaultVisible = false, extra: Partial<GraphDefinition> = {}): GraphDefinition {
  const metadata = CHANNEL_METADATA[channelId]!;
  return { key, title: metadata.name, unitFallback: metadata.unit, channelIds: [channelId], group, defaultVisible, height: 165, ...extra };
}
export const DAILY_GRAPHS: readonly GraphDefinition[] = [
  { key: "events", title: "Event Flags", channelIds: EVENT_CHANNELS, group: "Standard", defaultVisible: true },
  graph("flow", Channel.FlowRate, "Standard", true, { height: 205, symmetric: true }),
  graph("pressure", Channel.Pressure, "Standard", true, { title: "Pressure", channelIds: [Channel.Pressure, Channel.MaskPressureHigh, Channel.IPAP, Channel.EPAP], zeroBaseline: true, height: 180 }),
  graph("leak", Channel.Leak, "Standard", true, { zeroBaseline: true }),
  graph("flow-limitation", Channel.FlowLimitation, "Standard", true),
  graph("snore", Channel.Snore, "Standard", true),
  graph("mask-pressure", Channel.MaskPressure, "Respiratory", false, { title: "Mask Pressure", channelIds: [Channel.MaskPressure, Channel.MaskPressureHigh] }),
  graph("ipap", Channel.IPAP, "Respiratory", false, { title: "IPAP" }),
  graph("epap", Channel.EPAP, "Respiratory", false, { title: "EPAP" }),
  graph("respiratory-rate", Channel.RespRate, "Respiratory"),
  graph("tidal-volume", Channel.TidalVolume, "Respiratory"),
  graph("minute-ventilation", Channel.MinuteVent, "Respiratory"),
  graph("inspiration-time", Channel.InspiratoryTime, "Respiratory"),
  graph("expiration-time", Channel.ExpiratoryTime, "Respiratory"),
  graph("ie-ratio", Channel.IERatio, "Respiratory"),
  graph("target-minute-ventilation", Channel.TargetMinuteVent, "Respiratory"),
  graph("spo2", Channel.SpO2, "Oximetry", true, { title: "SpO₂", height: 145 }),
  graph("pulse", Channel.Pulse, "Oximetry", true, { height: 145, zeroBaseline: true }),
];

export function availableDailyGraphs(channelIds: readonly number[]): GraphDefinition[] {
  const available = new Set(channelIds);
  return DAILY_GRAPHS.filter(graph => graph.channelIds.some(id => available.has(id)));
}
export function isGraphVisible(graph: GraphDefinition, preferences: readonly GraphPreference[]): boolean {
  return preferences.find(item => item.key === graph.key)?.visible ?? graph.defaultVisible;
}
export function selectedChartChannels(channelIds: readonly number[], preferences: readonly GraphPreference[]): number[] {
  const selected = new Set(availableDailyGraphs(channelIds).filter(graph => isGraphVisible(graph, preferences)).flatMap(graph => graph.channelIds));
  // Event payloads also drive the existing inspector's chronological events.
  EVENT_CHANNELS.forEach(id => selected.add(id));
  return [...new Set(channelIds)].filter(id => selected.has(id)).sort((a, b) => a - b);
}
export function graphPresetVisibility(preset: "Standard" | "Respiratory", available: readonly GraphDefinition[]): Record<string, boolean> {
  const keys = preset === "Standard" ? ["events", "flow", "pressure", "leak", "flow-limitation"]
    : ["events", "flow", available.some(graph => graph.key === "mask-pressure") ? "mask-pressure" : "pressure", "flow-limitation", "respiratory-rate", "tidal-volume", "minute-ventilation"];
  return Object.fromEntries(available.map(graph => [graph.key, keys.includes(graph.key)]));
}
