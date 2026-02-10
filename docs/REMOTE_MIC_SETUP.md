# Remote Mic Mapping Setup

This document describes how to use remote microphone mapping in `P2P Conference`.

## What This Feature Does

`User A` can map their microphone to `User B` so that audio appears as microphone input on `User B`'s machine.

- Mapping is session-based.
- The target user must approve each request.
- Only one active source is allowed per target.
- Source audio is routed exclusively to the selected target while active.

## Windows Target Setup (VB-CABLE)

1. Open P2P Conference on the target user and join the room.
2. When a remote mic request arrives and VB-CABLE is missing, click `Install VB-CABLE & Accept`.
3. Approve the Windows UAC prompt (administrator privilege required).
4. If installation requests restart, reboot Windows and re-try mapping.
5. Verify `CABLE Input` appears in output devices.
6. In the target application (Teams, Zoom, OBS, etc.), select `CABLE Output` as microphone.
7. Keep mapping active while speaking.

Expected signal path:

`Remote peer audio -> CABLE Input (playback) -> CABLE Output (recording mic)`

## macOS Target Setup (BlackHole)

1. Open P2P Conference on the target user and join the room.
2. When a remote mic request arrives and BlackHole is missing, click `Install Virtual Device & Accept`.
3. Approve the macOS administrator authorization prompt and enter the password when requested.
4. Wait for installer completion. The pending request continues automatically after successful install.
5. If installation requests restart, reboot macOS and re-try mapping.
6. Verify `BlackHole 2ch` appears in output devices.
7. In the target application, select `BlackHole 2ch` as microphone.

Expected signal path:

`Remote peer audio -> BlackHole output -> BlackHole input (recording mic)`

## Troubleshooting

## Virtual device not detected

- Reinstall VB-CABLE/BlackHole with admin rights.
- Reboot and reopen P2P Conference.
- Confirm device appears in system sound settings.
- Use `Re-check device` from the settings panel after installation.

## Auto-install unavailable

- If you see a bundle pre-check warning, the packaged installer or manifest is missing/invalid.
- Ensure the build includes `resources/drivers/vb-cable` (Windows) or `resources/drivers/blackhole` (macOS).
- Verify the bundled installer SHA-256 matches `manifest.json`.

## Mapping request cannot start

- Ensure target accepted the request.
- Ensure target has a detected virtual output device in app settings.
- Verify both peers remain connected during approval/start handshake.

## Other app does not receive microphone signal

- Recheck that the other app is using `CABLE Output` (Windows) or `BlackHole 2ch` (macOS) as microphone.
- Confirm P2P Conference is actively showing remote mic session state.
- Disable conflicting exclusive audio modes in the target app.

## Mapping stops unexpectedly

- Check network stability (heartbeat timeout ends mapping).
- If peer disconnects, the session is terminated automatically.

## Security and Consent

- Every mapping session requires explicit target approval.
- The target can stop mapping at any time.
- No background auto-approval is enabled by default.
