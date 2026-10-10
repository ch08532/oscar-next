import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CpapSetting } from "../src/core/cpap-settings.js";
import { CPAPMode } from "../src/core/types.js";
import { parseEdf } from "../src/importers/edf/edf-parser.js";
import type { EdfSignalDefinition } from "../src/importers/edf/edf-types.js";
import { ResMedLoader } from "../src/importers/resmed/resmed-loader.js";
import { mapResMedSessions } from "../src/importers/resmed/resmed-session-mapper.js";
import { mapResMedSignal } from "../src/importers/resmed/resmed-signals.js";
import { normalizeResMedMode, parseResMedStrEdf, resMedMode } from "../src/importers/resmed/resmed-str.js";
import { parseResMedIdentificationJson, readResMedIdentification } from "../src/importers/resmed/resmed-identification.js";
import { OscarDatabase } from "../src/storage/database.js";
import { OscarQueries } from "../src/storage/queries.js";
import { makeOrdinaryEdf } from "./helpers/edf-fixture.js";

function signal(label: string): EdfSignalDefinition {
  return { index: 0, label, transducerType: "", physicalDimension: "", physicalMinimum: 0, physicalMaximum: 1, digitalMinimum: 0, digitalMaximum: 1, prefiltering: "", samplesPerRecord: 1, reserved: "", gain: 1, offset: 0, sampleRateHz: 1, isAnnotation: false };
}

