import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..");
const rootDir = resolve(desktopDir, "../..");
const source = resolve(rootDir, "dist/src");
const target = resolve(desktopDir, "backend/src");
await rm(resolve(desktopDir, "backend"), { recursive: true, force: true });
await mkdir(resolve(desktopDir, "backend"), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Staged backend: ${source} -> ${target}`);
