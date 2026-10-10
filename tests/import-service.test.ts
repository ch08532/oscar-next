import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Machine } from "../src/core/machine.js";
import { Session } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";
import { importSourceToDatabase, mergeImportedMachine, previewImportSource } from "../src/importers/import-service.js";
import { OscarDatabase } from "../src/storage/database.js";

function machineWithSessions(id: number, sessionIds: number[]): Machine {
  const machine = new Machine(id, { type: MachineType.CPAP, brand: "ResMed", model: "AirSense", serial: "ABC" });
  for (const sessionId of sessionIds) {
    const session = new Session(sessionId, MachineType.CPAP);
    session.setBounds(sessionId * 1000, sessionId * 1000 + 60_000);
    machine.addSession(session);
  }
  return machine;
}

test("mergeImportedMachine preserves older sessions and lets imported duplicates win", () => {
  const existing = machineWithSessions(7, [100, 200]);
  existing.properties.set("historic", "yes");
  const incoming = machineWithSessions(7, [200, 300]);
  incoming.session(200)?.setBounds(200_000, 299_000);

  const result = mergeImportedMachine(existing, incoming);
  assert.equal(result.newSessions, 1);
  assert.equal(result.updatedSessions, 1);
  assert.equal(result.machine.sessions.size, 3);
  assert.equal(result.machine.session(200)?.last, 299_000);
  assert.equal(result.machine.properties.get("historic"), "yes");
});

test("previewImportSource identifies ResMed media and counts EDF families", async () => {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-import-preview-"));
  try {
    await mkdir(join(root, "DATALOG", "20261009"), { recursive: true });
    await writeFile(join(root, "Identification.tgt"), "#SRN 12345\n#PNA AirSense_11_AutoSet\n#PCD 39000\n");
    await writeFile(join(root, "STR.edf"), "");
    await writeFile(join(root, "DATALOG", "20261009", "20261009_221500_BRP.edf"), "");
    await writeFile(join(root, "DATALOG", "20261009", "20261009_221500_EVE.edf"), "");

    const preview = await previewImportSource(root);
    assert.ok(preview);
    assert.equal(preview?.importerName, "ResMed");
    assert.equal(preview?.machine?.model, "AirSense 11 AutoSet");
    assert.equal(preview?.machine?.serial, "12345");
    assert.equal(preview?.fileCount, 3);
    assert.equal(preview?.fileCounts?.STR, 1);
    assert.equal(preview?.fileCounts?.BRP, 1);
    assert.equal(preview?.fileCounts?.EVE, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("importSourceToDatabase creates a stored machine and emits progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-import-store-"));
  const dbPath = join(root, "oscar.sqlite");
  const card = join(root, "card");
  try {
    await mkdir(join(card, "DATALOG"), { recursive: true });
    await writeFile(join(card, "Identification.tgt"), "#SRN 54321\n#PNA AirSense_10_AutoSet\n#PCD 37000\n");
    const progress: string[] = [];
    const result = await importSourceToDatabase(card, dbPath, (item) => { if (item.message) progress.push(item.message); });

    assert.equal(result.brand, "ResMed");
    assert.equal(result.model, "AirSense 10 AutoSet");
    assert.equal(result.sessionsImported, 0);
    assert.ok(progress.includes("Import complete"));

    const db = new OscarDatabase(dbPath);
    try {
      const stored = db.listMachines();
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.serial, "54321");
    } finally { db.close(); }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mergeImportedMachine preserves the user's disabled state for re-imported sessions", () => {
  const existing = machineWithSessions(9, [400]);
  const previous = existing.session(400);
  if (!previous) throw new Error("expected existing session");
  previous.enabled = false;

  const incoming = machineWithSessions(9, [400]);
  const result = mergeImportedMachine(existing, incoming);
  assert.equal(result.updatedSessions, 1);
  assert.equal(result.machine.session(400)?.enabled, false);
});
