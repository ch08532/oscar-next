import test from "node:test";
import assert from "node:assert/strict";
import { classifyResMedEdfPath } from "../src/importers/resmed/resmed-files.js";
import { parseResMedIdentificationTgt } from "../src/importers/resmed/resmed-identification.js";

test("ResMed EDF classifier recognizes dated and modern file names", () => {
  assert.equal(classifyResMedEdfPath("/card/STR.edf"), "STR");
  assert.equal(classifyResMedEdfPath("/card/DATALOG/20261009/20261009_221530_BRP.edf"), "BRP");
  assert.equal(classifyResMedEdfPath("/card/DATALOG/20261009/EVE00001.edf.gz"), "EVE");
  assert.equal(classifyResMedEdfPath("/card/DATALOG/20261009/data.bin"), "UNKNOWN");
});

test("ResMed Identification.tgt parser extracts serial and model fields", () => {
  const id = parseResMedIdentificationTgt(`
#SRN 22182060837
#PNA AirSense_11_AutoSet
#PCD 39000
#SID SX123-456
#FGT FW_1.2.3
`);
  assert.equal(id.serial, "22182060837");
  assert.equal(id.model, "AirSense 11 AutoSet");
  assert.equal(id.modelNumber, "39000");
  assert.equal(id.deviceId, "SX123-456");
  assert.equal(id.firmware, "FW_1.2.3");
});
