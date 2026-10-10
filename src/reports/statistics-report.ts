import { CPAP_SETTING_NAMES, CpapSetting } from "../core/cpap-settings.js";
import { CPAPMode, type SettingValue } from "../core/types.js";
import type { StoredMachineSummary } from "../storage/database.js";
import type { StatisticsSummary } from "../storage/queries.js";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(...values: unknown[]): string {
  return values.map(csvCell).join(",");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const MODE_NAMES: Readonly<Record<number, string>> = Object.freeze({
  [CPAPMode.Unknown]: "Unknown",
  [CPAPMode.CPAP]: "CPAP",
  [CPAPMode.APAP]: "APAP",
  [CPAPMode.BiLevelFixed]: "BiLevel Fixed",
  [CPAPMode.BiLevelAutoFixedPS]: "BiLevel Auto (Fixed PS)",
  [CPAPMode.BiLevelAutoVariablePS]: "BiLevel Auto (Variable PS)",
  [CPAPMode.ASV]: "ASV",
  [CPAPMode.ASVVariableEPAP]: "ASV (Variable EPAP)",
  [CPAPMode.AVAPS]: "AVAPS",
});

export function formatSettingValue(settingId: number, value: SettingValue): string {
  if (value === null) return "—";
  if (value instanceof Date) return value.toISOString();
  if (settingId === CpapSetting.Mode && typeof value === "number") return MODE_NAMES[value] ?? String(value);
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") {
    const pressureSettings = new Set<number>([
      CpapSetting.SetPressure, CpapSetting.PressureMin, CpapSetting.PressureMax,
      CpapSetting.EPAP, CpapSetting.IPAP, CpapSetting.EPAPMin, CpapSetting.EPAPMax,
      CpapSetting.IPAPMin, CpapSetting.IPAPMax, CpapSetting.PressureSupport,
      CpapSetting.PressureSupportMin, CpapSetting.PressureSupportMax, CpapSetting.RampPressure,
    ]);
    if (pressureSettings.has(settingId)) return `${value.toFixed(1)} cmH2O`;
    if (settingId === CpapSetting.RampTimeMinutes) return `${value} min`;
    if (settingId === CpapSetting.TemperatureC) return `${value} °C`;
  }
  return String(value);
}

export function settingName(settingId: number): string {
  return (CPAP_SETTING_NAMES as Readonly<Record<number, string>>)[settingId] ?? `Setting ${settingId}`;
}

