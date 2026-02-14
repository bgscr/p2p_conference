import { beforeEach, describe, expect, it, vi } from 'vitest'

const lifecycleMocks = vi.hoisted(() => ({
  createPeerConnectionLifecycle: vi.fn()
}))

vi.mock('../renderer/signaling/services/peerLifecycle', () => ({
  createPeerConnectionLifecycle: lifecycleMocks.createPeerConnectionLifecycle
}))

import {
  buildPeerConnectionLifecycleOptions,
  createPeerConnectionForRuntime,
  createPeerConnectionWithAdapter
} from '../renderer/signaling/services/peerConnectionOrchestration'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  PeerLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

describe('peerConnectionOrchestration service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    lifecycleMocks.createPeerConnectionLifecycle.mockReset()
  })

  it('builds lifecycle callbacks that map runtime state and signaling payloads', () => {
    const sendToPeer = vi.fn()
    const sendControlMessage = vi.fn()
    const peers = new Map<string, any>()

    const lifecycleOptions = buildPeerConnectionLifecycleOptions({
      peerId: 'peer-a',
      userName: 'Alice',
      platform: 'win',
      isInitiator: true,
      localStream: { id: 'local-stream' } as unknown as MediaStream,
      iceServers: [{ urls: 'stun:example.org' }],
      disconnectGracePeriodMs: 2500,
      peers,
      applyAudioRoutingToPeer: vi.fn(),
      setupDataChannel: vi.fn(),
      sendToPeer,
      sendControlMessage,
      attemptIceRestart: vi.fn(),
      cleanupPeer: vi.fn(),
      stopAnnounceInterval: vi.fn(),
      onPeerJoin: vi.fn(),
      onRemoteStream: vi.fn(),
      getLocalMuteStatus: () => ({ micMuted: true, speakerMuted: false }),
      isRoomLocked: () => true,
      getRoomLockOwnerPeerId: () => null,
      isLocalHandRaised: () => true,
      selfId: 'self-1',
      now: () => 1234
    })

    lifecycleOptions.onSendIceCandidate('peer-a', { candidate: 'candidate-1' })
    lifecycleOptions.onSendLocalMuteStatus('peer-a')
    lifecycleOptions.onSendRoomLockState('peer-a')
    lifecycleOptions.onSendLocalHandRaised('peer-a')

    expect(sendToPeer).toHaveBeenNthCalledWith(1, 'peer-a', {
      v: 1,
      type: 'ice-candidate',
      from: 'self-1',
      data: { candidate: 'candidate-1' }
    })
    expect(sendToPeer).toHaveBeenNthCalledWith(2, 'peer-a', {
      v: 1,
      type: 'mute-status',
      from: 'self-1',
      data: { micMuted: true, speakerMuted: false }
    })
    expect(sendToPeer).toHaveBeenNthCalledWith(3, 'peer-a', {
      v: 1,
      type: 'room-lock',
      from: 'self-1',
      data: {
        type: 'mod_room_lock',
        locked: true,
        lockedByPeerId: 'self-1',
        ts: 1234
      }
    })
    expect(sendControlMessage).toHaveBeenCalledWith('peer-a', {
      type: 'mod_hand_raise',
      peerId: 'self-1',
      raised: true,
      ts: 1234
    })
    expect(lifecycleOptions.shouldSendRoomLockState?.()).toBe(true)
    expect(lifecycleOptions.shouldSendLocalHandRaised?.()).toBe(true)
  })

  it('stores created peer state and returns the created RTCPeerConnection', () => {
    const fakePc = { id: 'pc-1' } as unknown as RTCPeerConnection
    const fakePeerConn = { userName: 'Alice' }
    lifecycleMocks.createPeerConnectionLifecycle.mockReturnValue({
      pc: fakePc,
      peerConn: fakePeerConn
    })

    const peers = new Map<string, any>()
    const result = createPeerConnectionForRuntime({
      peerId: 'peer-a',
      userName: 'Alice',
      platform: 'mac',
      isInitiator: false,
      localStream: null,
      iceServers: [{ urls: 'stun:example.org' }],
      disconnectGracePeriodMs: 2000,
      peers,
      applyAudioRoutingToPeer: vi.fn(),
      setupDataChannel: vi.fn(),
      sendToPeer: vi.fn(),
      sendControlMessage: vi.fn(),
      attemptIceRestart: vi.fn(),
      cleanupPeer: vi.fn(),
      stopAnnounceInterval: vi.fn(),
      onPeerJoin: vi.fn(),
      onRemoteStream: vi.fn(),
      getLocalMuteStatus: () => ({ micMuted: false, speakerMuted: false }),
      isRoomLocked: () => false,
      getRoomLockOwnerPeerId: () => null,
      isLocalHandRaised: () => false,
      selfId: 'self-1'
    })

    expect(result).toBe(fakePc)
    expect(peers.get('peer-a')).toBe(fakePeerConn)
    expect(lifecycleMocks.createPeerConnectionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: 'peer-a',
        userName: 'Alice',
        platform: 'mac',
        isInitiator: false
      })
    )
  })

  it('adapts runtime adapter shape for createPeerConnectionWithAdapter', () => {
    const fakePc = { id: 'pc-2' } as unknown as RTCPeerConnection
    const fakePeerConn = { userName: 'Bob' }
    lifecycleMocks.createPeerConnectionLifecycle.mockReturnValue({
      pc: fakePc,
      peerConn: fakePeerConn
    })

    const sendToPeer = vi.fn()
    const adapter = {
      localStream: null,
      peers: new Map<string, any>(),
      localMuteStatus: { micMuted: false, speakerMuted: true },
      roomLocked: false,
      roomLockOwnerPeerId: null,
      localHandRaised: false,
      applyAudioRoutingToPeer: vi.fn(),
      setupDataChannel: vi.fn(),
      sendToPeer,
      sendControlMessage: vi.fn(),
      attemptIceRestart: vi.fn(),
      cleanupPeer: vi.fn(),
      stopAnnounceInterval: vi.fn(),
      onPeerJoin: vi.fn(),
      onRemoteStream: vi.fn()
    }

    const created = createPeerConnectionWithAdapter({
      adapter: adapter as any,
      peerId: 'peer-b',
      userName: 'Bob',
      platform: 'linux',
      selfId: 'self-2',
      iceServers: [{ urls: 'stun:example.org' }],
      disconnectGracePeriodMs: 3000
    })

    expect(created).toBe(fakePc)
    expect(adapter.peers.get('peer-b')).toBe(fakePeerConn)
    expect(lifecycleMocks.createPeerConnectionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: 'peer-b',
        isInitiator: false,
        localStream: null
      })
    )

    const lifecycleOptions = lifecycleMocks.createPeerConnectionLifecycle.mock.calls[0][0]
    lifecycleOptions.onSendLocalMuteStatus('peer-b')
    expect(sendToPeer).toHaveBeenCalledWith('peer-b', {
      v: 1,
      type: 'mute-status',
      from: 'self-2',
      data: { micMuted: false, speakerMuted: true }
    })
  })
})
