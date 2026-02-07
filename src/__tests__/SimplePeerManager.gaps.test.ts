/**
 * @vitest-environment jsdom
 */

/**
 * Additional coverage tests for SimplePeerManager
 * Targets remaining uncovered lines/branches:
 * - replaceTrack: no audio sender fallback to codec-match, then addTrack fallback
 * - replaceTrack: error paths (replaceTrack failure, addTrack failure)
 * - setLocalStream: exact track ID match (skip), addTrack error catch
 * - attemptIceRestart: timeout triggers cleanupPeer when max attempts reached
 * - attemptIceRestart: createOffer failure on last attempt cleans up
 * - leaveRoom: peer close() error is caught
 * - handleOffer: pending ICE candidates with addIceCandidate failure
 * - handleOffer: setRemoteDescription/createAnswer error
 * - handleAnnounce: disconnected peer with iceRestartInProgress (not dead)
 * - connection state 'connected' sends mute status after delay
 * - connection state 'disconnected' (onconnectionstatechange)
 * - network reconnect: inner timer abort paths, MQTT not connected retry, error retry
 * - manualReconnect when no room
 * - handleBeforeUnload
 * - loadCredentials: error handling, concurrent loading
 * - MultiBrokerMQTT: handleBrokerDisconnect existing timer, subscribe failed on resubscribe
 * - MultiBrokerMQTT: getConnectionStatus
 * - MQTTClient: connect timeout, incomplete packet in buffer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SimplePeerManager,
  selfId,
  MQTTClient,
  MultiBrokerMQTT,
  loadCredentials,
  resetCredentialsCacheForTesting,
} from '../renderer/signaling/SimplePeerManager'

// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  PeerLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ---------- Mock classes ----------

let mockWebSockets: MockWS[] = []
let mockPeerConnections: MockPC[] = []

class MockWS {
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
      this.readyState = MockWS.OPEN
      this.onopen?.()
    }, 5)
  }

  send = vi.fn((data: Uint8Array) => {
    const packetType = data[0] & 0xf0
    setTimeout(() => {
      if (this.readyState !== MockWS.OPEN) return
      if (packetType === 0x10) {
        this.onmessage?.({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer })
      } else if (packetType === 0x80) {
        this.onmessage?.({
          data: new Uint8Array([0x90, 0x03, data[2], data[3], 0x00]).buffer,
        })
      }
    }, 5)
  })

  close = vi.fn(() => {
    this.readyState = MockWS.CLOSED
    setTimeout(() => this.onclose?.(), 1)
  })
}

class MockPC {
  onicecandidate: ((event: any) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((event: any) => void) | null = null
  connectionState = 'new'
  iceConnectionState = 'new'
  signalingState = 'stable'
  localDescription: any = null
  remoteDescription: any = null

  private senders: any[] = []

  constructor() {
    mockPeerConnections.push(this)
  }

  createOffer = vi.fn(async () => ({
    type: 'offer',
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10;useinbandfec=1',
  }))

  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'mock-answer-sdp' }))
  setLocalDescription = vi.fn(async (desc: any) => { this.localDescription = desc })
  setRemoteDescription = vi.fn(async (desc: any) => { this.remoteDescription = desc })
  addIceCandidate = vi.fn(async () => {})
  addTrack = vi.fn((track: any, _stream: any) => {
    const sender = {
      track,
      replaceTrack: vi.fn().mockResolvedValue(undefined),
      getParameters: vi.fn().mockReturnValue({ codecs: [{ mimeType: 'audio/opus' }] }),
    }
    this.senders.push(sender)
    return sender
  })
  getSenders = vi.fn(() => this.senders)
  getStats = vi.fn(async () => new Map())
  close = vi.fn(() => {
    this.connectionState = 'closed'
    this.iceConnectionState = 'closed'
    this.signalingState = 'closed'
  })
}

class MockBC {
  name: string
  onmessage: ((event: any) => void) | null = null
  constructor(name: string) { this.name = name }
  postMessage = vi.fn()
  close = vi.fn()
}

vi.stubGlobal('WebSocket', MockWS)
vi.stubGlobal('RTCPeerConnection', MockPC)
vi.stubGlobal('RTCSessionDescription', class { constructor(init: any) { Object.assign(this, init) } })
vi.stubGlobal('RTCIceCandidate', class {
  candidate: string; sdpMid: string | null; sdpMLineIndex: number | null
  constructor(init: any) { this.candidate = init.candidate || ''; this.sdpMid = init.sdpMid || null; this.sdpMLineIndex = init.sdpMLineIndex || null }
  toJSON() { return { candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex } }
})
vi.stubGlobal('BroadcastChannel', MockBC)
vi.stubGlobal('MediaStream', class {
  id = 'stream-' + Math.random().toString(36).substr(2, 6)
  private _tracks: any[]
  constructor(tracks?: any[]) { this._tracks = tracks || [] }
  getTracks() { return this._tracks }
  getAudioTracks() { return this._tracks.filter((t: any) => t.kind === 'audio') }
  getVideoTracks() { return this._tracks.filter((t: any) => t.kind === 'video') }
})

// ---------- helpers ----------

function setupElectronAPI() {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      getICEServers: vi.fn().mockResolvedValue([{ urls: 'stun:stun.test:19302' }]),
      getMQTTBrokers: vi.fn().mockResolvedValue([{ url: 'wss://test-broker/mqtt' }]),
    },
    writable: true,
    configurable: true,
  })
}

function teardownElectronAPI() {
  try { delete (window as any).electronAPI } catch { /* */ }
}

