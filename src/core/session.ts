import { EventList, EventListType, type EventListOptions } from "./event-list.js";
import { MachineType, type ChannelId, type SessionId, type SettingValue } from "./types.js";

export enum SliceStatus {
  Unknown = 0,
  EquipmentOff,
  MaskOn,
  MaskOff,
}

export interface SessionSlice {
  start: number;
  end: number;
  status: SliceStatus;
}

export class Session {
  readonly id: SessionId;
  readonly machineType: MachineType;
  enabled = true;
  summaryOnly = false;
  noSettings = false;
  changed = false;

  readonly eventLists = new Map<ChannelId, EventList[]>();
  readonly settings = new Map<ChannelId, SettingValue>();
  readonly slices: SessionSlice[] = [];

  #first = 0;
  #last = 0;

  constructor(id: SessionId, machineType: MachineType) {
    this.id = id;
    this.machineType = machineType;
  }

  get first(): number { return this.#first; }
  get last(): number { return this.#last; }
  get lengthMs(): number { return Math.max(0, this.#last - this.#first); }

  setFirst(timeMs: number): void {
    if (this.#first === 0 || timeMs < this.#first) this.#first = timeMs;
  }

  setLast(timeMs: number): void {
    if (this.#first !== 0 && timeMs <= this.#first) throw new RangeError("Session last time must be after first time");
    if (this.#last === 0 || timeMs > this.#last) this.#last = timeMs;
  }

  setBounds(firstMs: number, lastMs: number): void {
    if (lastMs < firstMs) throw new RangeError("Session end cannot be before start");
    this.#first = firstMs;
    this.#last = lastMs;
  }

  checkInside(timeMs: number): boolean { return timeMs >= this.#first && timeMs <= this.#last; }

  hours(): number {
    if (this.slices.length === 0) return this.lengthMs / 3_600_000;
    const maskOnMs = this.slices
      .filter((slice) => slice.status === SliceStatus.MaskOn)
      .reduce((total, slice) => total + Math.max(0, slice.end - slice.start), 0);
    return maskOnMs / 3_600_000;
  }

  addSlice(slice: SessionSlice): void { this.slices.push({ ...slice }); }

  addEventList(channelId: ChannelId, type: EventListType, options: EventListOptions = {}): EventList {
    const list = new EventList(type, options);
    const lists = this.eventLists.get(channelId) ?? [];
    lists.push(list);
    this.eventLists.set(channelId, lists);
    return list;
  }

  channelExists(channelId: ChannelId): boolean { return (this.eventLists.get(channelId)?.length ?? 0) > 0; }

  count(channelId: ChannelId): number {
    return (this.eventLists.get(channelId) ?? []).reduce((n, list) => n + list.count, 0);
  }

  sum(channelId: ChannelId): number {
    let total = 0;
    for (const list of this.eventLists.get(channelId) ?? []) {
      for (const value of list.values()) total += value;
    }
    return total;
  }

  min(channelId: ChannelId): number {
    const lists = this.eventLists.get(channelId) ?? [];
    if (lists.length === 0) return 0;
    return Math.min(...lists.filter((l) => l.count > 0).map((l) => l.min));
  }

  max(channelId: ChannelId): number {
    const lists = this.eventLists.get(channelId) ?? [];
    if (lists.length === 0) return 0;
    return Math.max(...lists.filter((l) => l.count > 0).map((l) => l.max));
  }

  avg(channelId: ChannelId): number {
    const count = this.count(channelId);
    return count === 0 ? 0 : this.sum(channelId) / count;
  }

  percentile(channelId: ChannelId, percentile: number): number {
    if (percentile < 0 || percentile > 1) throw new RangeError("Percentile must be between 0 and 1");
    const values = (this.eventLists.get(channelId) ?? []).flatMap((list) => list.values()).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const index = Math.min(values.length - 1, Math.max(0, Math.ceil(percentile * values.length) - 1));
    return values[index] ?? 0;
  }

  cph(channelId: ChannelId): number {
    const h = this.hours();
    return h > 0 ? this.count(channelId) / h : 0;
  }

  availableChannels(): ChannelId[] { return [...this.eventLists.keys()]; }
}
