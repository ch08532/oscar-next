import test from "node:test";
import assert from "node:assert/strict";
import { Day } from "../src/core/day.js";
import { EventListType } from "../src/core/event-list.js";
import { Session } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";

const H = 1, OA = 2, A = 3, CA = 4, RERA = 5;

test("Day calculates AHI and RDI from enabled CPAP sessions", () => {
  const session = new Session(100, MachineType.CPAP);
  session.setBounds(0 + 1_000, 3_601_000); // exactly one hour
  for (const [channel, count] of [[H, 1], [OA, 2], [A, 1], [CA, 1], [RERA, 2]] as const) {
    const list = session.addEventList(channel, EventListType.Event);
    for (let i = 0; i < count; i += 1) list.addEvent(2_000 + i * 1_000, 1);
  }
  const day = new Day("2026-10-09");
  day.addSession(session);
  const channels = { hypopnea: H, obstructive: OA, apnea: A, clearAirway: CA, rera: RERA };
  assert.equal(day.calcAHI(channels), 5);
  assert.equal(day.calcRDI(channels), 7);
});
