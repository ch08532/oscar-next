const encoder = new TextEncoder();

export interface FixtureSignal {
  label: string;
  dimension?: string;
  physicalMin?: number;
  physicalMax?: number;
  digitalMin?: number;
  digitalMax?: number;
  samples: number[];
  samplesPerRecord: number;
}

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

function int16le(values: readonly number[]): Uint8Array {
  const data = new Uint8Array(values.length * 2);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return data;
}

function dateFields(start: Date): { date: string; time: string } {
  const p = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${p(start.getUTCDate())}.${p(start.getUTCMonth() + 1)}.${p(start.getUTCFullYear() % 100)}`,
    time: `${p(start.getUTCHours())}.${p(start.getUTCMinutes())}.${p(start.getUTCSeconds())}`,
  };
}

export function makeOrdinaryEdf(
  start: Date,
  durationSeconds: number,
  signals: readonly FixtureSignal[],
): Uint8Array {
  const recordCount = 1;
  const signalCount = signals.length;
  const headerBytes = 256 + signalCount * 256;
  const dt = dateFields(start);
  const fixed = concat([
    asciiField("0", 8),
    asciiField("TEST", 80),
    asciiField("OSCAR NEXT RESMED TEST", 80),
    asciiField(dt.date, 8),
    asciiField(dt.time, 8),
    asciiField(String(headerBytes), 8),
    asciiField("", 44),
    asciiField(String(recordCount), 8),
    asciiField(String(durationSeconds), 8),
    asciiField(String(signalCount), 4),
  ]);

  const labels = signals.map((s) => asciiField(s.label, 16));
  const transducers = signals.map(() => asciiField("", 80));
  const dimensions = signals.map((s) => asciiField(s.dimension ?? "", 8));
  const physicalMins = signals.map((s) => asciiField(String(s.physicalMin ?? 0), 8));
  const physicalMaxes = signals.map((s) => asciiField(String(s.physicalMax ?? 1000), 8));
  const digitalMins = signals.map((s) => asciiField(String(s.digitalMin ?? 0), 8));
  const digitalMaxes = signals.map((s) => asciiField(String(s.digitalMax ?? 1000), 8));
  const prefilters = signals.map(() => asciiField("", 80));
  const sampleCounts = signals.map((s) => asciiField(String(s.samplesPerRecord), 8));
  const reserved = signals.map(() => asciiField("", 32));
  const signalHeader = concat([
    ...labels,
    ...transducers,
    ...dimensions,
    ...physicalMins,
    ...physicalMaxes,
    ...digitalMins,
    ...digitalMaxes,
    ...prefilters,
    ...sampleCounts,
    ...reserved,
  ]);

  for (const signal of signals) {
    if (signal.samples.length !== signal.samplesPerRecord) {
      throw new Error(`${signal.label}: samples length must equal samplesPerRecord for this fixture helper`);
    }
  }
  const payload = concat(signals.map((signal) => int16le(signal.samples)));
  return concat([fixed, signalHeader, payload]);
}

export function makeAnnotationEdf(start: Date, durationSeconds: number, talText: string, annotationBytes = 256): Uint8Array {
  if (annotationBytes % 2 !== 0) throw new Error("annotationBytes must be even");
  const signalCount = 1;
  const headerBytes = 256 + signalCount * 256;
  const dt = dateFields(start);
  const fixed = concat([
    asciiField("0", 8),
    asciiField("TEST", 80),
    asciiField("OSCAR NEXT RESMED TEST", 80),
    asciiField(dt.date, 8),
    asciiField(dt.time, 8),
    asciiField(String(headerBytes), 8),
    asciiField("EDF+C", 44),
    asciiField("1", 8),
    asciiField(String(durationSeconds), 8),
    asciiField("1", 4),
  ]);
  const signalHeader = concat([
    asciiField("EDF Annotations", 16),
    asciiField("", 80),
    asciiField("", 8),
    asciiField("-1", 8),
    asciiField("1", 8),
    asciiField("-32768", 8),
    asciiField("32767", 8),
    asciiField("", 80),
    asciiField(String(annotationBytes / 2), 8),
    asciiField("", 32),
  ]);
  const payload = new Uint8Array(annotationBytes);
  const encoded = encoder.encode(talText);
  if (encoded.length > payload.length) throw new Error("TAL text too large for annotation fixture");
  payload.set(encoded);
  return concat([fixed, signalHeader, payload]);
}

/** Build a conventional EDF with multiple data records. Signal samples are
 * supplied flattened by record (record 0 samples, then record 1, etc.). */
export function makeMultiRecordEdf(
  start: Date,
  durationSeconds: number,
  recordCount: number,
  signals: readonly FixtureSignal[],
): Uint8Array {
  if (!Number.isInteger(recordCount) || recordCount <= 0) throw new Error("recordCount must be positive");
  const signalCount = signals.length;
  const headerBytes = 256 + signalCount * 256;
  const dt = dateFields(start);
  const fixed = concat([
    asciiField("0", 8),
    asciiField("TEST", 80),
    asciiField("OSCAR NEXT RESMED TEST", 80),
    asciiField(dt.date, 8),
    asciiField(dt.time, 8),
    asciiField(String(headerBytes), 8),
    asciiField("", 44),
    asciiField(String(recordCount), 8),
    asciiField(String(durationSeconds), 8),
    asciiField(String(signalCount), 4),
  ]);

  const signalHeader = concat([
    ...signals.map((s) => asciiField(s.label, 16)),
    ...signals.map(() => asciiField("", 80)),
    ...signals.map((s) => asciiField(s.dimension ?? "", 8)),
    ...signals.map((s) => asciiField(String(s.physicalMin ?? 0), 8)),
    ...signals.map((s) => asciiField(String(s.physicalMax ?? 1000), 8)),
    ...signals.map((s) => asciiField(String(s.digitalMin ?? 0), 8)),
    ...signals.map((s) => asciiField(String(s.digitalMax ?? 1000), 8)),
    ...signals.map(() => asciiField("", 80)),
    ...signals.map((s) => asciiField(String(s.samplesPerRecord), 8)),
    ...signals.map(() => asciiField("", 32)),
  ]);

  for (const signal of signals) {
    if (signal.samples.length !== signal.samplesPerRecord * recordCount) {
      throw new Error(`${signal.label}: samples length must equal samplesPerRecord * recordCount`);
    }
  }

  const records: Uint8Array[] = [];
  for (let record = 0; record < recordCount; record += 1) {
    for (const signal of signals) {
      const startIndex = record * signal.samplesPerRecord;
      records.push(int16le(signal.samples.slice(startIndex, startIndex + signal.samplesPerRecord)));
    }
  }
  return concat([fixed, signalHeader, ...records]);
}
