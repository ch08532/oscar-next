import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CpapChannel } from "../src/core/cpap-channels.js";
import { ResMedLoader } from "../src/importers/resmed/resmed-loader.js";
import { makeAnnotationEdf, makeOrdinaryEdf } from "./helpers/edf-fixture.js";

async function makeSyntheticCard(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-resmed-"));
  const day = join(root, "DATALOG", "20261009");
  await mkdir(day, { recursive: true });
  await writeFile(join(root, "Identification.tgt"), "#SRN 12345678901\n#PNA AirSense_11_AutoSet\n#PCD 39000\n");

  const start = new Date(Date.UTC(2026, 9, 9, 22, 15, 30));
  await writeFile(join(root, "STR.edf"), makeOrdinaryEdf(new Date(Date.UTC(2026, 9, 9, 12, 0, 0)), 86400, [
    { label: "Mask Dur", dimension: "h", samples: [1], samplesPerRecord: 1 },
  ]));
  await writeFile(join(day, "20261009_221530_BRP.edf"), makeOrdinaryEdf(start, 2, [
    { label: "Flow.40ms", dimension: "L/s", physicalMin: -10, physicalMax: 10, digitalMin: -100, digitalMax: 100, samples: [-10, 0, 10, 20], samplesPerRecord: 4 },
    { label: "Press.40ms", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [100, 110, 120, 130], samplesPerRecord: 4 },
  ]));

  await writeFile(join(day, "20261009_221530_PLD.edf"), makeOrdinaryEdf(start, 2, [
    { label: "Press.2s", dimension: "cmH2O", physicalMin: 0, physicalMax: 30, digitalMin: 0, digitalMax: 300, samples: [100, 120], samplesPerRecord: 2 },
    { label: "Leak.2s", dimension: "L/s", physicalMin: 0, physicalMax: 10, digitalMin: 0, digitalMax: 100, samples: [1, 2], samplesPerRecord: 2 },
    { label: "RespRate.2s", dimension: "bpm", samples: [14, 15], samplesPerRecord: 2 },
    { label: "TidVol.2s", dimension: "L", physicalMin: 0, physicalMax: 1, digitalMin: 0, digitalMax: 1000, samples: [500, 600], samplesPerRecord: 2 },
  ]));

  await writeFile(join(day, "20261009_221530_SA2.edf"), makeOrdinaryEdf(start, 2, [
    { label: "Pulse.1s", dimension: "bpm", samples: [65, 66], samplesPerRecord: 2 },
    { label: "SpO2.1s", dimension: "%", samples: [96, 95], samplesPerRecord: 2 },
  ]));

  const eveTal = "+0\u0014\u0014recording starts\u0014\0+0.5\u00150.8\u0014Obstructive apnea\u0014\0+1.0\u00150.6\u0014Hypopnea\u0014\0+1.5\u00150.7\u0014Central apnea\u0014\0";
  await writeFile(join(day, "20261009_221529_EVE.edf"), makeAnnotationEdf(start, 2, eveTal));

  const cslTal = "+0.25\u0014CSR start\u0014\0+1.75\u0014CSR end\u0014\0";
  await writeFile(join(day, "20261009_221529_CSL.edf"), makeAnnotationEdf(start, 2, cslTal));
  return root;
}

test("ResMed loader maps BRP, PLD, SA2, EVE, and CSL into one session", async () => {
  const root = await makeSyntheticCard();
  try {
    const result = await new ResMedLoader().open(root);
    assert.equal(result.sessionsImported, 1);
    assert.equal(result.machine.info.model, "AirSense 11 AutoSet");
    const session = [...result.machine.sessions.values()][0];
    if (!session) throw new Error("Expected imported session");

    assert.equal(session.lengthMs, 2000);
    assert.equal(session.count(CpapChannel.FlowRate), 4);
    assert.equal(session.count(CpapChannel.Pressure), 2);
    assert.equal(session.count(CpapChannel.Leak), 2);
    assert.equal(session.count(CpapChannel.Pulse), 2);
    assert.equal(session.count(CpapChannel.SpO2), 2);

    // ResMed stores BRP flow and PLD leak in L/s; OSCAR converts both to L/min.
    assert.equal(session.eventLists.get(CpapChannel.FlowRate)?.[0]?.data(2), 60);
    assert.equal(session.eventLists.get(CpapChannel.Leak)?.[0]?.data(1), 12);
    // Tidal volume is normalized from L to mL.
    assert.equal(session.eventLists.get(CpapChannel.TidalVolume)?.[0]?.data(0), 500);

    assert.equal(session.count(CpapChannel.ObstructiveApnea), 1);
    assert.equal(session.count(CpapChannel.Hypopnea), 1);
    assert.equal(session.count(CpapChannel.ClearAirway), 1);
    assert.equal(session.count(CpapChannel.CSR), 1);
    assert.equal(session.eventLists.get(CpapChannel.ObstructiveApnea)?.[0]?.data(0), 0.8);
    assert.equal(session.eventLists.get(CpapChannel.CSR)?.[0]?.data(0), 1.5);
    assert.equal(result.warnings.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("day-wide EVE annotations are assigned to the session that contains each event", async () => {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-resmed-split-"));
  const day = join(root, "DATALOG", "20261010");
  await mkdir(day, { recursive: true });
  await writeFile(join(root, "Identification.tgt"), "#SRN 12345678901\n#PNA AirSense_11_AutoSet\n#PCD 39000\n");
  await writeFile(join(root, "STR.edf"), makeOrdinaryEdf(new Date(Date.UTC(2026, 9, 10, 12, 0, 0)), 86400, [
    { label: "Mask Dur", dimension: "h", samples: [1], samplesPerRecord: 1 },
  ]));

  try {
    const first = new Date(Date.UTC(2026, 9, 10, 1, 0, 0));
    const second = new Date(Date.UTC(2026, 9, 10, 1, 10, 0));
    await writeFile(join(day, "20261010_010000_BRP.edf"), makeOrdinaryEdf(first, 60, [
      { label: "Flow.40ms", dimension: "L/s", physicalMin: -10, physicalMax: 10, digitalMin: -100, digitalMax: 100, samples: [0, 1], samplesPerRecord: 2 },
    ]));
    await writeFile(join(day, "20261010_011000_BRP.edf"), makeOrdinaryEdf(second, 60, [
      { label: "Flow.40ms", dimension: "L/s", physicalMin: -10, physicalMax: 10, digitalMin: -100, digitalMax: 100, samples: [0, 1], samplesPerRecord: 2 },
    ]));

    const eveStart = first;
    const eveTal = "+30\u00151.0\u0014Obstructive apnea\u0014\0+630\u00151.0\u0014Hypopnea\u0014\0";
    await writeFile(join(day, "20261010_010000_EVE.edf"), makeAnnotationEdf(eveStart, 700, eveTal));

    const result = await new ResMedLoader().open(root);
    const sessions = [...result.machine.sessions.values()].sort((a, b) => a.first - b.first);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0]?.count(CpapChannel.ObstructiveApnea), 1);
    assert.equal(sessions[0]?.count(CpapChannel.Hypopnea), 0);
    assert.equal(sessions[1]?.count(CpapChannel.ObstructiveApnea), 0);
    assert.equal(sessions[1]?.count(CpapChannel.Hypopnea), 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
