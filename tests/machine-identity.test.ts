import test from "node:test";
import assert from "node:assert/strict";
import { machineIdFromInfo } from "../src/core/identity.js";

test("machine identity is deterministic and distinguishes serial numbers", () => {
  const a = machineIdFromInfo({ brand: "ResMed", model: "AirSense 11 AutoSet", modelNumber: "39000", serial: "ABC123" });
  const b = machineIdFromInfo({ brand: "ResMed", model: "AirSense 11 AutoSet", modelNumber: "39000", serial: "ABC123" });
  const c = machineIdFromInfo({ brand: "ResMed", model: "AirSense 11 AutoSet", modelNumber: "39000", serial: "XYZ999" });
  assert.equal(a, b);
  assert.ok(a > 0);
  assert.ok(a !== c);
});
