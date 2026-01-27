# Trystero Integration Guide

Complete reference for using Trystero for serverless WebRTC signaling.

## Overview

Trystero enables WebRTC peer discovery without traditional signaling servers by leveraging decentralized networks like BitTorrent DHT, Nostr, MQTT, and IPFS.

## Installation

```bash
npm install trystero
```

## Available Strategies

### BitTorrent DHT (Recommended for Serverless)

Uses public BitTorrent trackers for peer discovery.

```typescript
import { joinRoom } from 'trystero/torrent'

const room = joinRoom(config, 'room-name')
```

**Pros:**
- Completely serverless
- Large existing network of trackers
- No authentication required

**Cons:**
- 5-30 second discovery latency
- Relies on public tracker availability
- No message delivery guarantees during discovery

**Custom Trackers:**

```typescript
const config = {
  appId: 'my-app',
  trackerUrls: [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
    'wss://tracker.files.fm:7073/announce'
  ]
}

const room = joinRoom(config, roomId)
```

### MQTT (Fastest Discovery)

Uses public MQTT brokers for signaling.

```typescript
import { joinRoom } from 'trystero/mqtt'

const config = {
  appId: 'my-app',
  mqttUrl: 'wss://test.mosquitto.org:8081' // Public broker
}

const room = joinRoom(config, roomId)
```

**Pros:**
- Fastest peer discovery (1-3 seconds)
- Real-time message delivery
- Reliable connection

**Cons:**
- Depends on public broker availability
- Some brokers have rate limits
- May require authentication on private brokers

**Public MQTT Brokers:**
- `wss://test.mosquitto.org:8081` (Eclipse Mosquitto)
- `wss://broker.hivemq.com:8884/mqtt` (HiveMQ)
- `wss://mqtt.eclipseprojects.io:443/mqtt` (Eclipse IoT)

### Nostr (Decentralized Social Protocol)

Uses Nostr relays for peer discovery.

```typescript
import { joinRoom } from 'trystero/nostr'

const config = {
  appId: 'my-app',
  relayUrls: [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol'
  ]
}

const room = joinRoom(config, roomId)
```

**Pros:**
- Censorship-resistant
- Growing ecosystem
- No central authority

**Cons:**
- Medium discovery latency (5-15 seconds)
- Relay availability varies
- Newer protocol (less mature than BitTorrent)

### Firebase / Supabase (Requires Account)

Uses Firebase Realtime Database or Supabase for signaling.

```typescript
import { joinRoom } from 'trystero/firebase'

const config = {
  appId: 'my-app',
  firebaseApp: firebaseApp, // Initialized Firebase app
}

const room = joinRoom(config, roomId)
```

**Pros:**
- Very fast discovery (<1 second)
- Reliable infrastructure
- Good for hybrid apps (auth + P2P)

**Cons:**
- Requires Firebase/Supabase account
- Not truly "serverless" (you own the infrastructure)
- May incur costs at scale

## Core Room API

### Joining a Room

```typescript
interface RoomConfig {
  appId: string           // Namespace to prevent app collision
  password?: string       // Optional room password
  rtcConfig?: RTCConfiguration // Custom WebRTC config
}

const room = joinRoom(config, roomId)
```

**appId**: Critical for preventing collision with other apps using same DHT. Use a unique identifier like `com.yourcompany.yourapp.v1`.

**password**: If provided, room ID is hashed with password. Only peers with matching password can join.

```typescript
const room = joinRoom(
  { appId: 'my-app', password: 'secret123' },
  'public-room-name'
)
```

### Peer Lifecycle Events

```typescript
// Peer joins room
room.onPeerJoin(peerId => {
  console.log(`Peer ${peerId} joined`)
  // peerId is a unique identifier for this peer
})

// Peer leaves room
room.onPeerLeave(peerId => {
  console.log(`Peer ${peerId} left`)
  // Clean up associated resources
})

// Get currently connected peers
const peerIds = room.getPeers()
console.log(`${peerIds.length} peers online`)
```

### Leaving a Room

```typescript
// Gracefully disconnect
room.leave()

// Notify others before leaving
beforeunload = () => {
  room.leave()
}
```

## Data Channels

### makeAction (Custom Messages)

Send arbitrary data between peers:

```typescript
const [sendMessage, receiveMessage] = room.makeAction('chat')

// Send to specific peer
sendMessage({ text: 'Hello', timestamp: Date.now() }, targetPeerId)

// Send to all peers (broadcast)
sendMessage({ text: 'Hello everyone' })

// Receive messages
receiveMessage((data, peerId) => {
  console.log(`Message from ${peerId}:`, data.text)
})
```

**Use cases:**
- Text chat
- Metadata exchange
- Custom signaling (SDP, ICE candidates)
- Game state synchronization

**Data size limits:**
- Recommended: <16KB per message
- Maximum: ~64KB (depends on browser implementation)

### makeAudio (Audio Streaming)

Simplified audio transmission:

```typescript
const [sendAudio, receiveAudio] = room.makeAudio()

// Send your processed audio stream
sendAudio(localAudioStream)

// Receive remote audio streams
receiveAudio((stream, peerId) => {
  console.log(`Audio from ${peerId}`)
  
  const audioElement = new Audio()
  audioElement.srcObject = stream
  audioElement.play()
})

// Target specific peer
sendAudio(localAudioStream, targetPeerId)
```

**Under the hood:**
- Trystero handles WebRTC peer connection setup
- Automatically manages track addition
- Handles renegotiation when tracks change

### makeVideo (Video Streaming)

Same API as audio but for video:

```typescript
const [sendVideo, receiveVideo] = room.makeVideo()

sendVideo(videoStream)

receiveVideo((stream, peerId) => {
  videoElement.srcObject = stream
})
```

## Advanced Patterns

### Multiple Rooms

Join multiple rooms for different purposes:

```typescript
const lobbyRoom = joinRoom({ appId: 'app' }, 'lobby')
const gameRoom = joinRoom({ appId: 'app' }, 'game-123')

// Handle peers differently per room
lobbyRoom.onPeerJoin(id => console.log('Lobby peer:', id))
gameRoom.onPeerJoin(id => console.log('Game peer:', id))
```

### Room Migration

Move peers from one room to another:

```typescript
function migrateToRoom(newRoomId: string) {
  // Leave current room
  currentRoom.leave()
  
  // Join new room
  currentRoom = joinRoom(config, newRoomId)
  setupRoomHandlers(currentRoom)
}
```

### Handling Connection Failures

```typescript
const room = joinRoom(config, roomId)

// Track connection attempts
let connectionAttempts = 0
const MAX_ATTEMPTS = 3

room.onPeerJoin(peerId => {
  connectionAttempts = 0 // Reset on success
})

// Implement retry logic
function retryConnection() {
  if (connectionAttempts < MAX_ATTEMPTS) {
    connectionAttempts++
    console.log(`Retry ${connectionAttempts}/${MAX_ATTEMPTS}`)
    
    room.leave()
    setTimeout(() => {
      room = joinRoom(config, roomId)
    }, 2000 * connectionAttempts) // Exponential backoff
  } else {
    console.error('Connection failed after max retries')
    showUserError('Unable to connect. Try a different network.')
  }
}
```

### Mesh vs Star Topology

**Full Mesh (Default):**
Everyone connects to everyone:

```typescript
// No special config needed - this is default
const [send, receive] = room.makeAudio()

send(stream) // Broadcasts to all peers
```

**Star (Hub-Spoke):**
Designate one peer as hub:

```typescript
const isHub = determineIfHub() // e.g., first peer

if (isHub) {
  // Hub receives and redistributes
  receiveAudio((stream, peerId) => {
    // Relay to all other peers except sender
    room.getPeers()
      .filter(id => id !== peerId)
      .forEach(targetId => {
        sendAudio(stream, targetId)
      })
  })
} else {
  // Spoke only sends to hub
  const hubId = getHubPeerId()
  sendAudio(localStream, hubId)
}
```

## Custom WebRTC Configuration

Override default RTCConfiguration:

```typescript
const config = {
  appId: 'my-app',
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:turnserver.example.com:3478',
        username: 'user',
        credential: 'pass'
      }
    ],
    iceTransportPolicy: 'all', // or 'relay' for TURN-only
    iceCandidatePoolSize: 10
  }
}

const room = joinRoom(config, roomId)
```

## Debugging

### Enable Trystero Logs

```typescript
// Set before importing trystero
(window as any).TRYSTERO_LOG_LEVEL = 'debug'

import { joinRoom } from 'trystero/torrent'

// Now see detailed logs:
// - Peer discovery events
// - WebRTC signaling
// - Connection states
```

### Monitor Peer Discovery

```typescript
const discoveryStart = Date.now()

room.onPeerJoin(peerId => {
  const elapsed = Date.now() - discoveryStart
  console.log(`Peer discovered in ${elapsed}ms`)
})
```

### Inspect Underlying Connections

Trystero doesn't expose RTCPeerConnection directly, but you can track via browser DevTools:

1. Open Chrome DevTools
2. Navigate to `chrome://webrtc-internals`
3. See all active peer connections and stats

## Security Considerations

### Room ID Entropy

Generate secure room IDs:

```typescript
import { randomBytes } from 'crypto'

function generateRoomId(): string {
  return randomBytes(16).toString('base64url')
  // Example: "X3k9mL2pQ8fN7yR1"
}
```

Avoid predictable IDs like "room1", "test", "meeting" - anyone can join.

### Password Protection

```typescript
// Host generates password
const password = generateRandomPassword()
const room = joinRoom({ appId: 'app', password }, roomId)

// Share password out-of-band (email, secure messaging)
sharePasswordSecurely(password)

// Participants use same password
const room = joinRoom({ appId: 'app', password: receivedPassword }, roomId)
```

**Note:** Password is hashed client-side. Server/DHT never sees plaintext.

