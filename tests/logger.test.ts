import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StructuredLogger, sanitizeLogFields } from "../src/desktop/logger.js";

test("structured logger redacts sensitive field names", () => {
  const fields = sanitizeLogFields({ serial: "123456", sourcePath: "C:/Users/Chris/card", safe: "ResMed", nested: { profileName: "Chris", count: 3 } });
  assert.equal(fields.serial, "[redacted]");
  assert.equal(fields.sourcePath, "[redacted]");
  assert.equal(fields.safe, "ResMed");
  assert.deepEqual(fields.nested, { profileName: "[redacted]", count: 3 });
  const errorFields = sanitizeLogFields({ error: new Error("Failed reading C:\\Users\\Chris\\CPAP\\DATALOG") });
  assert.ok(!JSON.stringify(errorFields).includes("Chris"));
});

test("structured logger writes JSONL and rotates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-logger-"));
  try {
    const logger = new StructuredLogger(dir, { maxBytes: 180 });
    await logger.init();
    logger.info("app.start", { safe: "one", serial: "secret" });
    logger.info("app.second", { message: "x".repeat(160) });
    await logger.flush();
    const current = new TextDecoder().decode(await readFile(logger.filePath));
    const previous = new TextDecoder().decode(await readFile(logger.previousFilePath));
    assert.ok(current.includes("app.second"));
    assert.ok(previous.includes("app.start"));
    assert.ok(!previous.includes("secret"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
