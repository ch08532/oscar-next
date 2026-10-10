import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/**
 * First migration step for ResMed: detect an SD-card/root folder without parsing EDF yet.
 * OSCAR's loader recognizes ResMed media by the DATALOG directory and ResMed metadata files.
 */
export async function looksLikeResMedMedia(root: string): Promise<boolean> {
  try {
    if (!(await stat(root)).isDirectory()) return false;
  } catch {
    return false;
  }

  const datalog = join(root, "DATALOG");
  if (!(await exists(datalog))) return false;

  const entries = await readdir(root);
  const names = entries.map((entry: any) => typeof entry === "string" ? entry : entry.name);
  const hasIdentification = names.some((name: string) => name.toLowerCase().startsWith("identification."));
  const hasStr = names.some((name: string) => name.toLowerCase().startsWith("str."));

  // DATALOG is the core signature. Metadata strengthens confidence but isn't
  // mandatory because different generations/backups can vary.
  return hasIdentification || hasStr || (await stat(datalog)).isDirectory();
}
