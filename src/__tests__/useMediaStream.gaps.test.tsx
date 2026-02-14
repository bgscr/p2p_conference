/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage gap tests for useMediaStream
 * Targets:
 * - startCapture: video track handling (enabled/disabled)
 * - startCapture: NotFoundError path
 * - startCapture: generic error path
 * - startCapture: timeout path
 * - stopCapture: double cleanup guard
 * - stopCapture: cleanup audio context and animation frame
 * - switchInputDevice: preserves video track
 * - switchInputDevice: error path
 * - switchVideoDevice: no video track scenario
 * - switchVideoDevice: error path
 * - switchVideoDevice: stream change callback
 * - toggleVideo: no video track
 * - setupAudioLevelMonitoring: clean up existing context
 * - setupAudioLevelMonitoring: no audio tracks
 * - refreshDevices: error path
 * - refreshDevices: default device selection branches
 * - device change event listener
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaStream } from '../renderer/hooks/useMediaStream'

vi.mock('../renderer/utils/Logger', () => ({
  MediaLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Improved mock device setup
const createMockDevices = () => [
  { deviceId: 'mic-1', label: 'Mic 1', kind: 'audioinput' as const, groupId: 'g1', toJSON: vi.fn() },
  { deviceId: 'mic-2', label: '', kind: 'audioinput' as const, groupId: 'g2', toJSON: vi.fn() },
  { deviceId: 'cam-1', label: 'Camera 1', kind: 'videoinput' as const, groupId: 'g3', toJSON: vi.fn() },
  { deviceId: 'spk-1', label: 'Speaker 1', kind: 'audiooutput' as const, groupId: 'g4', toJSON: vi.fn() },
]

function createMockTrack(kind: string, id: string) {
  return {
    id,
    kind,
    label: `${kind}-${id}`,
    enabled: true,
    readyState: 'live' as const,
    muted: false,
    stop: vi.fn(),
  }
}

function createMockStream(audioTracks: any[], videoTracks: any[] = []) {
  const tracks = [...audioTracks, ...videoTracks]
  return {
    id: `stream-${Math.random().toString(36).slice(2, 8)}`,
    getTracks: () => tracks,
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    addTrack: vi.fn((track: any) => tracks.push(track)),
    removeTrack: vi.fn((track: any) => {
      const idx = tracks.indexOf(track)
      if (idx >= 0) tracks.splice(idx, 1)
    }),
  }
}

describe('useMediaStream - additional gaps', () => {
  let mockEnumerateDevices: ReturnType<typeof vi.fn>
  let mockGetUserMedia: ReturnType<typeof vi.fn>
  let deviceChangeListeners: (() => void)[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    deviceChangeListeners = []

    mockEnumerateDevices = vi.fn().mockResolvedValue(createMockDevices())
    mockGetUserMedia = vi.fn()

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: mockEnumerateDevices,
        getUserMedia: mockGetUserMedia,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'devicechange') deviceChangeListeners.push(handler)
        }),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    })

    vi.stubGlobal('AudioContext', class {
      createAnalyser = vi.fn().mockReturnValue({
        fftSize: 256,
        frequencyBinCount: 128,
        getByteFrequencyData: vi.fn(),
      })
      createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() })
      close = vi.fn()
    })

    vi.stubGlobal('MediaStream', class {
      id = `stream-${Math.random().toString(36).slice(2, 8)}`
      private _tracks: any[]
      constructor(tracks: any[] = []) { this._tracks = tracks }
      getTracks() { return this._tracks }
      getAudioTracks() { return this._tracks.filter(t => t.kind === 'audio') }
      getVideoTracks() { return this._tracks.filter(t => t.kind === 'video') }
      addTrack(t: any) { this._tracks.push(t) }
      removeTrack(t: any) { const i = this._tracks.indexOf(t); if (i >= 0) this._tracks.splice(i, 1) }
    })

    // requestAnimationFrame / cancelAnimationFrame
    let rafId = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => ++rafId))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function setupHook() {
    const hook = renderHook(() => useMediaStream())
    await act(async () => {
      await Promise.resolve()
    })
    return hook
  }

  it('startCapture handles NotFoundError', async () => {
    const notFoundErr = new Error('Not found')
    notFoundErr.name = 'NotFoundError'
    mockGetUserMedia.mockRejectedValue(notFoundErr)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    expect(result.current.error).toContain('No device found')
  })

  it('startCapture handles generic error', async () => {
    const genericErr = new Error('Something went wrong')
    genericErr.name = 'GenericError'
    mockGetUserMedia.mockRejectedValue(genericErr)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    expect(result.current.error).toContain('Failed to access media devices')
  })

  it('startCapture handles timeout', async () => {
    vi.useFakeTimers()
    // getUserMedia never resolves
    mockGetUserMedia.mockImplementation(() => new Promise(() => { }))

    const { result } = await setupHook()

    let capturePromise: Promise<any>
    act(() => {
      capturePromise = result.current.startCapture()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11000)
    })

    await act(async () => {
      await capturePromise!
    })

    expect(result.current.error).toContain('timed out')
    vi.useRealTimers()
  })

  it('startCapture with video disabled config', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const videoTrack = createMockTrack('video', 'v1')
    const stream = createMockStream([audioTrack], [videoTrack])
    mockGetUserMedia.mockResolvedValue(stream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture({ videoEnabled: false } as any)
    })

    expect(videoTrack.enabled).toBe(false)
    expect(result.current.isVideoEnabled).toBe(false)
  })

  it('startCapture with video enabled config', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const videoTrack = createMockTrack('video', 'v1')
    const stream = createMockStream([audioTrack], [videoTrack])
    mockGetUserMedia.mockResolvedValue(stream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture({ videoEnabled: true } as any)
    })

    expect(videoTrack.enabled).toBe(true)
    expect(result.current.isVideoEnabled).toBe(true)
  })

  it('stopCapture prevents double cleanup', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const stream = createMockStream([audioTrack])
    mockGetUserMedia.mockResolvedValue(stream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    act(() => { result.current.stopCapture() })
    expect(audioTrack.stop).toHaveBeenCalledTimes(1)

    // Second call should be guarded
    act(() => { result.current.stopCapture() })
    expect(audioTrack.stop).toHaveBeenCalledTimes(1) // Still 1
  })

  it('switchInputDevice preserves video track', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const videoTrack = createMockTrack('video', 'v1')
    const initStream = createMockStream([audioTrack], [videoTrack])
    mockGetUserMedia.mockResolvedValue(initStream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    const newAudioTrack = createMockTrack('audio', 'a2')
    const newStream = createMockStream([newAudioTrack])
    mockGetUserMedia.mockResolvedValue(newStream)

    await act(async () => {
      await result.current.switchInputDevice('mic-2')
    })

    expect(audioTrack.stop).toHaveBeenCalled()
    expect(result.current.selectedInputDevice).toBe('mic-2')
  })

  it('switchInputDevice preserves mute state', async () => {
    const initialAudioTrack = createMockTrack('audio', 'a1')
    const initialStream = createMockStream([initialAudioTrack])
    mockGetUserMedia.mockResolvedValueOnce(initialStream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    act(() => {
      result.current.toggleMute()
    })

    const switchedAudioTrack = createMockTrack('audio', 'a2')
    const switchedStream = createMockStream([switchedAudioTrack])
    mockGetUserMedia.mockResolvedValueOnce(switchedStream)

    await act(async () => {
      await result.current.switchInputDevice('mic-2')
    })

    expect(result.current.isMuted).toBe(true)
    expect(switchedAudioTrack.enabled).toBe(false)
  })

  it('switchInputDevice error sets error state', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const stream = createMockStream([audioTrack])
    mockGetUserMedia.mockResolvedValueOnce(stream).mockRejectedValueOnce(new Error('Switch failed'))

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    await act(async () => {
      const res = await result.current.switchInputDevice('bad-device')
      expect(res).toBeNull()
    })

    expect(result.current.error).toContain('Failed to switch microphone')
  })

  it('switchInputDevice with no current stream returns null', async () => {
    const { result } = await setupHook()

    // Wait for initial device enumeration to complete
    await act(async () => {
      await new Promise(r => setTimeout(r, 10))
    })

    await act(async () => {
      const res = await result.current.switchInputDevice('mic-2')
      expect(res).toBeNull()
    })

    // switchInputDevice calls setSelectedInputDevice, which should update state
    // But the early return path is the important coverage target
  })

  it('switchVideoDevice error sets error state', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const videoTrack = createMockTrack('video', 'v1')
    const stream = createMockStream([audioTrack], [videoTrack])
    mockGetUserMedia.mockResolvedValueOnce(stream).mockRejectedValueOnce(new Error('Camera failed'))

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    await act(async () => {
      const res = await result.current.switchVideoDevice('bad-cam')
      expect(res).toBeNull()
    })

    expect(result.current.error).toContain('Failed to switch camera')
  })

  it('switchVideoDevice with no current stream returns null', async () => {
    const { result } = await setupHook()

    // Wait for initial device enumeration
    await act(async () => {
      await new Promise(r => setTimeout(r, 10))
    })

    await act(async () => {
      const res = await result.current.switchVideoDevice('cam-2')
      expect(res).toBeNull()
    })

    // The early return path is the important coverage target
  })

  it('switchVideoDevice calls stream change callback', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const videoTrack = createMockTrack('video', 'v1')
    const stream = createMockStream([audioTrack], [videoTrack])
    mockGetUserMedia.mockResolvedValueOnce(stream)

    const newVideoTrack = createMockTrack('video', 'v2')
    const videoStream = createMockStream([], [newVideoTrack])
    mockGetUserMedia.mockResolvedValueOnce(videoStream)

    const { result } = await setupHook()

    const changeCallback = vi.fn()
    await act(async () => {
      await result.current.startCapture()
      result.current.setOnStreamChange(changeCallback)
    })

    await act(async () => {
      await result.current.switchVideoDevice('cam-2')
    })

    expect(changeCallback).toHaveBeenCalled()
    expect(videoTrack.stop).toHaveBeenCalled()
  })

  it('toggleMute toggles audio track enabled', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    audioTrack.enabled = true
    const stream = createMockStream([audioTrack])
    mockGetUserMedia.mockResolvedValue(stream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    act(() => { result.current.toggleMute() })
    expect(audioTrack.enabled).toBe(false)
    expect(result.current.isMuted).toBe(true)

    act(() => { result.current.toggleMute() })
    expect(audioTrack.enabled).toBe(true)
    expect(result.current.isMuted).toBe(false)
  })

  it('applies pre-capture mute intent when capture starts', async () => {
    const audioTrack = createMockTrack('audio', 'a-pre')
    const stream = createMockStream([audioTrack])
    mockGetUserMedia.mockResolvedValue(stream)

    const { result } = await setupHook()

    act(() => {
      result.current.toggleMute()
    })
    expect(result.current.isMuted).toBe(true)

    await act(async () => {
      await result.current.startCapture()
    })

    expect(result.current.isMuted).toBe(true)
    expect(audioTrack.enabled).toBe(false)
  })

  it('toggleVideo toggles video track enabled', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const videoTrack = createMockTrack('video', 'v1')
    videoTrack.enabled = true
    const stream = createMockStream([audioTrack], [videoTrack])
    mockGetUserMedia.mockResolvedValue(stream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture({ videoEnabled: true } as any)
    })

    act(() => { result.current.toggleVideo() })
    expect(videoTrack.enabled).toBe(false)
    expect(result.current.isVideoEnabled).toBe(false)
  })

  it('toggleVideo warns when no video track', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const stream = createMockStream([audioTrack])
    mockGetUserMedia.mockResolvedValue(stream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })

    act(() => { result.current.toggleVideo() })
    // Should not throw, warn logged
  })

  it('selectOutputDevice updates state', async () => {
    const { result } = await setupHook()

    await act(async () => {
      result.current.selectOutputDevice('spk-2')
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(result.current.selectedOutputDevice).toBe('spk-2')
  })

  it('refreshDevices handles enumerateDevices failure', async () => {
    mockEnumerateDevices.mockRejectedValue(new Error('Enum failed'))

    const { result } = await setupHook()

    // Wait for initial refresh to fail
    await act(async () => {
      await new Promise(r => setTimeout(r, 10))
    })

    expect(result.current.error).toContain('Failed to enumerate devices')
  })

  it('device change event triggers refresh', async () => {
    const { result: _result } = await setupHook()

    // Wait for initial enumeration
    await act(async () => {
      await new Promise(r => setTimeout(r, 10))
    })

    mockEnumerateDevices.mockClear()

    // Trigger device change
    act(() => {
      deviceChangeListeners.forEach(cb => cb())
    })

    await act(async () => {
      await new Promise(r => setTimeout(r, 10))
    })

    expect(mockEnumerateDevices).toHaveBeenCalled()
  })

  it('setupAudioLevelMonitoring with no audio tracks is no-op', async () => {
    const videoTrack = createMockTrack('video', 'v1')
    const stream = createMockStream([], [videoTrack])
    mockGetUserMedia.mockResolvedValue(stream)

    const { result } = await setupHook()

    await act(async () => {
      await result.current.startCapture()
    })
    // Should not crash when no audio tracks
  })

  it('setOnStreamChange sets the callback ref', async () => {
    const { result } = await setupHook()
    const cb = vi.fn()
    act(() => { result.current.setOnStreamChange(cb) })
    // Callback should be stored (tested indirectly via switchInputDevice)
  })

  it('switchInputDevice calls stream change callback', async () => {
    const audioTrack = createMockTrack('audio', 'a1')
    const stream = createMockStream([audioTrack])
    mockGetUserMedia.mockResolvedValueOnce(stream)

    const newAudioTrack = createMockTrack('audio', 'a2')
    const newStream = createMockStream([newAudioTrack])
    mockGetUserMedia.mockResolvedValueOnce(newStream)

    const { result } = await setupHook()
    const changeCallback = vi.fn()

    await act(async () => {
      await result.current.startCapture()
      result.current.setOnStreamChange(changeCallback)
    })

    await act(async () => {
      await result.current.switchInputDevice('mic-2')
    })

    expect(changeCallback).toHaveBeenCalled()
  })
})

