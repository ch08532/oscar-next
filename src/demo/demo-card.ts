import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { makeDemoAnnotationEdf, makeDemoEdf, type DemoSignal } from "./edf-writer.js";

export interface DemoCardOptions {
  days?: number;
  startDate?: string;
  overwrite?: boolean;
}

export interface DemoCardResult {
  rootPath: string;
  days: number;
  firstTherapyDate: string;
  lastTherapyDate: string;
  serial: string;
  model: string;
}

const DAY_MS = 86_400_000;

function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");
}
function isoDate(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
function addDays(date: string, offset: number): number {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid demo start date: ${date}`);
  return Date.UTC(year, month - 1, day + offset, 12, 0, 0);
}
function repeat(value: number, count: number): number[] { return Array.from({ length: count }, () => value); }
function wave(count: number, amplitude: number, bias = 0, cycles = 8): number[] {
  return Array.from({ length: count }, (_, index) => Math.round(bias + Math.sin(index / count * Math.PI * 2 * cycles) * amplitude));
}

export async function createDemoResMedCard(rawRootPath: string, options: DemoCardOptions = {}): Promise<DemoCardResult> {
  const rootPath = resolve(rawRootPath);
  const days = Math.max(3, Math.min(30, Math.floor(options.days ?? 14)));
  const startDate = options.startDate ?? "2026-09-26";
  if (options.overwrite !== false) await rm(rootPath, { recursive: true, force: true });
  await mkdir(join(rootPath, "DATALOG"), { recursive: true });

  const serial = "DEMO0000001";
  const model = "AirSense 11 AutoSet (Demo)";
  await writeFile(join(rootPath, "Identification.json"), JSON.stringify({
    FlowGenerator: { IdentificationProfiles: { Product: { SerialNumber: serial, ProductName: model, ProductCode: "DEMO11" }, Device: { FirmwareVersion: "DEMO-2.0" } } },
  }, null, 2));
  await writeFile(join(rootPath, "DEMO-DATA.txt"), "OSCAR Next 2.3 synthetic ResMed test card\n\nThis folder contains generated test data only. It does not contain real patient or device information.\nUse it to exercise OSCAR Next import, Daily, Overview, Statistics, graphs, and reports.\n");

  const strStart = new Date(addDays(startDate, 0));
  const maskOn: number[] = [], maskOff: number[] = [], modes: number[] = [], minPressure: number[] = [], maxPressure: number[] = [];
  const eprEnable: number[] = [], eprLevel: number[] = [], ahi: number[] = [], oai: number[] = [], cai: number[] = [], hi: number[] = [];
  const leakMedian: number[] = [], leak95: number[] = [], leakMax: number[] = [], durationHours: number[] = [];
  for (let day = 0; day < days; day += 1) {
    maskOn.push(600 + (day % 3) * 5); // 22:00-ish
    maskOff.push(1095 + (day % 4) * 7); // 06:15-ish
    modes.push(1); // Air11 raw AutoSet -> normalized APAP
    minPressure.push(60); maxPressure.push(day < Math.floor(days / 2) ? 120 : 140);
    eprEnable.push(2); eprLevel.push(3);
    const dailyAhi = 1.2 + (day % 5) * 0.55;
    ahi.push(Math.round(dailyAhi * 10));
    oai.push(Math.round((0.35 + (day % 3) * 0.16) * 10));
    cai.push(Math.round((0.20 + (day % 2) * 0.14) * 10));
    hi.push(Math.max(0, ahi[day]! - oai[day]! - cai[day]!));
    leakMedian.push(45 + day); leak95.push(90 + day * 2); leakMax.push(150 + day * 2);
    durationHours.push(80 + (day % 4) * 3);
  }
  const signals: DemoSignal[] = [
    { label: "Mask On", dimension: "min", samples: maskOn, samplesPerRecord: 1 },
    { label: "Mask Off", dimension: "min", samples: maskOff, samplesPerRecord: 1 },
    { label: "Mode", samples: modes, samplesPerRecord: 1 },
    { label: "S.AS.MinPress", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: minPressure, samplesPerRecord: 1 },
    { label: "S.AS.MaxPress", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: maxPressure, samplesPerRecord: 1 },
    { label: "S.EPR.EPREnable", samples: eprEnable, samplesPerRecord: 1 },
    { label: "S.EPR.ClinEnable", samples: eprEnable, samplesPerRecord: 1 },
    { label: "S.EPR.Level", samples: eprLevel, samplesPerRecord: 1 },
    { label: "Mask Dur", dimension: "h", physicalMin: 0, physicalMax: 24, digitalMin: 0, digitalMax: 240, samples: durationHours, samplesPerRecord: 1 },
    { label: "AHI", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: ahi, samplesPerRecord: 1 },
    { label: "OAI", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: oai, samplesPerRecord: 1 },
    { label: "CAI", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: cai, samplesPerRecord: 1 },
    { label: "HI", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: hi, samplesPerRecord: 1 },
    { label: "Leak Med", dimension: "L/min", physicalMin: 0, physicalMax: 120, digitalMin: 0, digitalMax: 1200, samples: leakMedian, samplesPerRecord: 1 },
    { label: "Leak 95", dimension: "L/min", physicalMin: 0, physicalMax: 120, digitalMin: 0, digitalMax: 1200, samples: leak95, samplesPerRecord: 1 },
    { label: "Leak Max", dimension: "L/min", physicalMin: 0, physicalMax: 120, digitalMin: 0, digitalMax: 1200, samples: leakMax, samplesPerRecord: 1 },
  ];
  await writeFile(join(rootPath, "STR.edf"), makeDemoEdf(strStart, 86_400, days, signals));

  // Detailed signals for the most recent three nights exercise Daily charts while
  // older nights remain useful for Overview/Statistics through STR summaries.
  for (let offset = Math.max(0, days - 3); offset < days; offset += 1) {
    const noonMs = addDays(startDate, offset);
    const startMs = noonMs + maskOn[offset]! * 60_000;
    const start = new Date(startMs);
    const folder = join(rootPath, "DATALOG", dateKey(noonMs));
    await mkdir(folder, { recursive: true });
    const fileStamp = `${dateKey(startMs)}_${String(start.getUTCHours()).padStart(2, "0")}${String(start.getUTCMinutes()).padStart(2, "0")}${String(start.getUTCSeconds()).padStart(2, "0")}`;

    const seconds = 120;
    const flowSamples = seconds * 25;
    const flow = wave(flowSamples, 35 + offset, 0, 30);
    // Include a narrow, visible excursion for graph/decimation verification.
    flow[Math.floor(flow.length * 0.58)] = 95;
    const maskPressure = wave(flowSamples, 8, 105 + offset, 5);
    await writeFile(join(folder, `${fileStamp}_BRP.edf`), makeDemoEdf(start, seconds, 1, [
      { label: "Flow.40ms", dimension: "L/s", physicalMin: -2, physicalMax: 2, digitalMin: -200, digitalMax: 200, samples: flow, samplesPerRecord: flowSamples },
      { label: "Press.40ms", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: maskPressure, samplesPerRecord: flowSamples },
    ]));

    const pldPoints = 60;
    await writeFile(join(folder, `${fileStamp}_PLD.edf`), makeDemoEdf(start, seconds, 1, [
      { label: "Press.2s", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: wave(pldPoints, 10, 100 + offset, 3), samplesPerRecord: pldPoints },
      { label: "Leak.2s", dimension: "L/s", physicalMin: 0, physicalMax: 2, digitalMin: 0, digitalMax: 200, samples: wave(pldPoints, 2, 3 + offset / 4, 4), samplesPerRecord: pldPoints },
      { label: "RespRate.2s", dimension: "bpm", samples: wave(pldPoints, 2, 15, 4), samplesPerRecord: pldPoints },
      { label: "TidVol.2s", dimension: "L", physicalMin: 0, physicalMax: 1, digitalMin: 0, digitalMax: 1000, samples: wave(pldPoints, 50, 520, 4), samplesPerRecord: pldPoints },
    ]));

    const oxPoints = 120;
    await writeFile(join(folder, `${fileStamp}_SA2.edf`), makeDemoEdf(start, seconds, 1, [
      { label: "Pulse.1s", dimension: "bpm", samples: wave(oxPoints, 5, 64 + offset, 5), samplesPerRecord: oxPoints },
      { label: "SpO2.1s", dimension: "%", samples: [...repeat(96, oxPoints - 4), 94, 93, 94, 95], samplesPerRecord: oxPoints },
    ]));

    const tal = `+0\u0014\u0014recording starts\u0014\0+20\u001510\u0014Obstructive apnea\u0014\0+52\u001510\u0014Hypopnea\u0014\0+88\u001510\u0014Central apnea\u0014\0`;
    await writeFile(join(folder, `${fileStamp}_EVE.edf`), makeDemoAnnotationEdf(start, seconds, tal));
  }

  return {
    rootPath, days, firstTherapyDate: isoDate(addDays(startDate, 0)), lastTherapyDate: isoDate(addDays(startDate, days - 1)), serial, model,
  };
}
