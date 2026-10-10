import test from "node:test";
import assert from "node:assert/strict";
import { dateAtOffset, dayOffset, rangeHandleOffset } from "../apps/desktop/src/overview-date-range.js";

test("overview date handles snap to inclusive days and cannot cross", () => {
  assert.equal(rangeHandleOffset(0.25, 12, 10, "start"), 3);
  assert.equal(rangeHandleOffset(1, 12, 5, "start"), 5);
  assert.equal(rangeHandleOffset(0, 12, 5, "end"), 5);
  assert.equal(rangeHandleOffset(-2, 12, 10, "start"), 0);
  assert.equal(rangeHandleOffset(2, 12, 3, "end"), 12);
  assert.equal(rangeHandleOffset(0.5, 0, 0, "start"), 0);
});

test("overview date steps preserve therapy keys through DST, leap days and year boundaries", () => {
  assert.equal(dayOffset("2026-03-07", "2026-03-09"), 2);
  assert.equal(dateAtOffset("2026-10-31", 2), "2026-11-02");
  assert.equal(dateAtOffset("2024-02-28", 1), "2024-02-29");
  assert.equal(dateAtOffset("2026-12-31", 1), "2027-01-01");
  assert.equal(dateAtOffset("2026-10-09", dayOffset("2026-10-09", "2026-10-09")), "2026-10-09");
});
