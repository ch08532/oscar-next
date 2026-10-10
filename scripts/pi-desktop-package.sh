#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCH="$(uname -m)"
if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
  echo "Warning: this script is intended to run on a Raspberry Pi / ARM64 Linux host (detected $ARCH)." >&2
fi

command -v node >/dev/null || { echo "Node.js 22+ is required." >&2; exit 1; }
MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( MAJOR < 22 )); then echo "Node.js 22+ is required (found $(node -v))." >&2; exit 1; fi

npm install
npm --prefix apps/desktop install
npm test
npm run desktop:package:linux:arm64

echo
echo "Raspberry Pi desktop packages:"
find apps/desktop/release -maxdepth 1 -type f \( -name '*.deb' -o -name '*.AppImage' \) -print
