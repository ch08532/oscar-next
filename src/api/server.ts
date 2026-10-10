import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import openApiDocument from "../../openapi/oscar-next.openapi.json" with { type: "json" };
import { systemTimeZone } from "../core/device-time.js";
import { importSourceToDatabase, previewImportSource } from "../importers/import-service.js";
import { createDemoResMedCard } from "../demo/demo-card.js";
import { statisticsToCsv, statisticsToHtml } from "../reports/statistics-report.js";
import { OscarDatabase } from "../storage/database.js";
import { OscarQueries, type ChartQueryOptions } from "../storage/queries.js";
import { createDiagnosticBundle } from "../desktop/diagnostics.js";
import { createSystemVolumeProvider, RemovableMediaWatcher, type DetectedMedia } from "../desktop/removable-media.js";

export const API_VERSION = "2.3.0";

export interface OscarApiServerOptions {
  databasePath: string;
  host?: string;
  port?: number;
  token?: string;
  allowImports?: boolean;
  watchMedia?: boolean;
  autoImportMedia?: boolean;
  webRoot?: string;
  demoRoot?: string;
  logFilePath?: string;
  previousLogFilePath?: string;
}

export interface RunningOscarApiServer {
  host: string;
  port: number;
  baseUrl: string;
  docsUrl: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isLoopback(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function tokenMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireInteger(raw: string | undefined, name: string): number {
  if (raw === undefined || raw === "") throw new HttpError(400, `${name} is required`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new HttpError(400, `${name} must be an integer`);
  return value;
}

function optionalInteger(raw: string | null, name: string): number | undefined {
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new HttpError(400, `${name} must be an integer`);
  return value;
}

function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) result[key] = jsonSafe(child);
    return result;
  }
  return value;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(jsonSafe(body));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, { "cache-control": "no-store" });
  response.end();
}

function sendBytes(response: ServerResponse, status: number, body: Uint8Array, contentType: string, fileName?: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": body.byteLength,
    "cache-control": "no-store",
    ...(fileName ? { "content-disposition": `attachment; filename="${fileName.replace(/\"/g, "")}"` } : {}),
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8", fileName?: string): void {
  sendBytes(response, status, Buffer.from(body), contentType, fileName);
}

const STATIC_MIME: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

