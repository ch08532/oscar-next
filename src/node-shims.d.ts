declare const process: {
  argv: string[];
  exitCode?: number;
  env: Record<string, string | undefined>;
  platform: string;
  arch: string;
  version: string;
  versions: Record<string, string | undefined>;
  cwd(): string;
  exit(code?: number): never;
  on(event: string, callback: (...args: any[]) => void): void;
};

declare module "node:fs/promises" {
  export function access(path: string): Promise<void>;
  export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any[]>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
  export function appendFile(path: string, data: string | Uint8Array): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function stat(path: string): Promise<{ size: number; isDirectory(): boolean; isFile(): boolean }>;
}

declare module "node:os" {
  export function tmpdir(): string;
  export function platform(): string;
  export function release(): string;
  export function arch(): string;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function normalize(path: string): string;
  export function extname(path: string): string;
  export const sep: string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:zlib" {
  export function gunzipSync(data: Uint8Array): Uint8Array;
}

declare module "node:test" {
  export default function test(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | ((err: unknown) => boolean)): void;
  };
  export default assert;
}

declare module "node:sqlite" {
  export class StatementSync {
    run(...values: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...values: any[]): any;
    all(...values: any[]): any[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; enableForeignKeyConstraints?: boolean; allowExtension?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module "electron" {
  export const app: any;
  export class BrowserWindow {
    constructor(options?: any);
    static getAllWindows(): BrowserWindow[];
    loadURL(url: string): Promise<void>;
    loadFile(path: string): Promise<void>;
    webContents: { printToPDF(options?: any): Promise<Uint8Array>; send(channel: string, ...args: any[]): void };
    on(event: string, callback: (...args: any[]) => void): void;
    isDestroyed(): boolean;
    destroy(): void;
  }
  export const dialog: any;
  export const ipcMain: any;
  export const contextBridge: any;
  export const ipcRenderer: any;
}

declare module "node:child_process" {
  export function execFile(
    file: string,
    args: string[],
    options: { windowsHide?: boolean },
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ): void;
}

declare const Buffer: {
  from(value: string | Uint8Array): Uint8Array & { length: number };
  isBuffer(value: unknown): boolean;
  concat(values: readonly Uint8Array[]): Uint8Array & { toString(encoding?: string): string };
  byteLength(value: string): number;
};

declare module "node:crypto" {
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

declare module "node:http" {
  export type IncomingMessage = any;
  export type ServerResponse = any;
  export function createServer(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): any;
}
