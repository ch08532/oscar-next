import test from "node:test";
import assert from "node:assert/strict";
import {
  digitalToPhysical,
  expandEdfYear,
  findEdfSignal,
  parseEdf,
  physicalSamples,
} from "../src/importers/edf/edf-parser.js";

const encoder = new TextEncoder();

function asciiField(value: string, width: number): Uint8Array {
  const encoded = encoder.encode(value);
  if (encoded.length > width) throw new Error(`Fixture field too long: ${value}`);
  const field = new Uint8Array(width);
  field.fill(0x20);
  field.set(encoded);
  return field;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function int16le(values: number[]): Uint8Array {
  const data = new Uint8Array(values.length * 2);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return data;
}

function annotationRecord(text: string, bytes = 64): Uint8Array {
  const data = new Uint8Array(bytes);
  const encoded = encoder.encode(text);
  if (encoded.length > bytes) throw new Error("Annotation fixture is too large");
  data.set(encoded);
  return data;
}

function makeFixture(recordCountField = "2"): Uint8Array {
  const signalCount = 2;
  const headerBytes = 256 + signalCount * 256;
  const fixed = concat([
    asciiField("0", 8),
    asciiField("TEST PATIENT", 80),
    asciiField("Startdate 09-OCT-2026 OSCAR-NEXT", 80),
    asciiField("09.10.26", 8),
    asciiField("22.15.30", 8),
    asciiField(String(headerBytes), 8),
    asciiField("EDF+C", 44),
    asciiField(recordCountField, 8),
    asciiField("1", 8),
    asciiField(String(signalCount), 4),
  ]);

  const signalHeader = concat([
    asciiField("Flow", 16), asciiField("EDF Annotations", 16),
    asciiField("", 80), asciiField("", 80),
    asciiField("L/min", 8), asciiField("", 8),
    asciiField("-100", 8), asciiField("-1", 8),
    asciiField("100", 8), asciiField("1", 8),
    asciiField("-32768", 8), asciiField("-32768", 8),
    asciiField("32767", 8), asciiField("32767", 8),
    asciiField("", 80), asciiField("", 80),
    asciiField("4", 8), asciiField("32", 8),
    asciiField("", 32), asciiField("", 32),
  ]);

  const record0 = concat([
    int16le([-32768, 0, 16384, 32767]),
    annotationRecord("+0\u0014\u0014Hypopnea\u0014\0"),
  ]);
  const record1 = concat([
    int16le([-16384, -1, 1, 8192]),
    annotationRecord("+1.25\u0014\u0014Obstructive Apnea\u0014\0+1.5\u00150.4\u0014Snore\u0014\0"),
  ]);

  return concat([fixed, signalHeader, record0, record1]);
}

test("EDF parser reads header, per-signal metadata, and little-endian samples", () => {
  const edf = parseEdf(makeFixture());
  assert.equal(edf.header.version, "0");
  assert.equal(edf.header.continuity, "continuous");
  assert.deepEqual(edf.header.start, { year: 2026, month: 10, day: 9, hour: 22, minute: 15, second: 30 });
  assert.equal(edf.parsedDataRecordCount, 2);

  const flow = findEdfSignal(edf, "Flow");
  if (!flow) throw new Error("Flow signal not found");
  assert.equal(flow.definition.samplesPerRecord, 4);
  assert.equal(flow.definition.sampleRateHz, 4);
  assert.deepEqual(Array.from(flow.digitalSamples ?? []), [-32768, 0, 16384, 32767, -16384, -1, 1, 8192]);

  assert.ok(Math.abs(digitalToPhysical(flow.definition, -32768) - (-100)) < 1e-9);
  assert.ok(Math.abs(digitalToPhysical(flow.definition, 32767) - 100) < 1e-9);
  assert.equal(physicalSamples(flow).length, 8);
});

test("EDF+ parser extracts TAL timekeeping, event text, and durations", () => {
  const edf = parseEdf(makeFixture());
  const annotations = findEdfSignal(edf, "EDF Annotations")?.annotations ?? [];

  assert.deepEqual(edf.dataRecordOnsetsSeconds, [0, 1.25]);
  assert.equal(annotations.length, 3);
  assert.equal(annotations[0]?.timekeeping, true);
  assert.deepEqual(annotations[0]?.texts, ["Hypopnea"]);
  assert.equal(annotations[1]?.onsetSeconds, 1.25);
  assert.deepEqual(annotations[1]?.texts, ["Obstructive Apnea"]);
  assert.equal(annotations[2]?.durationSeconds, 0.4);
  assert.deepEqual(annotations[2]?.texts, ["Snore"]);
});

test("EDF parser infers record count when the header contains -1", () => {
  const edf = parseEdf(makeFixture("-1"));
  assert.equal(edf.header.dataRecordCount, -1);
  assert.equal(edf.parsedDataRecordCount, 2);
});

test("EDF parser can parse header and signal definitions without allocating sample data", () => {
  const edf = parseEdf(makeFixture(), { includeData: false });
  assert.equal(edf.signals.length, 2);
  assert.equal(edf.signals[0]?.digitalSamples, undefined);
  assert.equal(edf.signals[1]?.annotations, undefined);
});

test("EDF two-digit years use the EDF+ 1985 clipping rule", () => {
  assert.equal(expandEdfYear(84), 2084);
  assert.equal(expandEdfYear(85), 1985);
  assert.equal(expandEdfYear(26), 2026);
});
