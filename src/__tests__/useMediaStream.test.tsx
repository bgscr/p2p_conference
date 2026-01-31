/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMediaStream } from '../renderer/hooks/useMediaStream'

// ============================================
// Mocks
// ============================================

// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
    MediaLog: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

// Mock MediaStreamTrack
const mockTrack = {
    stop: vi.fn(),
    kind: 'audio',
    label: 'Default Audio Device',
    enabled: true
}

// Mock MediaStream
const mockStream = {
    id: 'stream-123',
    getTracks: vi.fn(() => [mockTrack]),
    getAudioTracks: vi.fn(() => [mockTrack]),
    getVideoTracks: vi.fn(() => []),
    active: true
}

// Mock Navigator MediaDevices
const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream)
const mockEnumerateDevices = vi.fn().mockResolvedValue([
    { deviceId: 'default', kind: 'audioinput', label: 'Default Mic', groupId: '1' },
    { deviceId: 'headset', kind: 'audiooutput', label: 'Headset', groupId: '2' }
])

const listeners: Record<string, Function[]> = {}
const mockAddEventListener = vi.fn((event: string, cb: Function) => {
    listeners[event] = listeners[event] || []
    listeners[event].push(cb)
})
const mockDispatchEvent = vi.fn((event: Event) => {
    const list = listeners[event.type] || []
    // console.log(`Dispatching ${event.type} to ${list.length} listeners`)
    list.forEach(cb => cb(event))
    return true
})


Object.defineProperty(navigator, 'mediaDevices', {
    value: {
        getUserMedia: mockGetUserMedia,
        enumerateDevices: mockEnumerateDevices,
        addEventListener: mockAddEventListener,
        removeEventListener: vi.fn(),
        dispatchEvent: mockDispatchEvent,
        ondevicechange: null
    },
    writable: true
})

// Mock Web Audio API
class MockAnalyserNode {
    fftSize = 256
    frequencyBinCount = 128
    getByteFrequencyData = vi.fn((arr) => {
        arr.fill(128)
    })
    connect = vi.fn()
    disconnect = vi.fn()
}

class MockAudioContext {
    createAnalyser = vi.fn(() => new MockAnalyserNode())
    createMediaStreamSource = vi.fn(() => ({
        connect: vi.fn()
    }))
    close = vi.fn()
}

vi.stubGlobal('AudioContext', MockAudioContext)

// Track animation frame IDs for cleanup
let animFrameId = 0
const pendingFrames = new Map<number, NodeJS.Timeout>()

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++animFrameId
    const timeout = setTimeout(() => {
        pendingFrames.delete(id)
        // Only call callback if window still exists (test not torn down)
        if (typeof window !== 'undefined') {
            try {
                cb(0)
            } catch {
                // Ignore errors during cleanup
            }
        }
    }, 16)
    pendingFrames.set(id, timeout)
    return id
})

vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    const timeout = pendingFrames.get(id)
    if (timeout) {
        clearTimeout(timeout)
        pendingFrames.delete(id)
    }
})


