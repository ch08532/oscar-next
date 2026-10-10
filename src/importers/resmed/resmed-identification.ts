import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ResMedIdentification {
  serial?: string;
  model?: string;
  modelNumber?: string;
  deviceId?: string;
  firmware?: string;
  series?: string;
  raw: Readonly<Record<string, string>>;
}

function inferSeries(model?: string): string | undefined {
  if (!model) return undefined;
  const normalized = model.replaceAll("_", " ").trim();
  const match = /\b(AirSense|AirCurve)\s+(10|11)\b/i.exec(normalized);
  return match ? `${match[1]} ${match[2]}` : undefined;
}

export function parseResMedIdentificationTgt(text: string): ResMedIdentification {
  const raw: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^#([A-Z0-9]+)\s+(.*)$/.exec(line.trim());
    if (!match) continue;
    raw[match[1] ?? ""] = (match[2] ?? "").trim();
  }

  const result: ResMedIdentification = { raw };
  if (raw.SRN) result.serial = raw.SRN;
  if (raw.PNA) result.model = raw.PNA.replaceAll("_", " ");
  if (raw.PCD) result.modelNumber = raw.PCD;
  if (raw.SID) result.deviceId = raw.SID;
  if (raw.FGT) result.firmware = raw.FGT;
  const series = inferSeries(result.model);
  if (series) result.series = series;
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Supports the nested Identification.json structure used on newer ResMed cards. */
export function parseResMedIdentificationJson(text: string): ResMedIdentification | undefined {
  try {
    const root = asRecord(JSON.parse(text));
    if (!root) return undefined;
    const flowGenerator = asRecord(root.FlowGenerator) ?? root;
    const profiles = asRecord(flowGenerator.IdentificationProfiles) ?? flowGenerator;
    const product = asRecord(profiles.Product) ?? profiles;
    const device = asRecord(profiles.Device) ?? profiles;

    const raw: Record<string, string> = {};
    const collectPrimitive = (prefix: string, record: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          raw[prefix ? `${prefix}.${key}` : key] = String(value);
        }
      }
    };
    collectPrimitive("Product", product);
    collectPrimitive("Device", device);

    const textValue = (record: Record<string, unknown>, ...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" || typeof value === "number") return String(value).trim();
      }
      return undefined;
    };

    const result: ResMedIdentification = { raw };
    const serial = textValue(product, "SerialNumber", "Serial", "SRN");
    const modelNumber = textValue(product, "ProductCode", "ModelNumber", "PCD");
    const model = textValue(product, "ProductName", "ModelName", "PNA")?.replaceAll("_", " ");
    const deviceId = textValue(device, "DeviceID", "DeviceId", "SID") ?? textValue(product, "DeviceID", "DeviceId", "SID");
    const firmware = textValue(device, "FirmwareVersion", "Firmware", "FGT") ?? textValue(product, "FirmwareVersion", "Firmware", "FGT");
    if (serial) result.serial = serial;
    if (modelNumber) result.modelNumber = modelNumber;
    if (model) result.model = model;
    if (deviceId) result.deviceId = deviceId;
    if (firmware) result.firmware = firmware;
    const series = inferSeries(model); if (series) result.series = series;
    return result;
  } catch {
    return undefined;
  }
}

async function tryReadText(path: string): Promise<string | undefined> {
  try {
    return new TextDecoder("utf-8").decode(await readFile(path));
  } catch {
    return undefined;
  }
}

export async function readResMedIdentification(root: string): Promise<ResMedIdentification | undefined> {
  // Current OSCAR prefers Identification.json on newer cards when both exist.
  const json = await tryReadText(join(root, "Identification.json"));
  if (json !== undefined) {
    const parsed = parseResMedIdentificationJson(json);
    if (parsed) return parsed;
  }

  const tgt = await tryReadText(join(root, "Identification.tgt"));
  if (tgt !== undefined) return parseResMedIdentificationTgt(tgt);
  return undefined;
}
