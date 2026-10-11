# OSCAR Next REST / OpenAPI API

OSCAR Next 2.3 provides a local-first HTTP API over the same storage/query services used by Electron.

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
