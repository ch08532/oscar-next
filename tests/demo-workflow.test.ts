import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoResMedCard } from "../src/demo/demo-card.js";
import { previewImportSource } from "../src/importers/import-service.js";
import { runDemoSmokeWorkflow } from "../src/demo/demo-smoke.js";

test("demo card is detected as modern ResMed media with 14 therapy days", async () => {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-demo-card-test-"));
  try {
    const card = await createDemoResMedCard(join(root, "card"), { days: 14 });
    const preview = await previewImportSource(card.rootPath);
    assert.equal(preview?.importerName, "ResMed");
    assert.equal(preview?.machine?.serial, "DEMO0000001");
    assert.ok((preview?.fileCounts?.STR ?? 0) >= 1);
    assert.ok((preview?.fileCounts?.BRP ?? 0) >= 3);
    assert.equal(card.days, 14);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("2.0 demo smoke workflow exercises import, queries, charts, and diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "oscar-next-demo-smoke-test-"));
  try {
    const result = await runDemoSmokeWorkflow(root, true);
    assert.ok(result.usageHours > 4);
    assert.ok(result.ahi >= 0);
    assert.equal(result.overviewDays, 14);
    assert.ok(result.statisticsUsedDays >= 13);
    assert.ok(result.chartSeries >= 3);
    assert.ok(result.diagnosticBytes > 100);
  } finally { await rm(root, { recursive: true, force: true }); }
});
