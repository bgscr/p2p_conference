---
name: p2p-conference
description: Guide for building serverless peer-to-peer audio conferencing applications using WebRTC, decentralized signaling, and AI-powered noise suppression. Use when developers need to create P2P voice chat, implement WebRTC mesh topology, integrate RNNoise audio processing, build Electron-based audio apps, implement DHT-based signaling (Trystero/Hyperswarm), or develop cross-platform desktop conferencing software without central servers.
---

# P2P Conference Application Development

## Overview

Build serverless peer-to-peer audio conferencing systems with WebRTC Full Mesh topology, decentralized signaling via DHT, and client-side AI noise suppression. This skill provides architecture patterns, implementation workflows, and technical guidance for creating cross-platform desktop applications using Electron, React, and TypeScript.

## Core Architecture

### Technology Stack

**Application Framework:** Electron + React + TypeScript
- Electron provides consistent Chromium-based WebRTC across Windows, macOS, Linux
- Avoids WebKit fragmentation issues in Tauri (especially Linux WebRTC support)
- Native Node.js environment for DHT client libraries

**Network Topology:** Full Mesh P2P
- Each participant connects directly to all others (N-1 connections per client)
- No central media server (SFU/MCU)
- Suitable for 2-15 participants with audio-only streams
- Opus codec at 30-50 kbps per stream

**Signaling:** Decentralized via DHT
- Use Trystero library for serverless peer discovery
- BitTorrent DHT, Nostr, or MQTT strategies
- Room ID hashed to topic key for peer announcement
- Public STUN servers for NAT traversal (no TURN)

**Audio Processing:** Client-side AI
- RNNoise for noise suppression
- AudioWorklet + WebAssembly for real-time processing
- Browser-provided AEC (echo cancellation) and AGC (auto gain)

## Development Workflow

Building a P2P conference app follows these phases:

### Phase 1: Project Setup
1. Initialize Electron project with electron-vite
2. Configure TypeScript and React
3. Set up directory structure for audio processing, signaling, and UI components

### Phase 2: Core WebRTC Implementation
1. Implement device enumeration and media stream capture
2. Create peer connection manager for Full Mesh topology
3. Handle ICE candidate exchange and connection state

### Phase 3: Serverless Signaling
1. Integrate Trystero for DHT-based peer discovery
2. Implement room join/leave logic
3. Exchange SDP offers/answers via decentralized channels

### Phase 4: Audio Processing Pipeline
1. Set up AudioContext and MediaStream nodes
2. Implement AudioWorklet for RNNoise processing
3. Create ring buffer for frame size adaptation (128 → 480 samples)
4. Connect processing chain: mic → AEC/AGC → RNNoise → WebRTC

### Phase 5: Platform-Specific Configuration
1. Configure macOS microphone permissions (entitlements.plist)
2. Handle Linux audio backend variations (PulseAudio/PipeWire)
3. Set up Windows firewall rules for UDP connections

### Phase 6: Device Management & UX
1. Implement input device switching with replaceTrack()
2. Implement output device selection with setSinkId()
3. Add connection quality monitoring and error handling

## Project Initialization

### Directory Structure

Create this structure for optimal organization:

```
/my-conference-app
├── /electron
│   ├── main.ts              # Main process: window management, permissions
│   └── preload.ts           # IPC bridge between main and renderer
├── /src
│   ├── /renderer
│   │   ├── /components      # React UI components
│   │   │   ├── RoomView.tsx
│   │   │   ├── DeviceSelector.tsx
│   │   │   └── ParticipantList.tsx
│   │   ├── /hooks           # Custom React hooks
│   │   │   ├── useMediaStream.ts
│   │   │   ├── usePeerConnections.ts
│   │   │   └── useRoom.ts
│   │   ├── /audio-processor # Audio processing core
│   │   │   ├── noise-processor.js    # AudioWorklet processor
│   │   │   ├── rnnoise.wasm          # AI noise model
│   │   │   ├── RingBuffer.ts         # Frame buffer
│   │   │   └── AudioPipeline.ts      # Processing chain manager
│   │   ├── /signaling       # Decentralized signaling
│   │   │   ├── TrysteroClient.ts
│   │   │   └── PeerManager.ts
│   │   └── App.tsx
│   └── /types               # TypeScript definitions
├── package.json
└── electron.vite.config.ts
```

