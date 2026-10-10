# Task C — Windows Headless Service

OSCAR Next 2.3 adds a native Windows headless deployment alongside the normal Electron desktop application.

## What runs

- Windows Service: `OscarNextHeadless`
- Node.js 22+ headless backend
- SQLite database under `%ProgramData%\OSCAR Next Headless\data`
- React browser UI served by the same process
- REST/OpenAPI API at `/api/v1`
- Swagger UI at `/docs`
- optional mounted-card detection and optional unattended card import

The native service is recommended over Docker Desktop when you want automatic Windows drive-letter / SD-card detection.

## Localhost-only install

Open **Administrator PowerShell** in the source folder:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-headless-install.ps1
```

Then browse to:

```text
http://localhost:3210/
```

Localhost mode does not require an API token.

## LAN install

```powershell
.\scripts\windows-headless-install.ps1 -Lan
```

`-Lan` binds to `0.0.0.0`, creates a strong API token if one was not supplied, and adds a Windows Firewall rule for **Private** networks only. Enter the printed token in the browser on another device.

You may provide your own token:

```powershell
.\scripts\windows-headless-install.ps1 -Lan -ApiToken "a-long-random-secret"
```

## Automatic SD-card import

Detection is enabled by default, but import still waits for browser confirmation. To make the service import supported mounted cards automatically:

```powershell
.\scripts\windows-headless-install.ps1 -AutoImportMedia $true
```

This is opt-in because inserting media can then modify the therapy database without a browser confirmation step.

## Service management

```powershell
.\scripts\windows-headless-status.ps1
.\scripts\windows-headless-stop.ps1
.\scripts\windows-headless-start.ps1
.\scripts\windows-headless-uninstall.ps1
```

To remove the service **and** its database/logs:

```powershell
.\scripts\windows-headless-uninstall.ps1 -PurgeData
```

Without `-PurgeData`, the database is intentionally retained.

## Installed layout

```text
%ProgramData%\OSCAR Next Headless\
├── app\
│   ├── dist\
│   └── web\
├── data\
│   ├── oscar-next.sqlite
│   └── logs\
└── service\
    ├── OscarNextHeadlessService.exe
    ├── service.conf
    └── service-wrapper.log
```

`service.conf` is ACL-restricted to SYSTEM and Administrators because it can contain the LAN API token.

## Windows Service implementation

The installer compiles `deploy/windows-headless/OscarNextHeadlessService.cs` with the .NET Framework C# compiler built into standard Windows installations. The wrapper subclasses `ServiceBase`, launches the Node headless process, redirects wrapper output to a log, and lets Windows Service Control Manager restart the service after unexpected exits.

No NSSM/WinSW/node-windows dependency is required.

## Docker Desktop alternative

The existing headless Docker image also works on Windows with Docker Desktop. However, Linux containers do not naturally see Windows removable drive letters, so native Windows Service mode is preferred for CPAP SD-card auto-detection/import.

## Security defaults

- localhost-only binding is the default
- non-loopback binding requires a bearer token
- `-Lan` opens a firewall rule only on the Private profile
- unattended media import is disabled by default
- therapy data remains in the local SQLite database
