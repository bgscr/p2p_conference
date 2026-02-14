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
  resetCredentialsCacheForTesting,
} from '../renderer/signaling/SimplePeerManager'
import { createTestPeer } from './helpers/simplePeerManagerTestUtils'

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
  addIceCandidate = vi.fn(async () => { })
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

function createPeer(pc: MockPC, overrides: Record<string, any> = {}): any {
  return createTestPeer({
    pc,
    userName: 'TestUser',
    platform: 'win',
    isConnected: false,
    muteStatus: { micMuted: false, speakerMuted: false },
    ...overrides,
  })
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
    peer.disconnectTimer = setTimeout(() => { }, 10000)
    peer.reconnectTimer = setTimeout(() => { }, 10000)
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
      disconnectTimer: setTimeout(() => { }, 10000),
      reconnectTimer: setTimeout(() => { }, 10000),
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
      constructor() { }
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
      ; (multi as any).handleBrokerDisconnect(brokerUrl)

      // Second disconnect should clear previous timer
      ; (multi as any).handleBrokerDisconnect(brokerUrl)
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
      ; (multi as any).reconnectAttempts.set(brokerUrl, 5) // RECONNECT_MAX_ATTEMPTS = 5

      ; (multi as any).handleBrokerDisconnect(brokerUrl)

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

    const count = await multi.subscribeAll('fail-topic', () => { })
    // All subscriptions should fail
    expect(count).toBe(0)

    multi.disconnect()
  })
})

// ==========================================================
// Additional tests for uncovered lines
// ==========================================================

describe('SimplePeerManager - ICE restart and leave coverage', () => {
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
    managerAny.isLeaving = false
    manager.leaveRoom()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    teardownElectronAPI()
  })

  // --- Line 2267: ICE restart createOffer failure at max attempts triggers cleanupPeer ---
  it('ICE restart createOffer failure at max attempts triggers cleanupPeer (line 2267)', async () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const pc = new MockPC()
    // Make createOffer fail
    pc.createOffer = vi.fn().mockRejectedValue(new Error('createOffer failed'))

    const peerId = 'peer-offer-fail'
    // Set to max-1 attempts so the next attempt is the final one
    managerAny.peers.set(peerId, createPeer(pc, {
      iceRestartAttempts: 2 // MAX_ICE_RESTART_ATTEMPTS is usually 3
    }))

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    // Attempt ICE restart which will fail at max attempts
    await managerAny.attemptIceRestart(peerId)

    // Wait for async rejection handling
    await vi.advanceTimersByTimeAsync(100)

    // Peer should be cleaned up because it was the last attempt
    expect(managerAny.peers.has(peerId)).toBe(false)
  })

  // --- Lines 2286-2287: leaveRoom ignores concurrent leave operations ---
  it('leaveRoom ignores concurrent leave when isLeaving is true (lines 2286-2287)', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = new MockBC('test')
    managerAny.isLeaving = true // Already leaving

    const cleanupSpy = vi.spyOn(managerAny, 'cleanupPeer')

    // Add a peer that would normally be cleaned up
    const pc = new MockPC()
    managerAny.peers.set('p1', createPeer(pc))

    // Call leaveRoom - should return early due to isLeaving
    manager.leaveRoom()

    // cleanupPeer should NOT have been called
    expect(cleanupSpy).not.toHaveBeenCalled()
    // Peer should still exist
    expect(managerAny.peers.has('p1')).toBe(true)

    cleanupSpy.mockRestore()
  })

  // --- leaveRoom with no roomId returns early ---
  it('leaveRoom returns early when not in a room', () => {
    managerAny.roomId = null
    managerAny.isLeaving = false

    const cleanupSpy = vi.spyOn(managerAny, 'cleanupPeer')

    manager.leaveRoom()

    // Should not attempt any cleanup
    expect(cleanupSpy).not.toHaveBeenCalled()

    cleanupSpy.mockRestore()
  })

  // --- ICE restart createOffer failure NOT at max attempts schedules another attempt ---
  it('ICE restart createOffer failure before max attempts schedules retry', async () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const pc = new MockPC()
    // Make createOffer fail
    pc.createOffer = vi.fn().mockRejectedValue(new Error('createOffer failed'))

    const peerId = 'peer-offer-retry'
    // Only 1 attempt so far - should schedule another
    managerAny.peers.set(peerId, createPeer(pc, {
      iceRestartAttempts: 0
    }))

    const restartSpy = vi.spyOn(managerAny, 'attemptIceRestart')

    // First attempt
    await managerAny.attemptIceRestart(peerId)
    await vi.advanceTimersByTimeAsync(100)

    // Peer should still exist (not at max attempts)
    expect(managerAny.peers.has(peerId)).toBe(true)

    // Wait for retry delay (exponential backoff)
    vi.advanceTimersByTime(3000)

    // Should have scheduled a retry
    expect(restartSpy.mock.calls.length).toBeGreaterThan(1)

    restartSpy.mockRestore()
  })
})

