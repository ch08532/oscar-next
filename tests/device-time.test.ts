import test from "node:test";
import assert from "node:assert/strict";
import {
  instantToWallClock,
  isValidIanaTimeZone,
  resolveWallClockInstant,
  wallClockToInstant,
} from "../src/core/device-time.js";

test("device wall-clock conversion is deterministic for a normal Toronto date", () => {
  const wall = Date.UTC(2026, 9, 9, 22, 15, 0);
  const resolved = resolveWallClockInstant(wall, "America/Toronto");
  assert.equal(resolved.resolution, "exact");
  assert.equal(resolved.instantsMs.length, 1);
  const instant = wallClockToInstant(wall, "America/Toronto");
  assert.equal(new Date(instant).toISOString(), "2026-10-10T02:15:00.000Z");
  assert.equal(instantToWallClock(instant, "America/Toronto"), wall);
});

test("fall-back wall clock exposes both possible instants", () => {
  const wall = Date.UTC(2026, 10, 1, 1, 30, 0);
  const resolved = resolveWallClockInstant(wall, "America/Toronto");
  assert.equal(resolved.resolution, "ambiguous");
  assert.equal(resolved.instantsMs.length, 2);
  assert.equal(new Date(resolved.instantsMs[0]!).toISOString(), "2026-11-01T05:30:00.000Z");
  assert.equal(new Date(resolved.instantsMs[1]!).toISOString(), "2026-11-01T06:30:00.000Z");
});

test("spring-forward nonexistent wall clock is rejected", () => {
  const wall = Date.UTC(2026, 2, 8, 2, 30, 0);
  const resolved = resolveWallClockInstant(wall, "America/Toronto");
  assert.equal(resolved.resolution, "nonexistent");
  assert.throws(() => wallClockToInstant(wall, "America/Toronto"), /does not exist/);
});

test("timezone validation accepts IANA zones and rejects junk", () => {
  assert.equal(isValidIanaTimeZone("America/Toronto"), true);
  assert.equal(isValidIanaTimeZone("UTC"), true);
  assert.equal(isValidIanaTimeZone("Not/A_Zone"), false);
});
