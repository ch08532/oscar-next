import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

export type ResMedEdfType = "STR" | "BRP" | "PLD" | "SAD" | "SA2" | "EVE" | "CSL" | "AEV" | "UNKNOWN";

export interface ResMedEdfFile {
  path: string;
  type: ResMedEdfType;
}

export function classifyResMedEdfPath(path: string): ResMedEdfType {
  const name = basename(path).toUpperCase();
  if (/^STR(?:-[^.]+)?\.EDF(?:\.GZ)?$/.test(name)) return "STR";
  for (const type of ["BRP", "PLD", "SAD", "SA2", "EVE", "CSL", "AEV"] as const) {
    if (name.includes(type) && /\.EDF(?:\.GZ)?$/.test(name)) return type;
  }
  return "UNKNOWN";
}

async function walkEdfFiles(path: string, output: ResMedEdfFile[]): Promise<void> {
  let entries: any[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory?.()) {
      await walkEdfFiles(entryPath, output);
      continue;
    }
    if (!entry.isFile?.()) continue;
    const type = classifyResMedEdfPath(entryPath);
    if (type !== "UNKNOWN") output.push({ path: entryPath, type });
  }
}

export async function discoverResMedEdfFiles(root: string): Promise<ResMedEdfFile[]> {
  const files: ResMedEdfFile[] = [];
  await walkEdfFiles(root, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
