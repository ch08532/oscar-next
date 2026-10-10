import { resolve } from "node:path";
import { startOscarApiServer } from "./server.js";

interface CliOptions {
  databasePath?: string;
  host: string;
  port: number;
  token?: string;
  allowImports: boolean;
}

function usage(): string {
  return `OSCAR Next REST API\n\nUsage:\n  npm run api -- --database ./oscar.sqlite [options]\n\nOptions:\n  --database <path>      SQLite database path (required)\n  --host <host>          Bind address (default 127.0.0.1)\n  --port <port>          TCP port (default 3210; use 0 for an ephemeral port)\n  --token <token>        Bearer token; also read from OSCAR_API_TOKEN\n  --allow-imports        Enable filesystem import endpoints\n  --help                 Show this help\n\nSafety:\n  Non-loopback binding is refused unless a bearer token is configured.\n  Import endpoints are disabled unless --allow-imports is supplied.\n`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { host: "127.0.0.1", port: 3210, allowImports: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--database": options.databasePath = resolve(next()); break;
      case "--host": options.host = next(); break;
      case "--port": options.port = Number(next()); break;
      case "--token": options.token = next(); break;
      case "--allow-imports": options.allowImports = true; break;
      case "--help": console.log(usage()); process.exit(0);
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  const envToken = process.env.OSCAR_API_TOKEN;
  if (!options.token && envToken) options.token = envToken;
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.databasePath) throw new Error("--database is required");
  const server = await startOscarApiServer({
    databasePath: options.databasePath,
    host: options.host,
    port: options.port,
    allowImports: options.allowImports,
    ...(options.token ? { token: options.token } : {}),
  });
  console.log(`OSCAR Next API ${server.baseUrl}`);
  console.log(`Swagger UI: ${server.docsUrl}`);
  console.log(`OpenAPI:    ${server.baseUrl}/openapi.json`);
  console.log(`Imports:    ${options.allowImports ? "enabled" : "disabled"}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\n" + usage());
  process.exitCode = 1;
}
