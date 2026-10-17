# OSCAR Next REST / OpenAPI API

## OSCAR AI

Expert uses this shared job/conversation contract for all providers. Supply
`provider: "ollama"`, `"openai"` or `"groq"` when starting an analysis. Local Ollama requires
only the existing Expert settings and model compatibility; it does not read
OpenAI credentials or require a tunnel. Omitted providers inherit a conversation's
provider, or default to OpenAI for compatibility with earlier clients. A provider
change with an existing conversation ID is rejected; start a new conversation.
Responses include the selected provider. Local results add a `review` event
containing the validated ExpertResult, preserving evidence links and timings.
Local progress streams, while validated review content appears only on completion.
OpenAI configuration/status/tunnel endpoints below retain their existing behavior.
Groq uses its separate settings/key and backend-managed read-only tool calls;
no tunnel or public MCP listener is required. Groq text streams through the same
event contract. Its synthetic connection test performs a small inference request
without therapy data. See [Groq](GROQ.md) for account retention controls.

The shared AI UI uses the endpoints below. They obey existing bearer authentication
and reject cross-origin requests. OpenAI keys and tunnel runtime credentials are
write-only. Configuration is application state, not a clinical schema change.

| Route | Behavior |
| --- | --- |
| `GET/PUT /api/v1/ai/settings` | Safe settings/configured flags; replace/remove credentials |
| `GET/PUT /api/v1/ai/groq/settings` | Separate Groq settings and write-only key; configured flag only on reads |
| `POST /api/v1/ai/groq/check` | Synthetic Groq model/function-calling test; returns connected/message |
| `GET /api/v1/ai/groq/models` | Active Groq model IDs using the saved backend key; no inference or therapy data; listing does not verify chat/tool support or model permissions |
| `GET /api/v1/ai/status` | Monitored tunnel, MCP tools and last OpenAI test status |
| `POST /api/v1/ai/check` | `{component: all/openai/mcp/tunnel}` diagnostic checks |
| `POST /api/v1/ai/tunnel/restart` | Restart enabled managed tunnel |
| `POST /api/v1/ai/jobs` | Structured Daily/Trend/Compare/chat request; returns 202 |
| `GET/DELETE /api/v1/ai/jobs/{id}` | Incremental events or cancel, scoped by profileId/machineId |
| `GET /api/v1/ai/jobs/{id}/events` | Authenticated SSE batches, with optional cursor; disconnect cancels |
| `DELETE /api/v1/ai/history` | Scope body plus optional conversationId; cancel and erase local state |

SSE frames contain the OSCAR AIJob contract, with immutable `events` after the
requested cursor and `nextCursor`. Events are `status`, `text_delta`, `complete`,
and `error`, plus `review` for validated local results. Raw provider objects and hidden reasoning are never sent. Browser
uses SSE; Electron uses the identical incremental contract through preload.
All dates/ranges are explicit. A follow-up may inherit its conversation's scope.
Each range is limited to 90 inclusive therapy days. Only completed turns enter
local context. See [AI setup/privacy/lifecycle](OSCAR-AI.md). Regenerate the AI
schemas after building with `node scripts/update-ai-openapi.mjs`.

OSCAR Next 2.3 provides a local-first HTTP API over the same storage/query services used by Electron.

Daily respiratory indices prefer detailed event records. When a session lacks
detailed respiratory events, stored STR summary rates contribute by included
therapy-hour weighting, including sessions that contain waveforms. Overview and
Statistics reuse these rates. Event counts remain counts of detailed records;
summary rates never fabricate events or timestamps. STR has no reliable RERA
rate. Detailed events anywhere in a session retain precedence across noon.

## Start the API

```powershell
npm run api -- --database .\oscar.sqlite
```

Default endpoints:

- API: `http://127.0.0.1:3210/api/v1`
- Swagger UI: `http://127.0.0.1:3210/docs`
- OpenAPI 3.1 JSON: `http://127.0.0.1:3210/openapi.json`
- Source contract: `openapi/oscar-next.openapi.json`

The server binds to `127.0.0.1` by default. A non-loopback bind is refused unless a bearer token is supplied.

```powershell
$env:OSCAR_API_TOKEN = "replace-with-a-long-random-token"
npm run api -- --database .\oscar.sqlite --host 0.0.0.0
```

The same token can also be supplied with `--token`.

## Daily analysis and graph preferences

Daily channel analysis is a separate on-demand query, so fetching the existing
Daily summary or Overview does not calculate the additional channels. It returns
registry labels/units, raw-sample count, recorded coverage, min/mean/median/p95/max,
and optional leak threshold analysis. Quantiles use duration-weighted nearest
rank over valid samples across included sessions; uniform intervals match the
existing nearest-rank convention. Leak percentages use merged mask-on therapy
time as their denominator and report recorded coverage separately. The `leak`
field is absent when readings are missing.

`PUT .../analysis-preferences` accepts `{ "leakThreshold": 24,
"showLeakThreshold": true }` (threshold range 0–1000 L/min). Preferences persist
per machine in the database. `PUT .../graphs/visibility` accepts
`{ "visibility": { "flow": true, "respiratory-rate": false } }`; only supplied
keys change, atomically, without resetting other layout preferences. Existing
authentication requirements apply to all these endpoints.

