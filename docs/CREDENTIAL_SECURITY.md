# Credential Security Implementation

## Overview

This document describes the credential security improvements made to the P2P Conference application.

## Canonical Production Usage (Source of Truth)

Current repo default is packaged startup convenience mode (secure enforcement is off unless explicitly enabled).
Startup validation logic lives in `electron/main.ts` and `electron/credentials.ts`.

- `P2P_ALLOW_INSECURE_PRODUCTION` unset or `true` means insecure production startup is allowed.
- Set `P2P_ALLOW_INSECURE_PRODUCTION=false` to enforce secure production startup validation.
- In secure production mode, startup requires either:
  1. `P2P_CREDENTIALS_URL` (must be `https://`, optional `P2P_CREDENTIALS_BEARER_TOKEN`)
  2. Complete TURN and/or private MQTT env credentials
- `MQTT_PRIVATE_URL` must use `wss://` in secure production mode.

### Recommended Production Env Template

```env
# Preferred source: credential endpoint
P2P_CREDENTIALS_URL=https://credentials.example.com/v1/p2p/session
P2P_CREDENTIALS_BEARER_TOKEN=replace-with-rotated-token

# Optional cache metadata for env-provided credentials
CREDENTIALS_EXPIRES_AT=2026-12-31T23:59:59Z

# Fallback source: direct secure credentials
TURN_URLS=turns:turn.example.com:5349
TURN_USERNAME=replace-with-turn-username
TURN_CREDENTIAL=replace-with-turn-password

MQTT_PRIVATE_URL=wss://mqtt.example.com:8084/mqtt
MQTT_PRIVATE_USERNAME=replace-with-mqtt-username
MQTT_PRIVATE_PASSWORD=replace-with-mqtt-password

# Keep secure mode enabled in production packages
P2P_ALLOW_INSECURE_PRODUCTION=false
```

### Update Policy for URL/Variable Changes

When recommended URLs or variable names change, update this section first, then sync:

- `.env.example`
- `README.md`
- `electron/credentials.ts`
- `electron/main.ts`

## Changes Made

### 1. Main Process Credential Storage (`electron/credentials.ts`)

All sensitive credentials are now stored in the Electron main process:

- **TURN server credentials** (username/password)
- **MQTT broker credentials** (username/password)

Credentials are loaded from environment variables when available, with fallback to defaults for development.

### 2. IPC Bridge (`electron/main.ts` + `electron/preload.ts`)

New IPC handlers expose credentials securely:

```typescript
// Main process handlers
ipcMain.handle('get-ice-servers', () => getICEServers())
ipcMain.handle('get-mqtt-brokers', () => getMQTTBrokers())

// Preload exposes to renderer
electronAPI.getICEServers()
electronAPI.getMQTTBrokers()
```

### 3. Renderer Credential Loading (`SimplePeerManager.ts`)

The renderer now loads credentials from the main process via IPC:

```typescript
// Called automatically before joining a room
await loadCredentials()
```

### 4. Code Obfuscation (`electron.vite.config.ts`)

Production builds now include:

- **Terser minification** with aggressive settings
- **Property mangling** for private members
- **Dead code elimination**
- **Console.debug removal** in production
- **No source maps** in production

## Security Level: ★★☆☆☆

This implementation provides **basic protection** against casual inspection:

✅ Credentials not visible in DevTools console  
✅ Credentials separated from renderer code  
✅ Obfuscated code harder to read  
✅ Environment variable support for different deployments  

⚠️ Credentials still bundled in the app (can be extracted)  
⚠️ No time-limited credential rotation  
⚠️ No server-side validation  

## Environment Variables

For production, use the "Canonical Production Usage" section above.
For local development/manual testing, the same variable names apply.

## Future Improvements (★★★★★ Security)

### Option 1: Time-Limited TURN Credentials (Coturn REST API)

Coturn supports generating time-limited credentials using a shared secret:

1. Configure Coturn with `use-auth-secret` and a `static-auth-secret`
2. Create a simple credential service that generates credentials
3. Client requests credentials before joining a room

```typescript
// credentials.ts already has generateTURNCredentials() for this
const { username, credential } = generateTURNCredentials(
  sharedSecret,
  peerId,
  86400  // 24 hour TTL
)
```

### Option 2: Lightweight Credential Service

Deploy a minimal backend service (options below) that:

1. Validates requests (optional: require app signature)
2. Issues short-lived TURN credentials
3. Issues short-lived MQTT tokens (if your broker supports JWT)

### Recommended Backend Languages

| Language | Pros | Cons | Best For |
|----------|------|------|----------|
| **Node.js** | Same tech stack, easy integration | Heavier runtime | Quick prototype |
| **Go** | Fast, single binary, low resources | Learning curve | Production |
| **Rust** | Maximum performance, very secure | Steeper learning | High-security |
| **Python** | Fast development, many libs | Slower runtime | Prototyping |
| **Cloudflare Workers** | No server needed, global edge | Vendor lock-in | Minimal ops |

### Recommended: Cloudflare Workers

For minimal operational overhead:

```javascript
// worker.js
export default {
  async fetch(request, env) {
    const timestamp = Math.floor(Date.now() / 1000) + 86400
    const username = `${timestamp}:p2p-user`
    
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.TURN_SECRET),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(username))
    const credential = btoa(String.fromCharCode(...new Uint8Array(signature)))
    
    return Response.json({
      iceServers: [{
        urls: env.TURN_URLS.split(','),
        username,
        credential
      }]
    })
  }
}
```

## Testing the Changes

1. Build the app: `npm run build`
2. Check that credentials are not in `out/renderer/` files
3. Inspect `out/main/index.js` - credentials should be there but obfuscated
4. Run the app and verify connections still work

## File Changes Summary

| File | Change |
|------|--------|
| `electron/credentials.ts` | **NEW** - Credential management |
| `electron/main.ts` | Added IPC handlers |
| `electron/preload.ts` | Added credential APIs |
| `src/renderer/signaling/SimplePeerManager.ts` | Load credentials via IPC |
| `src/renderer/signaling/index.ts` | Export loadCredentials |
| `electron.vite.config.ts` | Added obfuscation |
| `.env` | Template with credentials |
| `.env.example` | Safe example for git |
