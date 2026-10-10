import { mkdir } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { startOscarApiServer } from "../api/server.js";
import { StructuredLogger } from "../desktop/logger.js";

interface CliOptions {
  databasePath: string;
  host: string;
  port: number;
  token?: string;
  allowImports: boolean;
  watchMedia: boolean;
  autoImportMedia: boolean;
  webRoot: string;
  logDirectory: string;
}

function usage(): string {
  return `OSCAR Next headless web service\n\nUsage:\n  npm run headless -- [options]\n\nOptions:\n  --database <path>      SQLite database path (default ./data/oscar-next.sqlite)\n  --host <host>          Bind address (default 127.0.0.1)\n  --port <port>          TCP port (default 3210)\n  --token <token>        Bearer token; also read from OSCAR_API_TOKEN\n  --allow-imports        Allow server-local CPAP folder imports and demo data\n  --watch-media          Watch mounted volumes for supported CPAP media (requires --allow-imports)\n  --auto-import-media    Automatically import detected supported media (requires --watch-media)\n  --web-root <path>      Built browser UI directory (default ./apps/desktop/headless-dist)\n  --log-dir <path>       Log directory (default alongside database under ./logs)\n  --help                 Show this help\n\nRecommended Raspberry Pi LAN mode:\n  OSCAR_API_TOKEN=<strong-random-token> npm run headless -- --host 0.0.0.0 --allow-imports --watch-media\n\nSafety:\n  Non-loopback binding is refused unless a bearer token is configured.\n`;
}

function parseArgs(args: string[]): CliOptions {
  let databasePath = resolve("./data/oscar-next.sqlite");
  let host = "127.0.0.1";
  let port = 3210;
  let token = process.env.OSCAR_API_TOKEN?.trim() || undefined;
  let allowImports = false;
  let watchMedia = false;
  let autoImportMedia = false;
  let webRoot = resolve("./apps/desktop/headless-dist");
  let logDirectory: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--database": databasePath = resolve(next()); break;
      case "--host": host = next(); break;
      case "--port": port = Number(next()); break;
      case "--token": token = next(); break;
      case "--allow-imports": allowImports = true; break;
      case "--watch-media": watchMedia = true; break;
      case "--auto-import-media": autoImportMedia = true; break;
      case "--web-root": webRoot = resolve(next()); break;
      case "--log-dir": logDirectory = resolve(next()); break;
      case "--help": console.log(usage()); process.exit(0); break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (watchMedia && !allowImports) throw new Error("--watch-media requires --allow-imports");
  if (autoImportMedia && !watchMedia) throw new Error("--auto-import-media requires --watch-media");
  return {
    databasePath,
    host,
    port,
    allowImports,
    watchMedia,
    autoImportMedia,
    webRoot,
    logDirectory: logDirectory ?? join(dirname(databasePath), "logs"),
    ...(token ? { token } : {}),
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(dirname(options.databasePath), { recursive: true });
  const logger = new StructuredLogger(options.logDirectory);
  await logger.init();

  const server = await startOscarApiServer({
    databasePath: options.databasePath,
    host: options.host,
    port: options.port,
    allowImports: options.allowImports,
    watchMedia: options.watchMedia,
    autoImportMedia: options.autoImportMedia,
    webRoot: options.webRoot,
    logFilePath: logger.filePath,
    previousLogFilePath: logger.previousFilePath,
    ...(options.token ? { token: options.token } : {}),
  });

  logger.info("headless.started", {
    host: options.host,
    port: server.port,
    importsEnabled: options.allowImports,
    mediaWatchEnabled: options.watchMedia,
  });
  console.log(`OSCAR Next headless UI: ${server.baseUrl}/`);
  console.log(`Swagger UI:             ${server.docsUrl}`);
  console.log(`OpenAPI:                ${server.baseUrl}/openapi.json`);
  console.log(`Imports:                ${options.allowImports ? "enabled" : "disabled"}`);
  console.log(`Media watch:            ${options.watchMedia ? "enabled" : "disabled"}`);
  console.log(`Automatic card import:  ${options.autoImportMedia ? "enabled" : "disabled"}`);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    logger.info("headless.stopping");
    await logger.flush();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\n" + usage());
  process.exitCode = 1;
}