### Initial Setup Commands

```bash
# Create project with electron-vite
npm create @quick-start/electron my-conference-app
cd my-conference-app

# Install core dependencies
npm install trystero simple-peer

# Install audio processing
npm install @types/audioworklet

# Install UI framework (if not included)
npm install react react-dom
npm install -D @types/react @types/react-dom
```

## Implementing Serverless Signaling

### Using Trystero for Peer Discovery

Trystero abstracts DHT complexity and provides WebRTC-specific APIs.

**Create a room hook:**

```typescript
// src/renderer/hooks/useRoom.ts
import { joinRoom, Room } from 'trystero/torrent'
import { useState, useEffect, useCallback } from 'react'

const APP_ID = 'my-conference-app-v1' // Namespace your app

interface UseRoomResult {
  room: Room | null
  peers: string[]
  joinRoomById: (roomId: string) => void
  leaveRoom: () => void
}

export const useRoom = (): UseRoomResult => {
  const [room, setRoom] = useState<Room | null>(null)
  const [peers, setPeers] = useState<string[]>([])

  const joinRoomById = useCallback((roomId: string) => {
    // Join room using BitTorrent DHT strategy
    const newRoom = joinRoom({ appId: APP_ID }, roomId)
    
    newRoom.onPeerJoin(peerId => {
      console.log('Peer joined:', peerId)
      setPeers(prev => [...prev, peerId])
    })
    
    newRoom.onPeerLeave(peerId => {
      console.log('Peer left:', peerId)
      setPeers(prev => prev.filter(p => p !== peerId))
    })
    
    setRoom(newRoom)
  }, [])

  const leaveRoom = useCallback(() => {
    if (room) {
      room.leave()
      setRoom(null)
      setPeers([])
    }
  }, [room])

  return { room, peers, joinRoomById, leaveRoom }
}
```

**Key concepts:**
- `appId`: Prevents collision with other apps using same DHT
- Room ID is hashed to create DHT topic key
- `onPeerJoin`/`onPeerLeave` callbacks for peer lifecycle
- BitTorrent strategy uses public trackers (no server required)

### SDP Exchange via Trystero

Trystero provides `makeAction` for custom data channels:

```typescript
// In your peer connection manager
const room = joinRoom({ appId: APP_ID }, roomId)

// Create bidirectional SDP exchange channel
const [sendSDP, receiveSDP] = room.makeAction('sdp')

// Send offer
receiveSDP((data, peerId) => {
  if (data.type === 'offer') {
    // Create answer and send back
    const answer = await peerConnection.createAnswer()
    await peerConnection.setRemoteDescription(data.sdp)
    await peerConnection.setLocalDescription(answer)
    sendSDP({ type: 'answer', sdp: answer }, peerId)
  }
})

// When creating offer
const offer = await peerConnection.createOffer()
await peerConnection.setLocalDescription(offer)
sendSDP({ type: 'offer', sdp: offer }, targetPeerId)
```

Alternatively, use Trystero's built-in audio streaming:

```typescript
// Simpler approach: let Trystero handle WebRTC
const [sendStream, receiveStream] = room.makeAudio()

// Send your processed audio stream
sendStream(localAudioStream)

// Receive remote streams
receiveStream((stream, peerId) => {
  // Play remote audio
  const audioElement = new Audio()
  audioElement.srcObject = stream
  audioElement.play()
})
```

## WebRTC Peer Connection Management

### Full Mesh Architecture

In a mesh topology, each client maintains N-1 peer connections:

```typescript
// src/renderer/signaling/PeerManager.ts
import { RTCPeerConnection, RTCSessionDescription } from 'wrtc' // type imports

interface PeerConnection {
  id: string
  connection: RTCPeerConnection
  stream: MediaStream | null
}

export class PeerManager {
  private peers: Map<string, PeerConnection> = new Map()
  private localStream: MediaStream | null = null
  
  constructor(
    private onRemoteStream: (peerId: string, stream: MediaStream) => void,
    private onPeerDisconnected: (peerId: string) => void
  ) {}

  setLocalStream(stream: MediaStream) {
    this.localStream = stream
    // Add to all existing peers
    this.peers.forEach(({ connection }) => {
      stream.getTracks().forEach(track => {
        connection.addTrack(track, stream)
      })
    })
  }

  async createPeerConnection(peerId: string): Promise<RTCPeerConnection> {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
    
    const pc = new RTCPeerConnection(config)
    
    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!)
      })
    }
    
    // Handle remote stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      this.peers.get(peerId)!.stream = remoteStream
      this.onRemoteStream(peerId, remoteStream)
    }
    
    // Handle connection state
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || 
          pc.iceConnectionState === 'failed') {
        this.removePeer(peerId)
        this.onPeerDisconnected(peerId)
      }
    }
    
    this.peers.set(peerId, { id: peerId, connection: pc, stream: null })
    return pc
  }

  removePeer(peerId: string) {
    const peer = this.peers.get(peerId)
    if (peer) {
      peer.connection.close()
      this.peers.delete(peerId)
    }
  }

  cleanup() {
    this.peers.forEach(peer => peer.connection.close())
    this.peers.clear()
  }
}
```

