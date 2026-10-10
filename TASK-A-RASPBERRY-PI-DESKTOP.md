# Task A — Raspberry Pi ARM64 Desktop

This deployment runs the existing Electron + React OSCAR Next application directly on a Raspberry Pi desktop.

## Recommended target

- Raspberry Pi 5, 8 GB preferred
- 64-bit Raspberry Pi OS
- active cooling
- USB full-size SD-card reader
- Node.js 22+

## Build

```bash
./scripts/pi-desktop-package.sh
```

The script installs dependencies, runs the regression suite, builds the Electron renderer/backend, and invokes electron-builder for ARM64 Linux.

Expected artifacts under `apps/desktop/release/`:

- `OSCAR-Next-2.3.0-arm64.deb`
- `OSCAR-Next-2.3.0-arm64.AppImage`

## Install the DEB

```bash
sudo apt install ./apps/desktop/release/OSCAR-Next-2.3.0-arm64.deb
```

The desktop application retains removable-media detection and the same local SQLite database model as the Windows build.
