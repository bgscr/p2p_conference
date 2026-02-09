/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScreenShare } from '../renderer/hooks/useScreenShare'

vi.mock('../renderer/utils/Logger', () => ({
  logger: {
    createModuleLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}))

function createMockScreenStream() {
  const videoTrack = {
    kind: 'video',
    stop: vi.fn(),
    onended: null as (() => void) | null
  }
  const stream = {
    getTracks: vi.fn(() => [videoTrack] as any),
    getVideoTracks: vi.fn(() => [videoTrack] as any)
  } as unknown as MediaStream

  return { stream, videoTrack }
}

describe('useScreenShare', () => {
  const onTrackReady = vi.fn()
  const onTrackStopped = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    delete (window as any).electronAPI
  })

  it('startScreenShare calls getDisplayMedia with correct constraints', async () => {
    const { stream } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(true)
    })

    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false })
    expect(onTrackReady).toHaveBeenCalledWith(stream)
    expect(result.current.isScreenSharing).toBe(true)
  })

  it('stopScreenShare stops tracks and triggers onTrackStopped', async () => {
    const { stream, videoTrack } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      await result.current.startScreenShare()
    })

    act(() => {
      result.current.stopScreenShare()
    })

    expect(videoTrack.stop).toHaveBeenCalled()
    expect(onTrackStopped).toHaveBeenCalledTimes(1)
    expect(result.current.isScreenSharing).toBe(false)
  })

  it('track.onended triggers stop flow', async () => {
    const { stream, videoTrack } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      await result.current.startScreenShare()
    })

    act(() => {
      videoTrack.onended?.()
    })

    expect(videoTrack.stop).toHaveBeenCalled()
    expect(onTrackStopped).toHaveBeenCalledTimes(1)
    expect(result.current.isScreenSharing).toBe(false)
  })

  it('handles unsupported platforms and permission denial', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const unsupported = await result.current.startScreenShare()
      expect(unsupported).toBe(false)
    })

    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotAllowedError' })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    await act(async () => {
      const denied = await result.current.startScreenShare()
      expect(denied).toBe(false)
    })
  })

  it('handles unexpected getDisplayMedia failures', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue(new Error('capture failed'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(false)
    })
  })

  it('handles unknown getDisplayMedia error shape', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue('capture failed')
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(false)
    })
  })

  it('falls back to Electron desktop source capture when getDisplayMedia throws NotReadableError', async () => {
    const { stream } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotReadableError' })
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia, getUserMedia },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockResolvedValue([{ id: 'screen:1:0', name: 'Screen 1' }])
    }

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(true)
    })

    expect(getDisplayMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    const constraints = getUserMedia.mock.calls[0][0] as any
    expect(constraints.video.mandatory.chromeMediaSource).toBe('desktop')
    expect(constraints.video.mandatory.chromeMediaSourceId).toBe('screen:1:0')
    expect(result.current.isScreenSharing).toBe(true)
  })

  it('uses current screen dimensions in compatibility fallback constraints', async () => {
    const { stream } = createMockScreenStream()
    const originalScreen = window.screen
    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotSupportedError' })
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new Error('standard profile failed'))
      .mockResolvedValueOnce(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia, getUserMedia },
      configurable: true
    })
    Object.defineProperty(window, 'screen', {
      value: { width: 2560, height: 1440 },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockResolvedValue([{ id: 'screen:7:0', name: 'Screen 7' }])
    }

    try {
      const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

      await act(async () => {
        const ok = await result.current.startScreenShare()
        expect(ok).toBe(true)
      })

      const secondAttempt = getUserMedia.mock.calls[1][0] as any
      expect(secondAttempt.video.mandatory.maxWidth).toBe(2560)
      expect(secondAttempt.video.mandatory.maxHeight).toBe(1440)
    } finally {
      Object.defineProperty(window, 'screen', { value: originalScreen, configurable: true })
    }
  })

  it('uses Electron fallback when getDisplayMedia is unavailable', async () => {
    const { stream } = createMockScreenStream()
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockResolvedValue([{ id: 'screen:2:0', name: 'Screen 2' }])
    }

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(true)
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(result.current.isScreenSharing).toBe(true)
  })

  it('tries multiple Electron sources when fallback source fails', async () => {
    const { stream } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotSupportedError' })
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new Error('first source standard failed'))
      .mockRejectedValueOnce(new Error('first source compatibility failed'))
      .mockRejectedValueOnce(new Error('first source minimal failed'))
      .mockResolvedValueOnce(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia, getUserMedia },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockResolvedValue([
        { id: 'screen:1:0', name: 'Screen 1' },
        { id: 'screen:2:0', name: 'Screen 2' }
      ])
    }

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(true)
    })

    expect(getUserMedia).toHaveBeenCalledTimes(4)
    const attemptedSourceIds = getUserMedia.mock.calls.map(call => (call[0] as any).video.mandatory.chromeMediaSourceId)
    expect(attemptedSourceIds).toEqual(['screen:1:0', 'screen:1:0', 'screen:1:0', 'screen:2:0'])
  })

  it('returns false when Electron fallback has no available sources', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotReadableError' })
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia, getUserMedia },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockResolvedValue([])
    }

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(false)
    })

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('returns false when querying Electron sources throws', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotReadableError' })
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia, getUserMedia },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockRejectedValue(new Error('ipc failed'))
    }

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(false)
    })

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('returns false when Electron API source response is not an array', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotReadableError' })
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia, getUserMedia },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockResolvedValue({ invalid: true })
    }

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(false)
    })

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('returns false when Electron API is unavailable but getUserMedia exists', async () => {
    const getUserMedia = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(false)
    })

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('returns false when all fallback sources fail and tries each source', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotSupportedError' })
    const getUserMedia = vi.fn().mockRejectedValue(new Error('all failed'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia, getUserMedia },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockResolvedValue([
        { id: 'screen:1:0', name: 'Screen 1' },
        { id: 'screen:2:0', name: 'Screen 2' }
      ])
    }

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(false)
    })

    expect(getUserMedia).toHaveBeenCalledTimes(6)
    const attemptedSourceIds = getUserMedia.mock.calls.map(call => (call[0] as any).video.mandatory.chromeMediaSourceId)
    expect(attemptedSourceIds).toEqual([
      'screen:1:0',
      'screen:1:0',
      'screen:1:0',
      'screen:2:0',
      'screen:2:0',
      'screen:2:0'
    ])
  })

  it('uses window sources as fallback when screen sources are unavailable', async () => {
    const { stream } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockRejectedValue({ name: 'NotSupportedError' })
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia, getUserMedia },
      configurable: true
    })
    ;(window as any).electronAPI = {
      getScreenSources: vi.fn().mockResolvedValue([
        { id: 'window:2:0', name: 'Window 2' },
        { id: 'window:3:0', name: 'Window 3' }
      ])
    }

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(true)
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    const constraints = getUserMedia.mock.calls[0][0] as any
    expect(constraints.video.mandatory.chromeMediaSourceId).toBe('window:2:0')
  })

  it('cleans up and returns false when onTrackReady throws', async () => {
    const { stream, videoTrack } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const throwingOnTrackReady = vi.fn(() => {
      throw new Error('callback failure')
    })
    const { result } = renderHook(() => useScreenShare(throwingOnTrackReady, onTrackStopped))

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(false)
    })

    expect(videoTrack.stop).toHaveBeenCalled()
    expect(result.current.isScreenSharing).toBe(false)
  })

  it('start while sharing is a no-op and stop when idle is a no-op', async () => {
    const { stream } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare(onTrackReady, onTrackStopped))

    await act(async () => {
      const first = await result.current.startScreenShare()
      const second = await result.current.startScreenShare()
      expect(first).toBe(true)
      expect(second).toBe(true)
    })

    expect(getDisplayMedia).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.stopScreenShare()
    })
    expect(onTrackStopped).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.stopScreenShare()
    })
    expect(onTrackStopped).toHaveBeenCalledTimes(1)
  })

  it('works without callbacks and handles stream without video tracks', async () => {
    const stream = {
      getTracks: vi.fn(() => [] as any),
      getVideoTracks: vi.fn(() => [] as any)
    } as unknown as MediaStream
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const { result } = renderHook(() => useScreenShare())

    await act(async () => {
      const ok = await result.current.startScreenShare()
      expect(ok).toBe(true)
    })
    expect(result.current.isScreenSharing).toBe(true)

    act(() => {
      result.current.stopScreenShare()
    })
    expect(result.current.isScreenSharing).toBe(false)
  })

  it('handles repeated stop calls in the same render cycle', async () => {
    const { stream } = createMockScreenStream()
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia },
      configurable: true
    })

    const localOnTrackStopped = vi.fn()
    const { result } = renderHook(() => useScreenShare(undefined, localOnTrackStopped))

    await act(async () => {
      await result.current.startScreenShare()
    })

    act(() => {
      result.current.stopScreenShare()
      result.current.stopScreenShare()
    })

    expect(localOnTrackStopped).toHaveBeenCalledTimes(2)
    expect(result.current.isScreenSharing).toBe(false)
  })
})
