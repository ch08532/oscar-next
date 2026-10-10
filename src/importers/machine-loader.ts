import type { MachineInfo } from "../core/types.js";
import type { Machine } from "../core/machine.js";

export interface ImportProgress {
  current: number;
  total?: number;
  message?: string;
}

export interface ImportContext {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportResult {
  machine: Machine;
  sessionsImported: number;
  warnings: string[];
}

/** TypeScript equivalent of OSCAR's MachineLoader abstract base class. */
export interface MachineLoader {
  readonly name: string;
  readonly version: number;
  detect(path: string): Promise<boolean>;
  peekInfo(path: string): Promise<MachineInfo | undefined>;
  open(path: string, context?: ImportContext): Promise<ImportResult>;
}