## File-system imports

REST imports are disabled by default because they accept paths on the API host. Enable them explicitly:

```powershell
npm run api -- --database .\oscar.sqlite --allow-imports
```

Then the following endpoints become available:

- `POST /api/v1/imports/preview`
- `POST /api/v1/imports`

## Main resources

| Resource | Operations |
| --- | --- |
| Health | `GET /api/v1/health` |
| Profiles | list, create, update |
| Machines | list by profile, read/update timezone handling |
| Daily | therapy-night summary and session list |
| Daily channel analysis | `GET /api/v1/machines/{machineId}/daily/{date}/channel-analysis` |
| Therapy analysis preferences | `GET/PUT /api/v1/machines/{machineId}/analysis-preferences` |
| Graph visibility | `PUT /api/v1/machines/{machineId}/graphs/visibility` |
| Overview | date-range trend data |
| Therapy history | lightweight timeline availability and usage, without waveform/event reads |
| Statistics | date-range aggregate statistics |
| Charts | waveform/event series with windowing and decimation |
| Sessions | enable/disable a session |
| Graph layout | preferences, order, bookmarks |
| Imports | preview/import local CPAP media when enabled |

### Example: Daily

```powershell
Invoke-RestMethod `
  "http://127.0.0.1:3210/api/v1/machines/123456/daily/2026-10-09"
```

### Example: chart data

```text
GET /api/v1/machines/123456/charts/2026-10-09?channels=1,2,3&maxPointsPerSeries=5000
```

High-rate typed arrays are serialized as normal JSON arrays. Waveforms may be min/max decimated to the requested point budget; event series are never decimated.

### Example: timeline availability

```text
GET /api/v1/machines/123456/therapy-history?startDate=2026-01-01&endDate=2026-10-09
```

Returns one `{ date, sessionCount, usageHours }` object per therapy day, including
gaps. Counts include enabled summary-only sessions. Usage uses mask-on slices
with the same session-duration fallback and noon rollover as Daily/Overview.
This endpoint reads only session metadata and slices; it does not calculate
AHI or pressure/leak statistics. It uses the same bearer authentication as other
therapy endpoints. Missing, invalid, or reversed dates return HTTP 400.

## Swagger authorization

If the API was started with a token, open `/docs`, click **Authorize**, and enter the token in the bearer-auth field.

## Privacy and deployment

The API can expose therapy data, machine serial numbers, profile names, and detailed waveform/event information. It is therefore intentionally local-only by default. Do not publish it to a LAN, VPN, reverse proxy, or the Internet without authentication and appropriate transport/network security.


## Headless web additions

OSCAR Next 2.2 uses the same API as the Raspberry Pi/headless browser edition. Additional service endpoints include:

- `GET /api/v1/state` — first-run/profile state for browser clients
- `GET|PUT /api/v1/active-profile` — active-profile selection
- `POST /api/v1/demo` — synthetic demo import when imports are enabled
- `GET|DELETE /api/v1/media/pending` — mounted-media detection handoff
- `GET /api/v1/machines/{machineId}/reports/statistics.csv`
- `GET /api/v1/machines/{machineId}/reports/statistics.html`
- `GET /api/v1/diagnostics` — privacy-safe ZIP bundle

The headless React UI is served by the same HTTP process. LAN binding still requires a bearer token.

## 2.3 deployment note

The same OpenAPI/Swagger contract is served by Windows Headless and Raspberry Pi Headless. Windows localhost deployments can run without a bearer token. Any non-loopback binding still requires a bearer token. `GET /api/v1/health` reports whether mounted-media watching and unattended media import are enabled.

## Local Expert API

The shared renderer uses these routes in browser mode and equivalent narrow IPC
methods on desktop:

- `GET|PUT /api/v1/expert/settings` — opt-in application settings, separate from clinical storage
- `GET /api/v1/expert/models` — installed local Ollama models
- `POST /api/v1/expert/check` — synthetic chat/tools/JSON compatibility test
- `GET /api/v1/expert/diagnostics` — registry, ephemeral-state and external MCP explanation
- `POST /api/v1/expert/reviews` — scoped night/trend/question request; returns a running job with HTTP 202
- `GET /api/v1/expert/reviews/{id}?profileId=1&machineId=42` — poll scoped status/result
- `DELETE /api/v1/expert/reviews/{id}?profileId=1&machineId=42` — cancel scoped generation

The OpenAPI document contains strict settings/request/review/result contracts.
Completed reviews require valid evidence references; malformed model output
becomes a failed job with no accepted result. Jobs are ephemeral, scoped to
profile/machine and bounded to one active operation per backend. Invalid requests
or unavailable job scope return 400. Existing bearer authentication applies when
configured. Expert requests with a cross-origin Origin header are rejected, and
loopback deployments reject non-loopback Host values. LAN access still requires
authentication. These routes never enable imports or expose arbitrary SQL/files.

Ollama URLs are backend-local loopback roots, never browser-selected remote
services. See [LOCAL-AI.md](LOCAL-AI.md) for bounds, cancellation, privacy, cloud
model rejection and the limits of AI evidence validation. To regenerate the
Expert OpenAPI sections after contract edits, run `npm run build` then
`node scripts/update-expert-openapi.mjs`.
