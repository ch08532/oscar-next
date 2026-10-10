import { appendFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY = /(serial|profile.?name|patient|user.?name|source.?path|database.?path|file.?path|directory|folder)/i;

function redactPaths(value: string): string {
  return value
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[path]")
    .replace(/\/(?:Users|home|mnt|media|Volumes)\/[^\s"']+/g, "[path]");
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (value instanceof Error) return { name: value.name, message: redactPaths(value.message), ...(value.stack ? { stack: redactPaths(value.stack) } : {}) };
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(key, item));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) output[childKey] = sanitizeValue(childKey, childValue);
    return output;
  }
  if (typeof value === "string") return redactPaths(value);
  return value;
}

export function sanitizeLogFields(fields: LogFields = {}): LogFields {
  const output: LogFields = {};
  for (const [key, value] of Object.entries(fields)) output[key] = sanitizeValue(key, value);
  return output;
}

export class StructuredLogger {
  readonly directory: string;
  readonly filePath: string;
  readonly previousFilePath: string;
  readonly maxBytes: number;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(directory: string, options: { maxBytes?: number } = {}) {
    this.directory = directory;
    this.filePath = join(directory, "oscar-next.log");
    this.previousFilePath = join(directory, "oscar-next.previous.log");
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  }

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  debug(event: string, fields?: LogFields): void { this.#queue("debug", event, fields); }
  info(event: string, fields?: LogFields): void { this.#queue("info", event, fields); }
  warn(event: string, fields?: LogFields): void { this.#queue("warn", event, fields); }
  error(event: string, fields?: LogFields): void { this.#queue("error", event, fields); }

  async flush(): Promise<void> { await this.#writeChain; }

  #queue(level: LogLevel, event: string, fields: LogFields = {}): void {
    const record = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...sanitizeLogFields(fields) }) + "\n";
    this.#writeChain = this.#writeChain.then(async () => {
      await this.#rotateIfNeeded(record.length);
      await appendFile(this.filePath, record);
    }).catch(async () => {
      // Logging must never crash the application. Reset the chain so later writes can recover.
      try { await mkdir(this.directory, { recursive: true }); await writeFile(this.filePath, record); } catch { /* ignore */ }
    });
  }

  async #rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentBytes = 0;
    try { currentBytes = (await stat(this.filePath)).size; } catch { return; }
    if (currentBytes + incomingBytes <= this.maxBytes) return;
    try { await rm(this.previousFilePath, { force: true }); } catch { /* no previous log */ }
    try { await rename(this.filePath, this.previousFilePath); } catch { /* another process/run may have moved it */ }
  }
}