## Audio Processing Pipeline

### AudioWorklet Processor for RNNoise

AudioWorklet runs in a separate audio rendering thread, ensuring real-time performance.

**Create the processor (runs in audio thread):**

```javascript
// src/renderer/audio-processor/noise-processor.js
// This file must be vanilla JS (no imports), loaded via audioWorklet.addModule()

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    
    // RNNoise requires 480 samples per frame (10ms at 48kHz)
    this.frameSize = 480
    this.buffer = new Float32Array(this.frameSize)
    this.bufferIndex = 0
    this.outputBuffer = new Float32Array(this.frameSize)
    this.outputIndex = 0
    
    // WASM module will be initialized via message from main thread
    this.wasmModule = null
    this.statePtr = null
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'init' && event.data.wasmModule) {
        this.initWasm(event.data.wasmModule)
      }
    }
  }
  
  initWasm(wasmModule) {
    this.wasmModule = wasmModule
    // Create RNNoise state
    this.statePtr = this.wasmModule._rnnoise_create(null)
  }
  
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    
    if (!input || !input[0] || !this.wasmModule) {
      return true // Keep processor alive
    }
    
    const inputChannel = input[0] // Mono audio
    const outputChannel = output[0]
    const blockSize = inputChannel.length // Usually 128 samples
    
    for (let i = 0; i < blockSize; i++) {
      // Fill input buffer
      this.buffer[this.bufferIndex++] = inputChannel[i]
      
      // When buffer is full, process with RNNoise
      if (this.bufferIndex === this.frameSize) {
        this.processFrame()
        this.bufferIndex = 0
      }
      
      // Output processed audio
      outputChannel[i] = this.outputBuffer[this.outputIndex++]
      
      // Wrap output index
      if (this.outputIndex >= this.frameSize) {
        this.outputIndex = 0
      }
    }
    
    return true
  }
  
  processFrame() {
    // Copy buffer to WASM memory
    const inputPtr = this.wasmModule._malloc(this.frameSize * 4) // Float32 = 4 bytes
    this.wasmModule.HEAPF32.set(this.buffer, inputPtr / 4)
    
    // Process frame (returns probability of voice, modifies buffer in-place)
    this.wasmModule._rnnoise_process_frame(this.statePtr, inputPtr, inputPtr)
    
    // Copy processed audio back
    this.outputBuffer.set(
      this.wasmModule.HEAPF32.subarray(inputPtr / 4, inputPtr / 4 + this.frameSize)
    )
    
    this.wasmModule._free(inputPtr)
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor)
```

**Load and use in main audio pipeline:**

