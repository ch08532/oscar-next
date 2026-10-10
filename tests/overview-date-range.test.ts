import test from "node:test";
import assert from "node:assert/strict";
import { clampRangeOffset, dateAtOffset, dayOffset, keyboardRangeOffset, presetDateRange, rangeHandleOffset } from "../apps/desktop/src/overview-date-range.js";

test("overview date handles snap to inclusive days and cannot cross", () => {
  assert.equal(rangeHandleOffset(0.25, 12, 10, "start"), 3);
  assert.equal(rangeHandleOffset(1, 12, 5, "start"), 5);
  assert.equal(rangeHandleOffset(0, 12, 5, "end"), 5);
  assert.equal(rangeHandleOffset(-2, 12, 10, "start"), 0);
  assert.equal(rangeHandleOffset(2, 12, 3, "end"), 12);
  assert.equal(rangeHandleOffset(0.5, 0, 0, "start"), 0);
});

for (const preset of [7, 30, 90] as const) {
  test(`${preset}-day preset includes both dates and preserves the selected end`, () => {
    const range = presetDateRange("2025-01-01", "2026-10-10", "2026-03-02", preset);
    assert.equal(range.endDate, "2026-03-02");
    assert.equal(dayOffset(range.startDate, range.endDate) + 1, preset);
  });

  test(`${preset}-day preset clamps to short machine history`, () => {
    assert.deepEqual(presetDateRange("2026-10-08", "2026-10-10", "2026-10-09", preset), {
      startDate: "2026-10-08", endDate: "2026-10-09",
    });
  });
}

test("All restores both endpoints after the end date was narrowed", () => {
  assert.deepEqual(presetDateRange("2024-02-29", "2026-10-10", "2025-01-01", "all"), {
    startDate: "2024-02-29", endDate: "2026-10-10",
  });
});

test("all presets preserve a single-day history", () => {
  for (const preset of [7, 30, 90, "all"] as const) {
    assert.deepEqual(presetDateRange("2026-10-10", "2026-10-10", "2026-10-10", preset), {
      startDate: "2026-10-10", endDate: "2026-10-10",
    });
  }
});

for (const edge of ["start", "end"] as const) {
  for (const [key, expected] of [["ArrowLeft", 9], ["ArrowDown", 9], ["ArrowRight", 11], ["ArrowUp", 11], ["PageDown", 3], ["PageUp", 17]] as const) {
    test(`${edge} handle ${key} moves by the expected day count`, () => {
      assert.equal(keyboardRangeOffset(key, 10, 30, edge === "start" ? 25 : 0, edge), expected);
    });
  }
}

test("Home and End move to history bounds or the opposite handle", () => {
  assert.equal(keyboardRangeOffset("Home", 10, 30, 20, "start"), 0);
  assert.equal(keyboardRangeOffset("End", 10, 30, 20, "start"), 20);
  assert.equal(keyboardRangeOffset("Home", 20, 30, 10, "end"), 10);
  assert.equal(keyboardRangeOffset("End", 20, 30, 10, "end"), 30);
});

test("keyboard movement clamps at history bounds and cannot cross the opposite handle", () => {
  assert.equal(keyboardRangeOffset("PageDown", 2, 30, 20, "start"), 0);
  assert.equal(keyboardRangeOffset("PageUp", 28, 30, 10, "end"), 30);
  assert.equal(keyboardRangeOffset("PageUp", 18, 30, 20, "start"), 20);
  assert.equal(keyboardRangeOffset("PageDown", 12, 30, 10, "end"), 10);
  assert.equal(keyboardRangeOffset("ArrowRight", 20, 30, 20, "start"), 20);
  assert.equal(keyboardRangeOffset("ArrowLeft", 10, 30, 10, "end"), 10);
});

test("unhandled keys leave browser keyboard behavior available", () => {
  for (const key of ["Tab", "Enter", "Escape", "a", "", "toString", "constructor"]) {
    assert.equal(keyboardRangeOffset(key, 10, 30, 20, "start"), undefined);
  }
});

test("single-day history remains at its only offset for every navigation key", () => {
  for (const edge of ["start", "end"] as const) {
    for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) {
      assert.equal(keyboardRangeOffset(key, 0, 0, 0, edge), 0);
    }
  }
});

test("offset updates preserve the allowed interval for either handle", () => {
  assert.equal(clampRangeOffset(-1, 30, 20, "start"), 0);
  assert.equal(clampRangeOffset(12, 30, 20, "start"), 12);
  assert.equal(clampRangeOffset(40, 30, 20, "start"), 20);
  assert.equal(clampRangeOffset(-1, 30, 10, "end"), 10);
  assert.equal(clampRangeOffset(12, 30, 10, "end"), 12);
  assert.equal(clampRangeOffset(40, 30, 10, "end"), 30);
});

test("pointer offsets round at half-day boundaries and reach both history endpoints", () => {
  assert.equal(rangeHandleOffset(0.249, 10, 10, "start"), 2);
  assert.equal(rangeHandleOffset(0.25, 10, 10, "start"), 3);
  assert.equal(rangeHandleOffset(0.249, 10, 0, "end"), 2);
  assert.equal(rangeHandleOffset(0.25, 10, 0, "end"), 3);
  assert.equal(rangeHandleOffset(0, 10, 10, "start"), 0);
  assert.equal(rangeHandleOffset(1, 10, 0, "end"), 10);
});

test("date offsets support backwards navigation and Gregorian century leap rules", () => {
  assert.equal(dayOffset("2026-01-01", "2025-12-31"), -1);
  assert.equal(dateAtOffset("2026-01-01", -1), "2025-12-31");
  assert.equal(dateAtOffset("2000-02-28", 1), "2000-02-29");
  assert.equal(dateAtOffset("2100-02-28", 1), "2100-03-01");
});

test("overview date steps preserve therapy keys through DST, leap days and year boundaries", () => {
  assert.equal(dayOffset("2026-03-07", "2026-03-09"), 2);
  assert.equal(dateAtOffset("2026-10-31", 2), "2026-11-02");
  assert.equal(dateAtOffset("2024-02-28", 1), "2024-02-29");
  assert.equal(dateAtOffset("2026-12-31", 1), "2027-01-01");
  assert.equal(dateAtOffset("2026-10-09", dayOffset("2026-10-09", "2026-10-09")), "2026-10-09");
});
