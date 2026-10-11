import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Machine } from "../src/core/machine.js";
import { Session, SliceStatus } from "../src/core/session.js";
import { EventListType } from "../src/core/event-list.js";
import { CpapChannel } from "../src/core/cpap-channels.js";
import { MachineType } from "../src/core/types.js";
import { OscarDatabase } from "../src/storage/database.js";
import { openApiDocument, startOscarApiServer } from "../src/api/server.js";

async function makeApiDatabase(path: string): Promise<void> {
  const db = new OscarDatabase(path);
  const profile = db.createProfile("API Test", "America/Toronto");
  const machine = new Machine(2100, { type: MachineType.CPAP, brand: "ResMed", model: "AirSense 11 AutoSet", serial: "API2100" });
  const first = Date.parse("2026-10-09T22:00:00Z");
  const session = new Session(21001, MachineType.CPAP);
  session.setBounds(first, first + 2 * 3_600_000);
  session.addSlice({ start: first, end: first + 2 * 3_600_000, status: SliceStatus.MaskOn });
  const pressure = session.addEventList(CpapChannel.Pressure, EventListType.Waveform, { gain: 0.1, rateMs: 60_000, dimension: "cmH2O" });
  pressure.addWaveform(first, Int16Array.from([80, 90, 100]), 180_000);
  const oa = session.addEventList(CpapChannel.ObstructiveApnea, EventListType.Event, { gain: 1, secondField: true, dimension: "event" });
  oa.addEvent(first + 60_000, 1, 10);
  machine.addSession(session);
  db.saveMachine(machine, { profileId: profile.id, deviceTimeZone: profile.timeZone, timeZoneSource: "profile" });
  db.close();
}

test("OpenAPI contract exposes core OSCAR Next resources", () => {
  assert.equal(openApiDocument.openapi, "3.1.0");
  assert.equal(openApiDocument.info.version, "2.3.0");
  assert.ok(openApiDocument.paths["/api/v1/machines/{machineId}/daily/{date}"]);
  assert.ok(openApiDocument.paths["/api/v1/machines/{machineId}/charts/{date}"]);
  assert.ok(openApiDocument.paths["/api/v1/imports/preview"]);
  assert.ok(openApiDocument.paths["/api/v1/state"]);
  assert.ok(openApiDocument.paths["/api/v1/active-profile"]);
  assert.ok(openApiDocument.paths["/api/v1/diagnostics"]);
  assert.ok(openApiDocument.paths["/api/v1/machines/{machineId}/therapy-history"]);
});

