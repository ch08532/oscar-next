#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v node >/dev/null || { echo "Node.js 22+ is required." >&2; exit 1; }
MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( MAJOR < 22 )); then echo "Node.js 22+ is required (found $(node -v))." >&2; exit 1; fi
command -v systemctl >/dev/null || { echo "systemd is required for the install helper." >&2; exit 1; }

DATA_DIR="${OSCAR_DATA_DIR:-$HOME/.local/share/oscar-next}"
CONFIG_DIR="${OSCAR_CONFIG_DIR:-$HOME/.config/oscar-next}"
SERVICE_DIR="$HOME/.config/systemd/user"
ENV_FILE="$CONFIG_DIR/headless.env"
SERVICE_FILE="$SERVICE_DIR/oscar-next-headless.service"
PORT="${OSCAR_PORT:-3210}"

mkdir -p "$DATA_DIR" "$CONFIG_DIR" "$SERVICE_DIR"

npm install
# Build the shared React renderer without downloading the Electron runtime.
npm --prefix apps/desktop install --ignore-scripts
npm run headless:build
npm test

if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  printf 'OSCAR_API_TOKEN=%s\n' "$TOKEN" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  TOKEN="$(sed -n 's/^OSCAR_API_TOKEN=//p' "$ENV_FILE" | head -n 1)"
fi

NODE_BIN="$(command -v node)"
cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=OSCAR Next headless CPAP analysis
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $ROOT/dist/src/headless/main.js --database $DATA_DIR/oscar-next.sqlite --host 0.0.0.0 --port $PORT --allow-imports --watch-media --web-root $ROOT/apps/desktop/headless-dist --log-dir $DATA_DIR/logs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now oscar-next-headless.service

HOST="$(hostname 2>/dev/null || echo raspberrypi)"
echo
echo "OSCAR Next headless is installed."
echo "Web UI:     http://$HOST.local:$PORT/"
echo "Swagger:    http://$HOST.local:$PORT/docs"
echo "API token:  $TOKEN"
echo "Token file: $ENV_FILE"
echo
echo "If the user service must run without an interactive login, run:"
echo "  sudo loginctl enable-linger $USER"
echo
echo "Service status:"
echo "  systemctl --user status oscar-next-headless.service"
