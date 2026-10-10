import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import type {
  EdfAnnotation,
  EdfContinuity,
  EdfFile,
  EdfHeader,
  EdfLocalDateTime,
  EdfSignalData,
  EdfSignalDefinition,
  ParseEdfOptions,
} from "./edf-types.js";

const FIXED_HEADER_BYTES = 256;
const SIGNAL_HEADER_BYTES = 256;
const ANNOTATION_LABEL = "EDF Annotations";

const ascii = new TextDecoder("ascii");
const utf8 = new TextDecoder("utf-8", { fatal: false });

function field(data: Uint8Array, offset: number, length: number): string {
  return ascii.decode(data.subarray(offset, offset + length)).trim();
}

function parseInteger(text: string, name: string): number {
  if (!/^-?\d+$/.test(text)) throw new Error(`Invalid EDF ${name}: ${JSON.stringify(text)}`);
  const value = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(value)) throw new Error(`EDF ${name} is outside the safe integer range: ${text}`);
  return value;
}

function parseNumber(text: string, name: string): number {
  if (text.length === 0) throw new Error(`Missing EDF ${name}`);
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Invalid EDF ${name}: ${JSON.stringify(text)}`);
  return value;
}

/** EDF+ uses 1985 as the two-digit-year clipping date. */
export function expandEdfYear(twoDigitYear: number): number {
  if (!Number.isInteger(twoDigitYear) || twoDigitYear < 0 || twoDigitYear > 99) {
    throw new RangeError(`Invalid EDF two-digit year: ${twoDigitYear}`);
  }
  return twoDigitYear >= 85 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
}

function parseStart(dateText: string, timeText: string): EdfLocalDateTime {
  const date = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(dateText);
  const time = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(timeText);
  if (!date || !time) throw new Error(`Invalid EDF start date/time: ${dateText} ${timeText}`);

  const day = Number(date[1]);
  const month = Number(date[2]);
  const year = expandEdfYear(Number(date[3]));
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`EDF start date/time is out of range: ${dateText} ${timeText}`);
  }
  return { year, month, day, hour, minute, second };
}

function continuityFromReserved(reserved: string): EdfContinuity {
  if (reserved.startsWith("EDF+C")) return "continuous";
  if (reserved.startsWith("EDF+D")) return "discontinuous";
  return "edf";
}

function signalFieldBlock(
  data: Uint8Array,
  offset: number,
  width: number,
  count: number,
): { values: string[]; nextOffset: number } {
  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(field(data, offset + index * width, width));
  }
  return { values, nextOffset: offset + width * count };
}

function parseAnnotations(bytes: Uint8Array, dataRecordIndex: number): EdfAnnotation[] {
  const annotations: EdfAnnotation[] = [];
  let start = 0;

  for (let i = 0; i <= bytes.length; i += 1) {
    if (i !== bytes.length && bytes[i] !== 0) continue;
    if (i > start) {
      const tal = utf8.decode(bytes.subarray(start, i));
      const firstAnnotationSep = tal.indexOf("\u0014");
      const durationSep = tal.indexOf("\u0015");

      let onsetEnd = firstAnnotationSep;
      if (durationSep >= 0 && (onsetEnd < 0 || durationSep < onsetEnd)) onsetEnd = durationSep;
      if (onsetEnd <= 0) throw new Error(`Malformed EDF+ TAL in data record ${dataRecordIndex}`);

      const onsetSeconds = parseNumber(tal.slice(0, onsetEnd), "annotation onset");
      let durationSeconds: number | undefined;
      let annotationStart: number;

      if (durationSep === onsetEnd) {
        const separator = tal.indexOf("\u0014", durationSep + 1);
        if (separator < 0) throw new Error(`Malformed EDF+ TAL duration in data record ${dataRecordIndex}`);
        const durationText = tal.slice(durationSep + 1, separator);
        durationSeconds = parseNumber(durationText, "annotation duration");
        annotationStart = separator + 1;
      } else {
        annotationStart = onsetEnd + 1;
      }

      const annotationPayload = tal.slice(annotationStart);
      const timekeeping = annotationPayload.startsWith("\u0014");
      const texts = annotationPayload
        .split("\u0014")
        .filter((text) => text.length > 0);

      const annotation: EdfAnnotation = {
        onsetSeconds,
        texts,
        timekeeping,
        dataRecordIndex,
      };
      if (durationSeconds !== undefined) annotation.durationSeconds = durationSeconds;
      annotations.push(annotation);
    }
    start = i + 1;
  }

  return annotations;
}

function parseSignalDefinitions(
  data: Uint8Array,
  header: EdfHeader,
): EdfSignalDefinition[] {
  const count = header.signalCount;
  let offset = FIXED_HEADER_BYTES;

  const labels = signalFieldBlock(data, offset, 16, count); offset = labels.nextOffset;
  const transducers = signalFieldBlock(data, offset, 80, count); offset = transducers.nextOffset;
  const dimensions = signalFieldBlock(data, offset, 8, count); offset = dimensions.nextOffset;
  const physicalMins = signalFieldBlock(data, offset, 8, count); offset = physicalMins.nextOffset;
  const physicalMaxes = signalFieldBlock(data, offset, 8, count); offset = physicalMaxes.nextOffset;
  const digitalMins = signalFieldBlock(data, offset, 8, count); offset = digitalMins.nextOffset;
  const digitalMaxes = signalFieldBlock(data, offset, 8, count); offset = digitalMaxes.nextOffset;
  const prefiltering = signalFieldBlock(data, offset, 80, count); offset = prefiltering.nextOffset;
  const samplesPerRecord = signalFieldBlock(data, offset, 8, count); offset = samplesPerRecord.nextOffset;
  const reserved = signalFieldBlock(data, offset, 32, count); offset = reserved.nextOffset;

  const expectedHeaderBytes = FIXED_HEADER_BYTES + count * SIGNAL_HEADER_BYTES;
  if (offset !== expectedHeaderBytes) throw new Error("Internal EDF signal-header size mismatch");

  const signals: EdfSignalDefinition[] = [];
  for (let index = 0; index < count; index += 1) {
    const physicalMinimum = parseNumber(physicalMins.values[index] ?? "", `signal ${index} physical minimum`);
    const physicalMaximum = parseNumber(physicalMaxes.values[index] ?? "", `signal ${index} physical maximum`);
    const digitalMinimum = parseNumber(digitalMins.values[index] ?? "", `signal ${index} digital minimum`);
    const digitalMaximum = parseNumber(digitalMaxes.values[index] ?? "", `signal ${index} digital maximum`);
    const samples = parseInteger(samplesPerRecord.values[index] ?? "", `signal ${index} samples/record`);

    if (samples < 0) throw new Error(`EDF signal ${index} has a negative samples/record value`);
    if (digitalMaximum === digitalMinimum) throw new Error(`EDF signal ${index} digital minimum equals maximum`);

    const gain = (physicalMaximum - physicalMinimum) / (digitalMaximum - digitalMinimum);
    const signalOffset = physicalMinimum - digitalMinimum * gain;
    const sampleRateHz = header.dataRecordDurationSeconds > 0
      ? samples / header.dataRecordDurationSeconds
      : 0;
    const label = labels.values[index] ?? "";

    signals.push({
      index,
      label,
      transducerType: transducers.values[index] ?? "",
      physicalDimension: dimensions.values[index] ?? "",
      physicalMinimum,
      physicalMaximum,
      digitalMinimum,
      digitalMaximum,
      prefiltering: prefiltering.values[index] ?? "",
      samplesPerRecord: samples,
      reserved: reserved.values[index] ?? "",
      gain,
      offset: signalOffset,
      sampleRateHz,
      isAnnotation: label === ANNOTATION_LABEL,
    });
  }
  return signals;
}

function parseHeader(data: Uint8Array): EdfHeader {
  if (data.length < FIXED_HEADER_BYTES) throw new Error(`EDF file is shorter than ${FIXED_HEADER_BYTES} bytes`);

  const version = field(data, 0, 8);
  const patientIdentification = field(data, 8, 80);
  const recordingIdentification = field(data, 88, 80);
  const startDate = field(data, 168, 8);
  const startTime = field(data, 176, 8);
  const headerBytes = parseInteger(field(data, 184, 8), "header byte count");
  const reserved = field(data, 192, 44);
  const dataRecordCount = parseInteger(field(data, 236, 8), "data record count");
  const dataRecordDurationSeconds = parseNumber(field(data, 244, 8), "data record duration");
  const signalCount = parseInteger(field(data, 252, 4), "signal count");

  if (signalCount <= 0) throw new Error(`EDF signal count must be positive, got ${signalCount}`);
  if (dataRecordCount < -1) throw new Error(`EDF data record count must be -1 or non-negative, got ${dataRecordCount}`);
  if (dataRecordDurationSeconds < 0) throw new Error("EDF data record duration cannot be negative");

  const minimumHeaderBytes = FIXED_HEADER_BYTES + signalCount * SIGNAL_HEADER_BYTES;
  if (headerBytes < minimumHeaderBytes) {
    throw new Error(`EDF header says ${headerBytes} bytes; at least ${minimumHeaderBytes} are required for ${signalCount} signals`);
  }
  if (data.length < headerBytes) throw new Error(`EDF file is truncated inside the header (${data.length} < ${headerBytes})`);

  return {
    version,
    patientIdentification,
    recordingIdentification,
    start: parseStart(startDate, startTime),
    headerBytes,
    reserved,
    dataRecordCount,
    dataRecordDurationSeconds,
    signalCount,
    continuity: continuityFromReserved(reserved),
  };
}

export function digitalToPhysical(signal: EdfSignalDefinition, digitalValue: number): number {
  return digitalValue * signal.gain + signal.offset;
}

export function physicalSamples(signal: EdfSignalData): Float64Array {
  const samples = signal.digitalSamples;
  if (!samples) return new Float64Array();
  const values = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    values[i] = digitalToPhysical(signal.definition, samples[i] ?? 0);
  }
  return values;
}

export function parseEdf(data: Uint8Array, options: ParseEdfOptions = {}): EdfFile {
  const strict = options.strict ?? true;
  const includeData = options.includeData ?? true;
  const header = parseHeader(data);
  const definitions = parseSignalDefinitions(data, header);
  const dataRecordSizeBytes = definitions.reduce((sum, signal) => sum + signal.samplesPerRecord * 2, 0);
  const payloadBytes = data.length - header.headerBytes;
  const warnings: string[] = [];

  if (dataRecordSizeBytes <= 0) throw new Error("EDF data record size is zero");

  const completeRecords = Math.floor(payloadBytes / dataRecordSizeBytes);
  const trailingBytes = payloadBytes % dataRecordSizeBytes;
  if (trailingBytes !== 0) {
    const message = `EDF payload has ${trailingBytes} trailing byte(s) after complete data records`;
    if (strict) throw new Error(message);
    warnings.push(message);
  }

  let parsedDataRecordCount = header.dataRecordCount === -1 ? completeRecords : header.dataRecordCount;
  if (header.dataRecordCount !== -1 && header.dataRecordCount > completeRecords) {
    const message = `EDF header declares ${header.dataRecordCount} data records but only ${completeRecords} complete record(s) are present`;
    if (strict) throw new Error(message);
    warnings.push(message);
    parsedDataRecordCount = completeRecords;
  } else if (header.dataRecordCount !== -1 && header.dataRecordCount < completeRecords) {
    warnings.push(`EDF file contains ${completeRecords} complete records but header declares ${header.dataRecordCount}; ignoring extra records`);
  }

  const signals: EdfSignalData[] = definitions.map((definition) => ({ definition }));
  const dataRecordOnsetsSeconds = Array.from(
    { length: parsedDataRecordCount },
    (_, index) => index * header.dataRecordDurationSeconds,
  );

  if (!includeData) {
    return { header, signals, parsedDataRecordCount, dataRecordSizeBytes, dataRecordOnsetsSeconds, warnings };
  }

  for (const signal of signals) {
    if (signal.definition.isAnnotation) signal.annotations = [];
    else signal.digitalSamples = new Int16Array(parsedDataRecordCount * signal.definition.samplesPerRecord);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let cursor = header.headerBytes;

  for (let recordIndex = 0; recordIndex < parsedDataRecordCount; recordIndex += 1) {
    for (const signal of signals) {
      const sampleCount = signal.definition.samplesPerRecord;
      const byteCount = sampleCount * 2;
      if (signal.definition.isAnnotation) {
        const recordAnnotations = parseAnnotations(data.subarray(cursor, cursor + byteCount), recordIndex);
        signal.annotations?.push(...recordAnnotations);
        const timekeeping = recordAnnotations.find((annotation) => annotation.timekeeping);
        if (timekeeping) dataRecordOnsetsSeconds[recordIndex] = timekeeping.onsetSeconds;
      } else {
        const target = signal.digitalSamples;
        if (!target) throw new Error("Internal EDF parser error: ordinary signal has no sample buffer");
        const base = recordIndex * sampleCount;
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
          target[base + sampleIndex] = view.getInt16(cursor + sampleIndex * 2, true);
        }
      }
      cursor += byteCount;
    }
  }

  return { header, signals, parsedDataRecordCount, dataRecordSizeBytes, dataRecordOnsetsSeconds, warnings };
}

export async function readEdfFile(path: string, options: ParseEdfOptions = {}): Promise<EdfFile> {
  const file = await readFile(path);
  const data = path.toLowerCase().endsWith(".gz") ? gunzipSync(file) : file;
  return parseEdf(data, options);
}

export function findEdfSignal(file: EdfFile, label: string, occurrence = 0): EdfSignalData | undefined {
  const matches = file.signals.filter((signal) => signal.definition.label === label);
  return matches[occurrence];
}
