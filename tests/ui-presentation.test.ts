import test from "node:test";
import assert from "node:assert/strict";
import { parseThemePreference, usesDarkTheme } from "../apps/desktop/src/theme-policy.js";
import { chronologicalEvents } from "../apps/desktop/src/inspector-events.js";
import { Channel } from "../apps/desktop/src/channels.js";
import { therapyTime } from "../apps/desktop/src/event-presentation.js";

test("appearance defaults to dark and honors explicit choices over OS appearance", () => {
  for (const stored of [null, "", "invalid", "dark"]) assert.equal(parseThemePreference(stored), "dark");
  for (const preference of ["light", "system"] as const) assert.equal(parseThemePreference(preference), preference);
  assert.equal(usesDarkTheme("dark", false), true);
  assert.equal(usesDarkTheme("light", true), false);
  assert.equal(usesDarkTheme("system", true), true);
  assert.equal(usesDarkTheme("system", false), false);
});

test("inspector orders exact events across sessions without reading dense waveforms", () => {
  const times = new Float64Array([300, 100]);
  const values = new Float64Array([14, 19]);
  const waveform = { channelId: Channel.FlowRate, get timesMs(): Float64Array { throw new Error("Waveforms must not be expanded"); }, values: new Float64Array() };
  assert.deepEqual(chronologicalEvents([
    waveform, { channelId: Channel.ObstructiveApnea, timesMs: times, values },
    { channelId: Channel.ClearAirway, timesMs: new Float64Array([200]), values: new Float64Array([12]) },
    { channelId: Channel.CSR, timesMs: new Float64Array([400]), values: new Float64Array([75]) },
  ]), [
    { time:100, duration:19, channel:Channel.ObstructiveApnea },
    { time:200, duration:12, channel:Channel.ClearAirway },
    { time:300, duration:14, channel:Channel.ObstructiveApnea },
    { time:400, duration:75, channel:Channel.CSR },
  ]);
  assert.deepEqual([...times], [300, 100]);
  assert.deepEqual([...values], [14, 19]);
  assert.deepEqual(chronologicalEvents([]), []);
});

test("inspector timestamps preserve device wall-clock time across midnight", () => {
  assert.equal(therapyTime(Date.parse("2026-03-08T23:59:43Z"), true), "23:59:43");
  assert.equal(therapyTime(Date.parse("2026-03-09T00:11:00Z")), "00:11");
});
