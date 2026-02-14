import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '@/types'
import { useConferenceController } from '../renderer/hooks/useConferenceController'

vi.mock('../renderer/utils/Logger', () => ({
  AppLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const DEFAULT_SETTINGS: AppSettings = {
  noiseSuppressionEnabled: true,
  echoCancellationEnabled: true,
  autoGainControlEnabled: true,
  selectedInputDevice: null,
  selectedVideoDevice: null,
  selectedOutputDevice: null,
  pushToTalkEnabled: false,
  pushToTalkKey: 'space'
}

function createMediaStream(audioCount: number, videoCount: number): MediaStream {
  const audioTracks = Array.from({ length: audioCount }, (_, index) => ({
    id: `audio-${index}`,
    kind: 'audio',
    label: `Audio ${index}`
  })) as unknown as MediaStreamTrack[]

  const videoTracks = Array.from({ length: videoCount }, (_, index) => ({
    id: `video-${index}`,
    kind: 'video',
    label: `Video ${index}`
  })) as unknown as MediaStreamTrack[]

  return {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks
  } as unknown as MediaStream
}

function createControllerHarness(overrides?: Partial<{
  startCapture: (opts: any) => Promise<MediaStream | null>
  switchInputDevice: (deviceId: string) => Promise<MediaStream | null>
  switchVideoDevice: (deviceId: string) => Promise<MediaStream | null>
  joinRoom: (roomId: string, userName: string) => Promise<void>
  t: (key: string) => string
}>) {
  const p2pManager = {
    setLocalStream: vi.fn(),
    replaceTrack: vi.fn(),
    broadcastMuteStatus: vi.fn()
  }

  const audioPipeline = {
    setNoiseSuppression: vi.fn(),
    connectInputStream: vi.fn().mockResolvedValue(createMediaStream(1, 0)),
    getNoiseSuppressionStatus: vi.fn().mockReturnValue({
      enabled: true,
      active: true,
      wasmReady: true
    })
  }

  const joinRoom = overrides?.joinRoom ?? vi.fn().mockResolvedValue(undefined)
  const startCapture = overrides?.startCapture ?? vi.fn().mockResolvedValue(createMediaStream(1, 1))
  const switchInputDevice = overrides?.switchInputDevice ?? vi.fn().mockResolvedValue(createMediaStream(1, 0))
  const switchVideoDevice = overrides?.switchVideoDevice ?? vi.fn().mockResolvedValue(createMediaStream(0, 1))

  const setUserName = vi.fn()
  const setGlobalError = vi.fn()
  const setAppView = vi.fn()
  const resetModerationState = vi.fn()
  const t = overrides?.t ?? vi.fn((key: string) => key)

  const hook = renderHook(() => {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS)

    return useConferenceController({
      p2pManager,
      settings,
      isMuted: false,
      isSpeakerMuted: false,
      audioPipeline,
      joinRoom,
      startCapture,
      switchInputDevice,
      switchVideoDevice,
      setSettings: setSettings as any,
      setUserName,
      setGlobalError,
      setAppView,
      resetModerationState,
      t
    })
  })

  return {
    hook,
    p2pManager,
    audioPipeline,
    joinRoom,
    startCapture,
    switchInputDevice,
    switchVideoDevice,
    setUserName,
    setGlobalError,
    setAppView,
    resetModerationState,
    t
  }
}

describe('useConferenceController', () => {
  it('joins room and applies processed media stream', async () => {
    const harness = createControllerHarness()

    await act(async () => {
      await harness.hook.result.current.handleJoinRoom('room-1', 'Alice', true)
    })

    expect(harness.setUserName).toHaveBeenCalledWith('Alice')
    expect(harness.setGlobalError).toHaveBeenCalledWith(null)
    expect(harness.setAppView).toHaveBeenCalledWith('room')
    expect(harness.startCapture).toHaveBeenCalled()
    expect(harness.audioPipeline.connectInputStream).toHaveBeenCalled()
    expect(harness.p2pManager.setLocalStream).toHaveBeenCalled()
    expect(harness.joinRoom).toHaveBeenCalledWith('room-1', 'Alice')
    expect(harness.p2pManager.broadcastMuteStatus).toHaveBeenCalledWith(false, false, true)
  })

  it('falls back to lobby and translated error when join fails', async () => {
    const harness = createControllerHarness({
      joinRoom: vi.fn().mockRejectedValue({})
    })

    await act(async () => {
      await harness.hook.result.current.handleJoinRoom('room-2', 'Bob')
    })

    expect(harness.setAppView).toHaveBeenCalledWith('lobby')
    expect(harness.setGlobalError).toHaveBeenLastCalledWith('errors.connectionFailed')
  })

  it('replaces audio track on input device change when track is available', async () => {
    const harness = createControllerHarness()

    await act(async () => {
      await harness.hook.result.current.handleInputDeviceChange('mic-2')
    })

    expect(harness.switchInputDevice).toHaveBeenCalledWith('mic-2')
    expect(harness.p2pManager.replaceTrack).toHaveBeenCalled()
    expect(harness.p2pManager.setLocalStream).toHaveBeenCalled()
  })

  it('applies settings updates and propagates noise suppression state', async () => {
    const harness = createControllerHarness()

    act(() => {
      harness.hook.result.current.handleSettingsChange({ noiseSuppressionEnabled: false })
    })

    expect(harness.audioPipeline.setNoiseSuppression).toHaveBeenCalledWith(false)
  })

  it('replaces video track on video device change when available', async () => {
    const harness = createControllerHarness()

    await act(async () => {
      await harness.hook.result.current.handleVideoDeviceChange('camera-2')
    })

    expect(harness.switchVideoDevice).toHaveBeenCalledWith('camera-2')
    expect(harness.p2pManager.replaceTrack).toHaveBeenCalled()
    expect(harness.p2pManager.setLocalStream).toHaveBeenCalled()
  })
})
