export interface EdfLocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export type EdfContinuity = "edf" | "continuous" | "discontinuous";

export interface EdfHeader {
  version: string;
  patientIdentification: string;
  recordingIdentification: string;
  start: EdfLocalDateTime;
  headerBytes: number;
  reserved: string;
  dataRecordCount: number;
  dataRecordDurationSeconds: number;
  signalCount: number;
  continuity: EdfContinuity;
}

export interface EdfSignalDefinition {
  index: number;
  label: string;
  transducerType: string;
  physicalDimension: string;
  physicalMinimum: number;
  physicalMaximum: number;
  digitalMinimum: number;
  digitalMaximum: number;
  prefiltering: string;
  samplesPerRecord: number;
  reserved: string;
  gain: number;
  offset: number;
  sampleRateHz: number;
  isAnnotation: boolean;
}

export interface EdfAnnotation {
  /** Seconds from the EDF file start. */
  onsetSeconds: number;
  durationSeconds?: number;
  /** One TAL can contain zero or more annotation strings. */
  texts: string[];
  /** True for the empty annotation used by EDF+ to timestamp a data record. */
  timekeeping: boolean;
  dataRecordIndex: number;
}

export interface EdfSignalData {
  definition: EdfSignalDefinition;
  /** Raw signed 16-bit samples. Undefined for EDF Annotations signals. */
  digitalSamples?: Int16Array;
  /** Parsed TAL annotations. Present only for EDF Annotations signals. */
  annotations?: EdfAnnotation[];
}

export interface EdfFile {
  header: EdfHeader;
  signals: EdfSignalData[];
  parsedDataRecordCount: number;
  dataRecordSizeBytes: number;
  /** Start time (seconds from file start) for each data record. */
  dataRecordOnsetsSeconds: number[];
  warnings: string[];
}

export interface ParseEdfOptions {
  /** Parse data samples/TAL annotations. Defaults to true. */
  includeData?: boolean;
  /** Reject truncated or inconsistent files. Defaults to true. */
  strict?: boolean;
}
