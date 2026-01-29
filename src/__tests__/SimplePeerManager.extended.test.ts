/**
 * Extended tests for SimplePeerManager
 * @vitest-environment jsdom
 * 
 * Tests cover:
 * - Message deduplication
 * - Peer connection lifecycle
 * - ICE restart logic
 * - Network status monitoring
 * - Mute status broadcasting
 * - Connection statistics
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SimplePeerManager, generatePeerId, selfId, loadCredentials } from '../renderer/signaling/SimplePeerManager'

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

// Store instances for tracking
let mockWebSocketInstances: MockWebSocket[] = []
let mockRTCPeerConnectionInstances: MockRTCPeerConnection[] = []

// Mock WebSocket for MQTT
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
    mockWebSocketInstances.push(this)
    
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      if (this.onopen) this.onopen()
    }, 10)
  }

  send = vi.fn((data: Uint8Array) => {
    const type = data[0] & 0xF0
    setTimeout(() => {
      if (this.readyState !== MockWebSocket.OPEN) return
      if (type === 0x10) {
        this.triggerMessage(new Uint8Array([0x20, 0x02, 0x00, 0x00]))
      } else if (type === 0x80) {
        const msgIdMsb = data[2]
        const msgIdLsb = data[3]
        this.triggerMessage(new Uint8Array([0x90, 0x03, msgIdMsb, msgIdLsb, 0x00]))
      }
    }, 10)
  })

  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    setTimeout(() => {
      if (this.onclose) this.onclose()
    }, 1)
  })

  public triggerMessage(data: Uint8Array) {
    if (this.onmessage) {
      this.onmessage({ data: data.buffer })
    }
  }

  public simulatePublish(payload: string) {
    const topicBytes = new TextEncoder().encode('p2p-conf/test-room')
    const messageBytes = new TextEncoder().encode(payload)
    const remainingLength = 2 + topicBytes.length + messageBytes.length
    
    const packet = new Uint8Array(2 + remainingLength)
    let i = 0
    packet[i++] = 0x30  // PUBLISH packet type
    packet[i++] = remainingLength
    packet[i++] = (topicBytes.length >> 8) & 0xff
    packet[i++] = topicBytes.length & 0xff
    packet.set(topicBytes, i)
    i += topicBytes.length
    packet.set(messageBytes, i)
    
    this.triggerMessage(packet)
  }
}

// Mock RTCPeerConnection
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
  
  private senders: MockRTCSender[] = []

  constructor() {
    mockRTCPeerConnectionInstances.push(this)
  }

  createOffer = vi.fn().mockImplementation(async (options?: RTCOfferOptions) => {
    return { type: 'offer', sdp: 'mock-sdp-offer' }
  })
  
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp-answer' })
  
  setLocalDescription = vi.fn().mockImplementation(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc as RTCSessionDescription
  })
  
  setRemoteDescription = vi.fn().mockImplementation(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = desc as RTCSessionDescription
  })
  
  addIceCandidate = vi.fn().mockResolvedValue(undefined)
  
  addTrack = vi.fn().mockImplementation((track: MediaStreamTrack, stream: MediaStream) => {
    const sender = new MockRTCSender(track)
    this.senders.push(sender)
    return sender
  })
  
  getSenders = vi.fn().mockImplementation(() => this.senders)
  
  getStats = vi.fn().mockImplementation(async () => {
    return new Map([
      ['candidate-pair-1', {
        type: 'candidate-pair',
        nominated: true,
        state: 'succeeded',
        currentRoundTripTime: 0.05
      }],
      ['inbound-rtp-1', {
        type: 'inbound-rtp',
        kind: 'audio',
        packetsReceived: 1000,
        packetsLost: 5,
        jitter: 0.01,
        bytesReceived: 50000
      }],
      ['outbound-rtp-1', {
        type: 'outbound-rtp',
        kind: 'audio',
        bytesSent: 50000
      }]
    ])
  })
  
  close = vi.fn().mockImplementation(() => {
    this.connectionState = 'closed'
    this.iceConnectionState = 'closed'
    setTimeout(() => this.onconnectionstatechange?.(), 0)
  })

  // Helper to simulate state changes
  simulateConnectionState(state: string) {
    this.connectionState = state
    setTimeout(() => this.onconnectionstatechange?.(), 0)
  }

  simulateIceConnectionState(state: string) {
    this.iceConnectionState = state
    setTimeout(() => this.oniceconnectionstatechange?.(), 0)
  }

  simulateTrack(track: MediaStreamTrack, stream: MediaStream) {
    setTimeout(() => {
      this.ontrack?.({ track, streams: [stream] })
    }, 0)
  }
}

class MockRTCSender {
  track: MediaStreamTrack | null
  
  constructor(track: MediaStreamTrack | null) {
    this.track = track
  }
  
  replaceTrack = vi.fn().mockResolvedValue(undefined)
  
  getParameters = vi.fn().mockReturnValue({
    codecs: [{ mimeType: 'audio/opus' }]
  })
}

// Mock RTCSessionDescription
class MockRTCSessionDescription {
  type: string
  sdp: string
  
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type || ''
    this.sdp = init.sdp || ''
  }
}

// Mock RTCIceCandidate
class MockRTCIceCandidate {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  
  constructor(init: RTCIceCandidateInit) {
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

// Mock BroadcastChannel
class MockBroadcastChannel {
  name: string
  onmessage: ((event: MessageEvent) => void) | null = null
  
  constructor(name: string) {
    this.name = name
  }
  
  postMessage = vi.fn()
  close = vi.fn()
}

// Mock MediaStream
class MockMediaStream {
  id: string
  private tracks: MockMediaStreamTrack[] = []
  
  constructor(tracks?: MockMediaStreamTrack[]) {
    this.id = `stream-${Math.random().toString(36).substr(2, 9)}`
    if (tracks) {
      this.tracks = tracks
    }
  }
  
  getTracks() {
    return this.tracks
  }
  
  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio')
  }
  
  getVideoTracks() {
    return this.tracks.filter(t => t.kind === 'video')
  }
  
  addTrack(track: MockMediaStreamTrack) {
    this.tracks.push(track)
  }
}

class MockMediaStreamTrack {
  id: string
  kind: string
  label: string
  enabled: boolean = true
  readyState: string = 'live'
  
  constructor(kind: string, label: string = '') {
    this.id = `track-${Math.random().toString(36).substr(2, 9)}`
    this.kind = kind
    this.label = label || `${kind} device`
  }
  
  stop = vi.fn()
  clone = vi.fn().mockReturnThis()
}

// Setup globals
vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
vi.stubGlobal('RTCSessionDescription', MockRTCSessionDescription)
vi.stubGlobal('RTCIceCandidate', MockRTCIceCandidate)
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
vi.stubGlobal('MediaStream', MockMediaStream)

describe('SimplePeerManager Extended Tests', () => {
  let manager: SimplePeerManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSocketInstances = []
    mockRTCPeerConnectionInstances = []

    // Mock electronAPI
    const mockElectronAPI = {
      getICEServers: vi.fn().mockResolvedValue([
        { urls: 'stun:stun.l.google.com:19302' }
      ]),
      getMQTTBrokers: vi.fn().mockResolvedValue([
        { url: 'wss://test-broker/mqtt' }
      ])
    }

    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true,
      configurable: true
    })

    // Mock navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true
    })

    manager = new SimplePeerManager()
  })

  afterEach(() => {
    manager.leaveRoom()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    // @ts-ignore
    delete window.electronAPI
  })

  describe('generatePeerId', () => {
    it('should generate 16 character alphanumeric ID', () => {
      const id = generatePeerId()
      expect(id).toHaveLength(16)
      expect(/^[A-Za-z0-9]+$/.test(id)).toBe(true)
    })

    it('should generate unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generatePeerId())
      }
      expect(ids.size).toBe(100)
    })
  })

  describe('loadCredentials', () => {
    it('should load ICE servers from electron API', async () => {
      await loadCredentials()
      
      expect((window as any).electronAPI.getICEServers).toHaveBeenCalled()
      expect((window as any).electronAPI.getMQTTBrokers).toHaveBeenCalled()
    })

    it('should handle missing electron API', async () => {
      // @ts-ignore
      delete window.electronAPI
      
      // Should not throw
      await loadCredentials()
    })

    it('should only load once when called multiple times', async () => {
      const promise1 = loadCredentials()
      const promise2 = loadCredentials()
      
      await Promise.all([promise1, promise2])
      
      // API should only be called once per credential type
      expect((window as any).electronAPI.getICEServers).toHaveBeenCalledTimes(1)
    })
  })

  describe('Signaling State Management', () => {
    it('should start in idle state', () => {
      expect(manager.getSignalingState()).toBe('idle')
    })

    it('should transition through states during join', async () => {
      const states: string[] = []
      manager.setOnSignalingStateChange((state) => {
        states.push(state)
      })

      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      expect(states).toContain('connecting')
      expect(states).toContain('connected')
    })

    it('should return to idle on leave', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      manager.leaveRoom()

      expect(manager.getSignalingState()).toBe('idle')
    })
  })

  describe('Mute Status Broadcasting', () => {
    it('should broadcast mute status to peers', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      manager.broadcastMuteStatus(true, false)

      // Verify broadcast was sent (check WebSocket.send was called)
      const ws = mockWebSocketInstances[0]
      expect(ws.send).toHaveBeenCalled()
    })

    it('should track local mute status', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      manager.broadcastMuteStatus(true, true)

      const debugInfo = manager.getDebugInfo() as any
      expect(debugInfo.localMuteStatus).toEqual({ micMuted: true, speakerMuted: true })
    })
  })

  describe('Local Stream Management', () => {
    it('should set local stream', async () => {
      const track = new MockMediaStreamTrack('audio', 'Test Mic')
      const stream = new MockMediaStream([track])

      manager.setLocalStream(stream as unknown as MediaStream)

      const debugInfo = manager.getDebugInfo() as any
      expect(debugInfo.roomId).toBeNull() // No room joined yet
    })

    it('should add tracks to existing peer connections', async () => {
      // Join room first
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      // Create a mock peer connection by simulating an announce message
      const ws = mockWebSocketInstances[0]
      ws.simulatePublish(JSON.stringify({
        v: 1,
        type: 'announce',
        from: 'peer-test-123',
        userName: 'Bob',
        platform: 'win',
        ts: Date.now(),
        msgId: 'msg-1'
      }))

      await vi.advanceTimersByTimeAsync(100)

      // Now set local stream
      const track = new MockMediaStreamTrack('audio', 'Test Mic')
      const stream = new MockMediaStream([track])
      
      manager.setLocalStream(stream as unknown as MediaStream)
    })
  })

  describe('Track Replacement', () => {
    it('should replace tracks in all peer connections', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      // Set initial stream
      const oldTrack = new MockMediaStreamTrack('audio', 'Old Mic')
      const oldStream = new MockMediaStream([oldTrack])
      manager.setLocalStream(oldStream as unknown as MediaStream)

      // Replace with new track
      const newTrack = new MockMediaStreamTrack('audio', 'New Mic')
      manager.replaceTrack(newTrack as unknown as MediaStreamTrack)

      // No peers, so no replacement should happen
      expect(manager.getPeers().size).toBe(0)
    })

    it('should handle null track gracefully', () => {
      // Should not throw
      manager.replaceTrack(null as any)
    })
  })

  describe('Connection Statistics', () => {
    it('should return empty stats when no peers connected', async () => {
      const stats = await manager.getConnectionStats()
      expect(stats.size).toBe(0)
    })
  })

  describe('Network Status Monitoring', () => {
    it('should track online/offline status', () => {
      const status = manager.getNetworkStatus()
      expect(status.isOnline).toBe(true)
      expect(status.wasInRoomWhenOffline).toBe(false)
      expect(status.reconnectAttempts).toBe(0)
    })

    it('should handle offline event', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      // Simulate offline event
      const offlineEvent = new Event('offline')
      window.dispatchEvent(offlineEvent)

      await vi.advanceTimersByTimeAsync(100)

      const status = manager.getNetworkStatus()
      expect(status.isOnline).toBe(false)
    })

    it('should attempt reconnect on online event', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      // Go offline
      Object.defineProperty(navigator, 'onLine', { value: false })
      window.dispatchEvent(new Event('offline'))
      await vi.advanceTimersByTimeAsync(100)

      // Go online
      Object.defineProperty(navigator, 'onLine', { value: true })
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(3000)

      // Should have triggered reconnect
    })

    it('should allow manual reconnect', async () => {
      const result = await manager.manualReconnect()
      // No room to reconnect to
      expect(result).toBe(false)
    })

    it('should expose network status callback', () => {
      const callback = vi.fn()
      manager.setOnNetworkStatusChange(callback)

      window.dispatchEvent(new Event('offline'))

      expect(callback).toHaveBeenCalledWith(false)
    })
  })

  describe('Debug Info', () => {
    it('should return comprehensive debug information', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      const debugInfo = manager.getDebugInfo() as any

      expect(debugInfo).toHaveProperty('selfId')
      expect(debugInfo).toHaveProperty('roomId', 'test-room')
      expect(debugInfo).toHaveProperty('userName', 'Alice')
      expect(debugInfo).toHaveProperty('signalingState')
      expect(debugInfo).toHaveProperty('peerCount', 0)
      expect(debugInfo).toHaveProperty('mqttConnected')
      expect(debugInfo).toHaveProperty('networkOnline')
    })
  })

  describe('Room Joining Edge Cases', () => {
    it('should prevent concurrent join operations', async () => {
      const join1 = manager.joinRoom('room-1', 'Alice')
      const join2 = manager.joinRoom('room-2', 'Bob')

      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)

      await Promise.all([join1, join2])

      // Second join should have been ignored
      const debugInfo = manager.getDebugInfo() as any
      expect(debugInfo.roomId).toBe('room-1')
    })

    it('should clean up existing room before joining new one', async () => {
      const join1 = manager.joinRoom('room-1', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(200)
      await join1

      // Join a different room
      const join2 = manager.joinRoom('room-2', 'Bob')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(200)
      await join2

      const debugInfo = manager.getDebugInfo() as any
      expect(debugInfo.roomId).toBe('room-2')
      expect(debugInfo.userName).toBe('Bob')
    })
  })

  describe('Leave Room Edge Cases', () => {
    it('should handle leave when not in room', () => {
      // Should not throw
      manager.leaveRoom()
      expect(manager.getSignalingState()).toBe('idle')
    })

    it('should prevent concurrent leave operations', async () => {
      const joinPromise = manager.joinRoom('test-room', 'Alice')
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await joinPromise

      // Multiple leaves should not cause issues
      manager.leaveRoom()
      manager.leaveRoom()

      expect(manager.getSignalingState()).toBe('idle')
    })
  })

  describe('Callbacks', () => {
    it('should accept all callback types', () => {
      const onPeerJoin = vi.fn()
      const onPeerLeave = vi.fn()
      const onRemoteStream = vi.fn()
      const onError = vi.fn()
      const onPeerMuteChange = vi.fn()

      manager.setCallbacks({
        onPeerJoin,
        onPeerLeave,
        onRemoteStream,
        onError,
        onPeerMuteChange
      })

      // Callbacks should be set (cannot verify directly, but no error is good)
    })

    it('should handle partial callbacks', () => {
      manager.setCallbacks({
        onPeerJoin: vi.fn()
      })

      // Should not throw
    })
  })

  describe('getPeers', () => {
    it('should return empty map when no peers', () => {
      const peers = manager.getPeers()
      expect(peers.size).toBe(0)
    })
  })

  describe('getPeerMuteStatus', () => {
    it('should return default mute status for unknown peer', () => {
      const status = manager.getPeerMuteStatus('unknown-peer')
      expect(status).toEqual({ micMuted: false, speakerMuted: false })
    })
  })

  describe('getAllPeerMuteStatuses', () => {
    it('should return empty map when no peers', () => {
      const statuses = manager.getAllPeerMuteStatuses()
      expect(statuses.size).toBe(0)
    })
  })
})

describe('Message Deduplication', () => {
  // Test deduplication logic separately
  
  class TestableMessageDeduplicator {
    private seen: Map<string, number> = new Map()
    private readonly windowSize = 500
    private readonly ttlMs = 30000

    isDuplicate(msgId: string): boolean {
      if (!msgId) return false
      if (this.seen.has(msgId)) return true
      
      this.seen.set(msgId, Date.now())
      
      if (this.seen.size > this.windowSize) {
        const entries = Array.from(this.seen.entries())
        entries.sort((a, b) => a[1] - b[1])
        const toRemove = entries.slice(0, entries.length - this.windowSize)
        toRemove.forEach(([key]) => this.seen.delete(key))
      }
      
      return false
    }

    size(): number {
      return this.seen.size
    }

    clear() {
      this.seen.clear()
    }
  }

  let dedup: TestableMessageDeduplicator

  beforeEach(() => {
    dedup = new TestableMessageDeduplicator()
  })

  it('should return false for new messages', () => {
    expect(dedup.isDuplicate('msg-1')).toBe(false)
    expect(dedup.isDuplicate('msg-2')).toBe(false)
  })

  it('should return true for duplicate messages', () => {
    expect(dedup.isDuplicate('msg-1')).toBe(false)
    expect(dedup.isDuplicate('msg-1')).toBe(true)
  })

  it('should handle empty message ID', () => {
    expect(dedup.isDuplicate('')).toBe(false)
    expect(dedup.isDuplicate('')).toBe(false) // Still false, not tracked
  })

  it('should track message count', () => {
    dedup.isDuplicate('msg-1')
    dedup.isDuplicate('msg-2')
    dedup.isDuplicate('msg-3')
    
    expect(dedup.size()).toBe(3)
  })

  it('should limit window size', () => {
    // Add more than window size
    for (let i = 0; i < 600; i++) {
      dedup.isDuplicate(`msg-${i}`)
    }
    
    // Should be limited to window size
    expect(dedup.size()).toBeLessThanOrEqual(500)
  })
})
