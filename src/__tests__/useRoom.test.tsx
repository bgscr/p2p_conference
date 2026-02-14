/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  selfId: 'mock-self-id'
}))

vi.mock('../renderer/utils/Logger', () => ({
  RoomLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

describe('useRoom Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    peerEventListeners.peerJoin.clear()
    peerEventListeners.peerLeave.clear()
    peerEventListeners.peerMuteChange.clear()
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useRoom())

    expect(result.current.roomId).toBeNull()
    expect(result.current.peers.size).toBe(0)
    expect(result.current.connectionState).toBe('idle')
    expect(result.current.error).toBeNull()
    expect(result.current.localPeerId).toBe('mock-self-id')
  })

  describe('joinRoom', () => {
    it('should join room successfully', async () => {
      const { result } = renderHook(() => useRoom())

      await act(async () => {
        await result.current.joinRoom('test-room', 'Alice')
      })

      expect(result.current.roomId).toBe('test-room')
      expect(result.current.connectionState).toBe('signaling')
      expect(result.current.error).toBeNull()
      expect(peerManager.joinRoom).toHaveBeenCalledWith('test-room', 'Alice')
    })

    it('should validate room ID', async () => {
      const { result } = renderHook(() => useRoom())

      await act(async () => {
        await result.current.joinRoom('abc', 'Alice')
      })

      expect(result.current.roomId).toBeNull()
      expect(result.current.error).toContain('Invalid room ID')
      expect(peerManager.joinRoom).not.toHaveBeenCalled()
    })

    it('should handle join errors', async () => {
      const error = new Error('Join failed')
      vi.mocked(peerManager.joinRoom).mockRejectedValueOnce(error)

      const { result } = renderHook(() => useRoom())

      await act(async () => {
        await result.current.joinRoom('test-room', 'Alice')
      })

      expect(result.current.error).toContain('Failed to join room')
      expect(result.current.connectionState).toBe('failed')
    })
  })

  describe('leaveRoom', () => {
    it('should leave room and reset state', async () => {
      const { result } = renderHook(() => useRoom())

      await act(async () => {
        await result.current.joinRoom('test-room', 'Alice')
      })

      act(() => {
        result.current.leaveRoom()
      })

      expect(result.current.roomId).toBeNull()
      expect(result.current.peers.size).toBe(0)
      expect(result.current.connectionState).toBe('idle')
      expect(peerManager.leaveRoom).toHaveBeenCalled()
    })
  })

  describe('Peer Events', () => {
    it('should subscribe to peer events', () => {
      renderHook(() => useRoom())

      expect(peerManager.on).toHaveBeenCalledWith('peerJoin', expect.any(Function))
      expect(peerManager.on).toHaveBeenCalledWith('peerLeave', expect.any(Function))
      expect(peerManager.on).toHaveBeenCalledWith('peerMuteChange', expect.any(Function))
    })

    it('should handle peer join', () => {
      const { result } = renderHook(() => useRoom())

      act(() => {
        emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
      })

      expect(result.current.peers.get('peer-1')).toEqual({
        id: 'peer-1',
        name: 'Bob',
        isMuted: false,
        isSpeakerMuted: false,
        audioLevel: 0,
        connectionState: 'connected',
        platform: 'win'
      })
      expect(result.current.connectionState).toBe('connected')
    })

    it('should handle peer leave', () => {
      const { result } = renderHook(() => useRoom())

      act(() => {
        emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
      })
      expect(result.current.peers.size).toBe(1)

      act(() => {
        emitPeerLeave({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
      })

      expect(result.current.peers.size).toBe(0)
    })

    it('should handle peer mute change', () => {
      const { result } = renderHook(() => useRoom())

      act(() => {
        emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
      })

      expect(result.current.peers.get('peer-1')?.isMuted).toBe(false)

      act(() => {
        emitPeerMuteChange({ peerId: 'peer-1', muteStatus: { micMuted: true, speakerMuted: false } })
      })

      expect(result.current.peers.get('peer-1')?.isMuted).toBe(true)

      act(() => {
        emitPeerMuteChange({ peerId: 'peer-1', muteStatus: { micMuted: false, speakerMuted: false } })
      })

      expect(result.current.peers.get('peer-1')?.isMuted).toBe(false)

      act(() => {
        emitPeerMuteChange({ peerId: 'peer-1', muteStatus: { micMuted: false, speakerMuted: true } })
      })

      expect(result.current.peers.get('peer-1')?.isSpeakerMuted).toBe(true)
    })

    it('should handle peer video mute change', () => {
      const { result } = renderHook(() => useRoom())

      act(() => {
        emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
      })

      expect(result.current.peers.get('peer-1')?.isVideoMuted).toBeUndefined()

      act(() => {
        emitPeerMuteChange({
          peerId: 'peer-1',
          muteStatus: { micMuted: false, speakerMuted: false, videoMuted: true }
        })
      })

      expect(result.current.peers.get('peer-1')?.isVideoMuted).toBe(true)

      act(() => {
        emitPeerMuteChange({
          peerId: 'peer-1',
          muteStatus: { micMuted: false, speakerMuted: false, videoMuted: false }
        })
      })

      expect(result.current.peers.get('peer-1')?.isVideoMuted).toBe(false)
    })

    it('should preserve video mute state when only mic/speaker changes', () => {
      const { result } = renderHook(() => useRoom())

      act(() => {
        emitPeerJoin({ peerId: 'peer-1', userName: 'Bob', platform: 'win' })
      })

      act(() => {
        emitPeerMuteChange({
          peerId: 'peer-1',
          muteStatus: { micMuted: false, speakerMuted: false, videoMuted: true }
        })
      })

      expect(result.current.peers.get('peer-1')?.isVideoMuted).toBe(true)

      act(() => {
        emitPeerMuteChange({
          peerId: 'peer-1',
          muteStatus: { micMuted: true, speakerMuted: false }
        })
      })

      expect(result.current.peers.get('peer-1')?.isVideoMuted).toBe(true)
      expect(result.current.peers.get('peer-1')?.isMuted).toBe(true)
    })
  })
})
