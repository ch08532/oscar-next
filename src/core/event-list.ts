import type { EventData, EventStore } from "./types.js";

export enum EventListType {
  Waveform = "waveform",
  Event = "event",
}

export interface EventListOptions {
  gain?: number;
  offset?: number;
  min?: number;
  max?: number;
  rateMs?: number;
  secondField?: boolean;
  dimension?: string;
}

/**
 * TypeScript counterpart to OSCAR SleepLib EventList.
 *
 * OSCAR stores event timestamps as uint32 millisecond deltas from the first
 * record and raw values as signed 16-bit integers. We keep the same external
 * semantics while using growable JS arrays during import; importers can obtain
 * compact Int16Array/Uint32Array snapshots after parsing.
 */
export class EventList {
  readonly type: EventListType;
  gain: number;
  offset: number;
  rateMs: number;
  dimension: string;

  #first = 0;
  #last = 0;
  #raw: EventStore[] = [];
  #raw2: EventStore[] = [];
  #timeDeltas: number[] = [];
  #secondField: boolean;
  #trackMinMax: boolean;
  #min: number;
  #max: number;
  #min2 = Number.POSITIVE_INFINITY;
  #max2 = Number.NEGATIVE_INFINITY;

  constructor(type: EventListType, options: EventListOptions = {}) {
    this.type = type;
    this.gain = options.gain ?? 1;
    this.offset = options.offset ?? 0;
    this.rateMs = options.rateMs ?? 0;
    this.dimension = options.dimension ?? "";
    this.#secondField = options.secondField ?? false;

    const min = options.min ?? 0;
    const max = options.max ?? 0;
    this.#trackMinMax = min === max;
    this.#min = this.#trackMinMax ? Number.POSITIVE_INFINITY : min;
    this.#max = this.#trackMinMax ? Number.NEGATIVE_INFINITY : max;
  }

  get count(): number { return this.#raw.length; }
  get first(): number { return this.#first; }
  get last(): number { return this.#last; }
  get duration(): number { return this.#last - this.#first; }
  get hasSecondField(): boolean { return this.#secondField; }
  get min(): number { return this.count ? this.#min : 0; }
  get max(): number { return this.count ? this.#max : 0; }
  get min2(): number { return this.#raw2.length ? this.#min2 : 0; }
  get max2(): number { return this.#raw2.length ? this.#max2 : 0; }

  clear(): void {
    this.#first = 0;
    this.#last = 0;
    this.#raw = [];
    this.#raw2 = [];
    this.#timeDeltas = [];
    this.#trackMinMax = true;
    this.#min = Number.POSITIVE_INFINITY;
    this.#max = Number.NEGATIVE_INFINITY;
    this.#min2 = Number.POSITIVE_INFINITY;
    this.#max2 = Number.NEGATIVE_INFINITY;
  }

  raw(index: number): EventStore { return this.#require(this.#raw, index); }
  raw2(index: number): EventStore { return this.#require(this.#raw2, index); }

  /** Matches OSCAR EventList::data(): raw * gain. Offset is intentionally not applied. */
  data(index: number): EventData { return this.raw(index) * this.gain; }
  data2(index: number): EventData { return this.raw2(index); }

  time(index: number): number {
    if (index < 0 || index >= this.count) throw new RangeError(`Event index ${index} out of range`);
    if (this.type === EventListType.Event) return this.#first + this.#require(this.#timeDeltas, index);
    return this.#first + index * this.rateMs;
  }

  addEvent(timeMs: number, value: EventStore, value2?: EventStore): void {
    if (this.type !== EventListType.Event) throw new Error("Cannot add discrete event data to a waveform EventList");
    this.#assertInt16(value);
    if (value2 !== undefined) this.#assertInt16(value2);

    const scaled = value * this.gain; // parity with OSCAR AddEvent: offset ignored
    this.#updatePrimaryMinMax(scaled);

    if (this.#raw.length === 0) {
      this.#first = timeMs;
      this.#last = timeMs;
    } else if (timeMs < this.#first) {
      const shift = this.#first - timeMs;
      this.#timeDeltas = this.#timeDeltas.map((delta) => delta + shift);
      this.#first = timeMs;
    }
    if (timeMs > this.#last) this.#last = timeMs;

    this.#raw.push(value);
    this.#timeDeltas.push(timeMs - this.#first);

    if (this.#secondField && value2 !== undefined) {
      this.#raw2.push(value2);
      this.#min2 = Math.min(this.#min2, value2);
      this.#max2 = Math.max(this.#max2, value2);
    }
  }

  addWaveform(startMs: number, samples: ArrayLike<number>, durationMs?: number): void {
    if (this.type !== EventListType.Waveform) throw new Error("Cannot add waveform data to an event EventList");
    if (this.rateMs <= 0) throw new Error("Waveform sample interval rateMs must be greater than zero");

    const n = samples.length;
    const duration = durationMs ?? n * this.rateMs;
    const end = startMs + duration;
    if (this.#raw.length === 0) this.#first = startMs;
    if (this.#last === 0 || end > this.#last) this.#last = end;

    for (let i = 0; i < n; i += 1) {
      const raw = samples[i];
      if (raw === undefined) continue;
      this.#assertInt16(raw);
      this.#raw.push(raw);
      this.#updatePrimaryMinMax(raw * this.gain + this.offset);
    }
  }

  rawData(): Int16Array { return Int16Array.from(this.#raw); }
  rawData2(): Int16Array { return Int16Array.from(this.#raw2); }
  timeDeltas(): Uint32Array { return Uint32Array.from(this.#timeDeltas); }

  values(): number[] { return this.#raw.map((raw) => raw * this.gain); }

  #updatePrimaryMinMax(value: number): void {
    if (!this.#trackMinMax) return;
    this.#min = Math.min(this.#min, value);
    this.#max = Math.max(this.#max, value);
  }

  #require<T>(array: readonly T[], index: number): T {
    const value = array[index];
    if (value === undefined) throw new RangeError(`Event index ${index} out of range`);
    return value;
  }

  #assertInt16(value: number): void {
    if (!Number.isInteger(value) || value < -32768 || value > 32767) {
      throw new RangeError(`Raw event value ${value} is outside signed 16-bit range`);
    }
  }
}
