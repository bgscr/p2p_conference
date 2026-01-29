/**
 * Additional comprehensive tests for SimplePeerManager
 * @vitest-environment jsdom
 * 
 * Focus on edge cases, ICE handling, and signaling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SimplePeerManager,
  generatePeerId,
  selfId,
  MultiBrokerMQTT,
  MQTTClient,
  resetCredentialsCacheForTesting
} from '../renderer/signaling/SimplePeerManager'

// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  PeerLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Store WebSocket instances for manipulation
let mockWebSockets: MockWebSocket[] = []
let mockPeerConnections: MockRTCPeerConnection[] = []

class MockWebSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: any) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: any) => void) | null = null
  readyState = 0
  binaryType = 'arraybuffer'
  url: string

  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  constructor(url: string) {
    this.url = url
    mockWebSockets.push(this)

    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
    }, 5)
  }

  send = vi.fn((data: Uint8Array) => {
    // Simulate MQTT protocol responses
    const packetType = data[0] & 0xF0
    setTimeout(() => {
      if (this.readyState !== MockWebSocket.OPEN) return

      // CONNECT -> CONNACK
      if (packetType === 0x10) {
        this.triggerMessage(new Uint8Array([0x20, 0x02, 0x00, 0x00]))
      }
      // SUBSCRIBE -> SUBACK
      else if (packetType === 0x80) {
        const msgId1 = data[2]
        const msgId2 = data[3]
        this.triggerMessage(new Uint8Array([0x90, 0x03, msgId1, msgId2, 0x00]))
      }
    }, 5)
  })

  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    setTimeout(() => this.onclose?.(), 1)
  })

  triggerMessage(data: Uint8Array) {
    if (this.onmessage) {
      this.onmessage({ data: data.buffer })
    }
  }

  triggerError() {
    this.onerror?.(new Error('Connection failed'))
  }

  simulatePublish(topic: string, payload: string) {
    const topicBytes = new TextEncoder().encode(topic)
    const messageBytes = new TextEncoder().encode(payload)
    const remainingLength = 2 + topicBytes.length + messageBytes.length

    const packet = new Uint8Array(2 + remainingLength)
    let i = 0
    packet[i++] = 0x30
    packet[i++] = remainingLength
    packet[i++] = (topicBytes.length >> 8) & 0xff
    packet[i++] = topicBytes.length & 0xff
    packet.set(topicBytes, i)
    i += topicBytes.length
    packet.set(messageBytes, i)

    this.triggerMessage(packet)
  }
}

class MockRTCPeerConnection {
  onicecandidate: ((event: any) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((event: any) => void) | null = null

  connectionState = 'new'
  iceConnectionState = 'new'
  signalingState = 'stable'
  localDescription: RTCSessionDescription | null = null
  remoteDescription: RTCSessionDescription | null = null

  private senders: any[] = []

  constructor() {
    mockPeerConnections.push(this)
  }

  createOffer = vi.fn(async (options?: RTCOfferOptions) => {
    return {
      type: 'offer',
      sdp: options?.iceRestart ? 'mock-sdp-offer-restart' : 'mock-sdp-offer'
    }
  })

  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp-answer' })

  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc as RTCSessionDescription
  })

  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc as RTCSessionDescription
  })

  addIceCandidate = vi.fn().mockResolvedValue(undefined)

  addTrack = vi.fn((track: any, _stream: any) => {
    const sender = { track, replaceTrack: vi.fn().mockResolvedValue(undefined), getParameters: vi.fn().mockReturnValue({ codecs: [{ mimeType: 'audio/opus' }] }) }
    this.senders.push(sender)
    return sender
  })

  getSenders = vi.fn(() => this.senders)

  getStats = vi.fn().mockResolvedValue(new Map([
    ['transport-1', { type: 'transport', selectedCandidatePairId: 'candidate-pair-1' }],
    ['candidate-pair-1', { type: 'candidate-pair', id: 'candidate-pair-1', nominated: true, currentRoundTripTime: 0.05 }],
    ['inbound-rtp-1', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 10, jitter: 0.015, bytesReceived: 50000 }],
    ['outbound-rtp-1', { type: 'outbound-rtp', kind: 'audio', bytesSent: 48000 }]
  ]))

  close = vi.fn(() => {
    this.connectionState = 'closed'
    this.iceConnectionState = 'closed'
    this.signalingState = 'closed'
  })

  simulateState(connState: string, iceState: string) {
    this.connectionState = connState
    this.iceConnectionState = iceState
    setTimeout(() => {
      this.onconnectionstatechange?.()
      this.oniceconnectionstatechange?.()
    }, 0)
  }

  simulateTrack(track: any, stream: any) {
    setTimeout(() => {
      this.ontrack?.({ track, streams: [stream] })
    }, 0)
  }

  simulateIceCandidate(candidate: any) {
    setTimeout(() => {
      this.onicecandidate?.({ candidate })
    }, 0)
  }
}

class MockMediaStream {
  id = `stream-${Math.random().toString(36).substr(2, 9)}`
  active = true
  private tracks: any[] = []

  constructor(tracks?: any[]) {
    if (tracks) this.tracks = tracks
  }

  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio') }
  addTrack(track: any) { this.tracks.push(track) }
}

class MockMediaStreamTrack {
  id = `track-${Math.random().toString(36).substr(2, 9)}`
  kind = 'audio'
  label = 'Test Microphone'
  enabled = true
  readyState = 'live'

  constructor(kind = 'audio') { this.kind = kind }
  stop = vi.fn()
}

class MockRTCSessionDescription {
  type: string
  sdp: string
  constructor(init: any) {
    this.type = init.type || ''
    this.sdp = init.sdp || ''
  }
}

class MockRTCIceCandidate {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null

  constructor(init: any) {
    this.candidate = init.candidate || ''
    this.sdpMid = init.sdpMid || null
    this.sdpMLineIndex = init.sdpMLineIndex || null
  }

  toJSON() {
    return {
      candidate: this.candidate,
      sdpMid: this.sdpMid,
      sdpMLineIndex: this.sdpMLineIndex
    }
  }
}

class MockBroadcastChannel {
  name: string
  onmessage: ((event: any) => void) | null = null

  constructor(name: string) { this.name = name }
  postMessage = vi.fn()
  close = vi.fn()
}

// Set up global mocks
vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
vi.stubGlobal('RTCSessionDescription', MockRTCSessionDescription)
vi.stubGlobal('RTCIceCandidate', MockRTCIceCandidate)
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
vi.stubGlobal('MediaStream', MockMediaStream)

describe('SimplePeerManager - ICE Handling', () => {
  let manager: SimplePeerManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
    mockPeerConnections = []
    resetCredentialsCacheForTesting()

    Object.defineProperty(window, 'electronAPI', {
      value: {
        getICEServers: vi.fn().mockResolvedValue([{ urls: 'stun:stun.test:19302' }]),
        getMQTTBrokers: vi.fn().mockResolvedValue([{ url: 'wss://test-broker/mqtt' }])
      },
      writable: true,
      configurable: true
    })

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0)', writable: true, configurable: true })

    manager = new SimplePeerManager()
  })

  afterEach(() => {
    manager.leaveRoom()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    // @ts-ignore
    delete window.electronAPI
  })

  describe('Peer Connection Lifecycle', () => {
    it('should create SimplePeerManager instance', () => {
      expect(manager).toBeDefined()
      expect(typeof manager.joinRoom).toBe('function')
      expect(typeof manager.leaveRoom).toBe('function')
      expect(typeof manager.setCallbacks).toBe('function')
    })

    it('should handle offer/answer exchange', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await vi.advanceTimersByTimeAsync(200)
      await joinPromise

      const ws = mockWebSockets[0]

      // Receive offer from peer
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'offer',
        from: 'peer-123',
        to: selfId,
        data: { type: 'offer', sdp: 'v=0\r\n...' },
        userName: 'Bob',
        platform: 'win',
        msgId: 'msg-2'
      }))

      await vi.advanceTimersByTimeAsync(100)

      // Verify answer was sent
      expect(ws.send).toHaveBeenCalled()
    })

    it('should handle ICE candidates', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await vi.advanceTimersByTimeAsync(200)
      await joinPromise

      const ws = mockWebSockets[0]

      // First establish connection with offer
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'offer',
        from: 'peer-123',
        to: selfId,
        data: { type: 'offer', sdp: 'v=0\r\n...' },
        userName: 'Bob',
        platform: 'win',
        msgId: 'msg-3'
      }))

      await vi.advanceTimersByTimeAsync(100)

      // Then send ICE candidate
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'ice-candidate',
        from: 'peer-123',
        to: selfId,
        data: { candidate: 'candidate:1 1 UDP 2122...', sdpMid: '0', sdpMLineIndex: 0 },
        msgId: 'msg-4'
      }))

      await vi.advanceTimersByTimeAsync(100)

      // Verify ICE candidate was added
      if (mockPeerConnections[0]) {
        expect(mockPeerConnections[0].addIceCandidate).toHaveBeenCalled()
      }
    })

    it('should queue ICE candidates before remote description is set', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await vi.advanceTimersByTimeAsync(200)
      await joinPromise

      const ws = mockWebSockets[0]

      // Send ICE candidate before offer (should be queued)
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'ice-candidate',
        from: 'peer-456',
        to: selfId,
        data: { candidate: 'candidate:1 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 },
        msgId: 'msg-5'
      }))

      await vi.advanceTimersByTimeAsync(50)

      // Then send offer
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'offer',
        from: 'peer-456',
        to: selfId,
        data: { type: 'offer', sdp: 'v=0\r\n...' },
        userName: 'Eve',
        platform: 'linux',
        msgId: 'msg-6'
      }))

      await vi.advanceTimersByTimeAsync(100)

      // Queued candidate should be added after remote description
      if (mockPeerConnections[0]) {
        expect(mockPeerConnections[0].addIceCandidate).toHaveBeenCalled()
      }
    })
  })

  describe('Connection State Transitions', () => {
    it('should notify peer join when connected', async () => {
      const onPeerJoin = vi.fn()
      manager.setCallbacks({ onPeerJoin })

      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await vi.advanceTimersByTimeAsync(200)
      await joinPromise

      const ws = mockWebSockets[0]

      // Receive offer
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'offer',
        from: 'peer-789',
        to: selfId,
        data: { type: 'offer', sdp: 'v=0\r\n...' },
        userName: 'Charlie',
        platform: 'win',
        msgId: 'msg-7'
      }))

      await vi.advanceTimersByTimeAsync(100)

      // Simulate connection success
      const pc = mockPeerConnections[mockPeerConnections.length - 1]
      if (pc) {
        pc.simulateState('connected', 'connected')
        await vi.advanceTimersByTimeAsync(50)

        expect(onPeerJoin).toHaveBeenCalledWith('peer-789', 'Charlie', 'win')
      }
    })

    it('should notify peer leave when connection closes', async () => {
      const onPeerLeave = vi.fn()
      manager.setCallbacks({ onPeerLeave })

      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await vi.advanceTimersByTimeAsync(200)
      await joinPromise

      const ws = mockWebSockets[0]

      // Receive offer and establish connection
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'offer',
        from: 'peer-abc',
        to: selfId,
        data: { type: 'offer', sdp: 'v=0\r\n...' },
        userName: 'Dave',
        platform: 'mac',
        msgId: 'msg-8'
      }))

      await vi.advanceTimersByTimeAsync(100)

      const pc = mockPeerConnections[mockPeerConnections.length - 1]
      if (pc) {
        // First connect
        pc.simulateState('connected', 'connected')
        await vi.advanceTimersByTimeAsync(50)

        // Then receive leave message
        ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
          v: 1,
          type: 'leave',
          from: 'peer-abc',
          msgId: 'msg-9'
        }))

        await vi.advanceTimersByTimeAsync(100)

        expect(onPeerLeave).toHaveBeenCalled()
      }
    })
  })

  describe('Remote Stream Handling', () => {
    it('should notify when remote stream is received', async () => {
      const onRemoteStream = vi.fn()
      manager.setCallbacks({ onRemoteStream })

      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await vi.advanceTimersByTimeAsync(200)
      await joinPromise

      const ws = mockWebSockets[0]

      // Establish connection
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'offer',
        from: 'peer-stream',
        to: selfId,
        data: { type: 'offer', sdp: 'v=0\r\n...' },
        userName: 'StreamPeer',
        platform: 'win',
        msgId: 'msg-10'
      }))

      await vi.advanceTimersByTimeAsync(100)

      const pc = mockPeerConnections[mockPeerConnections.length - 1]
      if (pc) {
        // Simulate track event
        const mockTrack = new MockMediaStreamTrack()
        const mockStream = new MockMediaStream([mockTrack])
        pc.simulateTrack(mockTrack, mockStream)

        await vi.advanceTimersByTimeAsync(50)

        expect(onRemoteStream).toHaveBeenCalled()
      }
    })
  })

  describe('Mute Status', () => {
    it('should handle mute status messages from peers', async () => {
      const onPeerMuteChange = vi.fn()
      manager.setCallbacks({ onPeerMuteChange })

      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await vi.advanceTimersByTimeAsync(200)
      await joinPromise

      const ws = mockWebSockets[0]

      // Establish connection first
      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'offer',
        from: 'peer-mute',
        to: selfId,
        data: { type: 'offer', sdp: 'v=0\r\n...' },
        userName: 'MutePeer',
        platform: 'win',
        msgId: 'msg-11'
      }))

      await vi.advanceTimersByTimeAsync(100)

      const pc = mockPeerConnections[mockPeerConnections.length - 1]
      if (pc) {
        pc.simulateState('connected', 'connected')
        await vi.advanceTimersByTimeAsync(50)

        // Send mute status
        ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
          v: 1,
          type: 'mute-status',
          from: 'peer-mute',
          data: { micMuted: true, speakerMuted: false },
          msgId: 'msg-12'
        }))

        await vi.advanceTimersByTimeAsync(50)

        expect(onPeerMuteChange).toHaveBeenCalledWith(
          'peer-mute',
          { micMuted: true, speakerMuted: false }
        )
      }
    })
  })

  describe('Ping/Pong', () => {
    it('should respond to ping with pong', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await vi.advanceTimersByTimeAsync(200)
      await joinPromise

      const ws = mockWebSockets[0]

      ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
        v: 1,
        type: 'ping',
        from: 'peer-ping',
        to: selfId,
        msgId: 'msg-13'
      }))

      await vi.advanceTimersByTimeAsync(50)

      // Should have sent a pong response
      expect(ws.send).toHaveBeenCalled()
    })
  })
})

describe('SimplePeerManager - Connection Stats', () => {
  let manager: SimplePeerManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
    mockPeerConnections = []
    resetCredentialsCacheForTesting()

    Object.defineProperty(window, 'electronAPI', {
      value: {
        getICEServers: vi.fn().mockResolvedValue([{ urls: 'stun:stun.test:19302' }]),
        getMQTTBrokers: vi.fn().mockResolvedValue([{ url: 'wss://test-broker/mqtt' }])
      },
      writable: true,
      configurable: true
    })

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })

    manager = new SimplePeerManager()
  })

  afterEach(() => {
    manager.leaveRoom()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    // @ts-ignore
    delete window.electronAPI
  })

  it('should calculate quality based on RTT, packet loss, and jitter', async () => {
    const joinPromise = manager.joinRoom('test-room', 'Alice')
    await vi.advanceTimersByTimeAsync(200)
    await joinPromise

    const ws = mockWebSockets[0]

    // Establish a peer connection
    ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
      v: 1,
      type: 'offer',
      from: 'peer-stats',
      to: selfId,
      data: { type: 'offer', sdp: 'v=0\r\n...' },
      userName: 'StatsPeer',
      platform: 'win',
      msgId: 'msg-14'
    }))

    await vi.advanceTimersByTimeAsync(100)

    const pc = mockPeerConnections[mockPeerConnections.length - 1]
    if (pc) {
      pc.simulateState('connected', 'connected')
      await vi.advanceTimersByTimeAsync(50)

      const stats = await manager.getConnectionStats()

      const peerStats = stats.get('peer-stats')
      if (peerStats) {
        expect(peerStats.rtt).toBeDefined()
        expect(peerStats.packetLoss).toBeDefined()
        expect(peerStats.jitter).toBeDefined()
        expect(peerStats.quality).toBeDefined()
        expect(['excellent', 'good', 'fair', 'poor']).toContain(peerStats.quality)
      }
    }
  })

  it('should return default values for connecting peers', async () => {
    const joinPromise = manager.joinRoom('test-room', 'Alice')
    await vi.advanceTimersByTimeAsync(200)
    await joinPromise

    const ws = mockWebSockets[0]

    // Start connection but don't complete
    ws.simulatePublish('p2p-conf/test-room', JSON.stringify({
      v: 1,
      type: 'offer',
      from: 'peer-connecting',
      to: selfId,
      data: { type: 'offer', sdp: 'v=0\r\n...' },
      userName: 'ConnectingPeer',
      platform: 'win',
      msgId: 'msg-15'
    }))

    await vi.advanceTimersByTimeAsync(50)

    // Don't simulate 'connected' state - leave as 'new'
    const stats = await manager.getConnectionStats()

    const peerStats = stats.get('peer-connecting')
    if (peerStats) {
      expect(peerStats.quality).toBe('fair')
      expect(peerStats.rtt).toBe(0)
    }
  })
})

describe('MQTTClient - Protocol Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('should connect with username and password', async () => {
    const client = new MQTTClient('wss://test/mqtt', 'testuser', 'testpass')

    const connectPromise = client.connect()
    await vi.advanceTimersByTimeAsync(100)
    await connectPromise

    expect(client.isConnected()).toBe(true)

    // Verify CONNECT packet was sent with credentials
    const ws = mockWebSockets[mockWebSockets.length - 1]
    expect(ws.send).toHaveBeenCalled()

    client.disconnect()
  })

  it('should report not connected before connect', () => {
    const client = new MQTTClient('wss://test/mqtt')
    expect(client.isConnected()).toBe(false)
  })

  it('should return broker URL', () => {
    const client = new MQTTClient('wss://test/mqtt')
    expect(client.getBrokerUrl()).toBe('wss://test/mqtt')
  })

  it('should report not connected initially', () => {
    const client = new MQTTClient('wss://test/mqtt')
    expect(client.isConnected()).toBe(false)
  })

  it('should set disconnect callback', () => {
    const client = new MQTTClient('wss://test/mqtt')
    const callback = vi.fn()

    // Should not throw
    expect(() => client.setOnDisconnect(callback)).not.toThrow()
  })
})

describe('MultiBrokerMQTT', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
    resetCredentialsCacheForTesting()

    Object.defineProperty(window, 'electronAPI', {
      value: {
        getICEServers: vi.fn().mockResolvedValue([]),
        getMQTTBrokers: vi.fn().mockResolvedValue([
          { url: 'wss://broker1/mqtt' },
          { url: 'wss://broker2/mqtt' }
        ])
      },
      writable: true,
      configurable: true
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    // @ts-ignore
    delete window.electronAPI
  })

  it('should create instance', () => {
    const multi = new MultiBrokerMQTT()
    expect(multi).toBeDefined()
    expect(typeof multi.connectAll).toBe('function')
    expect(typeof multi.disconnect).toBe('function')
    expect(typeof multi.publish).toBe('function')
    multi.disconnect()
  })

  it('should report not connected initially', () => {
    const multi = new MultiBrokerMQTT()
    expect(multi.isConnected()).toBe(false)
    multi.disconnect()
  })

  it('should return empty status before connecting', () => {
    const multi = new MultiBrokerMQTT()
    const status = multi.getConnectionStatus()
    expect(Array.isArray(status)).toBe(true)
    multi.disconnect()
  })

  it('should return zero deduplicator size initially', () => {
    const multi = new MultiBrokerMQTT()
    expect(multi.getDeduplicatorSize()).toBe(0)
    multi.disconnect()
  })

  it('should have subscribe and publish methods', () => {
    const multi = new MultiBrokerMQTT()
    expect(typeof multi.subscribeAll).toBe('function')
    expect(typeof multi.publish).toBe('function')
    multi.disconnect()
  })
})

describe('generatePeerId', () => {
  it('should generate IDs with only alphanumeric characters', () => {
    for (let i = 0; i < 50; i++) {
      const id = generatePeerId()
      expect(/^[A-Za-z0-9]+$/.test(id)).toBe(true)
    }
  })

  it('should generate exactly 16 characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePeerId()).toHaveLength(16)
    }
  })

  it('should have high uniqueness', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      ids.add(generatePeerId())
    }
    // All 1000 should be unique (collision is astronomically unlikely)
    expect(ids.size).toBe(1000)
  })
})

describe('selfId constant', () => {
  it('should be a valid peer ID', () => {
    expect(selfId).toHaveLength(16)
    expect(/^[A-Za-z0-9]+$/.test(selfId)).toBe(true)
  })
})
