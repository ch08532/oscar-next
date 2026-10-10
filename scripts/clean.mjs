import { rm } from "node:fs/promises";
for (const path of ["dist", "apps/desktop/dist", "apps/desktop/backend", "apps/desktop/release"]) {
  await rm(path, { recursive: true, force: true });
}
console.log("Cleaned build outputs.");