```typescript
// src/renderer/audio-processor/AudioPipeline.ts
export class AudioPipeline {
  private audioContext: AudioContext
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: AudioWorkletNode | null = null
  private destinationStream: MediaStream | null = null
  
  constructor() {
    this.audioContext = new AudioContext({ sampleRate: 48000 })
  }
  
  async initialize() {
    // Load AudioWorklet processor
    await this.audioContext.audioWorklet.addModule(
      '/audio-processor/noise-processor.js'
    )
    
    // Load RNNoise WASM module
    const wasmModule = await this.loadRNNoiseWasm()
    
    // Create processor node
    this.processorNode = new AudioWorkletNode(
      this.audioContext,
      'rnnoise-processor'
    )
    
    // Initialize WASM in processor thread
    this.processorNode.port.postMessage({
      type: 'init',
      wasmModule: wasmModule
    })
  }
  
  async loadRNNoiseWasm() {
    // Load precompiled WASM (obtain from xiph/rnnoise or use pre-built)
    const response = await fetch('/audio-processor/rnnoise.wasm')
    const wasmBinary = await response.arrayBuffer()
    
    // Instantiate WASM module
    const wasmModule = await WebAssembly.instantiate(wasmBinary)
    return wasmModule.instance.exports
  }
  
  async connectInputStream(stream: MediaStream): Promise<MediaStream> {
    // Create source from microphone
    this.sourceNode = this.audioContext.createMediaStreamSource(stream)
    
    // Create destination to output processed audio
    const destination = this.audioContext.createMediaStreamDestination()
    
    // Connect pipeline: mic → processor → destination
    this.sourceNode
      .connect(this.processorNode!)
      .connect(destination)
    
    this.destinationStream = destination.stream
    return this.destinationStream
  }
  
  disconnect() {
    this.sourceNode?.disconnect()
    this.processorNode?.disconnect()
  }
}
```

**Usage in React component:**

```typescript
// In your main app component
const [processedStream, setProcessedStream] = useState<MediaStream | null>(null)

useEffect(() => {
  const pipeline = new AudioPipeline()
  
  const setupAudio = async () => {
    await pipeline.initialize()
    
    // Get microphone with browser AEC/AGC enabled
    const rawStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,  // Critical: do AEC before RNNoise
        autoGainControl: true,
        noiseSuppression: false  // Use our RNNoise instead
      },
      video: false
    })
    
    // Process through RNNoise
    const processed = await pipeline.connectInputStream(rawStream)
    setProcessedStream(processed)
  }
  
  setupAudio()
  
  return () => pipeline.disconnect()
}, [])
```

### Critical Audio Processing Notes

**Echo Cancellation Order:**
- MUST enable browser's `echoCancellation: true` BEFORE RNNoise
- RNNoise is non-linear; applying it before AEC breaks echo reference signal
- Pipeline order: Mic → Browser AEC → Browser AGC → RNNoise → WebRTC

**Frame Size Adaptation:**
- Web Audio API processes 128-sample blocks
- RNNoise requires 480-sample frames (10ms at 48kHz)
- Use ring buffer to accumulate/dispense frames
- Maintain separate input/output buffers to avoid latency spikes

**Performance Optimization:**
- Only process outgoing audio (1 stream), not incoming (N-1 streams)
- Remote participants already send noise-suppressed audio
- CPU load remains constant regardless of participant count

## Device Management

### Input Device Selection

```typescript
// src/renderer/hooks/useMediaStream.ts
export const useMediaStream = () => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [stream, setStream] = useState<MediaStream | null>(null)
  
  // Enumerate devices
  useEffect(() => {
    const loadDevices = async () => {
      const deviceList = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = deviceList.filter(d => d.kind === 'audioinput')
      setDevices(audioInputs)
      if (audioInputs.length > 0) {
        setSelectedDeviceId(audioInputs[0].deviceId)
      }
    }
    
    loadDevices()
    
    // Listen for device changes (plug/unplug)
    navigator.mediaDevices.addEventListener('devicechange', loadDevices)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices)
    }
  }, [])
  
  // Get stream from selected device
  const switchDevice = async (deviceId: string) => {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: true,
        autoGainControl: true
      }
    })
    
    setStream(newStream)
    setSelectedDeviceId(deviceId)
    return newStream
  }
  
  return { devices, selectedDeviceId, stream, switchDevice }
}
```

**Switching device during call without reconnection:**

```typescript
// In peer manager
async switchMicrophone(newStream: MediaStream) {
  const audioTrack = newStream.getAudioTracks()[0]
  
  // Replace track in all peer connections
  this.peers.forEach(({ connection }) => {
    const sender = connection.getSenders().find(s => s.track?.kind === 'audio')
    if (sender) {
      sender.replaceTrack(audioTrack) // Seamless switch, no renegotiation
    }
  })
}
```

### Output Device Selection

```typescript
// Component for remote participant audio
interface RemoteAudioProps {
  stream: MediaStream
  outputDeviceId: string
}

const RemoteAudio: React.FC<RemoteAudioProps> = ({ stream, outputDeviceId }) => {
  const audioRef = useRef<HTMLAudioElement>(null)
  
  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream
      
      // Set output device (Electron/Chrome only)
      if ('setSinkId' in audioRef.current) {
        (audioRef.current as any)
          .setSinkId(outputDeviceId)
          .catch(err => console.error('Failed to set output device:', err))
      }
    }
  }, [stream, outputDeviceId])
  
  return <audio ref={audioRef} autoPlay playsInline />
}
```

