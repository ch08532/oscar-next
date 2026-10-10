import test from "node:test";
import assert from "node:assert/strict";
import { EventListType } from "../src/core/event-list.js";
import { Machine } from "../src/core/machine.js";
import { Session } from "../src/core/session.js";
import { MachineType } from "../src/core/types.js";

test("Machine indexes sessions and available channels", () => {
  const machine = new Machine(42, { type: MachineType.CPAP, brand: "ResMed" });
  const session = new Session(100, MachineType.CPAP);
  session.setBounds(1_000, 2_000);
  session.addEventList(55, EventListType.Event).addEvent(1_100, 1);
  machine.addSession(session);
  assert.equal(machine.session(100), session);
  assert.equal(machine.hasChannel(55), true);
  assert.equal(machine.firstSessionTime, 1_000);
});
