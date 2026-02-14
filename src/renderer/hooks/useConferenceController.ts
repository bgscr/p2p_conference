import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { AppSettings } from '@/types'
import { AppLog } from '../utils/Logger'
import {
  prepareInputSwitchPipeline,
  prepareJoinPipelineStream,
  type AudioPipelineAdapter
} from '../services/audioPipelineOrchestration'

type AppView = 'lobby' | 'room' | 'settings'

interface P2pMediaController {
  setLocalStream: (stream: MediaStream) => void
  replaceTrack: (track: MediaStreamTrack) => void
  broadcastMuteStatus: (
    micMuted: boolean,
    speakerMuted: boolean,
    videoEnabled?: boolean,
    isScreenSharing?: boolean
  ) => void
}

interface UseConferenceControllerOptions {
  p2pManager: P2pMediaController
  settings: AppSettings
  isMuted: boolean
  isSpeakerMuted: boolean
  audioPipeline: AudioPipelineAdapter
  joinRoom: (roomId: string, userName: string) => Promise<void>
  startCapture: (opts: {
    echoCancellation: boolean
    noiseSuppression: boolean
    autoGainControl: boolean
    videoEnabled: boolean
  }) => Promise<MediaStream | null>
  switchInputDevice: (deviceId: string) => Promise<MediaStream | null>
  switchVideoDevice: (deviceId: string) => Promise<MediaStream | null>
  setSettings: Dispatch<SetStateAction<AppSettings>>
  setUserName: (name: string) => void
  setGlobalError: (error: string | null) => void
  setAppView: (view: AppView) => void
  resetModerationState: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export function useConferenceController(options: UseConferenceControllerOptions) {
  const {
    p2pManager,
    settings,
    isMuted,
    isSpeakerMuted,
    audioPipeline,
    joinRoom,
    startCapture,
    switchInputDevice,
    switchVideoDevice,
    setSettings,
    setUserName,
    setGlobalError,
    setAppView,
    resetModerationState,
    t
  } = options

  const handleJoinRoom = useCallback(async (roomIdInput: string, name: string, cameraEnabled: boolean = false) => {
    setUserName(name)
    setGlobalError(null)
    resetModerationState()

    AppLog.info('Attempting to join room', { roomId: roomIdInput, userName: name, cameraEnabled })
    setAppView('room')

    try {
      const rawStream = await startCapture({
        echoCancellation: settings.echoCancellationEnabled,
        noiseSuppression: false,
        autoGainControl: settings.autoGainControlEnabled,
        videoEnabled: cameraEnabled
      })

      if (rawStream) {
        AppLog.info('Connecting stream to AudioPipeline for AI noise suppression')
        const joinPipeline = await prepareJoinPipelineStream({
          rawStream,
          noiseSuppressionEnabled: settings.noiseSuppressionEnabled,
          pipeline: audioPipeline
        })

        if (joinPipeline.usedPipeline && joinPipeline.status) {
          AppLog.info('AudioPipeline connected', {
            enabled: joinPipeline.status.enabled,
            active: joinPipeline.status.active,
            wasmReady: joinPipeline.status.wasmReady
          })
        } else if (joinPipeline.error) {
          AppLog.warn('AudioPipeline processing failed, using raw stream', { error: joinPipeline.error })
        }

        p2pManager.setLocalStream(joinPipeline.stream)
      }

      await joinRoom(roomIdInput, name)
      p2pManager.broadcastMuteStatus(isMuted, isSpeakerMuted, cameraEnabled)
      AppLog.info('Successfully joined room', { roomId: roomIdInput, cameraEnabled })
    } catch (err: any) {
      AppLog.error('Failed to join room', { roomId: roomIdInput, error: err })
      setGlobalError(err.message || t('errors.connectionFailed'))
      setAppView('lobby')
    }
  }, [
    setUserName,
    setGlobalError,
    resetModerationState,
    setAppView,
    startCapture,
    settings.echoCancellationEnabled,
    settings.autoGainControlEnabled,
    settings.noiseSuppressionEnabled,
    audioPipeline,
    p2pManager,
    joinRoom,
    isMuted,
    isSpeakerMuted,
    t
  ])

  const handleInputDeviceChange = useCallback(async (deviceId: string) => {
    AppLog.info('Switching input device', { deviceId })
    const newRawStream = await switchInputDevice(deviceId)

    if (!newRawStream) {
      AppLog.warn('switchInputDevice returned null - device switch may have failed')
      return
    }

    AppLog.info('Reconnecting new device through AudioPipeline')
    const switchResult = await prepareInputSwitchPipeline({
      rawStream: newRawStream,
      pipeline: audioPipeline
    })

    if (!switchResult.usedPipeline && switchResult.error) {
      AppLog.warn('AudioPipeline failed on device switch, using fallback stream', { error: switchResult.error })
    }

    if (switchResult.track) {
      AppLog.info('Replacing audio track in peer connections', {
        trackId: switchResult.track.id,
        label: switchResult.track.label
      })
      p2pManager.replaceTrack(switchResult.track)
      p2pManager.setLocalStream(switchResult.stream)
    } else {
      AppLog.error('No audio track available after input device switch')
    }
  }, [switchInputDevice, audioPipeline, p2pManager])

  const handleVideoDeviceChange = useCallback(async (deviceId: string) => {
    AppLog.info('Switching video device', { deviceId })
    const newStream = await switchVideoDevice(deviceId)
    if (!newStream) {
      return
    }

    const videoTrack = newStream.getVideoTracks()[0]
    if (videoTrack) {
      AppLog.info('Replacing video track in peer connections', {
        trackId: videoTrack.id,
        label: videoTrack.label
      })
      p2pManager.replaceTrack(videoTrack)
      p2pManager.setLocalStream(newStream)
    }
  }, [switchVideoDevice, p2pManager])

  const handleSettingsChange = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))

    if (newSettings.noiseSuppressionEnabled !== undefined) {
      audioPipeline.setNoiseSuppression(newSettings.noiseSuppressionEnabled)
    }

    AppLog.debug('Settings changed', { newSettings })
  }, [setSettings, audioPipeline])

  return {
    handleJoinRoom,
    handleInputDeviceChange,
    handleVideoDeviceChange,
    handleSettingsChange
  }
}
