import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CpapChannel } from "../src/core/cpap-channels.js";
import { CpapSetting } from "../src/core/cpap-settings.js";
import { CPAPMode } from "../src/core/types.js";
import { parseEdf } from "../src/importers/edf/edf-parser.js";
import { ResMedLoader } from "../src/importers/resmed/resmed-loader.js";
import { parseResMedStrEdf, sessionsFromStr } from "../src/importers/resmed/resmed-str.js";
import { makeMultiRecordEdf, makeOrdinaryEdf } from "./helpers/edf-fixture.js";

function makeStrFixture(): Uint8Array {
  const noon = new Date(Date.UTC(2026, 9, 9, 12, 0, 0));
  return makeOrdinaryEdf(noon, 86400, [
    // Two mask-on windows: 22:15-22:30 and 22:50-23:00.
    { label: "Mask On", samples: [615, 650], samplesPerRecord: 2 },
    { label: "Mask Off", samples: [630, 660], samplesPerRecord: 2 },
    { label: "Mode", samples: [1], samplesPerRecord: 1 },
    { label: "S.AS.MinPress", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [60], samplesPerRecord: 1 },
    { label: "S.AS.MaxPress", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [140], samplesPerRecord: 1 },
    { label: "S.EPR.EPRType", samples: [1], samplesPerRecord: 1 },
    { label: "S.EPR.Level", samples: [3], samplesPerRecord: 1 },
    { label: "S.EPR.EPREnable", samples: [1], samplesPerRecord: 1 },
    { label: "S.EPR.ClinEnable", samples: [1], samplesPerRecord: 1 },
    { label: "S.RampEnable", samples: [1], samplesPerRecord: 1 },
    { label: "S.RampTime", dimension: "min", samples: [20], samplesPerRecord: 1 },
    { label: "S.AS.StartPress", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [40], samplesPerRecord: 1 },
    { label: "S.SmartStart", samples: [1], samplesPerRecord: 1 },
  ]);
}

test("STR parser creates noon-based mask windows and APAP/EPR/ramp settings", () => {
  const str = parseResMedStrEdf(parseEdf(makeStrFixture()));
  assert.equal(str.days.length, 1);
  const day = str.days[0];
  if (!day) throw new Error("Expected STR day");
  assert.equal(day.windows.length, 2);
  assert.equal(new Date(day.windows[0]!.startMs).toISOString(), "2026-10-09T22:15:00.000Z");
  assert.equal(new Date(day.windows[0]!.endMs).toISOString(), "2026-10-09T22:30:00.000Z");
  assert.equal(day.settings.get(CpapSetting.Mode), CPAPMode.APAP);
  assert.equal(day.settings.get(CpapSetting.ResMedRawMode), 1);
  assert.equal(day.settings.get(CpapSetting.PressureMin), 6);
  assert.equal(day.settings.get(CpapSetting.PressureMax), 14);
  assert.equal(day.settings.get(CpapSetting.EPRMode), 2); // EPRType is 0-based in AirSense STR.
  assert.equal(day.settings.get(CpapSetting.EPRLevel), 3);
  assert.equal(day.settings.get(CpapSetting.RampEnabled), true);
  assert.equal(day.settings.get(CpapSetting.RampTimeMinutes), 20);
  assert.equal(day.settings.get(CpapSetting.RampPressure), 4);
  assert.equal(day.settings.get(CpapSetting.SmartStart), 1);

  const sessions = sessionsFromStr(str.days);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.hours(), 0.25);
  assert.equal(sessions[1]?.hours(), 1 / 6);
  assert.equal(sessions[0]?.settings.get(CpapSetting.PressureMax), 14);
});

test("STR mask windows remain authoritative while detailed EDF files attach by overlap", async () => {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-str-map-"));
  const dayDir = join(root, "DATALOG", "20261009");
  await mkdir(dayDir, { recursive: true });
  await writeFile(join(root, "Identification.tgt"), "#SRN 12345678901\n#PNA AirSense_11_AutoSet\n#PCD 39000\n");
  await writeFile(join(root, "STR.edf"), makeStrFixture());

  // Detailed data occupies only two seconds inside the second 10-minute mask window.
  const dataStart = new Date(Date.UTC(2026, 9, 9, 22, 50, 30));
  await writeFile(join(dayDir, "20261009_225030_BRP.edf"), makeOrdinaryEdf(dataStart, 2, [
    { label: "Flow.40ms", dimension: "L/s", physicalMin: -10, physicalMax: 10, digitalMin: -100, digitalMax: 100, samples: [-10, 0, 10, 20], samplesPerRecord: 4 },
  ]));

  try {
    const result = await new ResMedLoader().open(root);
    const sessions = [...result.machine.sessions.values()].sort((a, b) => a.first - b.first);
    assert.equal(sessions.length, 2);
    assert.equal(new Date(sessions[0]!.first).toISOString(), "2026-10-09T22:15:00.000Z");
    assert.equal(new Date(sessions[0]!.last).toISOString(), "2026-10-09T22:30:00.000Z");
    assert.equal(sessions[0]!.summaryOnly, true);

    assert.equal(new Date(sessions[1]!.first).toISOString(), "2026-10-09T22:50:00.000Z");
    assert.equal(new Date(sessions[1]!.last).toISOString(), "2026-10-09T23:00:00.000Z");
    assert.equal(sessions[1]!.summaryOnly, false);
    assert.equal(sessions[1]!.count(CpapChannel.FlowRate), 4);
    assert.equal(sessions[1]!.settings.get(CpapSetting.Mode), CPAPMode.APAP);
    assert.equal(sessions[1]!.settings.get(CpapSetting.PressureMin), 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("STR parser indexes multiple daily records independently", () => {
  const start = new Date(Date.UTC(2026, 9, 9, 12, 0, 0));
  const edf = makeMultiRecordEdf(start, 86400, 2, [
    { label: "Mask On", samples: [600, 660], samplesPerRecord: 1 },
    { label: "Mask Off", samples: [630, 720], samplesPerRecord: 1 },
    { label: "Mode", samples: [0, 1], samplesPerRecord: 1 },
    { label: "S.C.Press", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [100, 0], samplesPerRecord: 1 },
    { label: "S.AS.MinPress", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [0, 70], samplesPerRecord: 1 },
    { label: "S.AS.MaxPress", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [0, 150], samplesPerRecord: 1 },
  ]);
  const parsed = parseResMedStrEdf(parseEdf(edf));
  assert.equal(parsed.days.length, 2);
  assert.equal(new Date(parsed.days[0]!.windows[0]!.startMs).toISOString(), "2026-10-09T22:00:00.000Z");
  assert.equal(new Date(parsed.days[1]!.windows[0]!.startMs).toISOString(), "2026-10-10T23:00:00.000Z");
  assert.equal(parsed.days[0]!.settings.get(CpapSetting.Mode), CPAPMode.CPAP);
  assert.equal(parsed.days[0]!.settings.get(CpapSetting.SetPressure), 10);
  assert.equal(parsed.days[1]!.settings.get(CpapSetting.Mode), CPAPMode.APAP);
  assert.equal(parsed.days[1]!.settings.get(CpapSetting.PressureMin), 7);
  assert.equal(parsed.days[1]!.settings.get(CpapSetting.PressureMax), 15);
});