test("nested Identification.json extracts modern ResMed product identity and is preferred over tgt", async () => {
  const text = JSON.stringify({ FlowGenerator: { IdentificationProfiles: { Product: { SerialNumber: "SN11", ProductCode: "39000", ProductName: "AirSense_11_AutoSet" }, Device: { FirmwareVersion: "SX567-0401" } } } });
  const parsed = parseResMedIdentificationJson(text);
  assert.equal(parsed?.serial, "SN11");
  assert.equal(parsed?.modelNumber, "39000");
  assert.equal(parsed?.model, "AirSense 11 AutoSet");
  assert.equal(parsed?.series, "AirSense 11");
  assert.equal(parsed?.firmware, "SX567-0401");

  const root = await mkdtemp(join(tmpdir(), "oscar-next-id-json-"));
  try {
    await writeFile(join(root, "Identification.json"), text);
    await writeFile(join(root, "Identification.tgt"), "#SRN OLDSN\n#PNA AirSense_10_AutoSet\n#PCD 37028\n");
    const preferred = await readResMedIdentification(root);
    assert.equal(preferred?.serial, "SN11");
    assert.equal(preferred?.series, "AirSense 11");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AirSense/AirCurve 11 raw modes normalize before OSCAR mode classification", () => {
  assert.equal(normalizeResMedMode(1, true), 1);   // AutoSet
  assert.equal(normalizeResMedMode(2, true), 11);  // AutoSet for Her
  assert.equal(normalizeResMedMode(3, true), 0);   // CPAP
  assert.equal(normalizeResMedMode(6, true), 7);   // ASV
  assert.equal(normalizeResMedMode(7, true), 8);   // ASVAuto
  assert.equal(normalizeResMedMode(8, true), 6);   // VAuto
  assert.equal(resMedMode(9), CPAPMode.AVAPS);      // iVAPS/AVAPS family
  assert.equal(resMedMode(normalizeResMedMode(8, true)), CPAPMode.BiLevelAutoFixedPS);
});

test("AirSense 11 STR parsing uses normalized mode while preserving raw mode", () => {
  const edf = parseEdf(makeOrdinaryEdf(new Date(Date.UTC(2026, 9, 9, 12)), 86400, [
    { label: "Mask On", samples: [600], samplesPerRecord: 1 },
    { label: "Mask Off", samples: [660], samplesPerRecord: 1 },
    { label: "Mod", samples: [8], samplesPerRecord: 1 },
    { label: "S.VA.MinEPAP", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [50], samplesPerRecord: 1 },
    { label: "S.VA.MaxEPAP", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [100], samplesPerRecord: 1 },
    { label: "S.VA.PS", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [40], samplesPerRecord: 1 },
  ]));
  const day = parseResMedStrEdf(edf, { air11: true }).days[0];
  assert.equal(day?.settings.get(CpapSetting.ResMedRawMode), 8);
  assert.equal(day?.settings.get(CpapSetting.ResMedNormalizedMode), 6);
  assert.equal(day?.settings.get(CpapSetting.Mode), CPAPMode.BiLevelAutoFixedPS);
  assert.equal(day?.settings.get(CpapSetting.EPAPMin), 5);
  assert.equal(day?.settings.get(CpapSetting.EPAPMax), 10);
  assert.equal(day?.settings.get(CpapSetting.PressureSupport), 4);
});


test("legacy mode 9 parses iVAPS pressure support and derives IPAP limits", () => {
  const edf = parseEdf(makeOrdinaryEdf(new Date(Date.UTC(2026, 9, 9, 12)), 86400, [
    { label: "Mask On", samples: [600], samplesPerRecord: 1 },
    { label: "Mask Off", samples: [660], samplesPerRecord: 1 },
    { label: "Mode", samples: [9], samplesPerRecord: 1 },
    { label: "S.i.EPAP", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [60], samplesPerRecord: 1 },
    { label: "S.i.MinPS", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [30], samplesPerRecord: 1 },
    { label: "S.i.MaxPS", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [100], samplesPerRecord: 1 },
  ]));
  const day = parseResMedStrEdf(edf).days[0];
  assert.equal(day?.settings.get(CpapSetting.Mode), CPAPMode.AVAPS);
  assert.equal(day?.settings.get(CpapSetting.EPAP), 6);
  assert.equal(day?.settings.get(CpapSetting.PressureSupportMin), 3);
  assert.equal(day?.settings.get(CpapSetting.PressureSupportMax), 10);
  assert.equal(day?.settings.get(CpapSetting.IPAPMin), 9);
  assert.equal(day?.settings.get(CpapSetting.IPAPMax), 16);
});

test("newer ResMed signal aliases map to existing OSCAR Next channels", () => {
  assert.ok(mapResMedSignal("BRP", signal("TrigCycEvt.40ms")));
  assert.ok(mapResMedSignal("PLD", signal("S.S.IPAP")));
  assert.ok(mapResMedSignal("PLD", signal("S.S.EPAP")));
  assert.ok(mapResMedSignal("PLD", signal("Sızıntı")));
  assert.ok(mapResMedSignal("SA2", signal("Nabiz")));
});

test("STR-only night contributes summary AHI and event indices to Daily/Statistics", async () => {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-str-summary-"));
  const dbPath = join(root, "oscar.sqlite");
  try {
    await mkdir(join(root, "DATALOG"), { recursive: true });
    await writeFile(join(root, "Identification.tgt"), "#SRN SUMMARY11\n#PNA AirSense_11_AutoSet\n#PCD 39000\n");
    await writeFile(join(root, "STR.edf"), makeOrdinaryEdf(new Date(Date.UTC(2026, 9, 9, 12)), 86400, [
      { label: "Mask On", samples: [600], samplesPerRecord: 1 },
      { label: "Mask Off", samples: [960], samplesPerRecord: 1 },
      { label: "Mod", samples: [1], samplesPerRecord: 1 },
      { label: "AHI", dimension: "/h", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: [50], samplesPerRecord: 1 },
      { label: "OAI", dimension: "/h", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: [20], samplesPerRecord: 1 },
      { label: "CAI", dimension: "/h", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: [10], samplesPerRecord: 1 },
      { label: "HI", dimension: "/h", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: [20], samplesPerRecord: 1 },
      { label: "UAI", dimension: "/h", physicalMin: 0, physicalMax: 100, digitalMin: 0, digitalMax: 1000, samples: [0], samplesPerRecord: 1 },
      { label: "Leak 95", dimension: "L/min", samples: [18], samplesPerRecord: 1 },
    ]));

    const imported = await new ResMedLoader().open(root);
    const session = [...imported.machine.sessions.values()][0];
    assert.equal(session?.summaryOnly, true);
    assert.equal(session?.settings.get(CpapSetting.SummaryAHI), 5);
    const db = new OscarDatabase(dbPath); db.saveMachine(imported.machine); db.close();
    const q = new OscarQueries(dbPath);
    const daily = q.getDaily(imported.machine.id, "2026-10-09");
    assert.equal(daily.usageHours, 6);
    assert.equal(daily.ahi, 5);
    assert.equal(daily.rdi, 5);
    assert.equal(daily.eventIndices.obstructive, 2);
    assert.equal(daily.eventIndices.clearAirway, 1);
    assert.equal(daily.eventIndices.hypopnea, 2);
    assert.deepEqual(daily.eventCounts, { obstructive: 0, clearAirway: 0, hypopnea: 0, unclassified: 0, rera: 0 });
    const stats = q.getStatistics(imported.machine.id, "2026-10-09", "2026-10-09");
    assert.equal(stats.ahi, 5);
    assert.equal(stats.eventIndices.obstructive, 2);
    assert.equal(stats.settingsHistory[0]?.settings[CpapSetting.SummaryAHI], undefined, "nightly summary metrics must not fragment therapy settings history");
    q.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AEV files are parsed for diagnostics but not assigned invented clinical semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-aev-"));
  const path = join(root, "20261009_220000_AEV.edf");
  try {
    await writeFile(path, makeOrdinaryEdf(new Date(Date.UTC(2026, 9, 9, 22)), 2, [
      { label: "Unknown AEV", samples: [1, 2], samplesPerRecord: 2 },
    ]));
    const mapped = await mapResMedSessions([{ path, type: "AEV" }]);
    assert.equal(mapped.sessions.length, 0);
    assert.ok(mapped.warnings.some((warning) => warning.includes("AEV recognized; semantic mapping is not yet defined")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
