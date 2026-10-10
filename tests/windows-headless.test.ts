import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Windows headless deployment includes a real ServiceBase wrapper and management scripts", async () => {
  const text = async (path: string) => new TextDecoder().decode(await readFile(path));
  const service = await text("deploy/windows-headless/OscarNextHeadlessService.cs");
  const install = await text("scripts/windows-headless-install.ps1");
  const start = await text("scripts/windows-headless-start.ps1");
  const stop = await text("scripts/windows-headless-stop.ps1");
  const status = await text("scripts/windows-headless-status.ps1");
  const uninstall = await text("scripts/windows-headless-uninstall.ps1");

  assert.ok(/ServiceBase/.test(service));
  assert.ok(/OscarNextHeadless/.test(service));
  assert.ok(/--watch-media/.test(service));
  assert.ok(/--auto-import-media/.test(service));
  assert.ok(/sc\.exe create/.test(install));
  assert.ok(/New-NetFirewallRule/.test(install));
  assert.ok(/AutoImportMedia/.test(install));
  assert.ok(/Start-Service OscarNextHeadless/.test(start));
  assert.ok(/Stop-Service OscarNextHeadless/.test(stop));
  assert.ok(/Get-Service OscarNextHeadless/.test(status));
  assert.ok(/sc\.exe delete/.test(uninstall));
});