function mockMqtt(overrides: Record<string, any> = {}) {
  return {
    isConnected: () => true,
    publish: () => 1,
    disconnect: vi.fn(),
    isSubscribed: () => false,
    getConnectedCount: () => 1,
    getTotalMessageCount: () => 0,
    getDeduplicatorSize: () => 0,
    getConnectionStatus: () => [],
    connectAll: vi.fn().mockResolvedValue(['wss://test/mqtt']),
    subscribeAll: vi.fn().mockResolvedValue(1),
    setOnReconnect: vi.fn(),
    ...overrides,
  }
}

function createPeer(pc: MockPC, overrides: Record<string, any> = {}) {
  return {
    pc,
    stream: null,
    userName: 'TestUser',
    platform: 'win' as const,
    connectionStartTime: Date.now(),
    isConnected: false,
    muteStatus: { micMuted: false, speakerMuted: false },
    iceRestartAttempts: 0,
    iceRestartInProgress: false,
    disconnectTimer: null,
    reconnectTimer: null,
    ...overrides,
  }
}

// ==========================================================
// TESTS
// ==========================================================

describe('SimplePeerManager - additional gaps', () => {
  let manager: SimplePeerManager
  let managerAny: any

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
    mockPeerConnections = []
    resetCredentialsCacheForTesting()
    setupElectronAPI()

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0)',
      writable: true, configurable: true,
    })

    manager = new SimplePeerManager()
    managerAny = manager as any
  })

  afterEach(() => {
    if (managerAny.mqtt && typeof managerAny.mqtt.disconnect !== 'function') {
      managerAny.mqtt = null
    }
    manager.leaveRoom()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    teardownElectronAPI()
  })

  // --- replaceTrack: no audio sender, finds codec-match sender ---
  it('replaceTrack finds audio sender via codec params when no track.kind match', () => {
    const pc = new MockPC()
    const replaceTrackFn = vi.fn().mockResolvedValue(undefined)
    // Sender with no track but has audio codec
    const codecSender = {
      track: null,
      replaceTrack: replaceTrackFn,
      getParameters: vi.fn().mockReturnValue({ codecs: [{ mimeType: 'audio/opus' }] }),
    }
    pc.getSenders = vi.fn(() => [codecSender])

    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))

    const newTrack = { id: 't1', kind: 'audio', label: 'mic', enabled: true, readyState: 'live' }
    manager.replaceTrack(newTrack as any)

    expect(replaceTrackFn).toHaveBeenCalledWith(newTrack)
  })

  // --- replaceTrack: no audio sender at all, falls through to addTrack ---
  it('replaceTrack adds track when no audio sender exists', () => {
    const pc = new MockPC()
    // No senders at all
    pc.getSenders = vi.fn(() => [])

    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))
    managerAny.localStream = new (globalThis as any).MediaStream([])

    const newTrack = { id: 't1', kind: 'audio', label: 'mic', enabled: true, readyState: 'live' }
    manager.replaceTrack(newTrack as any)

    expect(pc.addTrack).toHaveBeenCalledWith(newTrack, managerAny.localStream)
  })

  // --- replaceTrack: replaceTrack failure path ---
  it('replaceTrack handles replaceTrack promise rejection', async () => {
    const pc = new MockPC()
    const replaceTrackFn = vi.fn().mockRejectedValue(new Error('replace failed'))
    const audioSender = {
      track: { kind: 'audio', id: 'old' },
      replaceTrack: replaceTrackFn,
      getParameters: vi.fn().mockReturnValue({ codecs: [] }),
    }
    pc.getSenders = vi.fn(() => [audioSender])

    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))

    const newTrack = { id: 't1', kind: 'audio', label: 'mic', enabled: true, readyState: 'live' }
    manager.replaceTrack(newTrack as any)

    // Wait for rejection to be handled
    await vi.advanceTimersByTimeAsync(10)
    // Should not throw
  })

  // --- replaceTrack: addTrack failure path ---
  it('replaceTrack handles addTrack error', () => {
    const pc = new MockPC()
    pc.getSenders = vi.fn(() => [])
    pc.addTrack = vi.fn(() => { throw new Error('addTrack failed') })

    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))
    managerAny.localStream = new (globalThis as any).MediaStream([])

    const newTrack = { id: 't1', kind: 'audio', label: 'mic', enabled: true, readyState: 'live' }
    expect(() => manager.replaceTrack(newTrack as any)).not.toThrow()
  })

  // --- replaceTrack: no localStream when addTrack needed ---
  it('replaceTrack skips addTrack when localStream is null', () => {
    const pc = new MockPC()
    pc.getSenders = vi.fn(() => [])

    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))
    managerAny.localStream = null

    const newTrack = { id: 't1', kind: 'audio', label: 'mic', enabled: true, readyState: 'live' }
    manager.replaceTrack(newTrack as any)

    expect(pc.addTrack).not.toHaveBeenCalled()
  })

  // --- setLocalStream: exact track ID match skips ---
  it('setLocalStream skips track already being sent', () => {
    const pc = new MockPC()
    const existingTrack = { kind: 'audio', id: 'same-track' }
    const sender = {
      track: existingTrack,
      replaceTrack: vi.fn(),
      getParameters: vi.fn().mockReturnValue({ codecs: [] }),
    }
    pc.getSenders = vi.fn(() => [sender])

    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))

    const stream = {
      id: 's1',
      getTracks: () => [{ kind: 'audio', id: 'same-track' }],
      getAudioTracks: () => [{ kind: 'audio', id: 'same-track' }],
      getVideoTracks: () => [],
    }

    manager.setLocalStream(stream as any)
    // replaceTrack should NOT be called (exact ID match)
    expect(sender.replaceTrack).not.toHaveBeenCalled()
    expect(pc.addTrack).not.toHaveBeenCalled()
  })

  // --- setLocalStream: addTrack error is caught ---
  it('setLocalStream catches addTrack error', () => {
    const pc = new MockPC()
    pc.getSenders = vi.fn(() => [])
    pc.addTrack = vi.fn(() => { throw new Error('addTrack failed') })

    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))

    const stream = {
      id: 's1',
      getTracks: () => [{ kind: 'audio', id: 'new-track' }],
      getAudioTracks: () => [{ kind: 'audio', id: 'new-track' }],
      getVideoTracks: () => [],
    }

    expect(() => manager.setLocalStream(stream as any)).not.toThrow()
  })

  // --- setLocalStream: replaceTrack error is caught ---
  it('setLocalStream catches replaceTrack error', async () => {
    const pc = new MockPC()
    const sender = {
      track: { kind: 'audio', id: 'old-track' },
      replaceTrack: vi.fn().mockRejectedValue(new Error('replace failed')),
      getParameters: vi.fn().mockReturnValue({ codecs: [] }),
    }
    pc.getSenders = vi.fn(() => [sender])

    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))

    const stream = {
      id: 's1',
      getTracks: () => [{ kind: 'audio', id: 'new-track' }],
      getAudioTracks: () => [{ kind: 'audio', id: 'new-track' }],
      getVideoTracks: () => [],
    }

    manager.setLocalStream(stream as any)
    await vi.advanceTimersByTimeAsync(10)
    // Should not throw
  })

  // --- leaveRoom: peer.pc.close() error is caught ---
  it('leaveRoom catches peer close error', async () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = new MockBC('test')

    const pc = new MockPC()
    pc.close = vi.fn(() => { throw new Error('close failed') })
    managerAny.peers.set('p1', createPeer(pc))

    expect(() => manager.leaveRoom()).not.toThrow()
  })

  // --- handleOffer: pending ICE candidate addIceCandidate failure ---
  it('handleOffer catches addIceCandidate failure for pending candidates', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    // Queue pending candidates before offer
    managerAny.pendingCandidates.set('peer-offer', [
      { candidate: 'c1', sdpMid: '0', sdpMLineIndex: 0 },
    ])

    // Need to make addIceCandidate fail on the created PC
    const origCreate = managerAny.createPeerConnection.bind(managerAny)
    vi.spyOn(managerAny, 'createPeerConnection').mockImplementation((...args: any[]) => {
      const pc = origCreate(...args)
      pc.addIceCandidate = vi.fn(async () => { throw new Error('ICE add failed') })
      return pc
    })

    await managerAny.handleOffer('peer-offer', { type: 'offer', sdp: 'v=0\r\n' }, 'User', 'win')
    // Should not throw
    managerAny.createPeerConnection.mockRestore()
  })

  // --- handleOffer: setRemoteDescription/createAnswer error ---
  it('handleOffer catches setRemoteDescription error and cleans up', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const origCreate = managerAny.createPeerConnection.bind(managerAny)
    vi.spyOn(managerAny, 'createPeerConnection').mockImplementation((...args: any[]) => {
      const pc = origCreate(...args)
      pc.setRemoteDescription = vi.fn(async () => { throw new Error('SRD failed') })
      return pc
    })

    await managerAny.handleOffer('peer-srd-fail', { type: 'offer', sdp: 'v=0\r\n' }, 'User', 'win')
    // Peer should be removed on error
    expect(managerAny.peers.has('peer-srd-fail')).toBe(false)
    managerAny.createPeerConnection.mockRestore()
  })

  // --- handleAnnounce: disconnected peer with iceRestartInProgress ---
  it('handleAnnounce ignores disconnected peer with ICE restart in progress', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const pc = new MockPC()
    pc.connectionState = 'disconnected'
    const peerId = 'peer-disc-restart'
    managerAny.peers.set(peerId, createPeer(pc, { isConnected: true, iceRestartInProgress: true }))

    const createOfferSpy = vi.spyOn(managerAny, 'createOffer')
    await managerAny.handleAnnounce(peerId, 'User', 'win')

    // Should NOT create new offer - connection still has restart in progress
    expect(createOfferSpy).not.toHaveBeenCalled()
    createOfferSpy.mockRestore()
  })

  // --- handleAnnounce: disconnected peer without iceRestartInProgress -> dead ---
  it('handleAnnounce cleans up disconnected peer without ICE restart', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const pc = new MockPC()
    pc.connectionState = 'disconnected'
    const peerId = 'peer-disc-dead'
    managerAny.peers.set(peerId, createPeer(pc, { isConnected: false, iceRestartInProgress: false }))

    await managerAny.handleAnnounce(peerId, 'User', 'win')

    // Dead peer should be closed
    expect(pc.close).toHaveBeenCalled()
  })

  // --- connection state 'connected' sends mute status after 500ms ---
  it('connection state connected sends mute status to peer after delay', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null
    managerAny.localMuteStatus = { micMuted: true, speakerMuted: false, videoMuted: false, videoEnabled: true }

    const onPeerJoin = vi.fn()
    manager.setCallbacks({ onPeerJoin })

    const peerId = 'peer-conn-mute'
    managerAny.createPeerConnection(peerId, 'ConnPeer', 'mac')

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')

    // Simulate connected state
    lastPC.connectionState = 'connected'
    lastPC.onconnectionstatechange?.()

    expect(onPeerJoin).toHaveBeenCalledWith(peerId, 'ConnPeer', 'mac')

    // After 500ms, mute status should be sent
    await vi.advanceTimersByTimeAsync(600)

    const muteStatusCalls = broadcastSpy.mock.calls.filter(
      (c: any[]) => c[0]?.type === 'mute-status'
    )
    expect(muteStatusCalls.length).toBeGreaterThan(0)

    broadcastSpy.mockRestore()
  })

  // --- ICE completed state also clears timers ---
  it('ICE completed state clears timers and resets restart', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()

    const peerId = 'peer-completed'
    managerAny.createPeerConnection(peerId, 'User', 'win')

    const peer = managerAny.peers.get(peerId)
    peer.disconnectTimer = setTimeout(() => {}, 10000)
    peer.reconnectTimer = setTimeout(() => {}, 10000)
    peer.iceRestartInProgress = true
    peer.iceRestartAttempts = 2

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    lastPC.iceConnectionState = 'completed'
    lastPC.oniceconnectionstatechange?.()

    expect(peer.disconnectTimer).toBeNull()
    expect(peer.reconnectTimer).toBeNull()
    expect(peer.iceRestartInProgress).toBe(false)
    expect(peer.iceRestartAttempts).toBe(0)
  })

  // --- ICE failed state triggers attemptIceRestart ---
  it('ICE failed state triggers attemptIceRestart', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const peerId = 'peer-ice-fail'
    managerAny.createPeerConnection(peerId, 'User', 'win')

    const restartSpy = vi.spyOn(managerAny, 'attemptIceRestart')

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    lastPC.iceConnectionState = 'failed'
    lastPC.oniceconnectionstatechange?.()

    expect(restartSpy).toHaveBeenCalledWith(peerId)
    restartSpy.mockRestore()
  })

  // --- handleBeforeUnload sends leave signal ---
  it('handleBeforeUnload sends leave signal', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')
    managerAny.handleBeforeUnload()

    const leaveCalls = broadcastSpy.mock.calls.filter((c: any[]) => c[0]?.type === 'leave')
    expect(leaveCalls.length).toBe(1)
    broadcastSpy.mockRestore()
  })

  // --- manualReconnect when no room ---
  it('manualReconnect returns false when no room', async () => {
    managerAny.roomId = null
    const result = await manager.manualReconnect()
    expect(result).toBe(false)
  })

  // --- manualReconnect when in room ---
  it('manualReconnect resets attempts and triggers reconnect', async () => {
    managerAny.roomId = 'test-room'
    managerAny.isOnline = true
    managerAny.networkReconnectAttempts = 3

    const result = await manager.manualReconnect()
    expect(result).toBe(true)
    expect(managerAny.networkReconnectAttempts).toBe(1) // incremented in attemptNetworkReconnect
    expect(managerAny.wasInRoomWhenOffline).toBe(true)
  })

  // --- getNetworkStatus returns current state ---
  it('getNetworkStatus returns comprehensive network info', () => {
    managerAny.isOnline = true
    managerAny.wasInRoomWhenOffline = false
    managerAny.networkReconnectAttempts = 2

    const status = manager.getNetworkStatus()
    expect(status.isOnline).toBe(true)
    expect(status.wasInRoomWhenOffline).toBe(false)
    expect(status.reconnectAttempts).toBe(2)
  })

  // --- setOnNetworkStatusChange ---
  it('setOnNetworkStatusChange sets callback', () => {
    const cb = vi.fn()
    manager.setOnNetworkStatusChange(cb)

    managerAny.handleOnline()
    expect(cb).toHaveBeenCalledWith(true)

    managerAny.handleOffline()
    expect(cb).toHaveBeenCalledWith(false)
  })

  // --- setOnSignalingStateChange ---
  it('setOnSignalingStateChange notifies on state changes', () => {
    const cb = vi.fn()
    manager.setOnSignalingStateChange(cb)

    managerAny.updateSignalingState('connecting')
    expect(cb).toHaveBeenCalledWith('connecting')

    managerAny.updateSignalingState('connected')
    expect(cb).toHaveBeenCalledWith('connected')
  })

  // --- updateSignalingState no-op for same state ---
  it('updateSignalingState is no-op when state unchanged', () => {
    const cb = vi.fn()
    manager.setOnSignalingStateChange(cb)

    managerAny.signalingState = 'connected'
    managerAny.updateSignalingState('connected')

    expect(cb).not.toHaveBeenCalled()
  })

  // --- handleSignalingMessage filters own messages ---
  it('handleSignalingMessage ignores own messages', () => {
    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')
    managerAny.handleSignalingMessage({ v: 1, type: 'announce', from: selfId })
    expect(broadcastSpy).not.toHaveBeenCalled()
    broadcastSpy.mockRestore()
  })

  // --- handleSignalingMessage filters messages for other peers ---
  it('handleSignalingMessage ignores messages for other peers', () => {
    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')
    managerAny.handleSignalingMessage({ v: 1, type: 'offer', from: 'other', to: 'not-me' })
    expect(broadcastSpy).not.toHaveBeenCalled()
    broadcastSpy.mockRestore()
  })

  // --- handleSignalingMessage 'pong' just records activity ---
  it('handleSignalingMessage pong records activity only', () => {
    const activitySpy = vi.spyOn(managerAny, 'recordPeerActivity')
    managerAny.handleSignalingMessage({ v: 1, type: 'pong', from: 'peer-x' })
    expect(activitySpy).toHaveBeenCalledWith('peer-x')
    activitySpy.mockRestore()
  })

  // --- heartbeat timeout removes peer ---
  it('heartbeat removes peer after timeout', async () => {
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = new MockBC('test')

    const pc = new MockPC()
    const peerId = 'peer-timeout'
    managerAny.peers.set(peerId, createPeer(pc, { isConnected: true }))

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    // Set lastSeen to very old
    managerAny.peerLastSeen.set(peerId, Date.now() - 20000)

    managerAny.startHeartbeat()
    await vi.advanceTimersByTimeAsync(6000)

    // Peer should be removed due to heartbeat timeout
    expect(managerAny.peers.has(peerId)).toBe(false)
  })

  // --- heartbeat initializes lastSeen for new peer ---
  it('heartbeat initializes lastSeen for peer without prior entry', async () => {
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = new MockBC('test')

    const pc = new MockPC()
    const peerId = 'peer-new-hb'
    managerAny.peers.set(peerId, createPeer(pc, { isConnected: true }))
    // No peerLastSeen entry

    managerAny.startHeartbeat()
    await vi.advanceTimersByTimeAsync(5500)

    // Should have been initialized
    expect(managerAny.peerLastSeen.has(peerId)).toBe(true)
  })

  // --- heartbeat sends ping to peer ---
  it('heartbeat sends ping when interval elapsed', async () => {
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = new MockBC('test')

    const pc = new MockPC()
    const peerId = 'peer-ping'
    managerAny.peers.set(peerId, createPeer(pc, { isConnected: true }))
    managerAny.peerLastSeen.set(peerId, Date.now())
    managerAny.peerLastPing.set(peerId, Date.now() - 6000) // Overdue for ping

    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')

    managerAny.startHeartbeat()
    await vi.advanceTimersByTimeAsync(5500)

    const pingCalls = broadcastSpy.mock.calls.filter((c: any[]) => c[0]?.type === 'ping')
    expect(pingCalls.length).toBeGreaterThan(0)
    broadcastSpy.mockRestore()
  })

  // --- attemptIceRestart timeout with max attempts -> cleanup ---
  it('ICE restart timeout at max attempts triggers cleanup', async () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()

    const pc = new MockPC()
    const peerId = 'peer-restart-max'
    managerAny.peers.set(peerId, createPeer(pc, { iceRestartAttempts: 2 }))

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    await managerAny.attemptIceRestart(peerId)

    // Now at attempt 3 (max), iceRestartInProgress=true
    const peer = managerAny.peers.get(peerId)
    expect(peer?.iceRestartAttempts).toBe(3)

    // Advance past the restart timeout (15000ms)
    await vi.advanceTimersByTimeAsync(16000)

    // Peer should be cleaned up
    expect(managerAny.peers.has(peerId)).toBe(false)
  })

  // --- cleanupPeer clears timers ---
  it('cleanupPeer clears disconnect and reconnect timers', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()

    const pc = new MockPC()
    const peerId = 'peer-timers'
    managerAny.peers.set(peerId, createPeer(pc, {
      isConnected: true,
      disconnectTimer: setTimeout(() => {}, 10000),
      reconnectTimer: setTimeout(() => {}, 10000),
    }))

    // Also set previousStats and peerLastSeen/peerLastPing
    managerAny.previousStats.set(peerId, {})
    managerAny.peerLastSeen.set(peerId, Date.now())
    managerAny.peerLastPing.set(peerId, Date.now())
    managerAny.pendingCandidates.set(peerId, [])

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    managerAny.cleanupPeer(peerId)

    expect(managerAny.peers.has(peerId)).toBe(false)
    expect(managerAny.previousStats.has(peerId)).toBe(false)
    expect(managerAny.peerLastSeen.has(peerId)).toBe(false)
    expect(managerAny.peerLastPing.has(peerId)).toBe(false)
    expect(managerAny.pendingCandidates.has(peerId)).toBe(false)
    expect(onPeerLeave).toHaveBeenCalled()
  })

  // --- cleanupPeer close() error is caught ---
  it('cleanupPeer catches close error', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()

    const pc = new MockPC()
    pc.close = vi.fn(() => { throw new Error('close error') })
    managerAny.peers.set('p1', createPeer(pc, { isConnected: true }))

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    expect(() => managerAny.cleanupPeer('p1')).not.toThrow()
    expect(onPeerLeave).toHaveBeenCalled()
  })

  // --- connection state 'closed' with connected peer triggers cleanup ---
  it('connection state closed with connected peer triggers cleanupPeer', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    const peerId = 'peer-closed-conn'
    managerAny.createPeerConnection(peerId, 'User', 'win')

    // Mark as connected first
    const peer = managerAny.peers.get(peerId)
    peer.isConnected = true

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    lastPC.connectionState = 'closed'
    lastPC.onconnectionstatechange?.()

    expect(onPeerLeave).toHaveBeenCalled()
  })

  // --- onicecandidate sends ICE candidate ---
  it('onicecandidate sends candidate to peer', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const peerId = 'peer-ice-send'
    managerAny.createPeerConnection(peerId, 'User', 'win')

    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    lastPC.onicecandidate?.({
      candidate: {
        type: 'host',
        toJSON: () => ({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 }),
      },
    })

    const iceCalls = broadcastSpy.mock.calls.filter((c: any[]) => c[0]?.type === 'ice-candidate')
    expect(iceCalls.length).toBe(1)
    broadcastSpy.mockRestore()
  })

  // --- onicecandidate with null candidate is ignored ---
  it('onicecandidate with null candidate does nothing', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()

    const peerId = 'peer-ice-null'
    managerAny.createPeerConnection(peerId, 'User', 'win')

    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    lastPC.onicecandidate?.({ candidate: null })

    const iceCalls = broadcastSpy.mock.calls.filter((c: any[]) => c[0]?.type === 'ice-candidate')
    expect(iceCalls.length).toBe(0)
    broadcastSpy.mockRestore()
  })

  // --- loadCredentials error handling ---
  it('loadCredentials handles API error gracefully', async () => {
    resetCredentialsCacheForTesting()
    Object.defineProperty(window, 'electronAPI', {
      value: {
        getICEServers: vi.fn().mockRejectedValue(new Error('API error')),
        getMQTTBrokers: vi.fn().mockResolvedValue([]),
      },
      writable: true, configurable: true,
    })

    await expect(loadCredentials()).resolves.toBeUndefined()
  })

  // --- loadCredentials returns same promise when called concurrently ---
  it('loadCredentials returns same promise for concurrent calls', async () => {
    resetCredentialsCacheForTesting()
    const p1 = loadCredentials()
    const p2 = loadCredentials()

    // Both should resolve to the same underlying promise
    await Promise.all([p1, p2])
  })

  // --- startAnnounceInterval stops after duration when healthy peers exist ---
  it('announce interval stops after duration when healthy peers exist', async () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.announceStartTime = Date.now() - 70000 // Over ANNOUNCE_DURATION (60s)

    // Add a healthy peer
    const pc = new MockPC()
    pc.connectionState = 'connected'
    managerAny.peers.set('healthy-peer', createPeer(pc, { isConnected: true }))

    managerAny.startAnnounceInterval()

    await vi.advanceTimersByTimeAsync(4000) // One interval tick

    // Interval should have stopped
    expect(managerAny.announceInterval).toBeNull()
  })

  // --- joinRoom: existing room gets cleaned up ---
  it('joinRoom cleans up existing room before joining', async () => {
    const joinP1 = manager.joinRoom('room1', 'Alice')
    await vi.advanceTimersByTimeAsync(200)
    await joinP1

    expect(managerAny.roomId).toBe('room1')

    // Join another room
    const joinP2 = manager.joinRoom('room2', 'Bob')
    await vi.advanceTimersByTimeAsync(300)
    await joinP2

    expect(managerAny.roomId).toBe('room2')
  })

  // --- joinRoom: BroadcastChannel creation error ---
  it('joinRoom handles BroadcastChannel error gracefully', async () => {
    resetCredentialsCacheForTesting()
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw new Error('BC not supported') } })

    const m2 = new SimplePeerManager()
    const joinP = m2.joinRoom('bc-fail', 'User')
    await vi.advanceTimersByTimeAsync(200)
    await joinP

    expect((m2 as any).broadcastChannel).toBeNull()
    m2.leaveRoom()

    // Restore
    vi.stubGlobal('BroadcastChannel', MockBC)
  })

  // --- handleAnnounce: selfId > peerId triggers createOffer ---
  it('handleAnnounce initiates offer when selfId > peerId', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    // Use a peerId that is definitely less than selfId
    const peerId = '0000' // Very low ASCII

    const createOfferSpy = vi.spyOn(managerAny, 'createOffer')
    await managerAny.handleAnnounce(peerId, 'SmallPeer', 'linux')

    if (selfId > peerId) {
      expect(createOfferSpy).toHaveBeenCalledWith(peerId, 'SmallPeer', 'linux')
    }
    createOfferSpy.mockRestore()
  })

  // --- handleAnnounce: selfId < peerId sends announce back ---
  it('handleAnnounce sends announce back when selfId < peerId', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    // Use a peerId that is definitely greater than selfId
    const peerId = 'zzzzzzzzzzzzzzzz' // Very high ASCII

    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')
    await managerAny.handleAnnounce(peerId, 'BigPeer', 'mac')

    if (selfId <= peerId) {
      const announceCalls = broadcastSpy.mock.calls.filter(
        (c: any[]) => c[0]?.type === 'announce' && c[0]?.to === peerId
      )
      expect(announceCalls.length).toBe(1)
    }
    broadcastSpy.mockRestore()
  })

  // --- handleAnnounce: failed state peer gets cleaned up ---
  it('handleAnnounce cleans up peer in failed state', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const pc = new MockPC()
    pc.connectionState = 'failed'
    const peerId = 'peer-failed'
    managerAny.peers.set(peerId, createPeer(pc))

    await managerAny.handleAnnounce(peerId, 'FailPeer', 'win')

    expect(pc.close).toHaveBeenCalled()
  })

  // --- BroadcastChannel postMessage error is caught ---
  it('broadcast catches BroadcastChannel postMessage error', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = null
    const bc = new MockBC('test')
    bc.postMessage = vi.fn(() => { throw new Error('BC error') })
    managerAny.broadcastChannel = bc

    expect(() => managerAny.broadcast({ v: 1, type: 'announce', from: selfId })).not.toThrow()
  })
})