### IP Privacy

P2P connections reveal IP addresses. To protect privacy:

```typescript
// Option 1: Warn users
showWarning('Your IP address is visible to other participants')

// Option 2: Use TURN for relay (hides IPs but requires server)
const config = {
  appId: 'app',
  rtcConfig: {
    iceTransportPolicy: 'relay', // Force TURN
    iceServers: [
      {
        urls: 'turn:relay.example.com:3478',
        username: 'user',
        credential: 'pass'
      }
    ]
  }
}
```

## Performance Optimization

### Lazy Room Joining

Don't join room on app load - wait for user action:

```typescript
// BAD: Joins immediately
const room = joinRoom(config, roomId)

// GOOD: Join when user clicks "Join Call"
let room: Room | null = null

function handleJoinClick() {
  room = joinRoom(config, roomId)
  setupHandlers(room)
}
```

### Cleanup on Disconnect

```typescript
function cleanup() {
  if (room) {
    room.leave()
    room = null
  }
  
  // Stop local streams
  localStream?.getTracks().forEach(t => t.stop())
  
  // Remove audio elements
  document.querySelectorAll('audio[data-peer]').forEach(el => el.remove())
}

window.addEventListener('beforeunload', cleanup)
```

## Common Issues

### Slow Peer Discovery

**Symptom:** Takes 30+ seconds to find peers

**Solutions:**
1. Use MQTT instead of BitTorrent for faster discovery
2. Combine multiple strategies:

```typescript
// Try MQTT first, fallback to BitTorrent
const mqttRoom = joinRoom({ appId: 'app' }, roomId, 'mqtt')
const torrentRoom = joinRoom({ appId: 'app' }, roomId, 'torrent')

const handlePeerJoin = (id) => {
  // First peer to connect wins
  if (!connected) {
    connected = true
    // Use this room, leave the other
  }
}

mqttRoom.onPeerJoin(handlePeerJoin)
torrentRoom.onPeerJoin(handlePeerJoin)
```

### Tracker Errors

**Symptom:** "WebSocket connection failed" in console

**Solutions:**
1. Trackers may be temporarily down - add fallbacks:

```typescript
const config = {
  appId: 'app',
  trackerUrls: [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
    'wss://tracker.files.fm:7073/announce',
    'wss://tracker.btorrent.xyz' // Fallback
  ]
}
```

2. Check if corporate firewall blocks WebSocket
3. Try alternative strategy (MQTT, Nostr)

### No Peers Found

**Symptom:** `room.getPeers()` returns empty array

**Checklist:**
1. Confirm both peers use identical `appId`
2. Confirm both use identical `roomId`
3. Confirm both use same password (if set)
4. Check network allows WebRTC (not blocked by VPN/firewall)
5. Verify tracker is accessible (check browser console)

### Data Not Received

**Symptom:** `makeAction` receiver never fires

**Solutions:**
1. Ensure receiver is set up BEFORE peer joins:

```typescript
// WRONG: Peer may join before listener is ready
room.onPeerJoin(id => {
  const [send, receive] = room.makeAction('msg')
  receive((data) => console.log(data))
})

// CORRECT: Set up listener immediately
const [send, receive] = room.makeAction('msg')
receive((data) => console.log(data))

room.onPeerJoin(id => {
  send({ hello: true }, id)
})
```

2. Check data size (<16KB recommended)
3. Verify connection is established (check `room.getPeers()`)

## Example: Complete Implementation

```typescript
import { joinRoom, Room } from 'trystero/torrent'

class ConferenceRoom {
  private room: Room | null = null
  private localStream: MediaStream | null = null
  private onRemoteStream: (stream: MediaStream, peerId: string) => void
  
  constructor(onRemoteStream: (stream: MediaStream, peerId: string) => void) {
    this.onRemoteStream = onRemoteStream
  }
  
  async join(roomId: string, localStream: MediaStream) {
    this.localStream = localStream
    
    this.room = joinRoom(
      { appId: 'my-conference-v1' },
      roomId
    )
    
    // Set up audio streaming
    const [sendAudio, receiveAudio] = this.room.makeAudio()
    
    // Send local audio
    sendAudio(localStream)
    
    // Receive remote audio
    receiveAudio((stream, peerId) => {
      this.onRemoteStream(stream, peerId)
    })
    
    // Track peers
    this.room.onPeerJoin(peerId => {
      console.log(`Peer joined: ${peerId}`)
    })
    
    this.room.onPeerLeave(peerId => {
      console.log(`Peer left: ${peerId}`)
    })
  }
  
  leave() {
    if (this.room) {
      this.room.leave()
      this.room = null
    }
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop())
      this.localStream = null
    }
  }
  
  getPeers(): string[] {
    return this.room?.getPeers() || []
  }
}

// Usage
const conference = new ConferenceRoom((stream, peerId) => {
  const audio = new Audio()
  audio.srcObject = stream
  audio.play()
})

await conference.join('my-room-123', localAudioStream)
```
