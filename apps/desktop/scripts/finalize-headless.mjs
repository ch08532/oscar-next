import { access, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..");
const source = resolve(desktopDir, "headless-dist/headless.html");
const target = resolve(desktopDir, "headless-dist/index.html");
await access(source);
await copyFile(source, target);
console.log(`Headless entry: ${source} -> ${target}`);
