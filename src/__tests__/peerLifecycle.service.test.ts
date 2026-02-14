import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupPeerLifecycleResources,
  createPeerConnectionLifecycle,
  type PeerConnectionState
} from '../renderer/signaling/services/peerLifecycle'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  PeerLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

class FakeDataChannel {
  label: string
  close = vi.fn()

  constructor(label: string) {
    this.label = label
  }
}

class FakeMediaStream {
  id = `stream-${Math.random().toString(36).slice(2, 6)}`
  private tracks: any[]

  constructor(tracks: any[] = []) {
    this.tracks = tracks
  }

  getTracks() {
    return this.tracks
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track?.kind === 'audio')
  }
}

class FakePeerConnection {
  addTrack = vi.fn()
  createDataChannel = vi.fn((label: string) => new FakeDataChannel(label) as unknown as RTCDataChannel)
  close = vi.fn()
  iceConnectionState: RTCIceConnectionState = 'new'
  connectionState: RTCPeerConnectionState = 'new'
  ondatachannel: ((event: { channel: RTCDataChannel }) => void) | null = null
  onicecandidate: ((event: { candidate: { type?: string; toJSON: () => RTCIceCandidateInit } | null }) => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((event: { track: MediaStreamTrack; streams?: MediaStream[] }) => void) | null = null
}

describe('peerLifecycle service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
    class RTCPeerConnectionMock extends FakePeerConnection {
      constructor(_configuration?: RTCConfiguration) {
        super()
      }
    }
    vi.stubGlobal('RTCPeerConnection', RTCPeerConnectionMock as unknown as typeof RTCPeerConnection)
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('creates initiator peer lifecycle with local tracks and data channels', () => {
    const peers = new Map<string, PeerConnectionState>()
    const setupDataChannel = vi.fn()
    const applyAudioRoutingToPeer = vi.fn()
    const onSendIceCandidate = vi.fn()

    const localStream = {
      getTracks: () => [{ kind: 'audio', id: 'a1' }, { kind: 'video', id: 'v1' }]
    } as unknown as MediaStream

    const { pc, peerConn } = createPeerConnectionLifecycle({
      peerId: 'peer-1',
      userName: 'Alice',
      platform: 'win',
      isInitiator: true,
      localStream,
      iceServers: [{ urls: 'stun:example.org' }],
      disconnectGracePeriodMs: 200,
      getPeer: (id) => peers.get(id),
      removePeer: (id) => {
        peers.delete(id)
      },
      applyAudioRoutingToPeer,
      setupDataChannel,
      onSendIceCandidate,
      onAttemptIceRestart: vi.fn(),
      onCleanupPeer: vi.fn(),
      onStopAnnounceInterval: vi.fn(),
      onPeerJoin: vi.fn(),
      onSendLocalMuteStatus: vi.fn(),
      onSendRoomLockState: vi.fn(),
      onSendLocalHandRaised: vi.fn(),
      onRemoteStream: vi.fn()
    })

    peers.set('peer-1', peerConn)
    const fakePc = pc as unknown as FakePeerConnection
    expect(fakePc.addTrack).toHaveBeenCalledTimes(2)
    expect(applyAudioRoutingToPeer).toHaveBeenCalledWith('peer-1')
    expect(fakePc.createDataChannel).toHaveBeenCalledWith('chat', { ordered: true })
    expect(fakePc.createDataChannel).toHaveBeenCalledWith('control', { ordered: true })
    expect(setupDataChannel).toHaveBeenCalledTimes(2)

    fakePc.onicecandidate?.({
      candidate: {
        type: 'host',
        toJSON: () => ({ candidate: 'candidate-1' })
      }
    })
    expect(onSendIceCandidate).toHaveBeenCalledWith('peer-1', { candidate: 'candidate-1' })

    const incomingChatChannel = new FakeDataChannel('chat') as unknown as RTCDataChannel
    fakePc.ondatachannel?.({ channel: incomingChatChannel })
    expect(setupDataChannel).toHaveBeenCalledWith(incomingChatChannel, 'peer-1', peerConn, 'chat')
  })

  it('handles ICE and connection state transitions with timers and cleanup branches', () => {
    const peers = new Map<string, PeerConnectionState>()
    const onAttemptIceRestart = vi.fn()
    const onCleanupPeer = vi.fn()
    const removePeer = vi.fn((id: string) => {
      peers.delete(id)
    })
    const onSendLocalMuteStatus = vi.fn()
    const onSendRoomLockState = vi.fn()
    const onSendLocalHandRaised = vi.fn()

    const { pc, peerConn } = createPeerConnectionLifecycle({
      peerId: 'peer-2',
      userName: 'Bob',
      platform: 'mac',
      isInitiator: false,
      localStream: null,
      iceServers: [],
      disconnectGracePeriodMs: 100,
      getPeer: (id) => peers.get(id),
      removePeer,
      applyAudioRoutingToPeer: vi.fn(),
      setupDataChannel: vi.fn(),
      onSendIceCandidate: vi.fn(),
      onAttemptIceRestart,
      onCleanupPeer,
      onStopAnnounceInterval: vi.fn(),
      onPeerJoin: vi.fn(),
      onSendLocalMuteStatus,
      onSendRoomLockState,
      onSendLocalHandRaised,
      shouldSendRoomLockState: () => false,
      shouldSendLocalHandRaised: () => false,
      onRemoteStream: vi.fn()
    })

    peers.set('peer-2', peerConn)
    const fakePc = pc as unknown as FakePeerConnection

    peerConn.disconnectTimer = setTimeout(() => undefined, 500)
    peerConn.reconnectTimer = setTimeout(() => undefined, 500)
    peerConn.iceRestartAttempts = 2
    peerConn.iceRestartInProgress = true

    fakePc.iceConnectionState = 'connected'
    fakePc.oniceconnectionstatechange?.()
    expect(peerConn.disconnectTimer).toBeNull()
    expect(peerConn.reconnectTimer).toBeNull()
    expect(peerConn.iceRestartAttempts).toBe(0)
    expect(peerConn.iceRestartInProgress).toBe(false)

    fakePc.iceConnectionState = 'failed'
    fakePc.oniceconnectionstatechange?.()
    expect(onAttemptIceRestart).toHaveBeenCalledWith('peer-2')

    fakePc.iceConnectionState = 'disconnected'
    fakePc.oniceconnectionstatechange?.()
    expect(peerConn.disconnectTimer).not.toBeNull()
    vi.advanceTimersByTime(120)
    expect(onAttemptIceRestart).toHaveBeenCalledTimes(2)

    fakePc.connectionState = 'connected'
    fakePc.onconnectionstatechange?.()
    vi.advanceTimersByTime(1000)
    expect(onSendLocalMuteStatus).toHaveBeenCalledWith('peer-2')
    expect(onSendRoomLockState).not.toHaveBeenCalled()
    expect(onSendLocalHandRaised).not.toHaveBeenCalled()

    fakePc.connectionState = 'failed'
    fakePc.onconnectionstatechange?.()
    expect(onCleanupPeer).toHaveBeenCalledWith('peer-2')

    peerConn.isConnected = false
    fakePc.connectionState = 'closed'
    fakePc.onconnectionstatechange?.()
    expect(removePeer).toHaveBeenCalledWith('peer-2')
  })

  it('handles remote track events with provided streams and fallback MediaStream creation', () => {
    const peers = new Map<string, PeerConnectionState>()
    const onRemoteStream = vi.fn()
    const remoteTrack = { kind: 'audio', id: 'track-1' } as unknown as MediaStreamTrack

    const { pc, peerConn } = createPeerConnectionLifecycle({
      peerId: 'peer-3',
      userName: 'Carol',
      platform: 'linux',
      isInitiator: false,
      localStream: null,
      iceServers: [],
      disconnectGracePeriodMs: 100,
      getPeer: (id) => peers.get(id),
      removePeer: (id) => {
        peers.delete(id)
      },
      applyAudioRoutingToPeer: vi.fn(),
      setupDataChannel: vi.fn(),
      onSendIceCandidate: vi.fn(),
      onAttemptIceRestart: vi.fn(),
      onCleanupPeer: vi.fn(),
      onStopAnnounceInterval: vi.fn(),
      onPeerJoin: vi.fn(),
      onSendLocalMuteStatus: vi.fn(),
      onSendRoomLockState: vi.fn(),
      onSendLocalHandRaised: vi.fn(),
      onRemoteStream
    })

    peers.set('peer-3', peerConn)
    const fakePc = pc as unknown as FakePeerConnection

    const explicitStream = new FakeMediaStream([remoteTrack]) as unknown as MediaStream
    fakePc.ontrack?.({ track: remoteTrack, streams: [explicitStream] })
    expect(onRemoteStream).toHaveBeenLastCalledWith('peer-3', explicitStream)
    expect(peerConn.stream).toBe(explicitStream)

    fakePc.ontrack?.({ track: remoteTrack, streams: [] })
    expect(onRemoteStream).toHaveBeenCalledTimes(2)
    const fallbackStream = onRemoteStream.mock.calls[1][1] as FakeMediaStream
    expect(fallbackStream.getTracks()).toEqual([remoteTrack])
    expect(peerConn.stream).toBe(fallbackStream)
  })

  it('cleans lifecycle resources and returns null when peer does not exist', () => {
    const missing = cleanupPeerLifecycleResources({
      peerId: 'missing-peer',
      peers: new Map(),
      pendingCandidates: new Map(),
      previousStats: new Map(),
      peerLastSeen: new Map(),
      peerLastPing: new Map()
    })
    expect(missing).toBeNull()

    const chatDataChannel = { close: vi.fn(() => { throw new Error('chat-close') }) }
    const controlDataChannel = { close: vi.fn(() => { throw new Error('control-close') }) }
    const peer = {
      pc: { close: vi.fn(() => { throw new Error('pc-close') }) },
      stream: null,
      userName: 'Dave',
      platform: 'win',
      connectionStartTime: 0,
      isConnected: true,
      muteStatus: { micMuted: false, speakerMuted: false },
      iceRestartAttempts: 0,
      iceRestartInProgress: false,
      disconnectTimer: setTimeout(() => undefined, 500),
      reconnectTimer: setTimeout(() => undefined, 500),
      chatDataChannel,
      controlDataChannel
    } as unknown as PeerConnectionState

    const peers = new Map([['peer-4', peer]])
    const pendingCandidates = new Map([['peer-4', [{ candidate: 'candidate-1' }]]])
    const previousStats = new Map([['peer-4', { packetsLost: 1 }]])
    const peerLastSeen = new Map([['peer-4', Date.now()]])
    const peerLastPing = new Map([['peer-4', Date.now()]])

    const cleaned = cleanupPeerLifecycleResources({
      peerId: 'peer-4',
      peers,
      pendingCandidates,
      previousStats,
      peerLastSeen,
      peerLastPing
    })

    expect(cleaned).toBe(peer)
    expect(chatDataChannel.close).toHaveBeenCalledTimes(1)
    expect(controlDataChannel.close).toHaveBeenCalledTimes(1)
    expect(peers.has('peer-4')).toBe(false)
    expect(pendingCandidates.has('peer-4')).toBe(false)
    expect(previousStats.has('peer-4')).toBe(false)
    expect(peerLastSeen.has('peer-4')).toBe(false)
    expect(peerLastPing.has('peer-4')).toBe(false)
  })
})
