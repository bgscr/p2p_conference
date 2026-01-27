# WebRTC API Reference

Complete reference for WebRTC APIs used in P2P conferencing applications.

## RTCPeerConnection

Core API for establishing peer-to-peer connections.

### Creating Connections

```typescript
const configuration: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceTransportPolicy: 'all', // 'relay' to force TURN only
  iceCandidatePoolSize: 10    // Pre-gather candidates for faster connection
}

const pc = new RTCPeerConnection(configuration)
```

### Adding Media Tracks

```typescript
// Add audio track from local stream
localStream.getTracks().forEach(track => {
  pc.addTrack(track, localStream)
})

// Or add individual track
const audioTrack = localStream.getAudioTracks()[0]
const sender = pc.addTrack(audioTrack, localStream)
```

### Event Handlers

```typescript
// ICE candidate generated (send to remote peer via signaling)
pc.onicecandidate = (event) => {
  if (event.candidate) {
    sendViaSignaling({
      type: 'ice-candidate',
      candidate: event.candidate
    })
  }
}

// Remote track received
pc.ontrack = (event) => {
  const [remoteStream] = event.streams
  audioElement.srcObject = remoteStream
}

// Connection state changes
pc.onconnectionstatechange = () => {
  console.log('Connection state:', pc.connectionState)
  // Values: 'new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'
}

pc.oniceconnectionstatechange = () => {
  console.log('ICE state:', pc.iceConnectionState)
  // Values: 'new', 'checking', 'connected', 'completed', 'failed', 'disconnected', 'closed'
}

// Negotiation needed (renegotiation required)
pc.onnegotiationneeded = async () => {
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  sendViaSignaling({ type: 'offer', sdp: pc.localDescription })
}
```

### Creating Offers and Answers

**Initiating peer (Caller):**

```typescript
const offer = await pc.createOffer({
  offerToReceiveAudio: true,
  offerToReceiveVideo: false
})

await pc.setLocalDescription(offer)

// Send offer to remote peer
sendViaSignaling({ type: 'offer', sdp: offer })
```

**Responding peer (Callee):**

```typescript
// Receive offer from remote peer
async function handleOffer(offer: RTCSessionDescriptionInit) {
  await pc.setRemoteDescription(offer)
  
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  
  // Send answer back to caller
  sendViaSignaling({ type: 'answer', sdp: answer })
}
```

**Receiving answer (Caller):**

```typescript
async function handleAnswer(answer: RTCSessionDescriptionInit) {
  await pc.setRemoteDescription(answer)
}
```

### ICE Candidate Exchange

```typescript
// Receive ICE candidate from remote peer
async function handleIceCandidate(candidate: RTCIceCandidateInit) {
  try {
    await pc.addIceCandidate(candidate)
  } catch (error) {
    console.error('Error adding ICE candidate:', error)
  }
}
```

### Complete Connection Flow

```typescript
// Caller side
async function initiateConnection() {
  // 1. Create offer
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  
  // 2. Send offer to remote
  await signaling.sendOffer(offer, remotePeerId)
  
  // 3. Wait for answer (handled by onmessage)
  // 4. ICE candidates exchanged automatically via onicecandidate
}

// Callee side
async function acceptConnection(offer: RTCSessionDescriptionInit) {
  // 1. Set remote description
  await pc.setRemoteDescription(offer)
  
  // 2. Create answer
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  
  // 3. Send answer back
  await signaling.sendAnswer(answer, remotePeerId)
  
  // 4. ICE candidates exchanged automatically
}
```

## MediaDevices API

### Enumerating Devices

```typescript
async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  
  const audioInputs = devices.filter(d => d.kind === 'audioinput')
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput')
  
  audioInputs.forEach(device => {
    console.log(`Microphone: ${device.label} [${device.deviceId}]`)
  })
  
  audioOutputs.forEach(device => {
    console.log(`Speaker: ${device.label} [${device.deviceId}]`)
  })
  
  return { audioInputs, audioOutputs }
}

// Listen for device changes (plug/unplug)
navigator.mediaDevices.addEventListener('devicechange', async () => {
  console.log('Devices changed')
  await listDevices()
})
```

### Getting User Media

```typescript
const constraints: MediaStreamConstraints = {
  audio: {
    // Device selection
    deviceId: { exact: 'specific-device-id' }, // or { ideal: 'device-id' }
    
    // Audio processing
    echoCancellation: true,       // Remove echo
    autoGainControl: true,        // Normalize volume
    noiseSuppression: false,      // Disable browser noise suppression (use RNNoise)
    
    // Quality settings
    sampleRate: 48000,            // 48kHz sample rate
    channelCount: 1,              // Mono
    
    // Advanced constraints
    latency: 0.01,                // 10ms latency target
    sampleSize: 16                // 16-bit depth
  },
  video: false
}

const stream = await navigator.mediaDevices.getUserMedia(constraints)
```

### Handling Permissions

```typescript
try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  // Permission granted
} catch (error) {
  if (error.name === 'NotAllowedError') {
    // User denied permission
    console.error('Microphone permission denied')
  } else if (error.name === 'NotFoundError') {
    // No microphone found
    console.error('No microphone detected')
  } else if (error.name === 'NotReadableError') {
    // Device in use by another app
    console.error('Microphone in use by another application')
  }
}
```

## RTCRtpSender (Track Management)

### Replacing Tracks

Switch microphone without reconnection:

```typescript
const sender = pc.getSenders().find(s => s.track?.kind === 'audio')

if (sender) {
  const newTrack = newStream.getAudioTracks()[0]
  await sender.replaceTrack(newTrack)
}
```

### Modifying Parameters

Adjust encoding parameters:

```typescript
const sender = pc.getSenders()[0]
const parameters = sender.getParameters()

// Modify bitrate
if (parameters.encodings && parameters.encodings.length > 0) {
  parameters.encodings[0].maxBitrate = 40000 // 40 kbps
}

await sender.setParameters(parameters)
```

## RTCDataChannel

Create data channel for text chat or metadata:

```typescript
// Create channel (caller side)
const dataChannel = pc.createDataChannel('chat', {
  ordered: true,           // Guarantee message order
  maxRetransmits: 3       // Retry up to 3 times
})

dataChannel.onopen = () => {
  console.log('Data channel open')
  dataChannel.send('Hello!')
}

dataChannel.onmessage = (event) => {
  console.log('Message received:', event.data)
}

// Receive channel (callee side)
pc.ondatachannel = (event) => {
  const channel = event.channel
  
  channel.onmessage = (e) => {
    console.log('Received:', e.data)
  }
}
```

## Stats API

Monitor connection quality:

```typescript
async function getStats(pc: RTCPeerConnection) {
  const stats = await pc.getStats()
  
  const metrics = {
    rtt: 0,
    packetsLost: 0,
    jitter: 0,
    bitrate: 0
  }
  
  stats.forEach(report => {
    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
      metrics.rtt = report.currentRoundTripTime * 1000 // ms
    }
    
    if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
      metrics.packetsLost = report.packetsLost
      metrics.jitter = report.jitter
      metrics.bitrate = report.bytesReceived * 8 / report.timestamp // bps
    }
  })
  
  return metrics
}

// Monitor every 5 seconds
setInterval(async () => {
  const stats = await getStats(pc)
  console.log(`RTT: ${stats.rtt}ms, Loss: ${stats.packetsLost}`)
}, 5000)
```

## SDP Manipulation

Modify SDP for custom codec parameters:

```typescript
async function createOfferWithCodecPreferences(pc: RTCPeerConnection) {
  const offer = await pc.createOffer()
  
  // Prefer Opus and set parameters
  offer.sdp = offer.sdp?.replace(
    /(a=fmtp:\d+ .*)/,
    '$1;maxaveragebitrate=40000;stereo=0;useinbandfec=1;usedtx=1'
  )
  
  // Parameters explained:
  // maxaveragebitrate=40000 - 40kbps average
  // stereo=0 - Force mono
  // useinbandfec=1 - Enable forward error correction (packet loss resilience)
  // usedtx=1 - Discontinuous transmission (save bandwidth during silence)
  
  await pc.setLocalDescription(offer)
  return offer
}
```

## Common Patterns

### Cleanup on Disconnect

```typescript
function cleanup() {
  // Stop local tracks
  localStream.getTracks().forEach(track => track.stop())
  
  // Close peer connections
  peerConnections.forEach(pc => pc.close())
  
  // Clear arrays
  peerConnections.clear()
  
  // Stop audio elements
  document.querySelectorAll('audio').forEach(audio => {
    audio.srcObject = null
    audio.remove()
  })
}
```

### Handling Reconnection

```typescript
pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === 'failed') {
    // Attempt ICE restart
    restartIce()
  }
}

async function restartIce() {
  const offer = await pc.createOffer({ iceRestart: true })
  await pc.setLocalDescription(offer)
  sendViaSignaling({ type: 'offer', sdp: offer })
}
```

### Perfect Negotiation Pattern

Handles simultaneous offers from both peers:

```typescript
let makingOffer = false
let ignoreOffer = false

pc.onnegotiationneeded = async () => {
  try {
    makingOffer = true
    await pc.setLocalDescription()
    sendViaSignaling({ description: pc.localDescription })
  } catch (err) {
    console.error(err)
  } finally {
    makingOffer = false
  }
}

async function handleSignalingMessage(message: any) {
  if (message.description) {
    const offerCollision = 
      message.description.type === 'offer' &&
      (makingOffer || pc.signalingState !== 'stable')
    
    ignoreOffer = !polite && offerCollision
    if (ignoreOffer) return
    
    await pc.setRemoteDescription(message.description)
    
    if (message.description.type === 'offer') {
      await pc.setLocalDescription()
      sendViaSignaling({ description: pc.localDescription })
    }
  }
  
  if (message.candidate) {
    try {
      await pc.addIceCandidate(message.candidate)
    } catch (err) {
      if (!ignoreOffer) throw err
    }
  }
}
```

## Troubleshooting

### No Audio Received

1. Check `ontrack` handler is set before creating offer
2. Verify remote stream has tracks: `stream.getTracks().length > 0`
3. Ensure audio element `autoplay` is true
4. Check browser autoplay policy (may need user gesture)

### ICE Connection Fails

1. Verify STUN servers are accessible
2. Check firewall isn't blocking UDP ports
3. Try different STUN servers
4. For symmetric NAT, TURN server is required (not available in serverless mode)

### Echo/Feedback

1. Never connect local mic to local speakers via AudioContext.destination
2. Ensure `echoCancellation: true` in getUserMedia
3. Check headphones vs speakers (speakers cause acoustic echo)

### High Packet Loss

1. Reduce bitrate in SDP or sender parameters
2. Enable forward error correction (useinbandfec=1)
3. Check network quality with stats API
4. Consider adaptive bitrate based on packet loss metrics