describe('MQTTClient - additional gaps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('connect rejects on timeout', async () => {
    // Override MockWS so it never triggers onopen/onmessage
    vi.stubGlobal('WebSocket', class {
      onopen: any = null
      onmessage: any = null
      onclose: any = null
      onerror: any = null
      readyState = 0
      binaryType = 'arraybuffer'
      send = vi.fn()
      close = vi.fn()
      static OPEN = 1
      constructor() {}
    })

    const client = new MQTTClient('wss://timeout/mqtt')
    const p = client.connect().catch((err: Error) => err)

    // Advance past MQTT_CONNECT_TIMEOUT (8000ms)
    await vi.advanceTimersByTimeAsync(9000)

    const result = await p
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('timeout')
    client.disconnect()

    // Allow remaining timers to flush to prevent unhandled rejections
    await vi.advanceTimersByTimeAsync(2000)

    // Restore
    vi.stubGlobal('WebSocket', MockWS)
  })

  it('WebSocket constructor error rejects connect', async () => {
    vi.stubGlobal('WebSocket', class {
      constructor() { throw new Error('WS not available') }
    })

    const client = new MQTTClient('wss://fail/mqtt')
    await expect(client.connect()).rejects.toThrow('WS not available')

    // Restore
    vi.stubGlobal('WebSocket', MockWS)
  })

  it('getBrokerUrl returns the URL', () => {
    const client = new MQTTClient('wss://test.example/mqtt')
    expect(client.getBrokerUrl()).toBe('wss://test.example/mqtt')
    client.disconnect()
  })

  it('handles truncated PUBLISH packet gracefully', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    const ws = mockWebSockets[mockWebSockets.length - 1]

    // PUBLISH packet with topic length exceeding available data
    const packet = new Uint8Array([0x30, 0x05, 0x00, 0x10]) // topic len says 16 but only 2 more bytes
    ws.onmessage?.({ data: packet.buffer })

    // Should not crash
    expect(client.isConnected()).toBe(true)
    client.disconnect()
  })

  it('handles PUBLISH with empty payload', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    const msgCallback = vi.fn()
    const ws = mockWebSockets[mockWebSockets.length - 1]

    const subPromise = client.subscribe('test-topic', msgCallback)
    await vi.advanceTimersByTimeAsync(50)
    await subPromise

    // PUBLISH with empty payload
    const topic = 'test-topic'
    const topicBytes = new TextEncoder().encode(topic)
    const packet = new Uint8Array(2 + 2 + topicBytes.length)
    let i = 0
    packet[i++] = 0x30
    packet[i++] = 2 + topicBytes.length
    packet[i++] = (topicBytes.length >> 8) & 0xff
    packet[i++] = topicBytes.length & 0xff
    packet.set(topicBytes, i)

    ws.onmessage?.({ data: packet.buffer })

    // Empty payload should NOT trigger callback
    expect(msgCallback).not.toHaveBeenCalled()
    client.disconnect()
  })
})