**Output device selector:**

```typescript
const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
const [selectedOutput, setSelectedOutput] = useState<string>('')

useEffect(() => {
  const loadOutputDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const outputs = devices.filter(d => d.kind === 'audiooutput')
    setOutputDevices(outputs)
    if (outputs.length > 0) setSelectedOutput(outputs[0].deviceId)
  }
  loadOutputDevices()
}, [])

return (
  <select value={selectedOutput} onChange={e => setSelectedOutput(e.target.value)}>
    {outputDevices.map(device => (
      <option key={device.deviceId} value={device.deviceId}>
        {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
      </option>
    ))}
  </select>
)
```

## Platform-Specific Configuration

### macOS Permissions

macOS requires explicit permission declarations for microphone access.

**Create entitlements file:**

```xml
<!-- /electron/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.device.microphone</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

**Update build configuration:**

```javascript
// electron.vite.config.ts
export default {
  // ...
  build: {
    mac: {
      entitlements: './electron/entitlements.mac.plist',
      entitlementsInherit: './electron/entitlements.mac.plist'
    }
  }
}
```

**Request permission in main process:**

```typescript
// electron/main.ts
import { app, systemPreferences } from 'electron'

app.whenReady().then(async () => {
  // Request microphone access (triggers system dialog)
  if (process.platform === 'darwin') {
    const status = await systemPreferences.askForMediaAccess('microphone')
    if (!status) {
      console.error('Microphone permission denied')
    }
  }
  
  // Create window...
})
```

### Linux Audio Backend Handling

Electron on Linux uses the system's audio backend (PulseAudio, PipeWire, or ALSA).

**Ensure proper permissions in package:**

For AppImage/Flatpak, configure audio access:

```yaml
# For Flatpak (if applicable)
finish-args:
  - --socket=pulseaudio
  - --device=all  # For audio devices
```

**Detect and handle audio issues:**

```typescript
// In renderer process
const checkAudioSupport = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(track => track.stop())
    return true
  } catch (error) {
    console.error('Audio not available:', error)
    // Show user-friendly error message
    return false
  }
}
```

**Recommended Linux distribution format:**
- **Best:** `.AppImage` (minimal sandboxing, direct audio access)
- **Good:** `.deb` / `.rpm` (native packages)
- **Avoid:** Snap (strict sandboxing causes audio issues)

### Windows Firewall Configuration

Windows Firewall may block UDP connections required for WebRTC.

**Detect firewall blocking:**

```typescript
// Monitor ICE connection state
peerConnection.oniceconnectionstatechange = () => {
  if (peerConnection.iceConnectionState === 'failed') {
    // Likely firewall issue
    console.error('Connection failed - possible firewall block')
    showFirewallWarning()
  }
}
```

**User guidance:**

Display instructions to users:
1. "Allow [App Name] through Windows Firewall when prompted"
2. Or manually: Settings → Firewall → Allow an app → Add [App Name]

**Installer configuration (optional):**

```xml
<!-- In electron-builder config -->
"nsis": {
  "allowToChangeInstallationDirectory": true,
  "oneClick": false,
  "createDesktopShortcut": true,
  "include": "installer-script.nsh"
}
```

```nsh
<!-- installer-script.nsh -->
!macro customInstall
  ; Add firewall rule for UDP
  ExecWait 'netsh advfirewall firewall add rule name="MyConferenceApp" dir=in action=allow protocol=UDP program="$INSTDIR\MyConferenceApp.exe"'
!macroend
```

## Connection Quality & Error Handling

### Monitoring Connection Health

```typescript
interface ConnectionStats {
  peerId: string
  rtt: number  // Round-trip time in ms
  packetsLost: number
  audioLevel: number
}

async function getConnectionStats(
  pc: RTCPeerConnection
): Promise<ConnectionStats | null> {
  const stats = await pc.getStats()
  let rtt = 0
  let packetsLost = 0
  
  stats.forEach(report => {
    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
      rtt = report.currentRoundTripTime * 1000
    }
    if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
      packetsLost = report.packetsLost
    }
  })
  
  return { peerId: 'unknown', rtt, packetsLost, audioLevel: 0 }
}

