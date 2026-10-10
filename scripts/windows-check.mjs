const major = Number(process.versions.node.split(".")[0]);
const problems = [];
if (process.platform !== "win32") problems.push(`This check is intended for Windows; current platform is ${process.platform}.`);
if (!Number.isFinite(major) || major < 22) problems.push(`Node.js 22+ is required; found ${process.version}.`);
console.log(`OSCAR Next Windows check\n  Platform: ${process.platform} ${process.arch}\n  Node:     ${process.version}`);
if (problems.length) {
  for (const problem of problems) console.error(`ERROR: ${problem}`);
  process.exitCode = 1;
} else console.log("Environment looks ready.");
