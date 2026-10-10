# Task B — Headless Web Deployment

Headless mode runs OSCAR Next as a Node.js service with no Electron process. The service hosts:

- the same React Daily / Overview / Statistics screens in a browser
- the REST API
- OpenAPI at `/openapi.json`
- Swagger UI at `/docs`
- SQLite persistence
- server-local CPAP imports
- optional mounted-media detection
- privacy-safe diagnostic bundles

The browser renderer talks to the REST API through an adapter implementing the same `OscarApi` interface used by Electron.

## Native Raspberry Pi / systemd deployment

```bash
./scripts/pi-headless-install.sh
```

The helper builds the service/UI, creates a strong API token, and installs a per-user systemd service.

It prints the URL and API token. On another device on the LAN, open for example:

```text
http://raspberrypi.local:3210/
```

The first browser connection asks for the API token. The token is saved only in that browser's local storage.

### Service commands

```bash
systemctl --user status oscar-next-headless.service
systemctl --user restart oscar-next-headless.service
journalctl --user -u oscar-next-headless.service -f
```

If the service must continue without a login session:

```bash
sudo loginctl enable-linger $USER
```

## Manual headless run

```bash
npm install
npm --prefix apps/desktop install --ignore-scripts
npm run headless:build
export OSCAR_API_TOKEN='use-a-strong-random-value'
node dist/src/headless/main.js \
  --database ./data/oscar-next.sqlite \
  --host 0.0.0.0 \
  --port 3210 \
  --allow-imports \
  --watch-media \
  --web-root ./apps/desktop/headless-dist
```

## Docker deployment

```bash
export OSCAR_API_TOKEN="$(openssl rand -hex 32)"
docker compose -f deploy/docker-compose.headless.yml up -d --build
```

Open `http://<pi-address>:3210/`.

For CPAP imports in Docker, mount the SD card or backup folder into the container read-only and enter that container path in **Import Data**. Automatic removable-media watching is intentionally not enabled in the default container because host block devices/mount events are not normally visible inside a container.

## Security model

- LAN binding (`0.0.0.0`) requires a bearer token.
- Browser assets and Swagger are public so the login screen can load; therapy API routes require the token.
- File-system imports require `--allow-imports`.
- The browser cannot browse the server filesystem; **Import Data** asks for a path that exists on the Raspberry Pi/server.
- Diagnostic bundles exclude the therapy database, waveform/event records, profile names, serial numbers, and source paths by default.