// Monitor periodically
setInterval(async () => {
  for (const [peerId, { connection }] of peerManager.peers) {
    const stats = await getConnectionStats(connection)
    if (stats.packetsLost > 100) {
      console.warn(`Poor connection to ${peerId}`)
    }
  }
}, 5000)
```

### Handling NAT Traversal Failures

Not all network configurations support P2P:

```typescript
const handleConnectionFailure = (peerId: string) => {
  // Show user-friendly message
  showNotification({
    type: 'warning',
    message: `Cannot connect to participant. This may happen on restricted networks (VPN, corporate firewall). Try switching to a different network or mobile hotspot.`
  })
}

// Timeout mechanism
const connectionTimeout = setTimeout(() => {
  if (pc.iceConnectionState !== 'connected') {
    handleConnectionFailure(peerId)
    pc.close()
  }
}, 15000) // 15 second timeout

pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === 'connected') {
    clearTimeout(connectionTimeout)
  }
}
```

### Graceful Degradation

When DHT discovery is slow:

```typescript
const [isSearching, setIsSearching] = useState(true)
const [searchTimeout, setSearchTimeout] = useState(false)

useEffect(() => {
  const timer = setTimeout(() => {
    if (peers.length === 0) {
      setSearchTimeout(true)
      // Suggest fallback: "No participants found. Double-check room ID or try again."
    }
  }, 30000) // 30 seconds
  
  return () => clearTimeout(timer)
}, [peers])
```

## Bandwidth & Scalability Considerations

### Participant Limit Guidelines

| Participants | Upload per client | Download per client | Feasibility |
|--------------|-------------------|---------------------|-------------|
| 2 (1v1) | 40 kbps | 40 kbps | Excellent |
| 5 | 160 kbps | 160 kbps | Excellent |
| 10 | 360 kbps | 360 kbps | Good |
| 15 | 560 kbps | 560 kbps | Acceptable (requires good connection) |
| 20+ | 760+ kbps | 760+ kbps | Not recommended |

**Recommendation:** Display warning at 10+ participants: "For best experience, limit to 10 participants. Performance may degrade on slower connections."

### Opus Configuration

Configure Opus codec for optimal quality/bandwidth:

```typescript
// When creating RTCPeerConnection
const offerOptions = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: false
}

const offer = await pc.createOffer(offerOptions)

// Modify SDP to set Opus bitrate
offer.sdp = offer.sdp?.replace(
  /(a=fmtp:\d+ .*)/, 
  '$1;maxaveragebitrate=40000;stereo=0;useinbandfec=1'
)

await pc.setLocalDescription(offer)
```

Parameters:
- `maxaveragebitrate=40000`: 40 kbps (balance quality/bandwidth)
- `stereo=0`: Mono audio (conference doesn't need stereo)
- `useinbandfec=1`: Enable forward error correction (packet loss resilience)

## Security & Privacy Considerations

### IP Address Exposure

P2P connections reveal participants' IP addresses to each other.

**User disclosure:**

Display in UI before joining:
```
⚠️ Privacy Notice: Your IP address will be visible to other participants in this call.
This is inherent to peer-to-peer architecture.
```

**For privacy-sensitive users:**

Suggest using VPN or Tor, but note this may affect connectivity.

### Room ID Security

Room IDs are hashed but predictable short IDs are vulnerable.

**Generate secure room IDs:**

```typescript
import { randomBytes } from 'crypto'

function generateSecureRoomId(): string {
  // Generate 16 bytes = 128 bits of entropy
  const buffer = randomBytes(16)
  return buffer.toString('base64url') // URL-safe base64
  // Example: "k7J3m9Lp2Xq8Fn4Y"
}
```

**Validate room ID length:**

```typescript
function isValidRoomId(roomId: string): boolean {
  // Require minimum entropy
  return roomId.length >= 12 && /^[A-Za-z0-9_-]+$/.test(roomId)
}
```

**User guidance:**

"Room IDs should be long and random. Short or guessable IDs (like '123') can be discovered by others."

### Encryption

WebRTC enforces DTLS-SRTP encryption for all media streams (mandatory in spec). No additional configuration needed.

Signaling data exchanged via DHT is public. Sensitive metadata should not be transmitted in room names or peer discovery.

## Testing Strategy

### Local Testing

Test with multiple browser windows:

```typescript
// Development helper: allow same-device peers
if (import.meta.env.DEV) {
  // Each window gets unique peer ID
  const instanceId = Math.random().toString(36).substr(2, 9)
  const modifiedAppId = `${APP_ID}-${instanceId}`
}
```

### Network Simulation

Test poor network conditions:

```bash
# Simulate packet loss (Linux)
sudo tc qdisc add dev eth0 root netem loss 5%

