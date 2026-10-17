import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ExpertTools, toolRegistry } from "./tools.js";
import { scopeSchema } from "./schemas.js";

export function createExpertMcpServer(tools: ExpertTools): McpServer {
  const server = new McpServer({ name: "oscar-expert",version: "1.0.0" });
  for (const [name,tool] of Object.entries(toolRegistry)) server.registerTool(`oscar_${name}`, { description: tool.description, inputSchema: tool.schema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (args: unknown) => {
    // A stdio host outlives one review: never reuse a previous request's snapshot.
    try { tools.clearCache(); const result = tools.call(name,args); return { content: [{ type: "text" as const,text: JSON.stringify(result) }] }; }
    catch { return { isError: true,content: [{ type: "text" as const,text: "Expert tool failed. Check scope, supported channels, dates and range limits." }] }; }
  });
  server.registerResource("capabilities", "oscar://capabilities", { description: "Read-only Expert capabilities; no patient identity" }, async () => ({ contents: [{ uri: "oscar://capabilities",mimeType: "application/json",text: JSON.stringify({ tools: Object.keys(toolRegistry),readOnly: true,maxRangeDays: 90,maxFeatureWindowMinutes: 60,scope: tools.scope }) }] }));
  server.registerPrompt("review-night", { description: "Review a night using measured OSCAR evidence", argsSchema: toolRegistry.get_night_summary.schema }, ({ date }) => ({ messages: [{ role: "user" as const,content: { type: "text" as const,text: `Use oscar_get_night_summary for ${date}, then read-only tools if needed. Distinguish summary indices from detailed events and missing coverage from zero. Cite evidence IDs. Provide educational observations and clinician questions, never diagnosis or therapy changes.` } }] }));
  return server;
}
export function defaultExpertDatabase(): string {
  if (process.env.OSCAR_DATABASE) return resolve(process.env.OSCAR_DATABASE);
  const root = process.platform === "win32" ? process.env.APPDATA ?? join(homedir(),"AppData","Roaming") : process.platform === "darwin" ? join(homedir(),"Library","Application Support") : process.env.XDG_CONFIG_HOME ?? join(homedir(),".config");
  return join(root,"oscar-next","oscar-next.sqlite");
}
export function resolveMcpScope(path: string, profileId?: number, machineId?: number): { profileId: number; machineId: number } {
  const db = new DatabaseSync(path,{ readOnly: true });
  try {
    const active = db.prepare("SELECT value FROM app_settings WHERE key='active_profile_id'").get() as { value: string } | undefined;
    const first = db.prepare("SELECT id FROM profiles ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    const profile = profileId ?? (active ? Number(active.value) : first?.id);
    if (!profile) throw new Error("No selected profile; configure OSCAR first");
    const machines = db.prepare("SELECT id FROM machines WHERE profile_id=? ORDER BY id").all(profile) as Array<{ id: number }>;
    const machine = machineId ?? (machines.length === 1 ? machines[0]?.id : undefined);
    if (machine === undefined || !machines.some(item => item.id === machine)) throw new Error("Choose --machine for the selected profile");
    return scopeSchema.parse({ profileId: profile,machineId: machine });
  } finally { db.close(); }
}
async function main(): Promise<void> {
  let path = defaultExpertDatabase(), profile: number | undefined,machine: number | undefined, check = false;
  const args = process.argv.slice(2);
  for (let i=0;i<args.length;i++) {
    const arg = args[i]; if (arg === "--check") { check = true; continue; }
    if (arg === "--help") { console.error("OSCAR Expert MCP: --database <file> --profile <id> --machine <id> [--check]. Read-only stdio. Set OSCAR_DATABASE for headless/custom databases."); return; }
    const value = args[++i]; if (!value) throw new Error("Missing MCP argument value");
    if (arg === "--database") path = resolve(value); else if (arg === "--profile") profile = Number(value); else if (arg === "--machine") machine = Number(value); else throw new Error("Unknown MCP argument");
  }
  const scope = resolveMcpScope(path,profile,machine), tools = new ExpertTools(path,scope);
  if (check) { createExpertMcpServer(tools); console.error(JSON.stringify({ status: "ready",scope,tools: Object.keys(toolRegistry),readOnly: true })); tools.close(); return; }
  const handle = serveStdio(() => createExpertMcpServer(tools));
  let closed = false;
  const close = () => { if (closed) return; closed = true; void handle.close().finally(() => { tools.close(); }); };
  process.once("SIGINT",close); process.once("SIGTERM",close);
  process.stdin.once("end",close);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main().catch(() => { console.error("OSCAR MCP could not start. Check the existing database, selected profile/machine and schema. No database was created or migrated."); process.exitCode=1; });