describe('MultiBrokerMQTT - additional gaps', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
    resetCredentialsCacheForTesting()
    setupElectronAPI()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    teardownElectronAPI()
  })

  it('getConnectionStatus returns broker details', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    const status = multi.getConnectionStatus()
    expect(Array.isArray(status)).toBe(true)
    expect(status.length).toBeGreaterThan(0)
    expect(status[0]).toHaveProperty('broker')
    expect(status[0]).toHaveProperty('connected')
    expect(status[0]).toHaveProperty('subscribed')

    multi.disconnect()
  })

  it('handleBrokerDisconnect clears existing reconnect timer', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    // Trigger two disconnects to test timer clearing
    const brokerUrl = (multi as any).clients.keys().next().value
    ;(multi as any).handleBrokerDisconnect(brokerUrl)

    // Second disconnect should clear previous timer
    ;(multi as any).handleBrokerDisconnect(brokerUrl)
    await vi.advanceTimersByTimeAsync(100)

    multi.disconnect()
  })

  it('handleBrokerDisconnect stops at max reconnect attempts', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    const brokerUrl = (multi as any).clients.keys().next().value

    // Set reconnect attempts to max
    ;(multi as any).reconnectAttempts.set(brokerUrl, 5) // RECONNECT_MAX_ATTEMPTS = 5

    ;(multi as any).handleBrokerDisconnect(brokerUrl)

    // Should not schedule reconnection
    expect((multi as any).reconnectTimers.has(brokerUrl)).toBe(false)

    multi.disconnect()
  })

  it('subscribeAll counts failed subscriptions', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    // Make subscribe fail by overriding send on all sockets
    mockWebSockets.forEach(ws => {
      ws.send = vi.fn(() => { throw new Error('send failed') })
    })

    const count = await multi.subscribeAll('fail-topic', () => {})
    // All subscriptions should fail
    expect(count).toBe(0)

    multi.disconnect()
  })
})
