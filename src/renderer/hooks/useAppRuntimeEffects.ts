import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react'
import type { ConnectionState, Peer } from '@/types'
import { logger, AppLog } from '../utils/Logger'
import { soundManager } from '../audio-processor/SoundManager'
import type { ToastType } from './useToastNotifications'

type AppView = 'lobby' | 'room' | 'settings'

interface PeerManagerRuntimeAdapter {
  on(event: 'remoteStream', callback: (payload: { peerId: string; stream: MediaStream }) => void): () => void
  on(event: 'error', callback: (payload: { error: Error; context: string }) => void): () => void
  setLocalStream: (stream: MediaStream) => void
}

interface AudioPipelineLifecycle {
  initialize: () => Promise<void>
  destroy: () => void
}

export interface UseAppRuntimeEffectsOptions {
  p2pManager: PeerManagerRuntimeAdapter
  audioPipeline: AudioPipelineLifecycle
  peers: Map<string, Peer>
  appView: AppView
  connectionState: ConnectionState
  isMuted: boolean
  localStream: MediaStream | null
  showToast: (message: string, type?: ToastType) => void
  t: (key: string, params?: Record<string, string | number>) => string
  clearToasts: () => void
  clearRemoteMicTimers: () => void
  onToggleMute: () => void
  onRequestLeaveConfirm: () => void
  onPipelineReady: (ready: boolean) => void
  onPeerDisconnected: (peerId: string) => void
  setRemoteStreams: Dispatch<SetStateAction<Map<string, MediaStream>>>
}

export function useAppRuntimeEffects(options: UseAppRuntimeEffectsOptions) {
  const {
    p2pManager,
    audioPipeline,
    peers,
    appView,
    connectionState,
    isMuted,
    localStream,
    showToast,
    t,
    clearToasts,
    clearRemoteMicTimers,
    onToggleMute,
    onRequestLeaveConfirm,
    onPipelineReady,
    onPeerDisconnected,
    setRemoteStreams
  } = options

  const onToggleMuteRef = useRef(onToggleMute)
  const onRequestLeaveConfirmRef = useRef(onRequestLeaveConfirm)
  const showToastRef = useRef(showToast)
  const translateRef = useRef(t)
  const clearToastsRef = useRef(clearToasts)
  const clearRemoteMicTimersRef = useRef(clearRemoteMicTimers)

  useEffect(() => {
    onToggleMuteRef.current = onToggleMute
  }, [onToggleMute])

  useEffect(() => {
    onRequestLeaveConfirmRef.current = onRequestLeaveConfirm
  }, [onRequestLeaveConfirm])

  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

  useEffect(() => {
    translateRef.current = t
  }, [t])

  useEffect(() => {
    clearToastsRef.current = clearToasts
  }, [clearToasts])

  useEffect(() => {
    clearRemoteMicTimersRef.current = clearRemoteMicTimers
  }, [clearRemoteMicTimers])

  useEffect(() => {
    logger.logSystemInfo()
    AppLog.info('Application starting')

    const initPipeline = async () => {
      try {
        await audioPipeline.initialize()
        onPipelineReady(true)
        AppLog.info('Audio pipeline initialized')
      } catch (err) {
        AppLog.error('Failed to initialize audio pipeline', { error: err })
        onPipelineReady(true)
      }
    }

    void initPipeline()

    const electronAPI = window.electronAPI

    let unsubscribeDownloadLogs: (() => void) | undefined
    if (electronAPI?.onDownloadLogs) {
      unsubscribeDownloadLogs = electronAPI.onDownloadLogs(() => {
        AppLog.info('Log download triggered via menu')
        logger.downloadLogs()
        showToastRef.current(translateRef.current('settings.downloadLogs'), 'success')
      })
    }

    let unsubscribeTrayMute: (() => void) | undefined
    if (electronAPI?.onTrayToggleMute) {
      unsubscribeTrayMute = electronAPI.onTrayToggleMute(() => {
        AppLog.info('Mute toggle triggered via tray')
        onToggleMuteRef.current()
      })
    }

    let unsubscribeTrayLeave: (() => void) | undefined
    if (electronAPI?.onTrayLeaveCall) {
      unsubscribeTrayLeave = electronAPI.onTrayLeaveCall(() => {
        AppLog.info('Leave call triggered via tray')
        onRequestLeaveConfirmRef.current()
        electronAPI?.showWindow?.()
      })
    }

    return () => {
      unsubscribeDownloadLogs?.()
      unsubscribeTrayMute?.()
      unsubscribeTrayLeave?.()
      clearToastsRef.current()
      clearRemoteMicTimersRef.current()
      audioPipeline.destroy()
      soundManager.destroy()
      AppLog.info('Application cleanup')
    }
  }, [audioPipeline, onPipelineReady])

  useEffect(() => {
    const unsubscribeRemoteStream = p2pManager.on('remoteStream', ({ peerId, stream }) => {
        AppLog.info('Remote stream received in App.tsx', {
          peerId,
          streamId: stream.id,
          trackCount: stream.getTracks().length,
          audioTracks: stream.getAudioTracks().map(track => ({
            id: track.id,
            enabled: track.enabled,
            muted: track.muted
          }))
        })

        if (stream.getAudioTracks().length === 0) {
          AppLog.warn('Remote stream has no audio tracks!', { peerId, streamId: stream.id })
        }

        setRemoteStreams(prev => {
          const updated = new Map(prev)
          updated.set(peerId, stream)
          AppLog.debug('Remote streams updated', { count: updated.size, peers: Array.from(updated.keys()) })
          return updated
        })
      })

    const unsubscribeError = p2pManager.on('error', ({ error, context }) => {
      AppLog.error('Peer manager error', { context, error: error.message })
      showToast(`Connection error: ${error.message}`, 'error')
    })

    return () => {
      unsubscribeRemoteStream()
      unsubscribeError()
    }
  }, [p2pManager, setRemoteStreams, showToast])

  const previousPeerIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const currentPeerIds = new Set(peers.keys())
    previousPeerIdsRef.current.forEach((peerId) => {
      if (!currentPeerIds.has(peerId)) {
        onPeerDisconnected(peerId)
      }
    })
    previousPeerIdsRef.current = currentPeerIds
  }, [onPeerDisconnected, peers])

  useEffect(() => {
    const electronAPI = window.electronAPI
    if (electronAPI?.updateCallState) {
      const inCall = appView === 'room' && connectionState === 'connected'
      electronAPI.updateCallState({ inCall, muted: isMuted })
      AppLog.debug('Synced call state with tray', { inCall, muted: isMuted })
    }
  }, [appView, connectionState, isMuted])

  useEffect(() => {
    const electronAPI = window.electronAPI
    if (electronAPI?.flashWindow && peers.size > 0 && !document.hasFocus()) {
      electronAPI.flashWindow()
    }
  }, [peers.size])

  useEffect(() => {
    if (localStream && appView === 'room') {
      p2pManager.setLocalStream(localStream)
    }
  }, [appView, localStream, p2pManager])
}