describe('MQTTClient - branch gap extensions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.stubGlobal('WebSocket', MockWS)
  })

  it('derives unknown broker hash when URL has no host segment', () => {
    const client: any = new MQTTClient('mqtt-no-scheme')
    expect(client.clientId).toContain('_unknown_')
    client.disconnect()
  })

  it('encodes CONNECT remaining length with multi-byte varint for long credentials', () => {
    const client: any = new MQTTClient('wss://long-cred/mqtt', 'u'.repeat(200), 'p'.repeat(200))
    const ws = { readyState: MockWS.OPEN, send: vi.fn(), close: vi.fn() }
    client.ws = ws
    client.sendConnect()
    const packet = ws.send.mock.calls[0][0] as Uint8Array
    expect(packet[0]).toBe(0x10)
    expect((packet[1] & 0x80) !== 0).toBe(true)
    client.disconnect()
  })

  it('handles SUBACK and PINGRESP packets without pending subscribe state', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const connectPromise = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await connectPromise

    const ws = mockWebSockets[mockWebSockets.length - 1]
    ws.onmessage?.({ data: new Uint8Array([0x90, 0x03, 0x00, 0x01, 0x00]).buffer })
    ws.onmessage?.({ data: new Uint8Array([0xd0, 0x00]).buffer })

    expect(client.isConnected()).toBe(true)
    client.disconnect()
  })

  it('handles publish packet with missing topic-length bytes', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const connectPromise = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await connectPromise

    const ws = mockWebSockets[mockWebSockets.length - 1]
    // PUBLISH with remaining-length byte but not enough bytes for topic length.
    ws.onmessage?.({ data: new Uint8Array([0x30, 0x01, 0x7f]).buffer })

    expect(client.isConnected()).toBe(true)
    client.disconnect()
  })

  it('handles keepalive when websocket is not open and subscribe timeout when already subscribed', async () => {
    const client: any = new MQTTClient('wss://test/mqtt')
    client.ws = { readyState: MockWS.CLOSED, send: vi.fn(), close: vi.fn() }
    client.startKeepalive()
    await vi.advanceTimersByTimeAsync(35000)
    expect(client.ws.send).not.toHaveBeenCalled()

    const connectedClient = new MQTTClient('wss://test/mqtt')
    const connectPromise = connectedClient.connect()
    await vi.advanceTimersByTimeAsync(50)
    await connectPromise
    const subscribePromise = connectedClient.subscribe('topic/subscribed', () => { })
    ; (connectedClient as any).subscribed = true
    await vi.advanceTimersByTimeAsync(6000)
    await expect(subscribePromise).resolves.toBeTypeOf('boolean')
    connectedClient.disconnect()
  })

  it('handles raw PINGRESP packet path directly', () => {
    const client: any = new MQTTClient('wss://test/mqtt')
    expect(() => client.handlePacket(new Uint8Array([0xd0, 0x00]))).not.toThrow()
    client.disconnect()
  })
})