# Simulate latency
sudo tc qdisc add dev eth0 root netem delay 100ms

# Reset
sudo tc qdisc del dev eth0 root
```

### Cross-Platform Testing

Test on:
- Windows 10/11 (various firewall configs)
- macOS 12+ (permission handling)
- Ubuntu 20.04+, Fedora (PulseAudio vs PipeWire)

## Common Issues & Solutions

### Issue: No audio from remote participant

**Cause:** HTMLAudioElement not playing
**Solution:**
```typescript
// Ensure autoplay and check for play errors
audioElement.autoplay = true
audioElement.play().catch(err => {
  console.error('Autoplay prevented:', err)
  // Show user: "Click to enable audio"
})
```

### Issue: Echo/feedback loop

**Cause:** Local audio routing to speakers
**Solution:** Never connect local mic to local speakers:
```typescript
// WRONG: causes feedback
localSource.connect(audioContext.destination)

// CORRECT: only send to peers
localSource.connect(processorNode).connect(peerConnection)
```

### Issue: RNNoise not loading

**Cause:** WASM file path incorrect
**Solution:** Place `rnnoise.wasm` in `public/` directory for proper access:
```
/public
  /audio-processor
    rnnoise.wasm
    noise-processor.js
```

### Issue: Connections fail on corporate networks

**Cause:** Symmetric NAT, blocked UDP
**Solution:** Display clear error: "Your network blocks P2P connections. Try mobile hotspot or different network."

### Issue: High CPU usage

**Cause:** Processing too many streams
**Solution:** Only process outgoing audio, not incoming:
```typescript
// Process only local mic (1 stream)
const processed = await pipeline.connectInputStream(micStream)

// Remote streams bypass processing (N-1 streams)
remoteStreams.forEach(stream => {
  audioElement.srcObject = stream // Direct playback
})
```

## Performance Optimization

### Lazy Loading WASM

Don't load RNNoise until user joins call:

```typescript
const [rnnoiseReady, setRnnoiseReady] = useState(false)

const prepareForCall = async () => {
  await audioPipeline.initialize() // Loads WASM
  setRnnoiseReady(true)
}

// Trigger on "Join Room" button, not on app load
```

### Web Worker for Signaling

Offload DHT operations to worker:

```typescript
// signaling.worker.ts
import { joinRoom } from 'trystero/torrent'

self.onmessage = (e) => {
  if (e.data.type === 'join') {
    const room = joinRoom({ appId: e.data.appId }, e.data.roomId)
    room.onPeerJoin(peerId => {
      self.postMessage({ type: 'peerJoin', peerId })
    })
  }
}
```

### Memory Management

Clean up streams when participants leave:

```typescript
const cleanup = (peerId: string) => {
  const peer = peers.get(peerId)
  if (peer?.stream) {
    peer.stream.getTracks().forEach(track => track.stop())
  }
  peer?.connection.close()
  peers.delete(peerId)
}
```

## References

For detailed reference material on specific topics, see:

- `references/webrtc-apis.md` - Complete WebRTC API documentation and usage patterns
- `references/trystero-integration.md` - Advanced Trystero configuration and strategies
- `references/rnnoise-details.md` - RNNoise algorithm explanation and optimization
- `references/platform-quirks.md` - Platform-specific audio API differences

## Additional Resources

**External Documentation:**
- [WebRTC API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Trystero GitHub](https://github.com/dmotz/trystero)
- [RNNoise Paper](https://jmvalin.ca/demo/rnnoise/)
- [Electron Audio Best Practices](https://www.electronjs.org/docs/latest/api/audio)

**Recommended Libraries:**
- `trystero`: Serverless WebRTC signaling
- `simple-peer`: Simplified WebRTC wrapper (alternative to raw RTCPeerConnection)
- `rnnoise-wasm`: Pre-compiled RNNoise for web
