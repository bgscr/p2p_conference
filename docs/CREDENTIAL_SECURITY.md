# Credential Security Implementation

## Overview

This document describes the credential security improvements made to the P2P Conference application.

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

Configure in `.env`:

```env
# TURN
TURN_URLS=turn:your-server.com:3478
TURN_USERNAME=your-username
TURN_CREDENTIAL=your-password

# MQTT
MQTT_PRIVATE_URL=ws://your-mqtt.com:8083/mqtt
MQTT_PRIVATE_USERNAME=admin
MQTT_PRIVATE_PASSWORD=password
```

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
