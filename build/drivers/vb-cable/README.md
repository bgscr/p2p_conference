# VB-CABLE Bundled Installer Assets

Place the licensed VB-CABLE installer binary in this folder before packaging:

- `VBCABLE_Setup_x64.exe`

Then update `manifest.json` with:

1. The exact installer filename.
2. The real SHA-256 checksum.
3. Any required silent install arguments approved by VB-Audio licensing terms.

This repository intentionally does not include the VB-CABLE binary.
