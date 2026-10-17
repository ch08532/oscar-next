# Provisioned tunnel runtime

Release engineering places the platform's verified official `tunnel-client`
release and `manifest.json` in this directory before packaging. Electron copies
this directory outside ASAR into `resources/tunnel-client`. No binary is committed
or downloaded/executed automatically by OSCAR. See `OSCAR-AI.md` for the manifest,
integrity, version, permissions and headless deployment contract.
