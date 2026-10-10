import type { ChannelId } from "./types.js";
import { MachineType } from "./types.js";

export enum ChannelType {
  Data = 1,
  Setting = 2,
  Flag = 4,
  MinorFlag = 8,
  Span = 16,
  Waveform = 32,
  Unknown = 64,
  All = 0xffff,
}

export enum ChannelDataType {
  Default = 0,
  Integer,
  Boolean,
  Double,
  String,
  RichText,
  Date,
  Time,
  DateTime,
  Lookup,
}

export enum ChannelScope {
  Global = 0,
  Machine,
  Day,
  Session,
}

export interface ChannelDefinition {
  id: ChannelId;
  type: ChannelType;
  machineType: MachineType;
  scope: ChannelScope;
  code: string;
  name: string;
  description: string;
  label: string;
  unit: string;
  dataType: ChannelDataType;
  order?: number;
  enabled?: boolean;
  showInOverview?: boolean;
}

export class ChannelRegistry {
  readonly #byId = new Map<ChannelId, ChannelDefinition>();
  readonly #byCode = new Map<string, ChannelDefinition>();

  register(channel: ChannelDefinition): void {
    if (this.#byId.has(channel.id)) throw new Error(`Duplicate channel id: ${channel.id}`);
    if (this.#byCode.has(channel.code)) throw new Error(`Duplicate channel code: ${channel.code}`);
    this.#byId.set(channel.id, Object.freeze({ ...channel }));
    this.#byCode.set(channel.code, Object.freeze({ ...channel }));
  }

  byId(id: ChannelId): ChannelDefinition | undefined { return this.#byId.get(id); }
  byCode(code: string): ChannelDefinition | undefined { return this.#byCode.get(code); }
  all(): readonly ChannelDefinition[] { return [...this.#byId.values()]; }
}
