export type ChannelId = number;
export type MachineId = number;
export type SessionId = number;
export type EventData = number;
export type EventStore = number;

export const OSCAR_DATA_MAGIC = 0xc73216ab;

export enum MachineType {
  Unknown = 0,
  CPAP = 1,
  Oximeter = 2,
  SleepStage = 3,
  Journal = 4,
  Position = 5,
  Uncategorized = 99,
}

export enum CPAPMode {
  Unknown = 0,
  CPAP,
  APAP,
  BiLevelFixed,
  BiLevelAutoFixedPS,
  BiLevelAutoVariablePS,
  ASV,
  ASVVariableEPAP,
  AVAPS,
}

export interface MachineInfo {
  type: MachineType;
  capabilities: number;
  loaderName: string;
  brand: string;
  model: string;
  modelNumber: string;
  serial: string;
  series: string;
  lastImported?: Date;
  version: number;
}

export type SettingValue = boolean | number | string | Date | null;
