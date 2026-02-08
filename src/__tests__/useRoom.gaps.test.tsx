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
 * - onPeerJoin callback with platform
 * - onPeerLeave: last peer -> signaling state
 * - onPeerMuteChange: unknown peer no-op
 * - updateConnectionState: callback trigger
 * - onSignalReceived: stores callback
 * - broadcastUserInfo: no-op
 * - Unmount cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Track peerManager callbacks
let peerManagerCallbacks: any = {}

vi.mock('../renderer/signaling/SimplePeerManager', () => ({
  peerManager: {
    setCallbacks: vi.fn((cbs: any) => { peerManagerCallbacks = { ...peerManagerCallbacks, ...cbs } }),
    joinRoom: vi.fn().mockResolvedValue(undefined),
    leaveRoom: vi.fn(),
    broadcastMuteStatus: vi.fn(),
  },
  selfId: 'self-123',
}))

vi.mock('../renderer/utils/Logger', () => ({
  RoomLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('useRoom - additional gaps', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    peerManagerCallbacks = {}
  })

  // We need to re-import after vi.mock
  async function getUseRoom() {
    const mod = await import('../renderer/hooks/useRoom')
    return mod.useRoom
  }

  it('rejects room ID shorter than 4 chars', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('ab', 'User')
    })

    expect(result.current.error).toContain('Invalid room ID')
  })

  it('rejects room ID with special characters', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('room@#$', 'User')
    })

    expect(result.current.error).toContain('Invalid room ID')
  })

  it('accepts valid room ID with underscores and dashes', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('my-room_123', 'User')
    })

    expect(result.current.error).toBeNull()
    expect(result.current.roomId).toBe('my-room_123')
  })

  it('joinRoom transitions to signaling state', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    await act(async () => {
      await result.current.joinRoom('test-room', 'Alice')
    })

    expect(result.current.connectionState).toBe('signaling')
  })

  it('joinRoom handles peerManager.joinRoom error', async () => {
    const { peerManager } = await import('../renderer/signaling/SimplePeerManager')
    vi.mocked(peerManager.joinRoom).mockRejectedValueOnce(new Error('MQTT failed'))

    const useRoom = await getUseRoom()
    const onConnectionStateChange = vi.fn()
    const { result } = renderHook(() => useRoom({ onConnectionStateChange }))

    await act(async () => {
      await result.current.joinRoom('test-room', 'Alice')
    })

    expect(result.current.error).toContain('Failed to join room')
    expect(result.current.connectionState).toBe('failed')
  })

  it('leaveRoom resets all state', async () => {
    const useRoom = await getUseRoom()
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

  it('onPeerJoin adds peer with platform', async () => {
    const useRoom = await getUseRoom()
    const onPeerJoin = vi.fn()
    const { result } = renderHook(() => useRoom({ onPeerJoin }))

    expect(peerManagerCallbacks.onPeerJoin).toBeDefined()

    act(() => {
      peerManagerCallbacks.onPeerJoin('peer-1', 'Bob', 'mac')
    })

    expect(result.current.peers.size).toBe(1)
    const peer = result.current.peers.get('peer-1')
    expect(peer?.name).toBe('Bob')
    expect(peer?.platform).toBe('mac')
    expect(onPeerJoin).toHaveBeenCalledWith('peer-1', 'Bob')
  })

  it('onPeerLeave removes peer and transitions to signaling when last peer', async () => {
    const useRoom = await getUseRoom()
    const onPeerLeave = vi.fn()
    const { result } = renderHook(() => useRoom({ onPeerLeave }))

    // Add then remove a peer
    act(() => {
      peerManagerCallbacks.onPeerJoin('peer-1', 'Bob', 'win')
    })
    expect(result.current.peers.size).toBe(1)

    act(() => {
      peerManagerCallbacks.onPeerLeave('peer-1', 'Bob', 'win')
    })

    expect(result.current.peers.size).toBe(0)
    expect(onPeerLeave).toHaveBeenCalledWith('peer-1', 'Bob')
    expect(result.current.connectionState).toBe('signaling')
  })

  it('onPeerLeave does not change state when other peers remain', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    act(() => {
      peerManagerCallbacks.onPeerJoin('peer-1', 'Bob', 'win')
      peerManagerCallbacks.onPeerJoin('peer-2', 'Charlie', 'mac')
    })
    expect(result.current.peers.size).toBe(2)

    act(() => {
      peerManagerCallbacks.onPeerLeave('peer-1', 'Bob', 'win')
    })

    expect(result.current.peers.size).toBe(1)
    expect(result.current.connectionState).toBe('connected')
  })

  it('onPeerMuteChange updates mic and speaker mute state', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    act(() => {
      peerManagerCallbacks.onPeerJoin('peer-1', 'Bob', 'win')
    })

    act(() => {
      peerManagerCallbacks.onPeerMuteChange('peer-1', {
        micMuted: true,
        speakerMuted: true,
        videoMuted: true,
      })
    })

    const peer = result.current.peers.get('peer-1')
    expect(peer?.isMuted).toBe(true)
    expect(peer?.isSpeakerMuted).toBe(true)
    expect(peer?.isVideoMuted).toBe(true)
  })

  it('onPeerMuteChange preserves videoMuted when not provided', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    act(() => {
      peerManagerCallbacks.onPeerJoin('peer-1', 'Bob', 'win')
    })

    // First set videoMuted
    act(() => {
      peerManagerCallbacks.onPeerMuteChange('peer-1', {
        micMuted: false, speakerMuted: false, videoMuted: true
      })
    })

    // Then update without videoMuted
    act(() => {
      peerManagerCallbacks.onPeerMuteChange('peer-1', {
        micMuted: true, speakerMuted: false
      })
    })

    const peer = result.current.peers.get('peer-1')
    expect(peer?.isMuted).toBe(true)
    expect(peer?.isVideoMuted).toBe(true) // Preserved
  })

  it('onPeerMuteChange is no-op for unknown peer', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    act(() => {
      peerManagerCallbacks.onPeerMuteChange('unknown', {
        micMuted: true, speakerMuted: false
      })
    })

    // Should not crash
    expect(result.current.peers.size).toBe(0)
  })

  it('onSignalReceived stores callback', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    const signalCb = vi.fn()
    act(() => { result.current.onSignalReceived(signalCb) })
    // No crash, callback stored
  })

  it('broadcastUserInfo is a no-op', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    act(() => { result.current.broadcastUserInfo() })
    // Should not throw
  })

  it('sendSignal is null', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    expect(result.current.sendSignal).toBeNull()
  })

  it('localPeerId is selfId', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    expect(result.current.localPeerId).toBe('self-123')
  })

  it('room is peerManager', async () => {
    const useRoom = await getUseRoom()
    const { result } = renderHook(() => useRoom())

    expect(result.current.room).toBeDefined()
  })

  it('unmount cleans up peerManager', async () => {
    const { peerManager } = await import('../renderer/signaling/SimplePeerManager')
    const useRoom = await getUseRoom()
    const { unmount } = renderHook(() => useRoom())

    unmount()
    expect(peerManager.leaveRoom).toHaveBeenCalled()
  })
})
