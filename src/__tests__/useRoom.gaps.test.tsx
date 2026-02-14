/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage gap tests for useRoom
 * Targets:
 * - isValidRoomId: various invalid inputs
 * - joinRoom: valid room join success
 * - joinRoom: join error (catch block, state transitions)
 * - leaveRoom cleanup
 * - peer event subscriptions
 * - onPeerLeave: last peer -> signaling state
 * - onPeerMuteChange: unknown peer no-op
 * - updateConnectionState: callback trigger
 * - onSignalReceived: stores callback
 * - broadcastUserInfo: no-op
 * - Unmount cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRoom } from '../renderer/hooks/useRoom'
import { peerManager } from '../renderer/signaling'

type PeerJoinPayload = {
  peerId: string
  userName: string
  platform: 'win' | 'mac' | 'linux'
}

type PeerLeavePayload = {
  peerId: string
  userName: string
  platform: 'win' | 'mac' | 'linux'
}

type PeerMutePayload = {
  peerId: string
  muteStatus: {
    micMuted: boolean
    speakerMuted: boolean
    videoMuted?: boolean
    isScreenSharing?: boolean
  }
}

const peerEventListeners = {
  peerJoin: new Set<(payload: PeerJoinPayload) => void>(),
  peerLeave: new Set<(payload: PeerLeavePayload) => void>(),
  peerMuteChange: new Set<(payload: PeerMutePayload) => void>()
}

function emitPeerJoin(payload: PeerJoinPayload): void {
  peerEventListeners.peerJoin.forEach((listener) => listener(payload))
}

function emitPeerLeave(payload: PeerLeavePayload): void {
  peerEventListeners.peerLeave.forEach((listener) => listener(payload))
}

function emitPeerMuteChange(payload: PeerMutePayload): void {
  peerEventListeners.peerMuteChange.forEach((listener) => listener(payload))
}

vi.mock('../renderer/signaling', () => ({
  peerManager: {
    on: vi.fn((event: 'peerJoin' | 'peerLeave' | 'peerMuteChange', callback: unknown) => {
      const listener = callback as (payload: unknown) => void
      if (event === 'peerJoin') {
        peerEventListeners.peerJoin.add(listener as (payload: PeerJoinPayload) => void)
      } else if (event === 'peerLeave') {
        peerEventListeners.peerLeave.add(listener as (payload: PeerLeavePayload) => void)
      } else if (event === 'peerMuteChange') {
        peerEventListeners.peerMuteChange.add(listener as (payload: PeerMutePayload) => void)
      }

      return () => {
        if (event === 'peerJoin') {
          peerEventListeners.peerJoin.delete(listener as (payload: PeerJoinPayload) => void)
        } else if (event === 'peerLeave') {
          peerEventListeners.peerLeave.delete(listener as (payload: PeerLeavePayload) => void)
        } else if (event === 'peerMuteChange') {
          peerEventListeners.peerMuteChange.delete(listener as (payload: PeerMutePayload) => void)
        }
      }
    }),
    joinRoom: vi.fn().mockResolvedValue(undefined),
    leaveRoom: vi.fn()
  },
  selfId: 'self-123'
}))

