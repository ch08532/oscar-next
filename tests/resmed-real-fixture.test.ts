import test from "node:test";
import assert from "node:assert/strict";
import { ResMedLoader } from "../src/importers/resmed/resmed-loader.js";

const fixture = process.env.OSCAR_RESMED_FIXTURE;

test("optional anonymized real-card fixture imports without structural errors", async () => {
  if (!fixture) return;
  const loader = new ResMedLoader();
  assert.equal(await loader.detect(fixture), true, "OSCAR_RESMED_FIXTURE must point at a copied/anonymized ResMed card root");
  const info = await loader.peekInfo(fixture);
  assert.equal(info?.brand, "ResMed");
  const result = await loader.open(fixture);
  assert.ok(result.sessionsImported > 0, "real fixture should contain at least one therapy session");
  for (const session of result.machine.sessions.values()) assert.ok(session.last >= session.first);
});
