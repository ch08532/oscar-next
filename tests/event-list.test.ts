import test from "node:test";
import assert from "node:assert/strict";
import { EventList, EventListType } from "../src/core/event-list.js";

test("EventList stores discrete event times as deltas from first", () => {
  const list = new EventList(EventListType.Event, { gain: 0.1 });
  list.addEvent(1_000, 100);
  list.addEvent(1_500, 120);
  assert.equal(list.first, 1_000);
  assert.equal(list.last, 1_500);
  assert.equal(list.time(1), 1_500);
  assert.equal(list.data(0), 10);
  assert.equal(list.min, 10);
  assert.equal(list.max, 12);
});

test("EventList shifts deltas if an earlier event arrives", () => {
  const list = new EventList(EventListType.Event);
  list.addEvent(2_000, 1);
  list.addEvent(1_000, 2);
  assert.equal(list.first, 1_000);
  assert.equal(list.time(0), 2_000);
  assert.equal(list.time(1), 1_000);
});

test("Waveform timestamps use the sample interval", () => {
  const list = new EventList(EventListType.Waveform, { gain: 0.5, offset: 1, rateMs: 40 });
  list.addWaveform(10_000, Int16Array.from([0, 2, 4]));
  assert.equal(list.count, 3);
  assert.equal(list.time(2), 10_080);
  assert.equal(list.min, 1);
  assert.equal(list.max, 3);
});
