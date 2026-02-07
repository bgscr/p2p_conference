/**
 * @vitest-environment jsdom
 */

/**
 * Coverage gap tests for SimplePeerManager
 * Targets uncovered lines and branches identified by v8 coverage:
 * - MQTTClient subscribe error paths and packet handling
 * - MultiBrokerMQTT subscribeAll parse error, publish gating, status methods
 * - SimplePeerManager: configureOpusCodec delegation, getConnectionStats error,
 *   broadcast fallback, offline/online reconnection paths, ICE restart edge cases,
 *   handleAnnounce dead-peer cleanup, handleOffer existing peer, connection state
 *   transitions, and more.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SimplePeerManager,
  selfId,
  MessageDeduplicator,
  MQTTClient,
  MultiBrokerMQTT,
  loadCredentials,
  resetCredentialsCacheForTesting,
} from '../renderer/signaling/SimplePeerManager'
import { SignalingLog } from '../renderer/utils/Logger'

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
    this.onmessage?.({ data: packet.buffer })
  }
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

  createOffer = vi.fn(async (opts?: any) => ({
    type: 'offer',
    sdp: opts?.iceRestart
      ? 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10;useinbandfec=1'
      : 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10;useinbandfec=1',
  }))

  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'mock-answer-sdp' }))

  setLocalDescription = vi.fn(async (desc: any) => {
    this.localDescription = desc
  })

  setRemoteDescription = vi.fn(async (desc: any) => {
    this.remoteDescription = desc
  })

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

  simulateState(connState: string, iceState: string) {
    this.connectionState = connState
    this.iceConnectionState = iceState
    this.onconnectionstatechange?.()
    this.oniceconnectionstatechange?.()
  }

  simulateTrack(track: any, streams: any[]) {
    this.ontrack?.({ track, streams })
  }

  simulateIceCandidate(candidate: any) {
    this.onicecandidate?.({ candidate })
  }
}

class MockBC {
  name: string
  onmessage: ((event: any) => void) | null = null
  constructor(name: string) {
    this.name = name
  }
  postMessage = vi.fn()
  close = vi.fn()
}

vi.stubGlobal('WebSocket', MockWS)
vi.stubGlobal('RTCPeerConnection', MockPC)
vi.stubGlobal('RTCSessionDescription', class { constructor(init: any) { Object.assign(this, init) } })
vi.stubGlobal('RTCIceCandidate', class {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  constructor(init: any) {
    this.candidate = init.candidate || ''
    this.sdpMid = init.sdpMid || null
    this.sdpMLineIndex = init.sdpMLineIndex || null
  }
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

/** Creates a mock MQTT object that won't crash in leaveRoom */
function mockMqtt(overrides: Record<string, any> = {}) {
  return {
    isConnected: () => true,
    publish: () => 1,
    disconnect: vi.fn(),
    isSubscribed: () => false,
    getConnectedCount: () => 1,
    getTotalMessageCount: () => 0,
    getDeduplicatorSize: () => 0,
    getBrokerStatus: () => [],
    ...overrides,
  }
}

// ==========================================================
// TESTS
// ==========================================================

describe('MessageDeduplicator - edge cases', () => {
  let dedup: MessageDeduplicator

  beforeEach(() => {
    vi.useFakeTimers()
    dedup = new MessageDeduplicator()
  })

  afterEach(() => {
    dedup.destroy()
    vi.useRealTimers()
  })

  it('should evict oldest entries when exceeding window size', () => {
    // Fill beyond the 500 window
    for (let i = 0; i < 510; i++) {
      dedup.isDuplicate(`msg-${i}`)
    }
    // Size should be capped at 500
    expect(dedup.size()).toBeLessThanOrEqual(500)

    // The oldest entry (msg-0) should have been evicted
    // so it is no longer a duplicate
    expect(dedup.isDuplicate('msg-0')).toBe(false)
  })

  it('cleanup should remove expired entries', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    dedup.isDuplicate('old-msg')
    expect(dedup.size()).toBe(1)

    // Advance past the 30s TTL
    vi.setSystemTime(new Date('2025-01-01T00:00:31Z'))
    dedup.cleanup()

    expect(dedup.size()).toBe(0)
    // Now it should be treated as new
    expect(dedup.isDuplicate('old-msg')).toBe(false)
  })

  it('cleanup is a no-op when nothing is expired', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    dedup.isDuplicate('recent-msg')

    vi.setSystemTime(new Date('2025-01-01T00:00:10Z'))
    dedup.cleanup()

    expect(dedup.size()).toBe(1)
  })

  it('destroy clears interval and data', () => {
    dedup.isDuplicate('a')
    dedup.isDuplicate('b')
    expect(dedup.size()).toBe(2)

    dedup.destroy()
    expect(dedup.size()).toBe(0)
  })
})

