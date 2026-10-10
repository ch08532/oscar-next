import test from "node:test";
import { execFile } from "node:child_process";

test("Windows bootstrap and packaging stop before npm when the environment check fails", async () => {
  if (process.platform !== "win32") return;
  for (const script of ["windows-dev.ps1", "windows-package.ps1"]) {
    const command = `function node { $global:LASTEXITCODE = 23 }
function npm { throw 'npm must not run after a failed environment check' }
try { . ./scripts/${script}; throw 'Bootstrap incorrectly succeeded' }
catch { if ($_.Exception.Message -ne 'Windows environment check failed (23).') { Write-Error $_; exit 1 } }
exit 0`;
    await new Promise<void>((resolve, reject) => {
      execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(new Error(`${script}: ${stdout}\n${stderr}`));
        else resolve();
      });
    });
  }
});
