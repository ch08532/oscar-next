# OSCAR Next 2.3 — Windows acceptance checklist

Use this after running `scripts\windows-dev.ps1` or installing the locally built 2.3.0 installer.

## 1. Startup

- [ ] OSCAR Next starts without a console/error dialog.
- [ ] Header displays version `2.3.0`.
- [ ] Native menu bar is hidden at startup; pressing Alt reveals it.
- [ ] Window/taskbar and installed shortcuts use the OSCAR Next blue pulse icon.
- [ ] Starting OSCAR Next a second time focuses the existing window rather than opening another database instance.

## 2. First-run demo

- [ ] Choose **Try demo data**.
- [ ] A `Demo Profile` is created if no profile exists.
- [ ] A synthetic `AirSense 11 AutoSet (Demo)` appears.
- [ ] Daily opens on the latest therapy date.
- [ ] A notice clearly says the data is synthetic.

## 3. Daily

- [ ] Usage is > 4 h.
- [ ] AHI/RDI are non-negative.
- [ ] Latest demo night has detailed Flow, Pressure, Leak, Pulse/SpO2 and event data.
- [ ] Wheel zoom and drag pan stay synchronized across graphs.
- [ ] Cursor readouts track the same time across graph rows.
- [ ] Disabling a session changes Daily calculations and graphs.
- [ ] Re-enabling the session restores them.

## 4. Graph preferences

- [ ] Pin/unpin a graph and restart; pin state survives.
- [ ] Drag graphs into a different order and restart; order survives.
- [ ] Resize a graph and restart; height survives.
- [ ] Save a zoom range, leave the range, recall it, then delete it.

## 5. Overview / Statistics

- [ ] Overview shows 14 demo therapy days.
- [ ] 7/30/90/all range controls work.
- [ ] Statistics reports used/compliant days, AHI/RDI and pressure/leak percentiles.
- [ ] CSV export succeeds.
- [ ] PDF export succeeds and opens as a valid PDF.

## 6. Profiles and time

- [ ] Create a second profile.
- [ ] Switching profiles changes the visible machine list.
- [ ] Profile timezone can be changed.
- [ ] Machine timezone can inherit the profile or use a manual override.

## 7. Diagnostics

- [ ] **Diagnostics** creates a ZIP.
- [ ] ZIP contains `diagnostics.json` and log files when present.
- [ ] ZIP does not contain the SQLite database or CPAP waveform/event files.

## 8. Real card (when available)

- [ ] Insert/copy a ResMed SD card.
- [ ] Automatic detection or **Import data** recognizes the card.
- [ ] Preflight model/serial/EDF counts look correct.
- [ ] Import completes without structural warnings that indicate data loss.
- [ ] Compare at least three nights against OSCAR: session times, AHI, OA/CA/H, pressure 95%, leak 95%, settings.

Record any failure with a diagnostic bundle and the exact step above that failed.


## 9. Windows headless service

- [ ] Install from Administrator PowerShell with `scripts\windows-headless-install.ps1`.
- [ ] `Get-Service OscarNextHeadless` reports `Running`.
- [ ] `http://localhost:3210/` opens without a token in default localhost mode.
- [ ] Swagger loads at `http://localhost:3210/docs`.
- [ ] Stop/start scripts control the service successfully.
- [ ] In `-Lan` mode, a token is required from another device and the firewall rule is Private-profile only.
- [ ] In normal watch mode, inserting a supported card creates a pending import prompt.
- [ ] With `-AutoImportMedia $true`, a supported mounted card imports without a browser confirmation.
- [ ] Uninstall without `-PurgeData` retains the database.