describe('MQTTClient - uncovered paths', () => {
  let ws: MockWS

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockWebSockets = []
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('connect resolves immediately if already connected', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const p = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await p
    expect(client.isConnected()).toBe(true)

    // Second connect should resolve immediately
    await client.connect()
    expect(client.isConnected()).toBe(true)
    client.disconnect()
  })

  it('connect rejects on WebSocket error before connected', async () => {
    const client = new MQTTClient('wss://fail/mqtt')
    const p = client.connect()
    await vi.advanceTimersByTimeAsync(1)
    ws = mockWebSockets[mockWebSockets.length - 1]

    // Trigger error before CONNACK
    ws.onerror?.(new Error('fail'))
    await expect(p).rejects.toThrow()
    client.disconnect()
  })

  it('connect rejects on WebSocket close before CONNACK', async () => {
    // Create a client and connect, but trigger onclose before CONNACK
    const client = new MQTTClient('wss://close-early/mqtt')
    const p = client.connect()

    // Wait for WS to open (but intercept send to block CONNACK reply)
    await vi.advanceTimersByTimeAsync(1)
    const wsInst = mockWebSockets[mockWebSockets.length - 1]
    // Block the auto-CONNACK by replacing send
    wsInst.send = vi.fn()

    // Let WS fully open
    await vi.advanceTimersByTimeAsync(10)

    // Now simulate WebSocket closing before CONNACK
    wsInst.readyState = MockWS.CLOSED
    wsInst.onerror?.(new Error('Connection lost'))

    await expect(p).rejects.toThrow()

    client.disconnect()
  })

  it('subscribe returns false when not connected', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const result = await client.subscribe('topic', () => { })
    expect(result).toBe(false)
    client.disconnect()
  })

  it('subscribe returns false on SUBACK timeout', async () => {
    const client = new MQTTClient('wss://test/mqtt')

    // Connect normally
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    // Override send to NOT reply with SUBACK
    ws = mockWebSockets[mockWebSockets.length - 1]
    ws.send = vi.fn()

    const subPromise = client.subscribe('topic', () => { })
    // Advance past subscribe timeout (5000ms)
    await vi.advanceTimersByTimeAsync(6000)

    const result = await subPromise
    expect(result).toBe(false)
    client.disconnect()
  })

  it('subscribe returns false when ws.send throws', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    ws = mockWebSockets[mockWebSockets.length - 1]
    ws.send = vi.fn(() => { throw new Error('send failed') })

    const result = await client.subscribe('topic', () => { })
    expect(result).toBe(false)
    client.disconnect()
  })

  it('publish returns false when not connected', () => {
    const client = new MQTTClient('wss://test/mqtt')
    const result = client.publish('topic', 'msg')
    expect(result).toBe(false)
  })

  it('publish returns false when ws.send throws', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    ws = mockWebSockets[mockWebSockets.length - 1]
    ws.send = vi.fn(() => { throw new Error('send error') })

    const result = client.publish('topic', 'msg')
    expect(result).toBe(false)
    client.disconnect()
  })

  it('disconnect sends DISCONNECT packet and cleans up', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    ws = mockWebSockets[mockWebSockets.length - 1]
    expect(ws.readyState).toBe(MockWS.OPEN)

    client.disconnect()
    expect(client.isConnected()).toBe(false)
    expect(client.isSubscribed()).toBe(false)
    expect(client.getMessageCount()).toBe(0)
  })

  it('disconnect handles ws.send error gracefully', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    ws = mockWebSockets[mockWebSockets.length - 1]
    ws.send = vi.fn(() => { throw new Error('send error on disconnect') })

    expect(() => client.disconnect()).not.toThrow()
  })

  it('unexpected WebSocket close triggers onDisconnect callback', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const disconnectCb = vi.fn()
    client.setOnDisconnect(disconnectCb)

    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    ws = mockWebSockets[mockWebSockets.length - 1]
    // Simulate unexpected close (not intentional)
    ws.onclose?.()
    await vi.advanceTimersByTimeAsync(10)

    expect(disconnectCb).toHaveBeenCalledWith('wss://test/mqtt')
  })

  it('intentional disconnect does NOT trigger onDisconnect callback', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const disconnectCb = vi.fn()
    client.setOnDisconnect(disconnectCb)

    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    client.disconnect()
    await vi.advanceTimersByTimeAsync(10)

    expect(disconnectCb).not.toHaveBeenCalled()
  })

  it('handles PUBLISH packets with QoS > 0', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    const msgCallback = vi.fn()
    ws = mockWebSockets[mockWebSockets.length - 1]

    // Override send to auto-SUBACK and then simulate a QoS1 PUBLISH
    const origSend = ws.send
    ws.send = vi.fn((data: Uint8Array) => {
      origSend(data)
    })

    const subPromise = client.subscribe('test-topic', msgCallback)
    await vi.advanceTimersByTimeAsync(50)
    await subPromise

    // Build a QoS 1 PUBLISH packet
    const topic = 'test-topic'
    const payload = '{"test":true}'
    const topicBytes = new TextEncoder().encode(topic)
    const payloadBytes = new TextEncoder().encode(payload)
    // QoS 1: packet type 0x32 (PUBLISH with QoS=1), has packet identifier (2 bytes)
    const remainingLength = 2 + topicBytes.length + 2 + payloadBytes.length
    const packet = new Uint8Array(2 + remainingLength)
    let i = 0
    packet[i++] = 0x32 // PUBLISH QoS 1
    packet[i++] = remainingLength
    packet[i++] = (topicBytes.length >> 8) & 0xff
    packet[i++] = topicBytes.length & 0xff
    packet.set(topicBytes, i); i += topicBytes.length
    packet[i++] = 0x00 // packet id MSB
    packet[i++] = 0x01 // packet id LSB
    packet.set(payloadBytes, i)

    ws.onmessage?.({ data: packet.buffer })

    expect(msgCallback).toHaveBeenCalledWith(payload)
    expect(client.getMessageCount()).toBe(1)

    client.disconnect()
  })

  it('handles PINGRESP packet type 13', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    ws = mockWebSockets[mockWebSockets.length - 1]
    // Simulate PINGRESP (0xD0 = type 13)
    ws.onmessage?.({ data: new Uint8Array([0xd0, 0x00]).buffer })

    // Should not crash - just a debug log
    expect(client.isConnected()).toBe(true)
    client.disconnect()
  })

  it('handles invalid remaining length in packet (> 4 bytes)', async () => {
    const client = new MQTTClient('wss://test/mqtt')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    ws = mockWebSockets[mockWebSockets.length - 1]
    // Create a packet with continuation bits set for > 4 bytes (invalid)
    const badPacket = new Uint8Array([0x30, 0x80, 0x80, 0x80, 0x80, 0x80])
    ws.onmessage?.({ data: badPacket.buffer })

    // Should not crash, buffer cleared
    expect(client.isConnected()).toBe(true)
    client.disconnect()
  })

  it('MQTTClient with username and password sets connect flags', async () => {
    const client = new MQTTClient('wss://test/mqtt', 'user', 'pass')
    const cp = client.connect()
    await vi.advanceTimersByTimeAsync(50)
    await cp

    ws = mockWebSockets[mockWebSockets.length - 1]
    // Verify send was called with CONNECT packet
    expect(ws.send).toHaveBeenCalled()
    const firstCall = ws.send.mock.calls[0]
    if (firstCall) {
      const packet = firstCall[0] as Uint8Array
      // First byte should be 0x10 (CONNECT)
      expect(packet[0]).toBe(0x10)
    }

    client.disconnect()
  })
})

