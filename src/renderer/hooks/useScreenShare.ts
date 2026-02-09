/**
 * useScreenShare Hook
 * Manages screen sharing via getDisplayMedia API
 */

import { useState, useCallback, useRef } from 'react'
import { logger } from '../utils/Logger'

const ScreenShareLog = logger.createModuleLogger('ScreenShare')

interface DesktopCaptureSource {
  id: string
  name: string
}

interface DesktopCaptureProfile {
  name: 'standard' | 'compatibility' | 'minimal'
  constraints: MediaStreamConstraints
}

interface ElectronScreenShareAPI {
  getScreenSources?: () => Promise<DesktopCaptureSource[]>
}

interface UseScreenShareResult {
  isScreenSharing: boolean
  screenStream: MediaStream | null
  startScreenShare: () => Promise<boolean>
  stopScreenShare: () => void
}

export function useScreenShare(
  onTrackReady?: (stream: MediaStream) => void,
  onTrackStopped?: () => void
): UseScreenShareResult {
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const screenStreamRef = useRef<MediaStream | null>(null)

  const getElectronScreenSources = useCallback(async (): Promise<DesktopCaptureSource[]> => {
    const electronAPI = (window as any).electronAPI as ElectronScreenShareAPI | undefined
    if (typeof electronAPI?.getScreenSources !== 'function') {
      return []
    }

    try {
      const sources = await electronAPI.getScreenSources()
      return Array.isArray(sources) ? sources : []
    } catch (err) {
      ScreenShareLog.warn('Failed to query Electron screen sources', { error: String(err) })
      return []
    }
  }, [])

  const buildCaptureProfiles = useCallback((sourceId: string): DesktopCaptureProfile[] => {
    const defaultWidth = 1920
    const defaultHeight = 1080
    const screenWidth = typeof window !== 'undefined' && window.screen?.width > 0
      ? window.screen.width
      : defaultWidth
    const screenHeight = typeof window !== 'undefined' && window.screen?.height > 0
      ? window.screen.height
      : defaultHeight

    return [
      {
        name: 'standard',
        constraints: {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxFrameRate: 30
            }
          } as any
        } as any
      },
      {
        name: 'compatibility',
        constraints: {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxFrameRate: 15,
              maxWidth: Math.max(1280, screenWidth),
              maxHeight: Math.max(720, screenHeight)
            }
          } as any
        } as any
      },
      {
        name: 'minimal',
        constraints: {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          } as any
        } as any
      }
    ]
  }, [])

  const startElectronDesktopCapture = useCallback(async (): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return null
    }

    const sources = await getElectronScreenSources()
    if (sources.length === 0) {
      ScreenShareLog.warn('No Electron capture sources available for fallback')
      return null
    }

    for (const source of sources) {
      const profiles = buildCaptureProfiles(source.id)
      for (const profile of profiles) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(profile.constraints)
          ScreenShareLog.info('Screen capture fallback succeeded', {
            sourceId: source.id,
            sourceName: source.name,
            profile: profile.name
          })
          return stream
        } catch (err) {
          ScreenShareLog.warn('Screen capture fallback source failed', {
            sourceId: source.id,
            sourceName: source.name,
            profile: profile.name,
            error: String(err)
          })
        }
      }
    }

    return null
  }, [buildCaptureProfiles, getElectronScreenSources])

  const stopScreenShare = useCallback(() => {
    const stream = screenStreamRef.current
    if (!stream && !isScreenSharing) {
      return
    }

    if (stream) {
      screenStreamRef.current = null
      stream.getTracks().forEach(track => {
        track.onended = null
        track.stop()
      })
    }

    setIsScreenSharing(false)
    onTrackStopped?.()
    ScreenShareLog.info('Screen sharing stopped')
  }, [isScreenSharing, onTrackStopped])

  const startScreenShare = useCallback(async (): Promise<boolean> => {
    // No-op if already sharing
    if (isScreenSharing || screenStreamRef.current) {
      ScreenShareLog.debug('Already screen sharing, ignoring')
      return true
    }

    let stream: MediaStream | null = null

    try {
      if (navigator.mediaDevices?.getDisplayMedia) {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        })
      } else {
        ScreenShareLog.warn('getDisplayMedia not supported, trying Electron fallback capture')
        stream = await startElectronDesktopCapture()
      }
    } catch (err: any) {
      const errorName = typeof err?.name === 'string' ? err.name : 'UnknownError'
      if (errorName === 'NotAllowedError') {
        ScreenShareLog.info('Screen share permission denied by user')
        return false
      }

      // On some Electron/Windows environments getDisplayMedia fails with NotReadableError.
      // Fall back to legacy desktop capture constraints when available.
      if (['NotReadableError', 'NotSupportedError', 'AbortError', 'TrackStartError'].includes(errorName)) {
        ScreenShareLog.warn('Primary screen share capture failed, trying Electron fallback', {
          errorName,
          error: String(err)
        })
        stream = await startElectronDesktopCapture()

        // Retry getDisplayMedia with lower constraints for remote-control/virtual-display environments.
        if (!stream && errorName === 'NotReadableError' && navigator.mediaDevices?.getDisplayMedia) {
          try {
            ScreenShareLog.warn('Retrying getDisplayMedia with compatibility constraints')
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: {
                frameRate: { ideal: 10, max: 15 },
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 }
              } as any,
              audio: false
            })
          } catch (compatErr) {
            ScreenShareLog.warn('Compatibility getDisplayMedia retry failed', {
              error: String(compatErr)
            })
          }
        }
      } else {
        ScreenShareLog.error('Failed to start screen sharing', { error: String(err) })
        return false
      }
    }

    if (!stream) {
      ScreenShareLog.error('Failed to start screen sharing')
      return false
    }

    try {
      screenStreamRef.current = stream
      setIsScreenSharing(true)

      // Handle the browser's native "Stop sharing" button
      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.onended = () => {
          ScreenShareLog.info('Screen share track ended by user')
          stopScreenShare()
        }
      }

      onTrackReady?.(stream)
      ScreenShareLog.info('Screen sharing started')
      return true
    } catch (err) {
      ScreenShareLog.error('Failed to initialize shared stream', { error: String(err) })
      stream.getTracks().forEach(track => {
        track.onended = null
        track.stop()
      })
      screenStreamRef.current = null
      setIsScreenSharing(false)
      return false
    }
  }, [isScreenSharing, stopScreenShare, onTrackReady, startElectronDesktopCapture])

  return {
    isScreenSharing,
    screenStream: screenStreamRef.current,
    startScreenShare,
    stopScreenShare
  }
}
