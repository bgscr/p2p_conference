import { describe, expect, it, vi } from 'vitest'
import {
  handlePostPeerCleanup,
  runPeerCleanupFlowWithAdapter
} from '../renderer/signaling/services/peerCleanupOrchestration'
import type { PeerConnectionState } from '../renderer/signaling/services/peerLifecycle'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  PeerLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

function createPeer() {
  const chatDataChannel = { close: vi.fn() } as unknown as RTCDataChannel
  const controlDataChannel = { close: vi.fn() } as unknown as RTCDataChannel
  return {
    pc: { close: vi.fn() } as unknown as RTCPeerConnection,
    stream: null,
    userName: 'Bob',
    platform: 'win' as const,
    connectionStartTime: 0,
    isConnected: true,
    muteStatus: { micMuted: false, speakerMuted: false },
    iceRestartAttempts: 0,
    iceRestartInProgress: false,
    disconnectTimer: 1 as unknown as NodeJS.Timeout,
    reconnectTimer: 2 as unknown as NodeJS.Timeout,
    chatDataChannel,
    controlDataChannel
  } as unknown as PeerConnectionState
}

describe('peerCleanupOrchestration service', () => {
  it('handles post cleanup callbacks and restarts discovery when no healthy peers remain', () => {
    const onRemoteMicPeerDisconnect = vi.fn()
    const onModerationPeerDisconnect = vi.fn()
    const onPeerLeave = vi.fn()
    const onRestartPeerDiscovery = vi.fn()

    handlePostPeerCleanup({
      peerId: 'peer-1',
      peer: { userName: 'Bob', platform: 'win' },
      roomId: 'room-1',
      onRemoteMicPeerDisconnect,
      onModerationPeerDisconnect,
      onPeerLeave,
      getHealthyPeerCount: () => 0,
      onRestartPeerDiscovery
    })

    expect(onRemoteMicPeerDisconnect).toHaveBeenCalledWith('peer-1')
    expect(onModerationPeerDisconnect).toHaveBeenCalledWith('peer-1')
    expect(onPeerLeave).toHaveBeenCalledWith('peer-1', 'Bob', 'win')
    expect(onRestartPeerDiscovery).toHaveBeenCalledTimes(1)
  })

  it('cleans up peer lifecycle resources and dispatches adapter callbacks', () => {
    const peer = createPeer()
    const chatClose = peer.chatDataChannel?.close as ReturnType<typeof vi.fn>
    const controlClose = peer.controlDataChannel?.close as ReturnType<typeof vi.fn>
    const onRemoteMicPeerDisconnect = vi.fn()
    const onModerationPeerDisconnect = vi.fn()
    const onPeerLeave = vi.fn()
    const onRestartPeerDiscovery = vi.fn()

    const adapter = {
      peers: new Map([['peer-1', peer]]),
      pendingCandidates: new Map([['peer-1', [{ candidate: 'candidate:1 1 udp 1 0.0.0.0 9 typ host' }]]]),
      previousStats: new Map([['peer-1', { packetsLost: 3 }]]),
      peerLastSeen: new Map([['peer-1', Date.now()]]),
      peerLastPing: new Map([['peer-1', Date.now()]]),
      roomId: 'room-1',
      onRemoteMicPeerDisconnect,
      onModerationPeerDisconnect,
      onPeerLeave,
      getHealthyPeerCount: vi.fn().mockReturnValue(0),
      onRestartPeerDiscovery
    }

    const result = runPeerCleanupFlowWithAdapter({
      peerId: 'peer-1',
      adapter: adapter as any
    })

    expect(result).toBe(true)
    expect(chatClose).toHaveBeenCalledTimes(1)
    expect(controlClose).toHaveBeenCalledTimes(1)
    expect((peer.pc.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
    expect(adapter.peers.has('peer-1')).toBe(false)
    expect(adapter.pendingCandidates.has('peer-1')).toBe(false)
    expect(adapter.previousStats.has('peer-1')).toBe(false)
    expect(adapter.peerLastSeen.has('peer-1')).toBe(false)
    expect(adapter.peerLastPing.has('peer-1')).toBe(false)
    expect(onRemoteMicPeerDisconnect).toHaveBeenCalledWith('peer-1')
    expect(onModerationPeerDisconnect).toHaveBeenCalledWith('peer-1')
    expect(onPeerLeave).toHaveBeenCalledWith('peer-1', 'Bob', 'win')
    expect(onRestartPeerDiscovery).toHaveBeenCalledTimes(1)
  })

  it('returns false when peer does not exist and skips callback side effects', () => {
    const onRemoteMicPeerDisconnect = vi.fn()
    const onModerationPeerDisconnect = vi.fn()
    const onPeerLeave = vi.fn()
    const onRestartPeerDiscovery = vi.fn()

    const result = runPeerCleanupFlowWithAdapter({
      peerId: 'missing-peer',
      adapter: {
        peers: new Map(),
        pendingCandidates: new Map(),
        previousStats: new Map(),
        peerLastSeen: new Map(),
        peerLastPing: new Map(),
        roomId: 'room-1',
        onRemoteMicPeerDisconnect,
        onModerationPeerDisconnect,
        onPeerLeave,
        getHealthyPeerCount: () => 1,
        onRestartPeerDiscovery
      } as any
    })

    expect(result).toBe(false)
    expect(onRemoteMicPeerDisconnect).not.toHaveBeenCalled()
    expect(onModerationPeerDisconnect).not.toHaveBeenCalled()
    expect(onPeerLeave).not.toHaveBeenCalled()
    expect(onRestartPeerDiscovery).not.toHaveBeenCalled()
  })
})