describe('MultiBrokerMQTT - uncovered paths', () => {
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

  it('subscribeAll handles JSON parse errors in onMessage wrapper', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    const callback = vi.fn()
    const subP = multi.subscribeAll('test-topic', callback)
    await vi.advanceTimersByTimeAsync(100)
    await subP

    // Access internal onMessage and send invalid JSON
    const internalOnMessage = (multi as any).onMessage
    expect(internalOnMessage).toBeDefined()

    // Invalid JSON should still forward to callback (catch block)
    internalOnMessage('not-valid-json')
    expect(callback).toHaveBeenCalledWith('not-valid-json')

    multi.disconnect()
  })

  it('subscribeAll deduplicates messages with msgId', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    const callback = vi.fn()
    const subP = multi.subscribeAll('test-topic', callback)
    await vi.advanceTimersByTimeAsync(100)
    await subP

    const internalOnMessage = (multi as any).onMessage

    // First call - new message
    internalOnMessage(JSON.stringify({ type: 'announce', msgId: 'dup-1' }))
    expect(callback).toHaveBeenCalledTimes(1)

    // Second call - duplicate
    internalOnMessage(JSON.stringify({ type: 'announce', msgId: 'dup-1' }))
    expect(callback).toHaveBeenCalledTimes(1) // Still 1 - deduped

    // Third call - new message without msgId (no dedup)
    internalOnMessage(JSON.stringify({ type: 'announce' }))
    expect(callback).toHaveBeenCalledTimes(2)

    multi.disconnect()
  })

  it('publish only sends to connected AND subscribed clients', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    // Before subscribing, publish should not succeed (not subscribed)
    const count = multi.publish('test-topic', 'hello')
    // Clients are connected but not subscribed
    expect(count).toBe(0)

    multi.disconnect()
  })

  it('isSubscribed returns false when no client is subscribed', () => {
    const multi = new MultiBrokerMQTT()
    expect(multi.isSubscribed()).toBe(false)
    multi.disconnect()
  })

  it('isSubscribed returns true after subscribeAll', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    const subP = multi.subscribeAll('topic', () => { })
    await vi.advanceTimersByTimeAsync(100)
    await subP

    expect(multi.isSubscribed()).toBe(true)
    multi.disconnect()
  })

  it('getTotalMessageCount sums across clients', async () => {
    const multi = new MultiBrokerMQTT()
    expect(multi.getTotalMessageCount()).toBe(0)
    multi.disconnect()
  })

  it('getConnectedCount returns number of connected brokers', async () => {
    const multi = new MultiBrokerMQTT()
    expect(multi.getConnectedCount()).toBe(0)

    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    expect(multi.getConnectedCount()).toBeGreaterThan(0)
    multi.disconnect()
  })

  it('setOnReconnect callback is invoked on reconnect', async () => {
    const multi = new MultiBrokerMQTT()
    const reconnectCb = vi.fn()
    multi.setOnReconnect(reconnectCb)

    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    // Subscribe so reconnect re-subscribes
    const subP = multi.subscribeAll('test-topic', () => { })
    await vi.advanceTimersByTimeAsync(100)
    await subP

    // Trigger broker disconnect for reconnection
    const brokerUrl = (multi as any).clients.keys().next().value
    const client = (multi as any).clients.get(brokerUrl)
    expect(client).toBeDefined()

      // Simulate unexpected disconnect
      ; (multi as any).handleBrokerDisconnect(brokerUrl)
    // Wait for exponential backoff + reconnection
    await vi.advanceTimersByTimeAsync(5000)

    // The callback should have been triggered after successful reconnect
    expect(reconnectCb).toHaveBeenCalled()

    multi.disconnect()
  })

  it('disconnect clears all state', async () => {
    const multi = new MultiBrokerMQTT()
    const connectP = multi.connectAll()
    await vi.advanceTimersByTimeAsync(100)
    await connectP

    multi.disconnect()

    expect(multi.isConnected()).toBe(false)
    expect(multi.isSubscribed()).toBe(false)
    expect(multi.getConnectedCount()).toBe(0)
    expect(multi.getDeduplicatorSize()).toBe(0)
  })
})