export function statisticsToCsv(machine: StoredMachineSummary, stats: StatisticsSummary): string {
  const lines: string[] = [];
  lines.push(row("OSCAR Next Therapy Statistics"));
  lines.push(row("Machine", `${machine.brand} ${machine.model}`.trim()));
  lines.push(row("Serial", machine.serial));
  lines.push(row("Start date", stats.startDate));
  lines.push(row("End date", stats.endDate));
  lines.push("");
  lines.push(row("Metric", "Value"));
  lines.push(row("Days in range", stats.totalDays));
  lines.push(row("Days used", stats.usedDays));
  lines.push(row("Days >= 4 hours", stats.compliantDays));
  lines.push(row("Total usage hours", stats.totalUsageHours.toFixed(2)));
  lines.push(row("Average usage hours", stats.averageUsageHours.toFixed(2)));
  lines.push(row("Median usage hours", stats.medianUsageHours.toFixed(2)));
  lines.push(row("AHI", stats.ahi.toFixed(3)));
  lines.push(row("RDI", stats.rdi.toFixed(3)));
  lines.push(row("OA index", stats.eventIndices.obstructive.toFixed(3)));
  lines.push(row("CA index", stats.eventIndices.clearAirway.toFixed(3)));
  lines.push(row("Hypopnea index", stats.eventIndices.hypopnea.toFixed(3)));
  lines.push(row("UA index", stats.eventIndices.unclassified.toFixed(3)));
  lines.push(row("RERA index", stats.eventIndices.rera.toFixed(3)));
  if (stats.pressure) {
    lines.push(row("Pressure median", stats.pressure.percentile50.toFixed(2)));
    lines.push(row("Pressure 95%", stats.pressure.percentile95.toFixed(2)));
    lines.push(row("Pressure max", stats.pressure.max.toFixed(2)));
  }
  if (stats.leak) {
    lines.push(row("Leak median", stats.leak.percentile50.toFixed(2)));
    lines.push(row("Leak 95%", stats.leak.percentile95.toFixed(2)));
    lines.push(row("Leak max", stats.leak.max.toFixed(2)));
  }

  lines.push("");
  lines.push(row("Daily therapy"));
  lines.push(row("Date", "Sessions", "Usage hours", "AHI", "RDI", "OA", "CA", "H", "UA", "RERA", "Pressure avg", "Pressure 95%", "Leak avg", "Leak 95%"));
  for (const day of stats.days) {
    lines.push(row(
      day.date, day.sessionCount, day.usageHours.toFixed(2), day.ahi.toFixed(3), day.rdi.toFixed(3),
      day.obstructive, day.clearAirway, day.hypopnea, day.unclassified, day.rera,
      day.pressureAverage?.toFixed(2), day.pressure95?.toFixed(2), day.leakAverage?.toFixed(2), day.leak95?.toFixed(2),
    ));
  }

  lines.push("");
  lines.push(row("Therapy settings history"));
  lines.push(row("Start date", "End date", "Sessions", "Setting", "Value"));
  for (const period of stats.settingsHistory) {
    const entries = Object.entries(period.settings).sort(([a], [b]) => Number(a) - Number(b));
    if (entries.length === 0) lines.push(row(period.startDate, period.endDate, period.sessionCount, "", ""));
    for (const [id, value] of entries) {
      const settingId = Number(id);
      lines.push(row(period.startDate, period.endDate, period.sessionCount, settingName(settingId), formatSettingValue(settingId, value)));
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function statisticsToHtml(machine: StoredMachineSummary, stats: StatisticsSummary): string {
  const settingRows = stats.settingsHistory.flatMap((period) => {
    const entries = Object.entries(period.settings).sort(([a], [b]) => Number(a) - Number(b));
    if (entries.length === 0) return [`<tr><td>${escapeHtml(period.startDate)}</td><td>${escapeHtml(period.endDate)}</td><td>${period.sessionCount}</td><td colspan="2">No stored settings</td></tr>`];
    return entries.map(([id, value], index) => {
      const settingId = Number(id);
      return `<tr><td>${index === 0 ? escapeHtml(period.startDate) : ""}</td><td>${index === 0 ? escapeHtml(period.endDate) : ""}</td><td>${index === 0 ? period.sessionCount : ""}</td><td>${escapeHtml(settingName(settingId))}</td><td>${escapeHtml(formatSettingValue(settingId, value))}</td></tr>`;
    });
  }).join("");

  const dailyRows = stats.days.map((day) => `<tr><td>${escapeHtml(day.date)}</td><td>${day.usageHours.toFixed(2)}</td><td>${day.ahi.toFixed(2)}</td><td>${day.rdi.toFixed(2)}</td><td>${day.obstructive}</td><td>${day.clearAirway}</td><td>${day.hypopnea}</td><td>${day.rera}</td><td>${day.pressure95?.toFixed(1) ?? "—"}</td><td>${day.leak95?.toFixed(1) ?? "—"}</td></tr>`).join("");

  const statCell = (label: string, value: string) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>OSCAR Next Statistics ${escapeHtml(stats.startDate)} to ${escapeHtml(stats.endDate)}</title><style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; } body { font: 12px system-ui, -apple-system, Segoe UI, sans-serif; color: #17212b; margin: 0; }
  header { border-bottom: 3px solid #17324d; padding-bottom: 10px; margin-bottom: 14px; } h1 { margin: 0; font-size: 24px; color: #17324d; } h2 { margin: 20px 0 8px; font-size: 15px; color: #17324d; }
  .meta { margin-top: 4px; color: #52677b; }.metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 7px; }.metric { border: 1px solid #d7e0e8; border-radius: 6px; padding: 8px; }.metric span { display:block; color:#617589; font-size:9px; text-transform:uppercase; }.metric strong { font-size:16px; }
  table { width:100%; border-collapse:collapse; font-size:10px; } th, td { border-bottom:1px solid #e3e9ee; padding:5px 4px; text-align:left; vertical-align:top; } th { background:#f3f6f8; color:#52677b; font-size:9px; text-transform:uppercase; } tr { break-inside: avoid; }
  .foot { margin-top:18px; color:#718294; font-size:9px; } </style></head><body>
  <header><h1>OSCAR Next Therapy Statistics</h1><div class="meta">${escapeHtml(`${machine.brand} ${machine.model}`.trim())}${machine.serial ? ` · Serial ${escapeHtml(machine.serial)}` : ""} · ${escapeHtml(stats.startDate)} through ${escapeHtml(stats.endDate)}</div></header>
  <div class="metrics">
    ${statCell("Days used", `${stats.usedDays} / ${stats.totalDays}`)}
    ${statCell("Days ≥ 4 h", String(stats.compliantDays))}
    ${statCell("Average usage", `${stats.averageUsageHours.toFixed(2)} h`)}
    ${statCell("Median usage", `${stats.medianUsageHours.toFixed(2)} h`)}
    ${statCell("AHI", stats.ahi.toFixed(2))}
    ${statCell("RDI", stats.rdi.toFixed(2))}
    ${statCell("Pressure 95%", stats.pressure ? `${stats.pressure.percentile95.toFixed(1)} cmH2O` : "—")}
    ${statCell("Leak 95%", stats.leak ? `${stats.leak.percentile95.toFixed(1)} L/min` : "—")}
  </div>
  <h2>Event indices</h2><table><thead><tr><th>OA</th><th>CA</th><th>Hypopnea</th><th>UA</th><th>RERA</th><th>Total AHI</th><th>RDI</th></tr></thead><tbody><tr><td>${stats.eventIndices.obstructive.toFixed(2)}</td><td>${stats.eventIndices.clearAirway.toFixed(2)}</td><td>${stats.eventIndices.hypopnea.toFixed(2)}</td><td>${stats.eventIndices.unclassified.toFixed(2)}</td><td>${stats.eventIndices.rera.toFixed(2)}</td><td>${stats.ahi.toFixed(2)}</td><td>${stats.rdi.toFixed(2)}</td></tr></tbody></table>
  <h2>Daily therapy</h2><table><thead><tr><th>Date</th><th>Hours</th><th>AHI</th><th>RDI</th><th>OA</th><th>CA</th><th>H</th><th>RERA</th><th>P95</th><th>L95</th></tr></thead><tbody>${dailyRows}</tbody></table>
  <h2>Therapy settings history</h2><table><thead><tr><th>Start</th><th>End</th><th>Sessions</th><th>Setting</th><th>Value</th></tr></thead><tbody>${settingRows}</tbody></table>
  <div class="foot">Generated by OSCAR Next. Statistics are calculated from the selected database and therapy-day range.</div>
  </body></html>`;
}