describe('useMediaStream Hook', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Clear listeners
        for (const key in listeners) delete listeners[key]
    })

    afterEach(() => {
        // Cancel all pending animation frames
        pendingFrames.forEach((timeout) => {
            clearTimeout(timeout)
        })
        pendingFrames.clear()

        // Clear all pending timers to prevent leaky state update errors
        vi.clearAllTimers()

        // Reset mock implementations
        mockGetUserMedia.mockResolvedValue(mockStream)
        mockTrack.enabled = true
    })

    it('should initialize with empty state', () => {
        const { result } = renderHook(() => useMediaStream())
        expect(result.current.localStream).toBeNull()
        expect(result.current.isMuted).toBe(false)
        expect(result.current.isLoading).toBe(false)
        expect(result.current.error).toBeNull()
    })

    it('should enumerate devices on mount', async () => {
        const { result } = renderHook(() => useMediaStream())

        await waitFor(() => {
            expect(result.current.inputDevices.length).toBeGreaterThan(0)
        })

        expect(result.current.inputDevices[0].label).toBe('Default Mic')
        expect(result.current.outputDevices[0].label).toBe('Headset')
    })

    describe('startCapture', () => {
        it('should start audio capture successfully', async () => {
            const { result } = renderHook(() => useMediaStream())

            await act(async () => {
                await result.current.startCapture()
            })

            expect(result.current.localStream).toBe(mockStream)
            expect(result.current.error).toBeNull()
            expect(mockGetUserMedia).toHaveBeenCalled()
        })

        it('should handle permission denied', async () => {
            const error = new Error('Permission denied')
            error.name = 'NotAllowedError'
            mockGetUserMedia.mockRejectedValue(error)

            const { result } = renderHook(() => useMediaStream())

            await act(async () => {
                await result.current.startCapture()
            })

            expect(result.current.localStream).toBeNull()
            expect(result.current.error).toBeTruthy()
            expect(result.current.error?.toLowerCase()).toContain('permission denied')
        })
    })

    describe('Device Switching', () => {
        it('should switch input device', async () => {
            const { result } = renderHook(() => useMediaStream())

            // Start first
            await act(async () => {
                await result.current.startCapture()
            })

            // Switch device
            const newStream = { ...mockStream, id: 'stream-456' }
            mockGetUserMedia.mockResolvedValue(newStream)

            await act(async () => {
                await result.current.switchInputDevice('mic-2')
            })

            expect(result.current.localStream).toBe(newStream)
            expect(mockGetUserMedia).toHaveBeenCalledWith(expect.objectContaining({
                audio: expect.objectContaining({
                    deviceId: { exact: 'mic-2' }
                })
            }))
        })
    })

    describe('Mute Toggle', () => {
        it('should toggle mute state', async () => {
            const { result } = renderHook(() => useMediaStream())

            // Start capture first
            await act(async () => {
                await result.current.startCapture()
            })

            act(() => {
                result.current.toggleMute()
            })

            expect(result.current.isMuted).toBe(true)
            expect(mockTrack.enabled).toBe(false)

            act(() => {
                result.current.toggleMute()
            })

            expect(result.current.isMuted).toBe(false)
            expect(mockTrack.enabled).toBe(true)
        })
    })

    describe('Cleanup', () => {
        it('should stop tracks on unmount', async () => {
            const { result, unmount } = renderHook(() => useMediaStream())

            await act(async () => {
                await result.current.startCapture()
            })

            unmount()

            expect(mockTrack.stop).toHaveBeenCalled()
        })
    })
    describe('Output Device Selection', () => {
        it('should select output device', () => {
            const { result } = renderHook(() => useMediaStream())

            act(() => {
                result.current.selectOutputDevice('speaker-1')
            })

            expect(result.current.selectedOutputDevice).toBe('speaker-1')
        })
    })

    describe('Explicit Stop Capture', () => {
        it('should stop capture when requested', async () => {
            const { result } = renderHook(() => useMediaStream())

            await act(async () => {
                await result.current.startCapture()
            })

            expect(result.current.localStream).not.toBeNull()

            act(() => {
                result.current.stopCapture()
            })

            expect(result.current.localStream).toBeNull()
            expect(mockTrack.stop).toHaveBeenCalled()
        })
    })

    describe('Environment Events', () => {
        it('should refresh devices on devicechange event', async () => {
            renderHook(() => useMediaStream())

            // Wait for initial enumeration
            await waitFor(() => expect(mockEnumerateDevices).toHaveBeenCalled())

            // Record the call count after initial setup
            const initialCallCount = mockEnumerateDevices.mock.calls.length

            // Manually trigger the devicechange handler that was registered
            // The event listener is added via addEventListener, so we need to call the registered handler
            const deviceChangeListeners = listeners['devicechange'] || []

            await act(async () => {
                // Trigger all devicechange listeners
                deviceChangeListeners.forEach(cb => cb(new Event('devicechange')))
                // Allow async operations to complete
                await new Promise(resolve => setTimeout(resolve, 50))
            })

            // Should trigger another enumeration - check that it was called more times than before
            await waitFor(() => {
                expect(mockEnumerateDevices.mock.calls.length).toBeGreaterThan(initialCallCount)
            }, { timeout: 1000 })
        })
    })

    describe('Stream Change Callback', () => {
        it('should notify listener when stream changes', async () => {
            const { result } = renderHook(() => useMediaStream())

            const listener = vi.fn()

            act(() => {
                result.current.setOnStreamChange(listener)
            })

            // Start capture (initial stream)
            await act(async () => {
                await result.current.startCapture()
            })

            // Switch device (should trigger listener)
            await act(async () => {
                await result.current.switchInputDevice('mic-2')
            })

            expect(listener).toHaveBeenCalled()
            const newStream = listener.mock.calls[0][0]
            expect(newStream).toBeDefined()
        })
    })
})