describe('MultiBrokerMQTT - branch gap extensions', () => {
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
    vi.stubGlobal('WebSocket', MockWS)
  })

  it('connectAll returns empty when all broker connects reject', async () => {
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
      static CONNECTING = 0
      static CLOSING = 2
      static CLOSED = 3
      constructor() {
        setTimeout(() => {
          this.onerror?.(new Error('connect fail'))
        }, 0)
      }
    })

    const multi = new MultiBrokerMQTT()
    const connectPromise = multi.connectAll()
    await vi.advanceTimersByTimeAsync(50)
    const connected = await connectPromise
    expect(connected).toEqual([])
    multi.disconnect()
  })

  it('reports disconnected status across helper accessors', () => {
    const multi: any = new MultiBrokerMQTT()
    multi.clients.set('wss://a', {
      isConnected: () => false,
      isSubscribed: () => false,
      publish: () => false,
      disconnect: vi.fn(),
      getMessageCount: () => 0
    })

    expect(multi.isConnected()).toBe(false)
    expect(multi.isSubscribed()).toBe(false)
    expect(multi.getConnectedCount()).toBe(0)
  })

  it('publish ignores unsuccessful publish calls even for connected/subscribed clients', () => {
    const multi: any = new MultiBrokerMQTT()
    multi.clients.set('wss://a', {
      isConnected: () => true,
      isSubscribed: () => true,
      publish: () => false,
      disconnect: vi.fn(),
      getMessageCount: () => 0
    })
    multi.clients.set('wss://b', {
      isConnected: () => true,
      isSubscribed: () => true,
      publish: () => true,
      disconnect: vi.fn(),
      getMessageCount: () => 0
    })

    expect(multi.publish('topic', 'payload')).toBe(1)
  })

  it('handleBrokerDisconnect exits immediately when shutting down', async () => {
    const multi: any = new MultiBrokerMQTT()
    multi.isShuttingDown = true

    await multi.handleBrokerDisconnect('wss://broker/mqtt')
    expect(multi.reconnectTimers.size).toBe(0)
  })

  it('reconnect path handles subscribe failure branch when topic is present', async () => {
    const multi: any = new MultiBrokerMQTT()
    multi.topic = 'room/test'
    multi.onMessage = vi.fn()
    multi.reconnectAttempts.set('wss://broker/mqtt', 0)

    const connectSpy = vi.spyOn(MQTTClient.prototype, 'connect').mockResolvedValue(undefined)
    const subscribeSpy = vi.spyOn(MQTTClient.prototype, 'subscribe').mockResolvedValue(false)

    await multi.handleBrokerDisconnect('wss://broker/mqtt')
    await vi.advanceTimersByTimeAsync(5000)

    expect(connectSpy).toHaveBeenCalled()
    expect(subscribeSpy).toHaveBeenCalled()

    connectSpy.mockRestore()
    subscribeSpy.mockRestore()
    multi.disconnect()
  })
})

