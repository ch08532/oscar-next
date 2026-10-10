import { Machine } from "../../core/machine.js";
import { machineIdFromInfo } from "../../core/identity.js";
import { MachineType, type MachineInfo } from "../../core/types.js";
import { readEdfFile } from "../edf/edf-parser.js";
import type { ImportContext, ImportResult, MachineLoader } from "../machine-loader.js";
import { looksLikeResMedMedia } from "./resmed-detector.js";
import { discoverResMedEdfFiles } from "./resmed-files.js";
import { mapResMedSessions } from "./resmed-session-mapper.js";
import { readResMedIdentification } from "./resmed-identification.js";

/** ResMed importer migration. Milestone 0.4 maps detailed EDF data into Session/EventList objects. */
export class ResMedLoader implements MachineLoader {
  readonly name = "ResMed";
  readonly version = 5;

  detect(path: string): Promise<boolean> { return looksLikeResMedMedia(path); }

  async peekInfo(path: string): Promise<MachineInfo | undefined> {
    if (!(await this.detect(path))) return undefined;
    const identification = await readResMedIdentification(path);
    return {
      type: MachineType.CPAP,
      capabilities: 0,
      loaderName: this.name,
      brand: "ResMed",
      model: identification?.model ?? "",
      modelNumber: identification?.modelNumber ?? "",
      serial: identification?.serial ?? "",
      series: identification?.series ?? "",
      version: this.version,
    };
  }

  async open(path: string, context?: ImportContext): Promise<ImportResult> {
    const info = await this.peekInfo(path);
    if (!info) throw new Error(`Not a ResMed media path: ${path}`);

    context?.onProgress?.({ current: 0, message: "Scanning ResMed EDF files" });
    const files = await discoverResMedEdfFiles(path);
    const warnings: string[] = [];
    const str = files.find((file) => file.type === "STR");

    if (str) {
      try {
        const summary = await readEdfFile(str.path, { includeData: false, strict: false });
        warnings.push(...summary.warnings.map((warning) => `STR.edf: ${warning}`));
      } catch (error) {
        warnings.push(`STR.edf could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      warnings.push("No STR.edf summary file was found.");
    }

    context?.onProgress?.({ current: 0, total: files.length, message: `Mapping ${files.length} ResMed EDF file(s)` });
    const air11 = /(?:AirSense|AirCurve)\s*11/i.test(info.model) || Number(info.modelNumber) >= 39000;
    const mapped = await mapResMedSessions(files, (completed, total, file) => {
      if (context?.signal?.aborted) throw new Error("Import cancelled");
      context?.onProgress?.({ current: completed, total, message: `Reading ${file.type}: ${file.path.split(/[\\/]/).pop() ?? file.path}` });
    }, { air11 });
    warnings.push(...mapped.warnings);

    const machine = new Machine(machineIdFromInfo(info), info);
    for (const session of mapped.sessions) machine.addSession(session);

    context?.onProgress?.({ current: files.length, total: files.length, message: `Imported ${mapped.sessions.length} ResMed session(s)` });
    return {
      machine,
      sessionsImported: mapped.sessions.length,
      warnings,
    };
  }
}
