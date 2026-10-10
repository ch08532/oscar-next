import type { MachineId, MachineInfo } from "./types.js";

/**
 * Produce a deterministic positive 31-bit machine id from stable device identity.
 * Serial number is preferred; model information prevents obvious cross-brand collisions.
 */
export function machineIdFromInfo(info: Pick<MachineInfo, "brand" | "modelNumber" | "model" | "serial">): MachineId {
  const identity = [info.brand, info.modelNumber, info.model, info.serial].join("|").trim().toLocaleLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const result = hash & 0x7fffffff;
  return result === 0 ? 1 : result;
}