test("REST API serves Swagger/OpenAPI and reuses Daily/chart/database logic", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-api-"));
  const path = join(dir, "oscar.sqlite");
  await makeApiDatabase(path);
  const api = await startOscarApiServer({ databasePath: path, port: 0 });
  try {
    const health = await fetch(`${api.baseUrl}/api/v1/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { apiVersion: string }).apiVersion, "2.3.0");

    const docs = await fetch(`${api.baseUrl}/docs`);
    assert.equal(docs.status, 200);
    assert.ok((await docs.text()).includes("SwaggerUIBundle"));

    const spec = await fetch(`${api.baseUrl}/openapi.json`);
    assert.equal(spec.status, 200);
    assert.equal((await spec.json() as { openapi: string }).openapi, "3.1.0");

    const profiles = await fetch(`${api.baseUrl}/api/v1/profiles`);
    const profileRows = await profiles.json() as Array<{ id: number; name: string }>;
    assert.equal(profileRows[0]?.name, "API Test");

    const machines = await fetch(`${api.baseUrl}/api/v1/profiles/${profileRows[0]!.id}/machines`);
    const machineRows = await machines.json() as Array<{ id: number; model: string }>;
    assert.equal(machineRows[0]?.id, 2100);
    assert.equal(machineRows[0]?.model, "AirSense 11 AutoSet");

    const daily = await fetch(`${api.baseUrl}/api/v1/machines/2100/daily/2026-10-09`);
    const dailyBody = await daily.json() as { usageHours: number; eventCounts: { obstructive: number } };
    assert.equal(dailyBody.usageHours, 2);
    assert.equal(dailyBody.eventCounts.obstructive, 1);

    const history = await fetch(`${api.baseUrl}/api/v1/machines/2100/therapy-history?startDate=2026-10-09&endDate=2026-10-10`);
    assert.equal(history.status, 200);
    assert.deepEqual(await history.json(), [
      { date: "2026-10-09", sessionCount: 1, usageHours: 2 },
      { date: "2026-10-10", sessionCount: 0, usageHours: 0 },
    ]);
    for (const query of ["", "?startDate=2026-10-09", "?startDate=bad&endDate=2026-10-10", "?startDate=2026-02-29&endDate=2026-03-01", "?startDate=2026-10-10&endDate=2026-10-09"]) {
      assert.equal((await fetch(`${api.baseUrl}/api/v1/machines/2100/therapy-history${query}`)).status, 400);
    }

    const chart = await fetch(`${api.baseUrl}/api/v1/machines/2100/charts/2026-10-09?channels=${CpapChannel.Pressure}&maxPointsPerSeries=5000`);
    const chartBody = await chart.json() as { series: Array<{ values: number[]; timesMs: number[] }> };
    assert.deepEqual(chartBody.series[0]?.values, [8, 9, 10]);
    assert.ok(Array.isArray(chartBody.series[0]?.timesMs));

    const disable = await fetch(`${api.baseUrl}/api/v1/machines/2100/sessions/21001`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disable.status, 204);
    const dailyAfter = await fetch(`${api.baseUrl}/api/v1/machines/2100/daily/2026-10-09`);
    assert.equal((await dailyAfter.json() as { usageHours: number }).usageHours, 0);
    const historyAfter = await fetch(`${api.baseUrl}/api/v1/machines/2100/therapy-history?startDate=2026-10-09&endDate=2026-10-09`);
    assert.deepEqual(await historyAfter.json(), [{ date: "2026-10-09", sessionCount: 0, usageHours: 0 }]);

    const blockedImport = await fetch(`${api.baseUrl}/api/v1/imports/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePath: dir }),
    });
    assert.equal(blockedImport.status, 403);
  } finally {
    await api.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("API bearer token is enforced when configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-api-token-"));
  const path = join(dir, "oscar.sqlite");
  await makeApiDatabase(path);
  const api = await startOscarApiServer({ databasePath: path, port: 0, token: "secret-token" });
  try {
    assert.equal((await fetch(`${api.baseUrl}/api/v1/profiles`)).status, 401);
    assert.equal((await fetch(`${api.baseUrl}/api/v1/profiles`, { headers: { authorization: "Bearer secret-token" } })).status, 200);
    assert.equal((await fetch(`${api.baseUrl}/api/v1/health`)).status, 200);
    const historyUrl = `${api.baseUrl}/api/v1/machines/2100/therapy-history?startDate=2026-10-09&endDate=2026-10-09`;
    assert.equal((await fetch(historyUrl)).status, 401);
    assert.equal((await fetch(historyUrl, { headers: { authorization: "Bearer secret-token" } })).status, 200);
  } finally {
    await api.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("API refuses non-loopback binding without a bearer token", async () => {
  let message = "";
  try {
    await startOscarApiServer({ databasePath: ":memory:", host: "0.0.0.0", port: 0 });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.ok(message.includes("Refusing non-loopback"));
});

test("headless API serves the browser SPA plus state, reports, and diagnostics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-headless-"));
  const path = join(dir, "oscar.sqlite");
  const webRoot = join(dir, "web");
  await mkdir(webRoot, { recursive: true });
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>OSCAR Next Headless</title><div id=\"root\"></div>");
  await makeApiDatabase(path);
  const api = await startOscarApiServer({ databasePath: path, port: 0, webRoot });
  try {
    const root = await fetch(`${api.baseUrl}/`);
    assert.equal(root.status, 200);
    assert.ok((await root.text()).includes("OSCAR Next Headless"));

    const state = await fetch(`${api.baseUrl}/api/v1/state`);
    const stateBody = await state.json() as { profiles: Array<{ id: number }>; activeProfile?: { id: number }; needsSetup: boolean };
    assert.equal(stateBody.needsSetup, false);
    assert.equal(stateBody.profiles.length, 1);
    assert.equal(stateBody.activeProfile?.id, stateBody.profiles[0]?.id);

    const csv = await fetch(`${api.baseUrl}/api/v1/machines/2100/reports/statistics.csv?startDate=2026-10-09&endDate=2026-10-09`);
    assert.equal(csv.status, 200);
    assert.ok((await csv.text()).includes("OSCAR Next Therapy Statistics"));

    const diagnostics = await fetch(`${api.baseUrl}/api/v1/diagnostics`);
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.headers.get("content-type"), "application/zip");
    assert.ok((await diagnostics.arrayBuffer()).byteLength > 100);
  } finally {
    await api.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("headless demo endpoint creates a profile and imports synthetic therapy data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oscar-next-headless-demo-"));
  const path = join(dir, "oscar.sqlite");
  const api = await startOscarApiServer({ databasePath: path, port: 0, allowImports: true, demoRoot: join(dir, "demo-card") });
  try {
    const demo = await fetch(`${api.baseUrl}/api/v1/demo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days: 2 }),
    });
    assert.equal(demo.status, 201);
    const result = await demo.json() as { sessionsImported: number; machineId: number };
    assert.ok(result.sessionsImported >= 2);

    const state = await fetch(`${api.baseUrl}/api/v1/state`);
    const stateBody = await state.json() as { profiles: Array<{ id: number }>; activeProfile?: { id: number } };
    assert.equal(stateBody.profiles.length, 1);
    assert.equal(stateBody.activeProfile?.id, stateBody.profiles[0]?.id);

    const machines = await fetch(`${api.baseUrl}/api/v1/profiles/${stateBody.profiles[0]!.id}/machines`);
    const machineRows = await machines.json() as Array<{ id: number }>;
    assert.ok(machineRows.some((machine) => machine.id === result.machineId));
  } finally {
    await api.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("automatic media import requires both imports and media watching", async () => {
  let first = "";
  try { await startOscarApiServer({ databasePath: ":memory:", port: 0, allowImports: true, autoImportMedia: true }); }
  catch (error) { first = error instanceof Error ? error.message : String(error); }
  assert.ok(/autoImportMedia requires watchMedia/.test(first));

  let second = "";
  try { await startOscarApiServer({ databasePath: ":memory:", port: 0, watchMedia: true, autoImportMedia: true }); }
  catch (error) { second = error instanceof Error ? error.message : String(error); }
  assert.ok(/autoImportMedia requires allowImports/.test(second));
});
