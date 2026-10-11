import { Channel } from "./channels.js";

export const EVENT_PRESENTATION: Readonly<Record<number, { label: string; name: string; color: string }>> = Object.freeze({
  [Channel.ObstructiveApnea]: { label: "OA", name: "Obstructive apnea", color: "#8b5cf6" },
  [Channel.ClearAirway]: { label: "CA", name: "Clear airway", color: "#06b6d4" },
  [Channel.Hypopnea]: { label: "H", name: "Hypopnea", color: "#3b82f6" },
  [Channel.UnclassifiedApnea]: { label: "UA", name: "Unclassified apnea", color: "#64748b" },
  [Channel.RERA]: { label: "RERA", name: "RERA", color: "#f59e0b" },
  [Channel.CSR]: { label: "CSR", name: "Cheyne-Stokes respiration", color: "#10b981" },
});

export function therapyTime(ms: number, seconds = false): string {
  return new Date(ms).toISOString().slice(11, seconds ? 19 : 16);
}
