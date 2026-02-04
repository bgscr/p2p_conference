/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRoom } from '../renderer/hooks/useRoom'
import { peerManager } from '../renderer/signaling/SimplePeerManager'

// Mock dependencies
vi.mock('../renderer/signaling/SimplePeerManager', () => ({
    peerManager: {
        setCallbacks: vi.fn((callbacks) => {
            // Store callbacks so they can be triggered by tests
            (global as any).mockCallbacks = callbacks
        }),
        joinRoom: vi.fn().mockResolvedValue(undefined),
        leaveRoom: vi.fn(),
        getHealthyPeerCount: vi.fn().mockReturnValue(0),
        setOnNetworkStatusChange: vi.fn(),
        setOnSignalingStateChange: vi.fn(),
        getNetworkStatus: vi.fn().mockReturnValue({ isOnline: true }),
        getConnectionStats: vi.fn().mockResolvedValue(new Map())
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
                await result.current.joinRoom('abc', 'Alice') // Too short
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

            // Join first
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
        it('should handle peer join', async () => {
            const { result } = renderHook(() => useRoom())

            // Get the callbacks setup function
            const setCallbacks = vi.mocked(peerManager.setCallbacks)
            expect(setCallbacks).toHaveBeenCalled()

            const callbacks = setCallbacks.mock.calls[0][0]

            act(() => {
                if (callbacks.onPeerJoin) {
                    callbacks.onPeerJoin('peer-1', 'Bob', 'win')
                }
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

        it('should handle peer leave', async () => {
            const { result } = renderHook(() => useRoom())
            const callbacks = vi.mocked(peerManager.setCallbacks).mock.calls[0][0]

            // Add peer
            act(() => {
                if (callbacks.onPeerJoin) {
                    callbacks.onPeerJoin('peer-1', 'Bob', 'win')
                }
            })
            expect(result.current.peers.size).toBe(1)

            // Remove peer
            act(() => {
                if (callbacks.onPeerLeave) {
                    callbacks.onPeerLeave('peer-1', 'Bob', 'win')
                }
            })

            expect(result.current.peers.size).toBe(0)
        })

        it('should handle peer mute change', async () => {
            const { result } = renderHook(() => useRoom())
            const callbacks = vi.mocked(peerManager.setCallbacks).mock.calls[0][0]

            // Add peer
            act(() => {
                if (callbacks.onPeerJoin) {
                    callbacks.onPeerJoin('peer-1', 'Bob', 'win')
                }
            })

            // Verify initial state
            expect(result.current.peers.get('peer-1')?.isMuted).toBe(false)

            // Trigger mute change
            act(() => {
                if (callbacks.onPeerMuteChange) {
                    callbacks.onPeerMuteChange('peer-1', { micMuted: true, speakerMuted: false })
                }
            })

            expect(result.current.peers.get('peer-1')?.isMuted).toBe(true)

            // Trigger unmute
            act(() => {
                if (callbacks.onPeerMuteChange) {
                    callbacks.onPeerMuteChange('peer-1', { micMuted: false, speakerMuted: false })
                }
            })

            expect(result.current.peers.get('peer-1')?.isMuted).toBe(false)

            // Trigger speaker mute change
            act(() => {
                if (callbacks.onPeerMuteChange) {
                    callbacks.onPeerMuteChange('peer-1', { micMuted: false, speakerMuted: true })
                }
            })

            expect(result.current.peers.get('peer-1')?.isSpeakerMuted).toBe(true)
        })

        it('should handle peer video mute change', async () => {
            const { result } = renderHook(() => useRoom())
            const callbacks = vi.mocked(peerManager.setCallbacks).mock.calls[0][0]

            // Add peer
            act(() => {
                if (callbacks.onPeerJoin) {
                    callbacks.onPeerJoin('peer-1', 'Bob', 'win')
                }
            })

            // Verify initial state (isVideoMuted should be undefined initially)
            expect(result.current.peers.get('peer-1')?.isVideoMuted).toBeUndefined()

            // Trigger video mute (video disabled)
            act(() => {
                if (callbacks.onPeerMuteChange) {
                    callbacks.onPeerMuteChange('peer-1', { micMuted: false, speakerMuted: false, videoMuted: true })
                }
            })

            expect(result.current.peers.get('peer-1')?.isVideoMuted).toBe(true)

            // Trigger video unmute (video enabled)
            act(() => {
                if (callbacks.onPeerMuteChange) {
                    callbacks.onPeerMuteChange('peer-1', { micMuted: false, speakerMuted: false, videoMuted: false })
                }
            })

            expect(result.current.peers.get('peer-1')?.isVideoMuted).toBe(false)
        })

        it('should preserve video mute state when only mic/speaker changes', async () => {
            const { result } = renderHook(() => useRoom())
            const callbacks = vi.mocked(peerManager.setCallbacks).mock.calls[0][0]

            // Add peer
            act(() => {
                if (callbacks.onPeerJoin) {
                    callbacks.onPeerJoin('peer-1', 'Bob', 'win')
                }
            })

            // Set video muted
            act(() => {
                if (callbacks.onPeerMuteChange) {
                    callbacks.onPeerMuteChange('peer-1', { micMuted: false, speakerMuted: false, videoMuted: true })
                }
            })

            expect(result.current.peers.get('peer-1')?.isVideoMuted).toBe(true)

            // Now change only mic status (without videoMuted in payload)
            act(() => {
                if (callbacks.onPeerMuteChange) {
                    callbacks.onPeerMuteChange('peer-1', { micMuted: true, speakerMuted: false })
                }
            })

            // isVideoMuted should be preserved
            expect(result.current.peers.get('peer-1')?.isVideoMuted).toBe(true)
            expect(result.current.peers.get('peer-1')?.isMuted).toBe(true)
        })
    })
})
