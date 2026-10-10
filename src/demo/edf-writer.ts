const encoder = new TextEncoder();

export interface DemoSignal {
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
  if (encoded.length > width) throw new Error(`EDF field too long: ${value}`);
  const field = new Uint8Array(width);
  field.fill(0x20);
  field.set(encoded);
  return field;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function int16le(values: readonly number[]): Uint8Array {
  const data = new Uint8Array(values.length * 2);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(value))), true));
  return data;
}

function dateFields(start: Date): { date: string; time: string } {
  const p = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${p(start.getUTCDate())}.${p(start.getUTCMonth() + 1)}.${p(start.getUTCFullYear() % 100)}`,
    time: `${p(start.getUTCHours())}.${p(start.getUTCMinutes())}.${p(start.getUTCSeconds())}`,
  };
}

export function makeDemoEdf(start: Date, durationSeconds: number, recordCount: number, signals: readonly DemoSignal[]): Uint8Array {
  if (!Number.isInteger(recordCount) || recordCount <= 0) throw new Error("recordCount must be positive");
  const signalCount = signals.length;
  const headerBytes = 256 + signalCount * 256;
  const dt = dateFields(start);
  const fixed = concat([
    asciiField("0", 8), asciiField("DEMO", 80), asciiField("OSCAR NEXT DEMO", 80),
    asciiField(dt.date, 8), asciiField(dt.time, 8), asciiField(String(headerBytes), 8),
    asciiField("", 44), asciiField(String(recordCount), 8), asciiField(String(durationSeconds), 8), asciiField(String(signalCount), 4),
  ]);
  const signalHeader = concat([
    ...signals.map((s) => asciiField(s.label, 16)), ...signals.map(() => asciiField("", 80)),
    ...signals.map((s) => asciiField(s.dimension ?? "", 8)), ...signals.map((s) => asciiField(String(s.physicalMin ?? 0), 8)),
    ...signals.map((s) => asciiField(String(s.physicalMax ?? 1000), 8)), ...signals.map((s) => asciiField(String(s.digitalMin ?? 0), 8)),
    ...signals.map((s) => asciiField(String(s.digitalMax ?? 1000), 8)), ...signals.map(() => asciiField("", 80)),
    ...signals.map((s) => asciiField(String(s.samplesPerRecord), 8)), ...signals.map(() => asciiField("", 32)),
  ]);
  for (const signal of signals) {
    if (signal.samples.length !== signal.samplesPerRecord * recordCount) throw new Error(`${signal.label}: unexpected sample count`);
  }
  const records: Uint8Array[] = [];
  for (let record = 0; record < recordCount; record += 1) {
    for (const signal of signals) {
      const offset = record * signal.samplesPerRecord;
      records.push(int16le(signal.samples.slice(offset, offset + signal.samplesPerRecord)));
    }
  }
  return concat([fixed, signalHeader, ...records]);
}

export function makeDemoAnnotationEdf(start: Date, durationSeconds: number, talText: string, annotationBytes = 512): Uint8Array {
  if (annotationBytes % 2 !== 0) throw new Error("annotationBytes must be even");
  const dt = dateFields(start);
  const fixed = concat([
    asciiField("0", 8), asciiField("DEMO", 80), asciiField("OSCAR NEXT DEMO", 80),
    asciiField(dt.date, 8), asciiField(dt.time, 8), asciiField("512", 8), asciiField("EDF+C", 44),
    asciiField("1", 8), asciiField(String(durationSeconds), 8), asciiField("1", 4),
  ]);
  const signalHeader = concat([
    asciiField("EDF Annotations", 16), asciiField("", 80), asciiField("", 8), asciiField("-1", 8), asciiField("1", 8),
    asciiField("-32768", 8), asciiField("32767", 8), asciiField("", 80), asciiField(String(annotationBytes / 2), 8), asciiField("", 32),
  ]);
  const payload = new Uint8Array(annotationBytes);
  const encoded = encoder.encode(talText);
  if (encoded.length > payload.length) throw new Error("Demo annotation payload is too large");
  payload.set(encoded);
  return concat([fixed, signalHeader, payload]);
}
