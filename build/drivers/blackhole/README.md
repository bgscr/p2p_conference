# Bundled BlackHole Installer

Place the distributable `BlackHole2ch.pkg` in this folder and update `manifest.json`:

1. Set `installerFile` to the exact package file name.
2. Compute SHA-256 for the package and update `sha256`.
3. Optionally add strict verification fields later:
   - `expectedTeamId`
   - `expectedSignerContains`
   - `requireNotarization`
   - `packageId`

If this package is missing or hash is incorrect, the app will show a pre-check warning and disable `Install & Accept`.
