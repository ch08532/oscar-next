import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OscarDatabase } from "../src/storage/database.js";
import { createDiagnosticBundle } from "../src/desktop/diagnostics.js";

function archiveText(data: Uint8Array): string { return new TextDecoder().decode(data); }

test("diagnostic bundle excludes profile names, database path, and therapy data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-diag-"));
  try {
    const dbPath = join(dir, "private-chris.sqlite");
    const db = new OscarDatabase(dbPath);
    db.createProfile("Sensitive Chris", "America/Toronto");
    db.close();
    const logPath = join(dir, "oscar-next.log");
    await writeFile(logPath, '{"event":"app.start","serial":"[redacted]"}\n');
    const bundle = await createDiagnosticBundle({ appVersion: "1.9.0", databasePath: dbPath, logFilePath: logPath, generatedAt: new Date("2026-10-10T00:00:00Z"), nodeVersion: "v22-test", electronVersion: "test" });
    const text = archiveText(bundle);
    assert.ok(text.includes('"appVersion": "1.9.0"'));
    assert.ok(text.includes('"schemaVersion": 5'));
    assert.ok(text.includes('"therapyDataIncluded": false'));
    assert.ok(text.includes('"profileCount": 1'));
    assert.ok(!text.includes("Sensitive Chris"));
    assert.ok(!text.includes("private-chris.sqlite"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
