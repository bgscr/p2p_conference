/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMediaStream } from '../renderer/hooks/useMediaStream'

// Create proper mock track factory
function createMockTrack(kind: 'audio' | 'video', deviceId: string, label: string) {
    return {
        kind,
        label,
        enabled: true,
        id: `track-${deviceId}-${Math.random().toString(36).slice(2)}`,
        stop: vi.fn(),
        getSettings: () => ({ deviceId }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }
}

// Create proper mock stream factory
function createMockStream(audioTrack: any, videoTrack?: any) {
    const tracks: any[] = []
    if (audioTrack) tracks.push(audioTrack)
    if (videoTrack) tracks.push(videoTrack)

    const stream = {
        id: `stream-${Math.random().toString(36).slice(2)}`,
        active: true,
        getTracks: () => [...tracks],
        getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
        getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
        getTrackById: (id: string) => tracks.find(t => t.id === id) || null,
        addTrack: (track: any) => {
            if (!tracks.includes(track)) {
                tracks.push(track)
            }
        },
        removeTrack: (track: any) => {
            const idx = tracks.indexOf(track)
            if (idx >= 0) tracks.splice(idx, 1)
        },
        clone: function () { return createMockStream(audioTrack, videoTrack) },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }
    return stream
}

// Mock the Logger
vi.mock('../renderer/utils/Logger', () => ({
    MediaLog: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

// Mock AudioContext as a proper constructor function
function MockAudioContext(this: any) {
    this.createAnalyser = () => ({
        fftSize: 256,
        frequencyBinCount: 128,
        getByteFrequencyData: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn()
    })
    this.createMediaStreamSource = () => ({
        connect: vi.fn(),
        disconnect: vi.fn()
    })
    this.close = vi.fn().mockResolvedValue(undefined)
}
; (global as any).AudioContext = MockAudioContext

// Mock devices
const mockDevices = [
    { deviceId: 'default-mic', kind: 'audioinput', label: 'Default Mic', groupId: '1' },
    { deviceId: 'cam1', kind: 'videoinput', label: 'Camera 1', groupId: '2' },
    { deviceId: 'cam2', kind: 'videoinput', label: 'Camera 2', groupId: '3' },
    { deviceId: 'speaker1', kind: 'audiooutput', label: 'Speaker 1', groupId: '4' }
]

// Mock getUserMedia and enumerateDevices
const mockGetUserMedia = vi.fn()
const mockEnumerateDevices = vi.fn()

describe('useMediaStream Video Capabilities', () => {
    beforeEach(() => {
        vi.clearAllMocks()

            // Mock requestAnimationFrame and cancelAnimationFrame
            ; (global as any).requestAnimationFrame = vi.fn().mockReturnValue(1)
            ; (global as any).cancelAnimationFrame = vi.fn()

        // Setup mock navigator.mediaDevices
        Object.defineProperty(global.navigator, 'mediaDevices', {
            value: {
                getUserMedia: mockGetUserMedia,
                enumerateDevices: mockEnumerateDevices,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            },
            writable: true,
            configurable: true
        })

        // Default mock implementations
        mockEnumerateDevices.mockResolvedValue(mockDevices)

        const mockAudioTrack = createMockTrack('audio', 'default-mic', 'Default Mic')
        const mockVideoTrack = createMockTrack('video', 'cam1', 'Camera 1')
        const mockStream = createMockStream(mockAudioTrack, mockVideoTrack)

        mockGetUserMedia.mockResolvedValue(mockStream)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('should enumerate video input devices', async () => {
        const { result } = renderHook(() => useMediaStream())

        // Wait for initial device enumeration (happens in useEffect)
        await waitFor(() => {
            expect(result.current.videoInputDevices.length).toBeGreaterThan(0)
        })

        expect(result.current.videoInputDevices).toHaveLength(2)
        expect(result.current.videoInputDevices[0].label).toBe('Camera 1')
        expect(result.current.videoInputDevices[1].label).toBe('Camera 2')
    })

    it('should start capture with video enabled', async () => {
        // Setup mock stream for this specific test
        const mockAudioTrack = createMockTrack('audio', 'default-mic', 'Default Mic')
        const mockVideoTrack = createMockTrack('video', 'cam1', 'Camera 1')
        const mockStream = createMockStream(mockAudioTrack, mockVideoTrack)
        mockGetUserMedia.mockResolvedValue(mockStream)

        const { result } = renderHook(() => useMediaStream())

        // Wait for initial enumeration (this sets up selected devices)
        await waitFor(() => {
            expect(result.current.selectedInputDevice).not.toBeNull()
        })

        let capturedStream: any = null
        await act(async () => {
            capturedStream = await result.current.startCapture({ videoEnabled: true } as any)
        })

        // Check if there was an error
        if (result.current.error) {
            console.error('startCapture error:', result.current.error)
        }

        expect(result.current.error).toBeNull()
        expect(mockGetUserMedia).toHaveBeenCalled()
        expect(capturedStream).toBeTruthy()
        expect(result.current.localStream).toBeTruthy()
        expect(result.current.localStream?.getVideoTracks()).toHaveLength(1)
        expect(result.current.isVideoEnabled).toBe(true)
    })

    it('should toggle video enabled state', async () => {
        const mockAudioTrack = createMockTrack('audio', 'default-mic', 'Default Mic')
        const mockVideoTrack = createMockTrack('video', 'cam1', 'Camera 1')
        const mockStream = createMockStream(mockAudioTrack, mockVideoTrack)
        mockGetUserMedia.mockResolvedValue(mockStream)

        const { result } = renderHook(() => useMediaStream())

        // Wait for initial enumeration
        await waitFor(() => {
            expect(mockEnumerateDevices).toHaveBeenCalled()
        })

        await act(async () => {
            await result.current.startCapture({ videoEnabled: true } as any)
        })

        // Initially video should be enabled since we passed videoEnabled: true
        expect(result.current.isVideoEnabled).toBe(true)
        expect(mockVideoTrack.enabled).toBe(true)

        // Toggle video off
        act(() => {
            result.current.toggleVideo()
        })

        expect(result.current.isVideoEnabled).toBe(false)
        expect(mockVideoTrack.enabled).toBe(false)

        // Toggle video back on
        act(() => {
            result.current.toggleVideo()
        })

        expect(result.current.isVideoEnabled).toBe(true)
        expect(mockVideoTrack.enabled).toBe(true)
    })

    it('should switch video devices', async () => {
        const mockAudioTrack = createMockTrack('audio', 'default-mic', 'Default Mic')
        const mockVideoTrack1 = createMockTrack('video', 'cam1', 'Camera 1')
        const mockInitialStream = createMockStream(mockAudioTrack, mockVideoTrack1)

        mockGetUserMedia.mockResolvedValueOnce(mockInitialStream)

        const { result } = renderHook(() => useMediaStream())

        // Wait for initial enumeration
        await waitFor(() => {
            expect(mockEnumerateDevices).toHaveBeenCalled()
        })

        await act(async () => {
            await result.current.startCapture()
        })

        expect(result.current.localStream).toBeTruthy()

        // Setup mock for second camera switch
        const mockVideoTrack2 = createMockTrack('video', 'cam2', 'Camera 2')
        const mockNewVideoStream = createMockStream(null, mockVideoTrack2)
        mockGetUserMedia.mockResolvedValueOnce(mockNewVideoStream)

        await act(async () => {
            const newStream = await result.current.switchVideoDevice('cam2')
            expect(newStream).toBeTruthy()
        })

        // Check that getUserMedia was called with the new device
        expect(mockGetUserMedia).toHaveBeenLastCalledWith({
            video: { deviceId: { exact: 'cam2' } },
            audio: false
        })

        expect(result.current.selectedVideoDevice).toBe('cam2')
    })

    it('should start capture with video disabled when videoEnabled is false', async () => {
        const mockAudioTrack = createMockTrack('audio', 'default-mic', 'Default Mic')
        const mockVideoTrack = createMockTrack('video', 'cam1', 'Camera 1')
        const mockStream = createMockStream(mockAudioTrack, mockVideoTrack)
        mockGetUserMedia.mockResolvedValue(mockStream)

        const { result } = renderHook(() => useMediaStream())

        // Wait for initial enumeration
        await waitFor(() => {
            expect(result.current.selectedInputDevice).not.toBeNull()
        })

        await act(async () => {
            await result.current.startCapture({ videoEnabled: false } as any)
        })

        // Video should be disabled when joining with camera OFF
        expect(result.current.isVideoEnabled).toBe(false)
        expect(mockVideoTrack.enabled).toBe(false)
        expect(result.current.localStream).toBeTruthy()
    })

    it('should default to video disabled without videoEnabled option', async () => {
        const mockAudioTrack = createMockTrack('audio', 'default-mic', 'Default Mic')
        const mockVideoTrack = createMockTrack('video', 'cam1', 'Camera 1')
        const mockStream = createMockStream(mockAudioTrack, mockVideoTrack)
        mockGetUserMedia.mockResolvedValue(mockStream)

        const { result } = renderHook(() => useMediaStream())

        // Wait for initial enumeration
        await waitFor(() => {
            expect(result.current.selectedInputDevice).not.toBeNull()
        })

        await act(async () => {
            // No videoEnabled specified - should use default (false/off)
            await result.current.startCapture()
        })

        // Default is video disabled (camera OFF by default)
        expect(result.current.isVideoEnabled).toBe(false)
        expect(mockVideoTrack.enabled).toBe(false)
    })
})
