# P2P Conference

A serverless, peer-to-peer audio conferencing application built with Electron, React, and WebRTC.

## Features

- **Serverless Architecture**: No central media servers required - all connections are direct peer-to-peer
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **AI Noise Suppression**: RNNoise-powered background noise removal
- **End-to-End Encryption**: All audio is encrypted via WebRTC DTLS-SRTP
- **Decentralized Signaling**: Uses BitTorrent DHT for peer discovery (via Trystero)
- **Hot-Swappable Devices**: Switch microphones and speakers during calls

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

## Technology Stack

- **Electron**: Cross-platform desktop framework
- **React + TypeScript**: UI framework
- **WebRTC**: Real-time peer-to-peer communication
- **Trystero**: Serverless signaling via BitTorrent DHT
- **RNNoise**: AI-powered noise suppression (WASM)
- **Web Audio API**: Audio processing pipeline
- **Tailwind CSS**: Styling

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

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

## Usage

1. **Start the application** - Launch P2P Conference
2. **Enter your name** - This will be displayed to other participants
3. **Create or join a room**:
   - Click "Generate" for a new secure room ID
   - Or enter an existing room ID to join
4. **Share the room ID** - Send it to others you want to call
5. **Call controls**:
   - 🎤 Mute/unmute your microphone
   - ⚙️ Change audio devices
   - 📞 Leave the call

## Network Requirements

This application uses P2P connections, which requires:

- UDP traffic allowed (ports vary due to NAT)
- STUN servers accessible (uses Google's public STUN)
- Not behind symmetric NAT (corporate firewalls may block)

**If connections fail:**
- Try using a mobile hotspot
- Switch to a home/public network
- Check firewall settings

## Privacy & Security

- **IP Addresses**: Visible to other participants (inherent to P2P)
- **Audio Encryption**: DTLS-SRTP (mandatory in WebRTC)
- **No Server Storage**: No audio or metadata is stored centrally
- **Room IDs**: Should be long and random for security

## Configuration

Audio processing options (Settings panel):
- **AI Noise Suppression**: Enable/disable RNNoise
- **Echo Cancellation**: Browser-provided AEC
- **Auto Gain Control**: Automatic volume adjustment

## Troubleshooting

### No audio from remote participants
- Check speaker selection in settings
- Verify browser audio permissions
- Try clicking "unmute" if audio was blocked

### Connection stuck at "Searching..."
- DHT discovery can take 5-30 seconds
- Verify both users have the same room ID
- Check network connectivity

### High CPU usage
- Audio processing is optimized but uses CPU
- Try disabling noise suppression
- Limit to fewer participants

## Development

### Project Structure

```
P2P_Conference/
├── electron/          # Main process
├── src/
│   ├── renderer/      # React application
│   │   ├── components/  # UI components
│   │   ├── hooks/       # React hooks
│   │   ├── audio-processor/  # Audio pipeline
│   │   └── signaling/   # Trystero client
│   └── types/         # TypeScript types
├── public/            # Static assets
└── build/             # Build configuration
```

### Key Files

- `electron/main.ts` - Electron main process
- `src/renderer/App.tsx` - Main React component
- `src/renderer/hooks/useRoom.ts` - Room/signaling logic
- `src/renderer/hooks/usePeerConnections.ts` - WebRTC management
- `public/audio-processor/noise-processor.js` - AudioWorklet

## License

MIT

## Acknowledgments

- [Trystero](https://github.com/dmotz/trystero) - Serverless WebRTC signaling
- [RNNoise](https://github.com/xiph/rnnoise) - AI noise suppression
- [Electron](https://www.electronjs.org/) - Cross-platform framework