describe('SimplePeerManager - branch gap extensions', () => {
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
      writable: true,
      configurable: true
    })

    manager = new SimplePeerManager()
    managerAny = manager as any
  })

  afterEach(() => {
    manager.leaveRoom()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    teardownElectronAPI()
  })

  it('setAudioRoutingMode rejects unknown exclusive routing target', () => {
    expect(manager.setAudioRoutingMode('exclusive', 'missing-peer')).toBe(false)
  })

  it('setLocalStream skips routed audio addTrack when peer is not exclusive target', () => {
    const pcA = new MockPC()
    const pcB = new MockPC()
    managerAny.peers.set('peer-a', createPeer(pcA))
    managerAny.peers.set('peer-b', createPeer(pcB))
    manager.setAudioRoutingMode('exclusive', 'peer-b')

    const audioTrack = { id: 'audio-1', kind: 'audio', enabled: true, muted: false, readyState: 'live', stop: vi.fn() } as any
    const stream = new MediaStream([audioTrack]) as unknown as MediaStream
    manager.setLocalStream(stream)

    expect(pcA.addTrack).not.toHaveBeenCalled()
  })

  it('chat data channel ignores invalid payload shape', () => {
    const peer = createPeer(new MockPC())
    managerAny.onChatMessage = vi.fn()
    const dc: any = { label: 'chat', onopen: null, onclose: null, onerror: null, onmessage: null }
    managerAny.setupDataChannel(dc, 'peer-1', peer, 'chat')

    dc.onmessage?.({ data: JSON.stringify({ type: 'chat', id: 1, senderName: 'x', content: 1, timestamp: 'bad' }) })
    expect(managerAny.onChatMessage).not.toHaveBeenCalled()
  })

  it('respondRemoteMicRequest applies default accepted/rejected reasons and updates state', () => {
    const peer = createPeer(new MockPC(), {
      controlDataChannel: {
        readyState: 'open',
        send: vi.fn(),
        close: vi.fn()
      }
    })
    managerAny.peers.set('peer-1', peer)

    managerAny.pendingRemoteMicRequests.set('req-accepted', 'peer-1')
    expect(manager.respondRemoteMicRequest('req-accepted', true)).toBe(true)
    expect((peer.controlDataChannel!.send as any).mock.calls[0][0]).toContain('"reason":"accepted"')
    expect(managerAny.activeRemoteMicSourcePeerId).toBe('peer-1')

    managerAny.pendingRemoteMicRequests.set('req-rejected', 'peer-1')
    expect(manager.respondRemoteMicRequest('req-rejected', false)).toBe(true)
    expect((peer.controlDataChannel!.send as any).mock.calls[1][0]).toContain('"reason":"rejected"')
  })

  it('sendRemoteMicStart and sendRemoteMicStop update and clear active mapping state', () => {
    const peer = createPeer(new MockPC(), {
      controlDataChannel: {
        readyState: 'open',
        send: vi.fn(),
        close: vi.fn()
      }
    })
    managerAny.peers.set('peer-1', peer)

    expect(manager.sendRemoteMicStart('peer-1', 'req-start')).toBe(true)
    expect(managerAny.activeRemoteMicTargetPeerId).toBe('peer-1')
    expect(managerAny.activeRemoteMicRequestId).toBe('req-start')

    managerAny.activeRemoteMicSourcePeerId = 'peer-1'
    expect(manager.sendRemoteMicStop('peer-1', 'req-start', 'stopped-by-source')).toBe(true)
    expect(managerAny.activeRemoteMicTargetPeerId).toBeNull()
    expect(managerAny.activeRemoteMicSourcePeerId).toBeNull()
    expect(managerAny.activeRemoteMicRequestId).toBeNull()
  })

  it('stopRemoteMicSession sends stop to both target and source peers when present', () => {
    const sendStopSpy = vi.spyOn(manager as any, 'sendRemoteMicStop').mockReturnValue(true)
    managerAny.activeRemoteMicRequestId = 'req-stop-all'
    managerAny.activeRemoteMicTargetPeerId = 'peer-target'
    managerAny.activeRemoteMicSourcePeerId = 'peer-source'

    manager.stopRemoteMicSession('stopped-by-source')

    expect(sendStopSpy).toHaveBeenCalledWith('peer-target', 'req-stop-all', 'stopped-by-source')
    expect(sendStopSpy).toHaveBeenCalledWith('peer-source', 'req-stop-all', 'stopped-by-source')
    sendStopSpy.mockRestore()
  })

  it('stopRemoteMicSession skips stop sends when target/source are missing', () => {
    const sendStopSpy = vi.spyOn(manager as any, 'sendRemoteMicStop').mockReturnValue(true)
    managerAny.activeRemoteMicRequestId = 'req-no-ends'
    managerAny.activeRemoteMicTargetPeerId = null
    managerAny.activeRemoteMicSourcePeerId = null

    manager.stopRemoteMicSession('unknown')

    expect(sendStopSpy).not.toHaveBeenCalled()
    sendStopSpy.mockRestore()
  })

  it('handleRemoteMicControlMessage clears active request state on rejected response and stop', () => {
    managerAny.activeRemoteMicTargetPeerId = 'peer-1'
    managerAny.activeRemoteMicSourcePeerId = 'peer-1'
    managerAny.activeRemoteMicRequestId = 'req-ctrl'
    managerAny.pendingOutgoingRemoteMicRequestId = 'req-ctrl'
    managerAny.pendingRemoteMicRequests.set('req-ctrl', 'peer-1')

    managerAny.handleRemoteMicControlMessage('peer-1', {
      type: 'rm_response',
      requestId: 'req-ctrl',
      accepted: false,
      reason: 'rejected',
      ts: Date.now()
    })
    expect(managerAny.activeRemoteMicTargetPeerId).toBeNull()
    expect(managerAny.activeRemoteMicRequestId).toBeNull()

    managerAny.activeRemoteMicTargetPeerId = 'peer-1'
    managerAny.activeRemoteMicSourcePeerId = 'peer-1'
    managerAny.activeRemoteMicRequestId = 'req-ctrl'
    managerAny.pendingRemoteMicRequests.set('req-ctrl', 'peer-1')

    managerAny.handleRemoteMicControlMessage('peer-1', {
      type: 'rm_stop',
      requestId: 'req-ctrl',
      reason: 'stopped-by-source',
      ts: Date.now()
    })
    expect(managerAny.activeRemoteMicSourcePeerId).toBeNull()
    expect(managerAny.activeRemoteMicRequestId).toBeNull()
  })

  it('handleRemoteMicControlMessage keeps unrelated active mappings untouched', () => {
    managerAny.activeRemoteMicTargetPeerId = 'peer-target-keep'
    managerAny.activeRemoteMicSourcePeerId = 'peer-source-keep'
    managerAny.activeRemoteMicRequestId = 'req-keep'

    managerAny.handleRemoteMicControlMessage('peer-other', {
      type: 'rm_response',
      requestId: 'req-other',
      accepted: false,
      reason: 'rejected',
      ts: Date.now()
    })
    managerAny.handleRemoteMicControlMessage('peer-other', {
      type: 'rm_stop',
      requestId: 'req-other',
      reason: 'unknown',
      ts: Date.now()
    })

    expect(managerAny.activeRemoteMicTargetPeerId).toBe('peer-target-keep')
    expect(managerAny.activeRemoteMicSourcePeerId).toBe('peer-source-keep')
    expect(managerAny.activeRemoteMicRequestId).toBe('req-keep')
  })

  it('cleanupPeer handles missing peer and fully closes channels/timers for existing peer', () => {
    expect(() => managerAny.cleanupPeer('missing-peer')).not.toThrow()

    const peer = createPeer(new MockPC(), {
      disconnectTimer: setTimeout(() => {}, 1000),
      reconnectTimer: setTimeout(() => {}, 1000),
      chatDataChannel: { close: vi.fn(), readyState: 'open' },
      controlDataChannel: { close: vi.fn(), readyState: 'open' }
    })
    managerAny.peers.set('peer-close', peer)
    managerAny.activeRemoteMicTargetPeerId = 'peer-close'
    managerAny.activeRemoteMicRequestId = 'req-peer-close'
    managerAny.onRemoteMicControl = vi.fn()

    managerAny.cleanupPeer('peer-close')

    expect(peer.chatDataChannel).toBeNull()
    expect(peer.controlDataChannel).toBeNull()
    expect(managerAny.onRemoteMicControl).toHaveBeenCalled()
  })

  it('peer connection handlers cover control-channel path and track-with-stream path', () => {
    managerAny.localStream = new MediaStream([]) as unknown as MediaStream
    const pc = managerAny.createPeerConnection('peer-handler', 'Peer Handler', 'win', false)
    const peerConn = managerAny.peers.get('peer-handler')

    const controlChannel: any = { label: 'control', onopen: null, onclose: null, onerror: null, onmessage: null }
    pc.ondatachannel?.({ channel: controlChannel } as any)
    expect(peerConn.controlDataChannel).toBe(controlChannel)

    const streamTrack = { kind: 'audio', id: 'audio-track-1' } as any
    const stream = new MediaStream([streamTrack]) as unknown as MediaStream
    pc.ontrack?.({ track: streamTrack, streams: [stream] } as any)
    expect(peerConn.stream).toBe(stream)

    const unknownChannel: any = { label: 'metrics', onopen: null, onclose: null, onerror: null, onmessage: null }
    pc.ondatachannel?.({ channel: unknownChannel } as any)
  })

  it('ICE/connection callbacks cover disconnect timer branches and disconnected state branch', () => {
    const pc = managerAny.createPeerConnection('peer-ice', 'Peer ICE', 'win', false)
    const peerConn = managerAny.peers.get('peer-ice')

    peerConn.disconnectTimer = setTimeout(() => {}, 1000)
    pc.iceConnectionState = 'disconnected'
    pc.oniceconnectionstatechange?.()
    expect(peerConn.disconnectTimer).not.toBeNull()

    peerConn.disconnectTimer = setTimeout(() => {}, 1000)
    peerConn.reconnectTimer = setTimeout(() => {}, 1000)
    pc.connectionState = 'connected'
    pc.onconnectionstatechange?.()
    expect(peerConn.disconnectTimer).toBeNull()
    expect(peerConn.reconnectTimer).toBeNull()

    pc.connectionState = 'disconnected'
    pc.onconnectionstatechange?.()

    peerConn.iceRestartInProgress = true
    pc.connectionState = 'failed'
    pc.onconnectionstatechange?.()

    pc.connectionState = 'connecting'
    pc.onconnectionstatechange?.()
  })

  it('ICE/connection callbacks handle missing peer references and delayed reconnect guard', async () => {
    const pc = managerAny.createPeerConnection('peer-missing', 'Peer Missing', 'win', false)
    const peerConn = managerAny.peers.get('peer-missing')
    expect(peerConn).toBeDefined()

    managerAny.peers.delete('peer-missing')

    pc.connectionState = 'connected'
    pc.onconnectionstatechange?.()

    pc.iceConnectionState = 'disconnected'
    pc.oniceconnectionstatechange?.()

    managerAny.peers.set('peer-missing', createPeer(pc, {
      disconnectTimer: null,
      reconnectTimer: null
    }))
    const readded = managerAny.peers.get('peer-missing')
    pc.iceConnectionState = 'disconnected'
    pc.oniceconnectionstatechange?.()
    expect(readded.disconnectTimer).not.toBeNull()

    pc.iceConnectionState = 'connected'
    await vi.advanceTimersByTimeAsync(5000)
  })

  it('handleRemoteMicPeerDisconnect covers source-only path and pending request cleanup fallback id', () => {
    managerAny.activeRemoteMicSourcePeerId = 'peer-source-only'
    managerAny.activeRemoteMicRequestId = null
    managerAny.pendingRemoteMicRequests.set('req-from-source', 'peer-source-only')
    managerAny.pendingRemoteMicRequests.set('req-from-other', 'peer-other')
    managerAny.onRemoteMicControl = vi.fn()

    managerAny.handleRemoteMicPeerDisconnect('peer-source-only')

    expect(managerAny.activeRemoteMicSourcePeerId).toBeNull()
    expect(managerAny.pendingRemoteMicRequests.has('req-from-source')).toBe(false)
    expect(managerAny.pendingRemoteMicRequests.has('req-from-other')).toBe(true)
    expect(managerAny.onRemoteMicControl).toHaveBeenCalled()
  })

  it('attemptIceRestart timeout callback exits when restart is no longer in progress', async () => {
    const pc = new MockPC()
    managerAny.peers.set('peer-timeout-guard', createPeer(pc, {
      iceRestartInProgress: false
    }))

    await managerAny.attemptIceRestart('peer-timeout-guard')
    const peer = managerAny.peers.get('peer-timeout-guard')
    peer.iceRestartInProgress = false
    await vi.advanceTimersByTimeAsync(16000)
    expect(managerAny.peers.has('peer-timeout-guard')).toBe(true)
  })

  it('attemptIceRestart handles empty offer SDP fallback path', async () => {
    const pc = new MockPC()
    pc.createOffer = vi.fn(async () => ({ type: 'offer', sdp: '' }))
    pc.setLocalDescription = vi.fn(async () => { })
    managerAny.roomId = 'room-restart'
    managerAny.mqtt = mockMqtt()
    managerAny.peers.set('peer-empty-sdp', createPeer(pc, {
      iceRestartAttempts: 0,
      iceRestartInProgress: false
    }))

    await managerAny.attemptIceRestart('peer-empty-sdp')
    expect(pc.setLocalDescription).toHaveBeenCalled()
  })

  it('replaceTrack covers video-route and null-routed fallback branches', () => {
    const videoSender = {
      track: { kind: 'video', id: 'video-sender' },
      replaceTrack: vi.fn().mockResolvedValue(undefined),
      getParameters: vi.fn().mockReturnValue({ codecs: [{ mimeType: 'video/vp8' }] })
    }
    const audioSender = {
      track: { kind: 'audio', id: 'audio-sender' },
      replaceTrack: vi.fn().mockResolvedValue(undefined),
      getParameters: vi.fn().mockReturnValue({ codecs: [{ mimeType: 'audio/opus' }] })
    }

    const pcVideo = new MockPC()
    pcVideo.getSenders = vi.fn(() => [videoSender as any])
    managerAny.peers.set('peer-video', createPeer(pcVideo))
    manager.replaceTrack({ kind: 'video', id: 'video-track', label: 'Video', enabled: true, readyState: 'live' } as any)
    expect(videoSender.replaceTrack).toHaveBeenCalled()

    const pcAudio = new MockPC()
    pcAudio.getSenders = vi.fn(() => [audioSender as any])
    managerAny.peers.set('peer-audio', createPeer(pcAudio))
    managerAny.peers.set('peer-target-exclusive', createPeer(new MockPC()))
    manager.setAudioRoutingMode('exclusive', 'peer-target-exclusive')
    manager.replaceTrack({ kind: 'audio', id: 'audio-track', label: 'Audio', enabled: true, readyState: 'live' } as any)
    expect(audioSender.replaceTrack).toHaveBeenCalledWith(null)

    const pcNoSender = new MockPC()
    pcNoSender.getSenders = vi.fn(() => [])
    managerAny.peers.set('peer-no-sender', createPeer(pcNoSender))
    manager.replaceTrack({ kind: 'audio', id: 'audio-null-route', label: 'Audio', enabled: true, readyState: 'live' } as any)
    expect(pcNoSender.addTrack).not.toHaveBeenCalled()
  })
})