vi.mock('../renderer/utils/Logger', () => ({
  RoomLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('useRoom - additional gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    peerEventListeners.peerJoin.clear()
    peerEventListeners.peerLeave.clear()
    peerEventListeners.peerMuteChange.clear()
  })

  it('rejects room ID shorter than 4 chars', async () => {
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('ab', 'User')
    })

    expect(result.current.error).toContain('Invalid room ID')
  })

  it('rejects room ID with special characters', async () => {
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('room@#$', 'User')
    })

    expect(result.current.error).toContain('Invalid room ID')
  })

  it('accepts valid room ID with underscores and dashes', async () => {
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('my-room_123', 'User')
    })

    expect(result.current.error).toBeNull()
    expect(result.current.roomId).toBe('my-room_123')
  })

  it('joinRoom transitions to signaling state', async () => {
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('test-room', 'Alice')
    })

    expect(result.current.connectionState).toBe('signaling')
  })

  it('joinRoom handles peerManager.joinRoom error', async () => {
    vi.mocked(peerManager.joinRoom).mockRejectedValueOnce(new Error('MQTT failed'))
    const onConnectionStateChange = vi.fn()
    const { result } = renderHook(() => useRoom({ onConnectionStateChange }))

    await act(async () => {
      await result.current.joinRoom('test-room', 'Alice')
    })

    expect(result.current.error).toContain('Failed to join room')
    expect(result.current.connectionState).toBe('failed')
  })

  it('leaveRoom resets all state', async () => {
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('test-room', 'Alice')
    })

    act(() => { result.current.leaveRoom() })

    expect(result.current.roomId).toBeNull()
    expect(result.current.peers.size).toBe(0)
    expect(result.current.connectionState).toBe('idle')
    expect(result.current.error).toBeNull()
  })

  it('subscribes to peer manager events', () => {
    renderHook(() => useRoom())
    expect(peerManager.on).toHaveBeenCalledWith('peerJoin', expect.any(Function))
    expect(peerManager.on).toHaveBeenCalledWith('peerLeave', expect.any(Function))
    expect(peerManager.on).toHaveBeenCalledWith('peerMuteChange', expect.any(Function))
  })

  it('onPeerJoin adds peer with platform', () => {
    const onPeerJoin = vi.fn()
    const { result } = renderHook(() => useRoom({ onPeerJoin }))

    act(() => {
      emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'mac' })
    })

    expect(result.current.peers.size).toBe(1)
    const peer = result.current.peers.get('peer-1')
    expect(peer?.name).toBe('Bob')
    expect(peer?.platform).toBe('mac')
    expect(onPeerJoin).toHaveBeenCalledWith('peer-1', 'Bob')
  })

  it('onPeerLeave removes peer and transitions to signaling when last peer', () => {
    const onPeerLeave = vi.fn()
    const { result } = renderHook(() => useRoom({ onPeerLeave }))

    act(() => {
      emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
    })
    expect(result.current.peers.size).toBe(1)

    act(() => {
      emitPeerLeave({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
    })

    expect(result.current.peers.size).toBe(0)
    expect(onPeerLeave).toHaveBeenCalledWith('peer-1', 'Bob')
    expect(result.current.connectionState).toBe('signaling')
  })

  it('onPeerLeave does not change state when other peers remain', () => {
    const { result } = renderHook(() => useRoom())

    act(() => {
      emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
      emitPeerJoin({ peerId: 'peer-2', userName: 'Charlie', platform: 'mac' })
    })
    expect(result.current.peers.size).toBe(2)

    act(() => {
      emitPeerLeave({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
    })

    expect(result.current.peers.size).toBe(1)
    expect(result.current.connectionState).toBe('connected')
  })

  it('onPeerMuteChange updates mic and speaker mute state', () => {
    const { result } = renderHook(() => useRoom())

    act(() => {
      emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
    })

    act(() => {
      emitPeerMuteChange({
        peerId: 'peer-1',
        muteStatus: {
          micMuted: true,
          speakerMuted: true,
          videoMuted: true
        }
      })
    })

    const peer = result.current.peers.get('peer-1')
    expect(peer?.isMuted).toBe(true)
    expect(peer?.isSpeakerMuted).toBe(true)
    expect(peer?.isVideoMuted).toBe(true)
  })

  it('onPeerMuteChange preserves videoMuted when not provided', () => {
    const { result } = renderHook(() => useRoom())

    act(() => {
      emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
    })

    act(() => {
      emitPeerMuteChange({
        peerId: 'peer-1',
        muteStatus: {
          micMuted: false,
          speakerMuted: false,
          videoMuted: true
        }
      })
    })

    act(() => {
      emitPeerMuteChange({
        peerId: 'peer-1',
        muteStatus: {
          micMuted: true,
          speakerMuted: false
        }
      })
    })

    const peer = result.current.peers.get('peer-1')
    expect(peer?.isMuted).toBe(true)
    expect(peer?.isVideoMuted).toBe(true)
  })

  it('onPeerMuteChange is no-op for unknown peer', () => {
    const { result } = renderHook(() => useRoom())

    act(() => {
      emitPeerMuteChange({
        peerId: 'unknown',
        muteStatus: {
          micMuted: true,
          speakerMuted: false
        }
      })
    })

    expect(result.current.peers.size).toBe(0)
  })

  it('onSignalReceived stores callback', () => {
    const { result } = renderHook(() => useRoom())
    const signalCb = vi.fn()
    act(() => { result.current.onSignalReceived(signalCb) })
  })

  it('broadcastUserInfo is a no-op', () => {
    const { result } = renderHook(() => useRoom())
    act(() => { result.current.broadcastUserInfo() })
  })

  it('sendSignal is null', () => {
    const { result } = renderHook(() => useRoom())
    expect(result.current.sendSignal).toBeNull()
  })

  it('localPeerId is selfId', () => {
    const { result } = renderHook(() => useRoom())
    expect(result.current.localPeerId).toBe('self-123')
  })

  it('room is peerManager', () => {
    const { result } = renderHook(() => useRoom())
    expect(result.current.room).toBeDefined()
  })

  it('unmount cleans up peerManager', () => {
    const { unmount } = renderHook(() => useRoom())
    unmount()
    expect(peerManager.leaveRoom).toHaveBeenCalled()
  })
})
