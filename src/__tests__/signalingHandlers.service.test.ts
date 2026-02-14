import { describe, expect, it, vi } from 'vitest'
import { handleAnnounceSignal } from '../renderer/signaling/services/signalingHandlers'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  PeerLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

function createBaseOptions(overrides: Partial<Parameters<typeof handleAnnounceSignal>[0]> = {}) {
  return {
    peerId: 'peer-a',
    userName: 'Peer A',
    platform: 'win' as const,
    selfId: 'self-z',
    roomLocked: false,
    roomLockOwnerPeerId: null,
    localUserName: 'Local',
    localPlatform: 'win' as const,
    getPeer: vi.fn(),
    removePeer: vi.fn(),
    createOffer: vi.fn().mockResolvedValue(undefined),
    sendRoomLockedNotice: vi.fn(),
    sendAnnounceReply: vi.fn(),
    now: () => 123,
    ...overrides
  }
}

describe('signalingHandlers.handleAnnounceSignal', () => {
  it('recreates connection when existing peer is stuck in new state beyond threshold', async () => {
    const close = vi.fn()
    const existingPeer = {
      pc: { connectionState: 'new' as const, close },
      isConnected: false,
      iceRestartInProgress: false,
      connectionStartTime: 0
    }

    const options = createBaseOptions({
      getPeer: vi.fn(() => existingPeer),
      selfId: 'zzzz',
      now: () => 20000,
      newConnectionStaleMs: 5000
    })

    await handleAnnounceSignal(options)

    expect(close).toHaveBeenCalledTimes(1)
    expect(options.removePeer).toHaveBeenCalledWith('peer-a')
    expect(options.createOffer).toHaveBeenCalledWith('peer-a', 'Peer A', 'win')
  })

  it('keeps recent new peer connections and ignores duplicate announce', async () => {
    const close = vi.fn()
    const existingPeer = {
      pc: { connectionState: 'new' as const, close },
      isConnected: false,
      iceRestartInProgress: false,
      connectionStartTime: 10000
    }

    const options = createBaseOptions({
      getPeer: vi.fn(() => existingPeer),
      selfId: 'zzzz',
      now: () => 12000,
      newConnectionStaleMs: 5000
    })

    await handleAnnounceSignal(options)

    expect(close).not.toHaveBeenCalled()
    expect(options.removePeer).not.toHaveBeenCalled()
    expect(options.createOffer).not.toHaveBeenCalled()
  })

  it('keeps active connecting peers and ignores duplicate announce', async () => {
    const close = vi.fn()
    const existingPeer = {
      pc: { connectionState: 'connecting' as const, close },
      isConnected: false,
      iceRestartInProgress: false
    }

    const options = createBaseOptions({
      getPeer: vi.fn(() => existingPeer),
      selfId: 'zzzz'
    })

    await handleAnnounceSignal(options)

    expect(close).not.toHaveBeenCalled()
    expect(options.removePeer).not.toHaveBeenCalled()
    expect(options.createOffer).not.toHaveBeenCalled()
  })
})