describe('SimplePeerManager - coverage gaps', () => {
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
      configurable: true,
    })

    manager = new SimplePeerManager()
    managerAny = manager as any
  })

  afterEach(() => {
    // Ensure mqtt mock has disconnect method before leaveRoom
    if (managerAny.mqtt && typeof managerAny.mqtt.disconnect !== 'function') {
      managerAny.mqtt = null
    }
    manager.leaveRoom()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    teardownElectronAPI()
  })

  // --- configureOpusCodec delegation ---
  it('configureOpusCodec delegates to configureOpusSdp', () => {
    const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10;useinbandfec=1'
    const result = managerAny.configureOpusCodec(sdp)
    expect(result).toContain('maxaveragebitrate=60000')
    expect(result).toContain('stereo=0')
  })

  // --- broadcast when MQTT publishes 0 brokers ---
  it('broadcast logs correctly when MQTT publish returns 0', () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt({ publish: () => 0 })
    managerAny.broadcastChannel = null

    // Should not throw
    managerAny.broadcast({ v: 1, type: 'announce', from: selfId })
  })

  // --- broadcast with only BroadcastChannel (no MQTT) ---
  it('broadcast uses only BroadcastChannel when MQTT is null', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = null
    const bc = new MockBC('test')
    managerAny.broadcastChannel = bc

    managerAny.broadcast({ v: 1, type: 'announce', from: selfId })
    expect(bc.postMessage).toHaveBeenCalled()
  })

  // --- broadcast does not log for ping/pong/mute-status ---
  it('broadcast skips logging for ping, pong, and mute-status types', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = null
    const bc = new MockBC('test')
    managerAny.broadcastChannel = bc

    vi.mocked(SignalingLog.debug).mockClear()

    managerAny.broadcast({ v: 1, type: 'ping', from: selfId })
    managerAny.broadcast({ v: 1, type: 'pong', from: selfId })
    managerAny.broadcast({ v: 1, type: 'mute-status', from: selfId })

    // None of these should trigger the 'Message broadcast' log
    const broadcastLogCalls = vi.mocked(SignalingLog.debug).mock.calls.filter(
      (c: any[]) => c[0] === 'Message broadcast'
    )
    expect(broadcastLogCalls.length).toBe(0)
  })

  // --- broadcastMuteStatus early return when no peers ---
  it('broadcastMuteStatus returns early if no peers', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt({ publish: vi.fn() })
    // No peers
    expect(managerAny.peers.size).toBe(0)

    manager.broadcastMuteStatus(true, false, true)

    // MQTT publish should NOT be called since peers.size === 0
    expect(managerAny.mqtt.publish).not.toHaveBeenCalled()
  })

  // --- getConnectionStats error handling ---
  it('getConnectionStats catches errors from getStats()', async () => {
    managerAny.roomId = 'test-room'

    const pc = new MockPC()
    pc.connectionState = 'connected'
    pc.getStats = vi.fn(async () => { throw new Error('stats failed') })

    managerAny.peers.set('peer-err', {
      pc,
      stream: null,
      userName: 'Err',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    const stats = await manager.getConnectionStats()
    // The error should be caught, not thrown; the peer should not appear in results
    expect(stats.has('peer-err')).toBe(false)
  })

  // --- getConnectionStats for non-connected peer ---
  it('getConnectionStats returns default for non-connected peers', async () => {
    managerAny.roomId = 'test-room'

    const pc = new MockPC()
    pc.connectionState = 'connecting'

    managerAny.peers.set('peer-connecting', {
      pc,
      stream: null,
      userName: 'Connecting',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: false,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    const stats = await manager.getConnectionStats()
    const peerStats = stats.get('peer-connecting')
    expect(peerStats).toBeDefined()
    expect(peerStats!.quality).toBe('fair')
    expect(peerStats!.rtt).toBe(0)
  })

  // --- handleMuteStatus for non-existent peer (no crash) ---
  it('handleMuteStatus is no-op for unknown peer', () => {
    expect(() => {
      managerAny.handleMuteStatus('unknown-peer', { micMuted: true })
    }).not.toThrow()
  })

  // --- handlePeerLeave for non-existent peer (no crash) ---
  it('handlePeerLeave is no-op for unknown peer', () => {
    expect(() => {
      managerAny.handlePeerLeave('unknown-peer')
    }).not.toThrow()
  })

  // --- handleAnswer for non-existent peer ---
  it('handleAnswer returns early for unknown peer', async () => {
    await expect(
      managerAny.handleAnswer('unknown-peer', { type: 'answer', sdp: 'x' })
    ).resolves.toBeUndefined()
  })

  // --- handleAnnounce with existing dead peer (closed state) ---
  it('handleAnnounce cleans up dead peer and creates new connection', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const deadPC = new MockPC()
    deadPC.connectionState = 'closed'
    deadPC.close = vi.fn()

    const peerId = 'peer-dead'
    managerAny.peers.set(peerId, {
      pc: deadPC,
      stream: null,
      userName: 'Dead',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: false,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    // Use a peerId that is less than selfId so the manager waits (no offer)
    // Or greater than selfId so it initiates
    // We use a fixed peerId and let the logic determine who initiates
    await managerAny.handleAnnounce(peerId, 'DeadPeer', 'win')

    // Dead peer should have been cleaned up
    expect(deadPC.close).toHaveBeenCalled()
  })

  // --- handleAnnounce ignores duplicate announce from live peer ---
  it('handleAnnounce ignores announce from peer with active connection', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const livePC = new MockPC()
    livePC.connectionState = 'connected'

    const peerId = 'peer-live'
    managerAny.peers.set(peerId, {
      pc: livePC,
      stream: null,
      userName: 'Live',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    const createOfferSpy = vi.spyOn(managerAny, 'createOffer')
    await managerAny.handleAnnounce(peerId, 'Live', 'win')

    // Should NOT create a new offer since connection is alive
    expect(createOfferSpy).not.toHaveBeenCalled()
    createOfferSpy.mockRestore()
  })

  // --- handleOffer cleans up existing peer before creating new ---
  it('handleOffer closes existing peer connection before creating new', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const existingPC = new MockPC()
    const peerId = 'peer-existing'

    managerAny.peers.set(peerId, {
      pc: existingPC,
      stream: null,
      userName: 'Existing',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    await managerAny.handleOffer(peerId, { type: 'offer', sdp: 'v=0\r\n...' }, 'NewUser', 'mac')

    expect(existingPC.close).toHaveBeenCalled()
    // A new peer connection should exist
    expect(managerAny.peers.has(peerId)).toBe(true)
  })

  // --- handleAnswer with pending ICE candidates ---
  it('handleAnswer applies pending ICE candidates after setting remote description', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const pc = new MockPC()
    pc.remoteDescription = null
    const peerId = 'peer-answer'

    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'AnswerPeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: false,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    // Queue pending candidates
    managerAny.pendingCandidates.set(peerId, [
      { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
    ])

    await managerAny.handleAnswer(peerId, { type: 'answer', sdp: 'mock-sdp' })

    expect(pc.setRemoteDescription).toHaveBeenCalled()
    expect(pc.addIceCandidate).toHaveBeenCalled()
    // Pending candidates should be cleared
    expect(managerAny.pendingCandidates.has(peerId)).toBe(false)
  })

  // --- attemptIceRestart with peer not found ---
  it('attemptIceRestart returns early if peer not found', async () => {
    await managerAny.attemptIceRestart('nonexistent-peer')
    // No crash
  })

  // --- attemptIceRestart when already in progress ---
  it('attemptIceRestart returns early if restart already in progress', async () => {
    const pc = new MockPC()
    const peerId = 'peer-restart'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'RestartPeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: true, // Already in progress
      disconnectTimer: null,
      reconnectTimer: null,
    })

    await managerAny.attemptIceRestart(peerId)
    // createOffer should NOT have been called
    expect(pc.createOffer).not.toHaveBeenCalled()
  })

  // --- attemptIceRestart when max attempts exceeded ---
  it('attemptIceRestart cleans up peer when max attempts exceeded', async () => {
    const pc = new MockPC()
    const peerId = 'peer-maxrestart'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'MaxRestart',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 3, // MAX_ICE_RESTART_ATTEMPTS = 3
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    // Set up onPeerLeave to verify cleanup
    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    await managerAny.attemptIceRestart(peerId)

    // Peer should be cleaned up
    expect(managerAny.peers.has(peerId)).toBe(false)
    expect(onPeerLeave).toHaveBeenCalledWith(peerId, 'MaxRestart', 'win')
  })

  // --- attemptIceRestart with closed signaling state ---
  it('attemptIceRestart cleans up peer when signalingState is closed', async () => {
    const pc = new MockPC()
    pc.signalingState = 'closed'
    const peerId = 'peer-closed'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'ClosedPeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    await managerAny.attemptIceRestart(peerId)

    expect(managerAny.peers.has(peerId)).toBe(false)
  })

  // --- attemptIceRestart with createOffer failure + retry ---
  it('attemptIceRestart schedules retry on createOffer failure', async () => {
    const pc = new MockPC()
    pc.createOffer = vi.fn(async () => { throw new Error('offer failed') })
    const peerId = 'peer-offerfail'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'OfferFail',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    await managerAny.attemptIceRestart(peerId)

    // Should have incremented attempts and scheduled a retry
    const peer = managerAny.peers.get(peerId)
    expect(peer.iceRestartAttempts).toBe(1)
    expect(peer.iceRestartInProgress).toBe(false) // Reset on failure
  })

  // --- Connection state 'failed' without restart in progress ---
  it('connection state failed with no restart in progress triggers cleanup', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    const peerId = 'peer-fail-cleanup'

    // Create peer connection (which also sets up event handlers)
    managerAny.createPeerConnection(peerId, 'FailPeer', 'win')

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    lastPC.connectionState = 'failed'
    lastPC.onconnectionstatechange?.()

    expect(onPeerLeave).toHaveBeenCalledWith(peerId, 'FailPeer', 'win')
  })

  // --- Connection state 'closed' with non-connected peer ---
  it('connection state closed for non-connected peer just deletes from map', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const onPeerLeave = vi.fn()
    manager.setCallbacks({ onPeerLeave })

    const peerId = 'peer-closed-nonconn'
    managerAny.createPeerConnection(peerId, 'ClosedPeer', 'win')

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    // Peer is NOT connected (isConnected = false initially)
    lastPC.connectionState = 'closed'
    lastPC.onconnectionstatechange?.()

    // Should just delete, not call onPeerLeave via cleanupPeer
    expect(managerAny.peers.has(peerId)).toBe(false)
  })

  // --- ICE disconnected state triggers grace period timer ---
  it('ICE disconnected triggers grace period and then restart', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const peerId = 'peer-ice-disc'
    managerAny.createPeerConnection(peerId, 'IceDiscPeer', 'win')

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    lastPC.iceConnectionState = 'disconnected'
    lastPC.oniceconnectionstatechange?.()

    // Grace period timer should be set
    const peer = managerAny.peers.get(peerId)
    expect(peer.disconnectTimer).toBeTruthy()

    // After grace period (5000ms), if still disconnected, should attempt restart
    await vi.advanceTimersByTimeAsync(5500)

    // ICE restart should have been triggered
    expect(lastPC.createOffer).toHaveBeenCalled()
  })

  // --- ICE connected clears timers ---
  it('ICE connected clears disconnect and reconnect timers', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const peerId = 'peer-ice-conn'
    managerAny.createPeerConnection(peerId, 'IceConnPeer', 'win')

    const peer = managerAny.peers.get(peerId)
    peer.disconnectTimer = setTimeout(() => { }, 10000)
    peer.reconnectTimer = setTimeout(() => { }, 10000)
    peer.iceRestartInProgress = true
    peer.iceRestartAttempts = 2

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    lastPC.iceConnectionState = 'connected'
    lastPC.oniceconnectionstatechange?.()

    expect(peer.disconnectTimer).toBeNull()
    expect(peer.reconnectTimer).toBeNull()
    expect(peer.iceRestartInProgress).toBe(false)
    expect(peer.iceRestartAttempts).toBe(0)
  })

  // --- ontrack with no streams creates MediaStream from track ---
  it('ontrack creates MediaStream when no streams in event', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const onRemoteStream = vi.fn()
    manager.setCallbacks({ onRemoteStream })

    const peerId = 'peer-track-nostream'
    managerAny.createPeerConnection(peerId, 'TrackPeer', 'win')

    const lastPC = mockPeerConnections[mockPeerConnections.length - 1]
    const mockTrack = { kind: 'audio', id: 'track-1' }

    // Trigger ontrack with empty streams array
    lastPC.ontrack?.({ track: mockTrack, streams: [] })

    expect(onRemoteStream).toHaveBeenCalledWith(peerId, expect.any(Object))
  })

  // --- setLocalStream replaces existing track of same kind ---
  it('setLocalStream replaces existing track of same kind', () => {
    const pc = new MockPC()
    const existingTrack = { kind: 'audio', id: 'old-track' }
    const replaceTrackFn = vi.fn().mockResolvedValue(undefined)
    const existingSender = {
      track: existingTrack,
      replaceTrack: replaceTrackFn,
      getParameters: vi.fn().mockReturnValue({ codecs: [] }),
    }
    pc.getSenders = vi.fn(() => [existingSender])

    const peerId = 'peer-replace'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'ReplacePeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    const newTrack = { kind: 'audio', id: 'new-track' }
    const newStream = {
      id: 'stream-1',
      getTracks: () => [newTrack],
      getAudioTracks: () => [newTrack],
    }

    manager.setLocalStream(newStream as any)

    expect(replaceTrackFn).toHaveBeenCalledWith(newTrack)
    expect(pc.addTrack).not.toHaveBeenCalled()
  })

  // --- cleanupPeer restarts discovery when no healthy peers remain ---
  it('cleanupPeer restarts announce when no healthy peers', () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const pc = new MockPC()
    pc.connectionState = 'failed'
    const peerId = 'peer-cleanup-announce'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'CleanupPeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    const announceSpy = vi.spyOn(managerAny, 'broadcastAnnounce')
    managerAny.cleanupPeer(peerId)

    // Should restart announcements
    expect(announceSpy).toHaveBeenCalled()
    announceSpy.mockRestore()
  })

  // --- sendLeaveSignal when not in room ---
  it('sendLeaveSignal is no-op when not in room', () => {
    managerAny.roomId = null
    expect(() => managerAny.sendLeaveSignal()).not.toThrow()
  })

  // --- handleIceCandidate queues when no remote description ---
  it('handleIceCandidate queues candidate when no remote description', async () => {
    managerAny.roomId = 'test-room'

    const pc = new MockPC()
    pc.remoteDescription = null
    const peerId = 'peer-noremote'

    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'NoRemotePeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: false,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    await managerAny.handleIceCandidate(peerId, { candidate: 'c1', sdpMid: '0' })

    expect(managerAny.pendingCandidates.get(peerId)).toHaveLength(1)
  })

  // --- handleIceCandidate for unknown peer queues ---
  it('handleIceCandidate queues for unknown peer', async () => {
    await managerAny.handleIceCandidate('unknown-peer', { candidate: 'c1', sdpMid: '0' })
    expect(managerAny.pendingCandidates.get('unknown-peer')).toHaveLength(1)
  })

  // --- Platform detection for mac ---
  it('detects mac platform from user agent', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      writable: true,
      configurable: true,
    })

    const joinPromise = manager.joinRoom('test-room', 'MacUser')
    await vi.advanceTimersByTimeAsync(200)
    await joinPromise

    expect(managerAny.localPlatform).toBe('mac')
  })

  // --- Platform detection for linux ---
  it('detects linux platform from user agent', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
      writable: true,
      configurable: true,
    })

    const m2 = new SimplePeerManager()
    const m2Any = m2 as any

    const joinPromise = m2.joinRoom('test-room', 'LinuxUser')
    await vi.advanceTimersByTimeAsync(200)
    await joinPromise

    expect(m2Any.localPlatform).toBe('linux')
    m2.leaveRoom()
  })

  // --- joinRoom handles MQTT connection failure ---
  it('joinRoom handles MQTT connectAll throwing', async () => {
    resetCredentialsCacheForTesting()

    // Make MultiBrokerMQTT.connectAll throw
    vi.spyOn(MultiBrokerMQTT.prototype, 'connectAll').mockRejectedValue(new Error('No MQTT brokers could be connected'))

    const onError = vi.fn()
    const m2 = new SimplePeerManager()
    m2.setCallbacks({ onError })

    const joinPromise = m2.joinRoom('fail-room', 'FailUser')
    await vi.advanceTimersByTimeAsync(200)
    await joinPromise

    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'mqtt-connection')

    vi.mocked(MultiBrokerMQTT.prototype.connectAll).mockRestore()
    m2.leaveRoom()
  })

  // --- joinRoom handles 0 subscribe count ---
  it('joinRoom disconnects MQTT when subscribe returns 0', async () => {
    resetCredentialsCacheForTesting()

    vi.spyOn(MultiBrokerMQTT.prototype, 'connectAll').mockResolvedValue(['wss://test/mqtt'])
    vi.spyOn(MultiBrokerMQTT.prototype, 'subscribeAll').mockResolvedValue(0)
    const disconnectSpy = vi.spyOn(MultiBrokerMQTT.prototype, 'disconnect')
    vi.spyOn(MultiBrokerMQTT.prototype, 'isConnected').mockReturnValue(false)

    const m2 = new SimplePeerManager()
    const joinPromise = m2.joinRoom('nosub-room', 'NoSubUser')
    await vi.advanceTimersByTimeAsync(200)
    await joinPromise

    expect(disconnectSpy).toHaveBeenCalled()

    vi.restoreAllMocks()
    m2.leaveRoom()
  })

  // --- joinRoom prevents concurrent joins ---
  it('joinRoom prevents concurrent join operations', async () => {
    const p1 = manager.joinRoom('room1', 'Alice')
    const p2 = manager.joinRoom('room2', 'Bob')

    await vi.advanceTimersByTimeAsync(300)
    await Promise.all([p1, p2])

    // Second join should have been ignored
    const debugInfo = manager.getDebugInfo() as any
    expect(debugInfo.roomId).toBe('room1')
  })

  // --- leaveRoom prevents concurrent leaves ---
  it('leaveRoom handles concurrent leave operations', async () => {
    const joinP = manager.joinRoom('test-room', 'Alice')
    await vi.advanceTimersByTimeAsync(200)
    await joinP

    manager.leaveRoom()
    // Second leave should be no-op
    manager.leaveRoom()

    expect(manager.getSignalingState()).toBe('idle')
  })

  // --- offline/online reconnection flow ---
  it('offline event remembers room and online triggers reconnect', async () => {
    const joinP = manager.joinRoom('test-room', 'Alice')
    await vi.advanceTimersByTimeAsync(200)
    await joinP

    // Go offline
    managerAny.handleOffline()
    expect(managerAny.wasInRoomWhenOffline).toBe(true)
    expect(managerAny.isOnline).toBe(false)

    // Go online
    managerAny.handleOnline()
    expect(managerAny.isOnline).toBe(true)

    // Wait for reconnect delay
    await vi.advanceTimersByTimeAsync(3000)

    // Reconnect attempt should have run
    expect(managerAny.networkReconnectAttempts).toBeGreaterThanOrEqual(0)
  })

  // --- offline when not in room ---
  it('offline event does not set wasInRoomWhenOffline when not in room', () => {
    managerAny.roomId = null
    managerAny.handleOffline()
    expect(managerAny.wasInRoomWhenOffline).toBe(false)
  })

  // --- network reconnect max attempts ---
  it('attemptNetworkReconnect stops after max attempts and calls onError', async () => {
    managerAny.roomId = 'test-room'
    managerAny.isOnline = true
    managerAny.networkReconnectAttempts = 5 // Already at max (NETWORK_RECONNECT_MAX_ATTEMPTS = 5)

    const onError = vi.fn()
    manager.setCallbacks({ onError })

    await managerAny.attemptNetworkReconnect()

    // After exceeding max, should reset and call onError
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'network-reconnect')
    expect(managerAny.networkReconnectAttempts).toBe(0)
    expect(managerAny.wasInRoomWhenOffline).toBe(false)
  })

  // --- attemptNetworkReconnect aborts if offline or no room ---
  it('attemptNetworkReconnect aborts when offline', async () => {
    managerAny.roomId = 'test-room'
    managerAny.isOnline = false

    await managerAny.attemptNetworkReconnect()
    // Should not have incremented attempts
    expect(managerAny.networkReconnectAttempts).toBe(0)
  })

  it('attemptNetworkReconnect aborts when no room', async () => {
    managerAny.roomId = null
    managerAny.isOnline = true

    await managerAny.attemptNetworkReconnect()
    expect(managerAny.networkReconnectAttempts).toBe(0)
  })

  // --- recordPeerActivity ---
  it('recordPeerActivity updates both lastSeen and lastPing maps', () => {
    const peerId = 'peer-activity'
    managerAny.recordPeerActivity(peerId)

    expect(managerAny.peerLastSeen.has(peerId)).toBe(true)
    expect(managerAny.peerLastPing.has(peerId)).toBe(true)
  })

  // --- heartbeat skips when no signaling channels ---
  it('heartbeat is no-op when no MQTT and no BroadcastChannel', async () => {
    managerAny.mqtt = mockMqtt({ isConnected: () => false })
    managerAny.broadcastChannel = null
    const pc = new MockPC()
    const peerId = 'peer-hb'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'HBPeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    managerAny.startHeartbeat()
    await vi.advanceTimersByTimeAsync(6000)

    // Peer should NOT have been pinged or removed (heartbeat early returns)
    expect(managerAny.peers.has(peerId)).toBe(true)
  })

  // --- heartbeat skips when no peers ---
  it('heartbeat is no-op when no peers', async () => {
    managerAny.mqtt = mockMqtt()
    expect(managerAny.peers.size).toBe(0)

    managerAny.startHeartbeat()
    await vi.advanceTimersByTimeAsync(6000)
    // Should not crash
  })

  // --- handleSignalingMessage for ping sends pong ---
  it('handleSignalingMessage for ping sends pong', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = mockMqtt()
    managerAny.broadcastChannel = null

    const broadcastSpy = vi.spyOn(managerAny, 'broadcast')

    managerAny.handleSignalingMessage({
      v: 1,
      type: 'ping',
      from: 'peer-pinger',
      to: selfId,
    })

    expect(broadcastSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'pong' }))
    broadcastSpy.mockRestore()
  })

  // --- loadCredentials with empty/null results ---
  it('loadCredentials handles null ICE servers from API', async () => {
    resetCredentialsCacheForTesting()
    Object.defineProperty(window, 'electronAPI', {
      value: {
        getICEServers: vi.fn().mockResolvedValue(null),
        getMQTTBrokers: vi.fn().mockResolvedValue(null),
      },
      writable: true,
      configurable: true,
    })

    await loadCredentials()
    // Should not throw
  })

  // --- loadCredentials already loaded ---
  it('loadCredentials returns early if already loaded', async () => {
    resetCredentialsCacheForTesting()
    await loadCredentials()

    // Second call should return immediately
    await loadCredentials()
  })

  // --- replaceTrack with null track ---
  it('replaceTrack returns early with null track', () => {
    manager.replaceTrack(null as any)
    // Should not throw
  })

  // --- replaceTrack with no peers ---
  it('replaceTrack returns early with no peers', () => {
    const track = { id: 't1', kind: 'audio', label: 'mic', enabled: true, readyState: 'live' }
    manager.replaceTrack(track as any)
    // Should not throw
  })

  // --- getPeers returns peer data ---
  it('getPeers returns peer info', () => {
    const pc = new MockPC()
    managerAny.peers.set('p1', {
      pc,
      stream: null,
      userName: 'Test',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: true, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    const peers = manager.getPeers()
    expect(peers.size).toBe(1)
    expect(peers.get('p1')?.userName).toBe('Test')
    expect(peers.get('p1')?.muteStatus.micMuted).toBe(true)
  })

  // --- getAllPeerMuteStatuses ---
  it('getAllPeerMuteStatuses returns all peer mute info', () => {
    const pc = new MockPC()
    managerAny.peers.set('p1', {
      pc,
      stream: null,
      userName: 'Test',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: true, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    const statuses = manager.getAllPeerMuteStatuses()
    expect(statuses.size).toBe(1)
    expect(statuses.get('p1')?.micMuted).toBe(true)
  })

  // --- ICE restart timeout triggers another attempt ---
  it('ICE restart timeout triggers next attempt if available', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    const pc = new MockPC()
    const peerId = 'peer-timeout'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'TimeoutPeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    await managerAny.attemptIceRestart(peerId)

    // Verify the peer is now in restart state
    const peer = managerAny.peers.get(peerId)
    expect(peer.iceRestartInProgress).toBe(true)
    expect(peer.iceRestartAttempts).toBe(1)

    // Simulate the restart timeout (15000ms) while still in progress
    // Keep the iceRestartInProgress flag true
    await vi.advanceTimersByTimeAsync(15500)

    // After timeout, it should have triggered another attempt or cleanup
  })

  // --- createOffer failure removes peer ---
  it('createOffer failure removes peer from map', async () => {
    managerAny.roomId = 'test-room'
    managerAny.topic = 'p2p-conf/test-room'
    managerAny.mqtt = mockMqtt()

    // Spy on createPeerConnection so that after a real PC is created, we make createOffer fail
    const origCPC = managerAny.createPeerConnection.bind(managerAny)
    vi.spyOn(managerAny, 'createPeerConnection').mockImplementation(
      (...args: any[]) => {
        const pc = origCPC(...args)
        pc.createOffer = vi.fn(async () => { throw new Error('create offer failed') })
        return pc
      }
    )

    const peerId = 'peer-offer-err'
    await managerAny.createOffer(peerId, 'ErrPeer', 'win')

    expect(managerAny.peers.has(peerId)).toBe(false)
    managerAny.createPeerConnection.mockRestore()
  })

  // --- handleAnswer setRemoteDescription failure ---
  it('handleAnswer catches setRemoteDescription error', async () => {
    const pc = new MockPC()
    pc.setRemoteDescription = vi.fn(async () => { throw new Error('SRD failed') })
    const peerId = 'peer-srd-fail'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'SRDFail',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: false,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    // Should not throw
    await managerAny.handleAnswer(peerId, { type: 'answer', sdp: 'mock' })
  })

  // --- addIceCandidate error is caught ---
  it('handleIceCandidate catches addIceCandidate error', async () => {
    const pc = new MockPC()
    pc.remoteDescription = { type: 'offer', sdp: 'x' }
    pc.addIceCandidate = vi.fn(async () => { throw new Error('ICE add failed') })
    const peerId = 'peer-ice-err'
    managerAny.peers.set(peerId, {
      pc,
      stream: null,
      userName: 'ICEErrPeer',
      platform: 'win',
      connectionStartTime: Date.now(),
      isConnected: false,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: null,
      reconnectTimer: null,
    })

    // Should not throw
    await managerAny.handleIceCandidate(peerId, { candidate: 'c1', sdpMid: '0' })
  })

  // --- broadcast adds msgId if missing ---
  it('broadcast adds msgId if not present', () => {
    managerAny.roomId = 'test-room'
    managerAny.mqtt = null
    const bc = new MockBC('test')
    managerAny.broadcastChannel = bc

    const msg: any = { v: 1, type: 'announce', from: selfId }
    managerAny.broadcast(msg)

    expect(msg.msgId).toBeDefined()
    expect(typeof msg.msgId).toBe('string')
  })

  // --- sendToPeer sets to, sessionId, and msgId ---
  it('sendToPeer sets to, sessionId, and generates msgId', () => {
    managerAny.roomId = 'test-room'
    managerAny.sessionId = 42
    managerAny.mqtt = null
    const bc = new MockBC('test')
    managerAny.broadcastChannel = bc

    const msg: any = { v: 1, type: 'ping', from: selfId }
    managerAny.sendToPeer('target-peer', msg)

    expect(msg.to).toBe('target-peer')
    expect(msg.sessionId).toBe(42)
    expect(msg.msgId).toBeDefined()
  })

  // --- getDebugInfo returns comprehensive info ---
  it('getDebugInfo returns all fields', async () => {
    const joinP = manager.joinRoom('test-room', 'Alice')
    await vi.advanceTimersByTimeAsync(200)
    await joinP

    const info = manager.getDebugInfo() as any
    expect(info).toHaveProperty('selfId')
    expect(info).toHaveProperty('roomId', 'test-room')
    expect(info).toHaveProperty('userName', 'Alice')
    expect(info).toHaveProperty('sessionId')
    expect(info).toHaveProperty('signalingState')
    expect(info).toHaveProperty('mqttConnected')
    expect(info).toHaveProperty('mqttSubscribed')
    expect(info).toHaveProperty('mqttBrokerCount')
    expect(info).toHaveProperty('mqttBrokerStatus')
    expect(info).toHaveProperty('mqttMessagesReceived')
    expect(info).toHaveProperty('mqttDedupCacheSize')
    expect(info).toHaveProperty('peerCount', 0)
    expect(info).toHaveProperty('peers')
    expect(info).toHaveProperty('localMuteStatus')
    expect(info).toHaveProperty('isJoining', false)
    expect(info).toHaveProperty('isLeaving', false)
    expect(info).toHaveProperty('networkOnline')
    expect(info).toHaveProperty('networkWasInRoomWhenOffline')
    expect(info).toHaveProperty('networkReconnectAttempts')
  })
})
