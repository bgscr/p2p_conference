# P2P Conference

A serverless, peer-to-peer audio conferencing application built with Electron, React, and WebRTC.

## Features

- **Serverless Architecture**: No central media servers required - all connections are direct peer-to-peer
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **AI Noise Suppression**: RNNoise-powered background noise removal (WASM-based)
- **End-to-End Encryption**: All audio is encrypted via WebRTC DTLS-SRTP
- **Multi-Broker Signaling**: Redundant MQTT broker connectivity for reliable peer discovery
- **Hot-Swappable Devices**: Switch microphones and speakers during calls
- **Connection Quality Monitoring**: Real-time RTT, packet loss, and jitter statistics
- **Internationalization**: English and Chinese language support

## Architecture

```
┌─────────────┐     ┌─────────────┐
│   User A    │────▶│   User B    │
└─────────────┘     └─────────────┘
       │                   │
       └───────┬───────────┘
               ▼
        ┌─────────────┐
        │   User C    │
        └─────────────┘

Full Mesh P2P Topology
- Each user connects directly to all others
- No central server forwarding media
- Max recommended: 10-15 participants
```

### Signaling Architecture

```
┌────────────────────────────────────┐
│          Multi-Broker MQTT         │
├────────────────────────────────────┤
│  ┌──────────┐  ┌──────────────┐   │
│  │ EMQX.io  │  │ Mosquitto    │   │
│  │ (Global) │  │ (Public)     │   │
│  └──────────┘  └──────────────┘   │
│  ┌──────────────┐                 │
│  │ Private MQTT │                 │
│  │ (w/ auth)    │                 │
│  └──────────────┘                 │
└────────────────────────────────────┘
           │
           ▼
    Message Deduplication
           │
           ▼
    WebRTC Signaling (SDP/ICE)
```

## Technology Stack

- **Electron 28**: Cross-platform desktop framework
- **React 18 + TypeScript**: UI framework with type safety
- **WebRTC**: Real-time peer-to-peer communication
- **MQTT over WebSocket**: Multi-broker signaling for reliability
- **RNNoise (WASM)**: AI-powered noise suppression via AudioWorklet
- **Web Audio API**: Audio processing pipeline with 48kHz support
- **Tailwind CSS**: Styling

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Building

```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

### Code Quality

```bash
# Type checking
npm run typecheck

# Lint code
npm run lint

# Fix lint issues automatically
npm run lint:fix
```

## Usage

1. **Start the application** - Launch P2P Conference
2. **Enter your name** - This will be displayed to other participants
3. **Create or join a room**:
   - Click "Generate" for a new secure room ID
   - Or enter an existing room ID to join
4. **Share the room ID** - Send it to others you want to call
5. **Call controls**:
   - 🎤 Mute/unmute your microphone (M key)
   - 🔊 Mute/unmute speakers
   - ⚙️ Change audio devices
   - 📞 Leave the call (Esc key)

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `M` | Toggle microphone mute |
| `Esc` | Leave call / Cancel search |
| `Ctrl+Shift+L` | Download debug logs |

## Network Requirements

This application uses P2P connections, which requires:

- UDP traffic allowed (ports vary due to NAT)
- STUN/TURN servers accessible
- WebSocket connections to MQTT brokers

**If connections fail:**
- Try using a mobile hotspot
- Switch to a home/public network
- Check firewall settings

## Privacy & Security

- **IP Addresses**: Visible to other participants (inherent to P2P)
- **Audio Encryption**: DTLS-SRTP (mandatory in WebRTC)
- **No Server Storage**: No audio or metadata is stored centrally
- **Room IDs**: Should be long and random (8+ characters) for security
- **Credentials**: MQTT and TURN credentials are stored in the main process (not exposed to renderer)

## Configuration

Audio processing options (Settings panel):
- **AI Noise Suppression**: Enable/disable RNNoise (removes keyboard, fan noise)
- **Echo Cancellation**: Browser-provided AEC
- **Auto Gain Control**: Automatic volume adjustment

## Troubleshooting

### No audio from remote participants
- Check speaker selection in settings
- Verify browser audio permissions
- Try clicking the participant's volume slider

### Connection stuck at "Searching..."
- MQTT discovery typically takes 3-10 seconds
- Verify both users have the exact same room ID
- Check network connectivity
- Try a different network if behind strict firewall

### High CPU usage
- Audio processing is optimized but uses CPU
- Try disabling noise suppression
- Limit to fewer participants (10 max recommended)

### Debug Logs
Press `Ctrl+Shift+L` or use the Help menu to download debug logs for troubleshooting.

## Development

### Project Structure

```
P2P_Conference/
├── electron/           # Main process
│   ├── main.ts         # Window management, tray, IPC
│   ├── preload.ts      # IPC bridge
│   ├── credentials.ts  # MQTT/TURN credentials
│   └── logger.ts       # File-based logging
├── src/
│   ├── renderer/       # React application
│   │   ├── components/   # UI components
│   │   ├── hooks/        # React hooks
│   │   ├── audio-processor/  # Audio pipeline + RNNoise
│   │   ├── signaling/    # SimplePeerManager (MQTT)
│   │   └── utils/        # Logger, i18n
│   └── types/          # TypeScript definitions
├── public/             # Static assets
│   └── audio-processor/  # WASM + AudioWorklet
└── build/              # Build configuration
```

### Key Files

| File | Description |
|------|-------------|
| `electron/main.ts` | Electron main process |
| `src/renderer/App.tsx` | Main React component |
| `src/renderer/signaling/SimplePeerManager.ts` | Multi-broker MQTT signaling + WebRTC |
| `src/renderer/audio-processor/AudioPipeline.ts` | Audio processing chain |
| `public/audio-processor/noise-processor.js` | RNNoise AudioWorklet |

### Audio Processing Pipeline

```
Microphone Input
       │
       ▼
Browser AEC/AGC (constraints)
       │
       ▼
AudioContext (48kHz)
       │
       ▼
MediaStreamSource
       │
       ▼
AudioWorkletNode (RNNoise WASM)
  - Ring buffer (128 → 480 samples)
  - AI noise suppression
  - int16 ↔ float32 conversion
       │
       ▼
GainNode → AnalyserNode
       │
       ▼
MediaStreamDestination → WebRTC
```

## License

MIT

## Acknowledgments

- [RNNoise](https://github.com/xiph/rnnoise) - AI noise suppression
- [@jitsi/rnnoise-wasm](https://github.com/AoEiuV020/AoEiuV020) - WASM build
- [Electron](https://www.electronjs.org/) - Cross-platform framework
- [EMQX](https://www.emqx.io/) - Public MQTT broker