async function tryServeWebAsset(response: ServerResponse, webRoot: string, pathname: string): Promise<boolean> {
  if (pathname.startsWith("/api/") || pathname === "/openapi.json" || pathname.startsWith("/docs")) return false;
  const root = resolve(webRoot);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalizedRelative = normalize(relative).replace(/^([.]{2}[\\/])+/, "");
  let path = resolve(root, normalizedRelative);
  if (path !== root && !path.startsWith(root + sep)) return false;
  try {
    const bytes = await readFile(path);
    sendBytes(response, 200, bytes, STATIC_MIME[extname(path).toLowerCase()] ?? "application/octet-stream");
    return true;
  } catch {
    // SPA fallback for browser routes without a file extension.
    if (!extname(pathname)) {
      path = join(root, "index.html");
      try {
        const bytes = await readFile(path);
        sendBytes(response, 200, bytes, "text/html; charset=utf-8");
        return true;
      } catch { /* no web build */ }
    }
    return false;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? (chunk as Uint8Array) : Buffer.from(chunk as Uint8Array);
    length += bytes.length;
    if (length > 1_048_576) throw new HttpError(413, "Request body exceeds 1 MiB");
    chunks.push(bytes);
  }
  if (length === 0) return {};
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().includes("application/json")) throw new HttpError(415, "Content-Type must be application/json");
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object expected");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new HttpError(400, `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function swaggerHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OSCAR Next API – Swagger UI</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
<style>body{margin:0;background:#fafafa}.offline{padding:10px 16px;font:13px system-ui;color:#555}</style>
</head><body><div class="offline">Swagger UI assets are loaded from jsDelivr. The raw contract is always available at <a href="/openapi.json">/openapi.json</a>.</div><div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>window.onload=()=>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,persistAuthorization:true,displayRequestDuration:true,tryItOutEnabled:true});</script>
</body></html>`;
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
  });
  response.end(html);
}

function authorize(request: IncomingMessage, token: string | undefined, pathname: string): void {
  if (!token || pathname === "/api/v1/health") return;
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Bearer token required");
  const supplied = header.slice("Bearer ".length);
  if (!tokenMatches(token, supplied)) throw new HttpError(401, "Invalid bearer token");
}

function withDatabase<T>(databasePath: string, callback: (db: OscarDatabase) => T): T {
  const db = new OscarDatabase(databasePath);
  try { return callback(db); }
  finally { db.close(); }
}

function withQueries<T>(databasePath: string, callback: (queries: OscarQueries) => T): T {
  const queries = new OscarQueries(databasePath);
  try { return callback(queries); }
  finally { queries.close(); }
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${key} must be a non-empty string`);
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${key} must be a string`);
  return value;
}

function requireBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") throw new HttpError(400, `${key} must be a boolean`);
  return value;
}

function requireNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, `${key} must be a finite number`);
  return value;
}

export async function startOscarApiServer(options: OscarApiServerOptions): Promise<RunningOscarApiServer> {
  const host = options.host?.trim() || "127.0.0.1";
  const port = options.port ?? 3210;
  const token = options.token?.trim() || undefined;
  const allowImports = options.allowImports === true;
  const autoImportMedia = options.autoImportMedia === true;
  if (autoImportMedia && !allowImports) throw new Error("autoImportMedia requires allowImports");
  if (autoImportMedia && !options.watchMedia) throw new Error("autoImportMedia requires watchMedia");
  const webRoot = options.webRoot ? resolve(options.webRoot) : undefined;
  let pendingDetectedMedia: DetectedMedia | undefined;
  let mediaImportInFlight = false;
  let lastAutomaticMediaImport: { sourcePath: string; machineId: number; importedAt: string; sessionsImported: number } | undefined;

  const autoImportDetectedMedia = async (detected: DetectedMedia): Promise<void> => {
    if (mediaImportInFlight) return;
    mediaImportInFlight = true;
    try {
      const profile = withDatabase(options.databasePath, (db) => db.getActiveProfile() ?? db.createProfile("Default", systemTimeZone()));
      const result = await importSourceToDatabase(detected.volume.rootPath, options.databasePath, undefined, { profileId: profile.id, deviceTimeZone: profile.timeZone });
      lastAutomaticMediaImport = {
        sourcePath: detected.volume.rootPath,
        machineId: result.machineId,
        importedAt: new Date().toISOString(),
        sessionsImported: result.sessionsImported,
      };
    } catch {
      // Keep the card available to the browser so a user can retry manually.
      pendingDetectedMedia = detected;
    } finally {
      mediaImportInFlight = false;
    }
  };

  const mediaWatcher = options.watchMedia && allowImports
    ? new RemovableMediaWatcher({
      provider: createSystemVolumeProvider(),
      probe: previewImportSource,
      onDetected: (detected) => {
        if (autoImportMedia) void autoImportDetectedMedia(detected);
        else pendingDetectedMedia = detected;
      },
      probeExistingOnStart: true,
    })
    : undefined;
  if (!isLoopback(host) && !token) throw new Error("Refusing non-loopback API binding without a bearer token");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new RangeError("port must be between 0 and 65535");

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
      const pathname = decodeURIComponent(url.pathname);

      if (method === "GET" && pathname === "/openapi.json") return sendJson(response, 200, openApiDocument);
      if (method === "GET" && (pathname === "/docs" || pathname === "/docs/")) return sendHtml(response, swaggerHtml());
      if (webRoot && method === "GET" && await tryServeWebAsset(response, webRoot, pathname)) return;
      if (method === "GET" && pathname === "/") {
        response.writeHead(302, { location: "/docs" }); response.end(); return;
      }

      authorize(request, token, pathname);

      if (method === "GET" && pathname === "/api/v1/health") {
        return sendJson(response, 200, {
          status: "ok",
          apiVersion: API_VERSION,
          databaseOpen: true,
          importsEnabled: allowImports,
          mediaWatchEnabled: Boolean(mediaWatcher),
          autoImportMediaEnabled: autoImportMedia,
          mediaImportInFlight,
          lastAutomaticMediaImport: lastAutomaticMediaImport ?? null,
          webUiEnabled: Boolean(webRoot),
          platform: process.platform,
          arch: process.arch,
        });
      }

      if (pathname === "/api/v1/state" && method === "GET") {
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => {
          const profiles = db.listProfiles();
          return {
            databaseOpen: true,
            systemTimeZone: systemTimeZone(),
            profiles,
            activeProfile: db.getActiveProfile(),
            needsSetup: profiles.length === 0,
          };
        }));
      }
      if (pathname === "/api/v1/active-profile" && method === "GET") {
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => db.getActiveProfile() ?? null));
      }
      if (pathname === "/api/v1/active-profile" && method === "PUT") {
        const body = await readJsonBody(request);
        const profileId = requireNumber(body, "profileId");
        if (!Number.isSafeInteger(profileId)) throw new HttpError(400, "profileId must be an integer");
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => {
          db.setActiveProfile(profileId);
          return db.getActiveProfile() ?? null;
        }));
      }

      if (pathname === "/api/v1/profiles" && method === "GET") {
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => db.listProfiles()));
      }
      if (pathname === "/api/v1/profiles" && method === "POST") {
        const body = await readJsonBody(request);
        const profile = withDatabase(options.databasePath, (db) => db.createProfile(requireString(body, "name"), requireString(body, "timeZone")));
        return sendJson(response, 201, profile);
      }
      let match = /^\/api\/v1\/profiles\/(\d+)$/.exec(pathname);
      if (match && method === "PATCH") {
        const profileId = requireInteger(match[1], "profileId");
        const body = await readJsonBody(request);
        const updates: { name?: string; timeZone?: string } = {};
        const name = optionalString(body, "name");
        const timeZone = optionalString(body, "timeZone");
        if (name !== undefined) updates.name = name;
        if (timeZone !== undefined) updates.timeZone = timeZone;
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => db.updateProfile(profileId, updates)));
      }
      match = /^\/api\/v1\/profiles\/(\d+)\/machines$/.exec(pathname);
      if (match && method === "GET") {
        const profileId = requireInteger(match[1], "profileId");
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => db.listMachines(profileId)));
      }

      match = /^\/api\/v1\/machines\/(\d+)\/time-settings$/.exec(pathname);
      if (match && method === "GET") {
        const machineId = requireInteger(match[1], "machineId");
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => db.getMachineTimeSettings(machineId)));
      }
      if (match && method === "PUT") {
        const machineId = requireInteger(match[1], "machineId");
        const body = await readJsonBody(request);
        const raw = body.timeZone;
        if (raw !== undefined && raw !== null && typeof raw !== "string") throw new HttpError(400, "timeZone must be a string or null");
        const timeZone = typeof raw === "string" && raw.trim() ? raw : undefined;
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => db.setMachineTimeZone(machineId, timeZone)));
      }

      match = /^\/api\/v1\/machines\/(\d+)\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
      if (match && method === "GET") {
        const machineId = requireInteger(match[1], "machineId");
        return sendJson(response, 200, withQueries(options.databasePath, (queries) => queries.getDaily(machineId, match![2]!)));
      }
      match = /^\/api\/v1\/machines\/(\d+)\/sessions\/(\d+)$/.exec(pathname);
      if (match && method === "PATCH") {
        const machineId = requireInteger(match[1], "machineId");
        const sessionId = requireInteger(match[2], "sessionId");
        const body = await readJsonBody(request);
        withDatabase(options.databasePath, (db) => db.setSessionEnabled(machineId, sessionId, requireBoolean(body, "enabled")));
        return sendNoContent(response);
      }
      match = /^\/api\/v1\/machines\/(\d+)\/overview$/.exec(pathname);
      if (match && method === "GET") {
        const machineId = requireInteger(match[1], "machineId");
        const startDate = url.searchParams.get("startDate") ?? "";
        const endDate = url.searchParams.get("endDate") ?? "";
        if (!startDate || !endDate) throw new HttpError(400, "startDate and endDate are required");
        return sendJson(response, 200, withQueries(options.databasePath, (queries) => queries.getOverview(machineId, startDate, endDate)));
      }
      match = /^\/api\/v1\/machines\/(\d+)\/statistics$/.exec(pathname);
      if (match && method === "GET") {
        const machineId = requireInteger(match[1], "machineId");
        const startDate = url.searchParams.get("startDate") ?? "";
        const endDate = url.searchParams.get("endDate") ?? "";
        if (!startDate || !endDate) throw new HttpError(400, "startDate and endDate are required");
        return sendJson(response, 200, withQueries(options.databasePath, (queries) => queries.getStatistics(machineId, startDate, endDate)));
      }
      match = /^\/api\/v1\/machines\/(\d+)\/charts\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
      if (match && method === "GET") {
        const machineId = requireInteger(match[1], "machineId");
        const channelText = url.searchParams.get("channels");
        if (!channelText) throw new HttpError(400, "channels is required");
        const channelIds = channelText.split(",").filter(Boolean).map((value) => requireInteger(value.trim(), "channel ID"));
        if (channelIds.length === 0) throw new HttpError(400, "At least one channel ID is required");
        const startMs = optionalInteger(url.searchParams.get("startMs"), "startMs");
        const endMs = optionalInteger(url.searchParams.get("endMs"), "endMs");
        const maxPointsPerSeries = optionalInteger(url.searchParams.get("maxPointsPerSeries"), "maxPointsPerSeries");
        if (maxPointsPerSeries !== undefined && (maxPointsPerSeries < 10 || maxPointsPerSeries > 200_000)) throw new HttpError(400, "maxPointsPerSeries must be between 10 and 200000");
        const chartOptions: ChartQueryOptions = {};
        if (startMs !== undefined) chartOptions.startMs = startMs;
        if (endMs !== undefined) chartOptions.endMs = endMs;
        if (maxPointsPerSeries !== undefined) chartOptions.maxPointsPerSeries = maxPointsPerSeries;
        return sendJson(response, 200, withQueries(options.databasePath, (queries) => queries.getChartSeries(machineId, match![2]!, channelIds, chartOptions)));
      }

      match = /^\/api\/v1\/machines\/(\d+)\/graphs\/preferences$/.exec(pathname);
      if (match && method === "GET") {
        const machineId = requireInteger(match[1], "machineId");
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => db.getGraphPreferences(machineId)));
      }
      match = /^\/api\/v1\/machines\/(\d+)\/graphs\/preferences\/([^/]+)$/.exec(pathname);
      if (match && method === "PUT") {
        const machineId = requireInteger(match[1], "machineId");
        const graphKey = match[2]!;
        const body = await readJsonBody(request);
        withDatabase(options.databasePath, (db) => {
          if (body.pinned !== undefined) {
            if (typeof body.pinned !== "boolean") throw new HttpError(400, "pinned must be a boolean");
            db.setGraphPinned(machineId, graphKey, body.pinned);
          }
          if (body.height !== undefined) db.setGraphHeight(machineId, graphKey, requireNumber(body, "height"));
        });
        return sendNoContent(response);
      }
      match = /^\/api\/v1\/machines\/(\d+)\/graphs\/order$/.exec(pathname);
      if (match && method === "PUT") {
        const machineId = requireInteger(match[1], "machineId");
        const body = await readJsonBody(request);
        if (!Array.isArray(body.keys) || !body.keys.every((item) => typeof item === "string")) throw new HttpError(400, "keys must be an array of strings");
        withDatabase(options.databasePath, (db) => db.setGraphOrder(machineId, body.keys as string[]));
        return sendNoContent(response);
      }
      match = /^\/api\/v1\/machines\/(\d+)\/graphs\/bookmarks$/.exec(pathname);
      if (match && method === "GET") {
        const machineId = requireInteger(match[1], "machineId");
        const date = url.searchParams.get("date");
        if (!date) throw new HttpError(400, "date is required");
        return sendJson(response, 200, withDatabase(options.databasePath, (db) => db.listGraphBookmarks(machineId, date)));
      }
      if (match && method === "POST") {
        const machineId = requireInteger(match[1], "machineId");
        const body = await readJsonBody(request);
        const bookmark = withDatabase(options.databasePath, (db) => db.createGraphBookmark(machineId, requireString(body, "date"), requireString(body, "name"), requireNumber(body, "startMs"), requireNumber(body, "endMs")));
        return sendJson(response, 201, bookmark);
      }
      match = /^\/api\/v1\/machines\/(\d+)\/graphs\/bookmarks\/(\d+)$/.exec(pathname);
      if (match && method === "DELETE") {
        const machineId = requireInteger(match[1], "machineId");
        const bookmarkId = requireInteger(match[2], "bookmarkId");
        withDatabase(options.databasePath, (db) => db.deleteGraphBookmark(machineId, bookmarkId));
        return sendNoContent(response);
      }

      if (pathname === "/api/v1/imports/preview" && method === "POST") {
        if (!allowImports) throw new HttpError(403, "File-system imports are disabled; start the API with --allow-imports");
        const body = await readJsonBody(request);
        return sendJson(response, 200, await previewImportSource(requireString(body, "sourcePath")) ?? null);
      }
      if (pathname === "/api/v1/imports" && method === "POST") {
        if (!allowImports) throw new HttpError(403, "File-system imports are disabled; start the API with --allow-imports");
        const body = await readJsonBody(request);
        const sourcePath = requireString(body, "sourcePath");
        const requestedProfileId = body.profileId;
        if (requestedProfileId !== undefined && (typeof requestedProfileId !== "number" || !Number.isSafeInteger(requestedProfileId))) throw new HttpError(400, "profileId must be an integer");
        const profile = withDatabase(options.databasePath, (db) => {
          if (typeof requestedProfileId === "number") {
            const found = db.getProfile(requestedProfileId);
            if (!found) throw new HttpError(404, `Profile ${requestedProfileId} was not found`);
            return found;
          }
          return db.getActiveProfile() ?? db.createProfile("Default", systemTimeZone());
        });
        const result = await importSourceToDatabase(sourcePath, options.databasePath, undefined, { profileId: profile.id, deviceTimeZone: profile.timeZone });
        return sendJson(response, 201, result);
      }

      if (pathname === "/api/v1/demo" && method === "POST") {
        if (!allowImports) throw new HttpError(403, "Demo import is disabled; start the API with --allow-imports");
        const body = await readJsonBody(request);
        const requestedProfileId = body.profileId;
        const days = body.days === undefined ? 14 : requireNumber(body, "days");
        if (!Number.isSafeInteger(days) || days < 1 || days > 90) throw new HttpError(400, "days must be an integer between 1 and 90");
        const profile = withDatabase(options.databasePath, (db) => {
          if (typeof requestedProfileId === "number") {
            const found = db.getProfile(requestedProfileId);
            if (!found) throw new HttpError(404, `Profile ${requestedProfileId} was not found`);
            return found;
          }
          return db.getActiveProfile() ?? db.createProfile("Demo Profile", systemTimeZone());
        });
        const demoRoot = options.demoRoot ?? join(resolve(options.databasePath, ".."), "demo-resmed-card");
        await createDemoResMedCard(demoRoot, { days, overwrite: true });
        const result = await importSourceToDatabase(demoRoot, options.databasePath, undefined, { profileId: profile.id, deviceTimeZone: profile.timeZone });
        return sendJson(response, 201, result);
      }

      if (pathname === "/api/v1/media/pending" && method === "GET") {
        return sendJson(response, 200, pendingDetectedMedia ?? null);
      }
      if (pathname === "/api/v1/media/pending" && method === "DELETE") {
        pendingDetectedMedia = undefined;
        return sendNoContent(response);
      }

      match = /^\/api\/v1\/machines\/(\d+)\/reports\/statistics\.(csv|html)$/.exec(pathname);
      if (match && method === "GET") {
        const machineId = requireInteger(match[1], "machineId");
        const format = match[2]!;
        const startDate = url.searchParams.get("startDate") ?? "";
        const endDate = url.searchParams.get("endDate") ?? "";
        if (!startDate || !endDate) throw new HttpError(400, "startDate and endDate are required");
        const machine = withDatabase(options.databasePath, (db) => db.listMachines().find((item) => item.id === machineId));
        if (!machine) throw new HttpError(404, `Machine ${machineId} was not found`);
        const stats = withQueries(options.databasePath, (queries) => queries.getStatistics(machineId, startDate, endDate));
        if (format === "csv") return sendText(response, 200, statisticsToCsv(machine, stats), "text/csv; charset=utf-8", `oscar-next-${startDate}-${endDate}.csv`);
        return sendText(response, 200, statisticsToHtml(machine, stats), "text/html; charset=utf-8", `oscar-next-${startDate}-${endDate}.html`);
      }

      if (pathname === "/api/v1/diagnostics" && method === "GET") {
        const zip = await createDiagnosticBundle({
          appVersion: API_VERSION,
          databasePath: options.databasePath,
          logFilePath: options.logFilePath,
          previousLogFilePath: options.previousLogFilePath,
        });
        return sendBytes(response, 200, zip, "application/zip", `OSCAR-Next-Diagnostics-${new Date().toISOString().slice(0, 10)}.zip`);
      }

      throw new HttpError(404, "Endpoint not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, status, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
  mediaWatcher?.start();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve API server address");
  const actualPort = address.port;
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const baseUrl = `http://${displayHost}:${actualPort}`;
  return {
    host,
    port: actualPort,
    baseUrl,
    docsUrl: `${baseUrl}/docs`,
    close: () => new Promise<void>((resolve, reject) => {
      mediaWatcher?.stop();
      server.close((error: unknown) => error ? reject(error) : resolve());
    }),
  };
}

export { openApiDocument };
