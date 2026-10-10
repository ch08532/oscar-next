import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { ImportPreview } from "../importers/import-service.js";

export interface VolumeInfo {
  rootPath: string;
  label?: string;
  removable?: boolean;
}

export interface VolumeProvider {
  listVolumes(): Promise<VolumeInfo[]>;
}

type ExecResult = { stdout: string; stderr: string };

function runFile(command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error: Error | null, stdout: string, stderr: string) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function normalizeWindowsJson(raw: string): Array<{ rootPath?: string; label?: string; removable?: boolean }> {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed as { rootPath?: string; label?: string; removable?: boolean }];
}

export class WindowsVolumeProvider implements VolumeProvider {
  async listVolumes(): Promise<VolumeInfo[]> {
    // Include fixed drive letters as well as removable drives. Some card readers
    // report removable media as DriveType 3. The media probe is cheap and the
    // watcher only reacts when a volume first appears.
    const script = [
      "$ErrorActionPreference='Stop'",
      "$items = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 -or $_.DriveType -eq 3 } | ForEach-Object { [PSCustomObject]@{ rootPath = ($_.DeviceID + '\\'); label = $_.VolumeName; removable = ($_.DriveType -eq 2) } }",
      "$items | ConvertTo-Json -Compress",
    ].join("; ");
    const { stdout } = await runFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return normalizeWindowsJson(stdout)
      .filter((item): item is { rootPath: string; label?: string; removable?: boolean } => typeof item.rootPath === "string")
      .map((item) => ({ rootPath: item.rootPath, ...(item.label ? { label: item.label } : {}), ...(item.removable !== undefined ? { removable: item.removable } : {}) }));
  }
}

export class MacVolumeProvider implements VolumeProvider {
  async listVolumes(): Promise<VolumeInfo[]> {
    const base = "/Volumes";
    let names: string[];
    try { names = (await readdir(base)).map((entry: any) => typeof entry === "string" ? entry : entry.name); }
    catch { return []; }
    const result: VolumeInfo[] = [];
    for (const name of names) {
      const rootPath = join(base, name);
      try {
        if ((await stat(rootPath)).isDirectory()) result.push({ rootPath, label: name, removable: true });
      } catch { /* volume disappeared during enumeration */ }
    }
    return result;
  }
}

interface LsblkDevice {
  name?: string;
  label?: string | null;
  mountpoint?: string | null;
  rm?: boolean | number;
  type?: string;
  children?: LsblkDevice[];
}

function flattenLsblk(devices: LsblkDevice[]): LsblkDevice[] {
  const output: LsblkDevice[] = [];
  for (const device of devices) {
    output.push(device);
    if (device.children) output.push(...flattenLsblk(device.children));
  }
  return output;
}

async function linuxVolumesFromProc(): Promise<VolumeInfo[]> {
  try {
    const raw = new TextDecoder().decode(await readFile("/proc/mounts"));
    const volumes: VolumeInfo[] = [];
    for (const line of raw.split("\n")) {
      const [device, escapedMount] = line.split(" ");
      if (!device?.startsWith("/dev/") || !escapedMount || escapedMount === "/") continue;
      const rootPath = escapedMount.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\134/g, "\\");
      if (rootPath.startsWith("/boot")) continue;
      volumes.push({ rootPath });
    }
    return volumes;
  } catch { return []; }
}

export class LinuxVolumeProvider implements VolumeProvider {
  async listVolumes(): Promise<VolumeInfo[]> {
    try {
      const { stdout } = await runFile("lsblk", ["--json", "--output", "NAME,LABEL,MOUNTPOINT,RM,TYPE"]);
      const parsed = JSON.parse(stdout) as { blockdevices?: LsblkDevice[] };
      return flattenLsblk(parsed.blockdevices ?? [])
        .filter((device) => typeof device.mountpoint === "string" && device.mountpoint !== "/" && device.type !== "loop")
        .map((device) => ({
          rootPath: device.mountpoint as string,
          ...(device.label ? { label: device.label } : {}),
          ...(device.rm !== undefined ? { removable: Boolean(device.rm) } : {}),
        }));
    } catch {
      return linuxVolumesFromProc();
    }
  }
}

export function createSystemVolumeProvider(platform = process.platform): VolumeProvider {
  if (platform === "win32") return new WindowsVolumeProvider();
  if (platform === "darwin") return new MacVolumeProvider();
  return new LinuxVolumeProvider();
}

export interface DetectedMedia {
  volume: VolumeInfo;
  preview: ImportPreview;
}

export type MediaProbe = (rootPath: string) => Promise<ImportPreview | undefined>;

export class RemovableMediaWatcher {
  readonly #provider: VolumeProvider;
  readonly #probe: MediaProbe;
  readonly #onDetected: (detected: DetectedMedia) => void;
  readonly #intervalMs: number;
  readonly #probeExistingOnStart: boolean;
  #knownRoots = new Set<string>();
  #promptedRoots = new Set<string>();
  #timer: ReturnType<typeof setInterval> | undefined;
  #polling = false;
  #initialized = false;

  constructor(options: {
    provider: VolumeProvider;
    probe: MediaProbe;
    onDetected(detected: DetectedMedia): void;
    intervalMs?: number;
    probeExistingOnStart?: boolean;
  }) {
    this.#provider = options.provider;
    this.#probe = options.probe;
    this.#onDetected = options.onDetected;
    this.#intervalMs = options.intervalMs ?? 2_000;
    this.#probeExistingOnStart = options.probeExistingOnStart ?? true;
  }

  async pollOnce(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      const volumes = await this.#provider.listVolumes();
      const current = new Map(volumes.map((volume) => [volume.rootPath, volume]));

      // Allow a removed/reinserted card to prompt again.
      for (const root of this.#knownRoots) {
        if (!current.has(root)) this.#promptedRoots.delete(root);
      }

      const candidates = volumes.filter((volume) => {
        if (this.#promptedRoots.has(volume.rootPath)) return false;
        if (!this.#initialized) return this.#probeExistingOnStart;
        return !this.#knownRoots.has(volume.rootPath);
      });

      this.#knownRoots = new Set(current.keys());
      this.#initialized = true;

      for (const volume of candidates) {
        try {
          const preview = await this.#probe(volume.rootPath);
          if (!preview) continue;
          this.#promptedRoots.add(volume.rootPath);
          this.#onDetected({ volume, preview });
        } catch {
          // A volume can disappear while it is being probed; retry only if it
          // later reappears as a newly mounted volume.
        }
      }
    } finally {
      this.#polling = false;
    }
  }

  start(): void {
    if (this.#timer) return;
    void this.pollOnce();
    this.#timer = setInterval(() => { void this.pollOnce(); }, this.#intervalMs);
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
