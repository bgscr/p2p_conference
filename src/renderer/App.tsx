/**
 * Main Application Component
 * P2P Conference System - Serverless Audio Conferencing
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useRoom } from './hooks/useRoom'
import { useMediaStream } from './hooks/useMediaStream'
import { useI18n } from './hooks/useI18n'
import { peerManager } from './signaling/SimplePeerManager'
import { getAudioPipeline } from './audio-processor/AudioPipeline'
import { soundManager } from './audio-processor/SoundManager'
import { logger, AppLog } from './utils/Logger'

import { LobbyView } from './components/LobbyView'
import { RoomView } from './components/RoomView'
import { SettingsPanel } from './components/SettingsPanel'
import { ConnectionOverlay } from './components/ConnectionOverlay'
import { ErrorBanner } from './components/ErrorBanner'
import { LeaveConfirmDialog } from './components/LeaveConfirmDialog'
import { Toast } from './components/Toast'

import type {
  ConnectionState,
  AppSettings,
  RemoteMicSession,
  VirtualMicDeviceStatus,
  RemoteMicControlMessage,
  RemoteMicStopReason,
  VirtualAudioInstallResult,
  VirtualAudioInstallerState
} from '@/types'
import { useScreenShare } from './hooks/useScreenShare'
import { useDataChannel } from './hooks/useDataChannel'

// App states
type AppView = 'lobby' | 'room' | 'settings'

interface ToastMessage {
  id: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
}



const DEFAULT_SETTINGS: AppSettings = {
  noiseSuppressionEnabled: true,
  echoCancellationEnabled: true,
  autoGainControlEnabled: true,
  selectedInputDevice: null,
  selectedVideoDevice: null,
  selectedOutputDevice: null
}

const REMOTE_MIC_REQUEST_TIMEOUT_MS = 30000
const REMOTE_MIC_INSTALL_TIMEOUT_MS = 180000
// Source waits through target approval (30s) + possible assisted install (180s).
const REMOTE_MIC_OUTGOING_TIMEOUT_MS = REMOTE_MIC_REQUEST_TIMEOUT_MS + REMOTE_MIC_INSTALL_TIMEOUT_MS
const REMOTE_MIC_HEARTBEAT_INTERVAL_MS = 5000
const REMOTE_MIC_HEARTBEAT_TIMEOUT_MS = 15000

const REMOTE_MIC_STOP_REASON_SET: ReadonlySet<RemoteMicStopReason> = new Set<RemoteMicStopReason>([
  'stopped-by-source',
  'stopped-by-target',
  'rejected',
  'busy',
  'request-timeout',
  'heartbeat-timeout',
  'peer-disconnected',
  'virtual-device-missing',
  'virtual-device-install-failed',
  'virtual-device-restart-required',
  'user-cancelled',
  'routing-failed',
  'unknown'
])

function normalizeRemoteMicStopReason(reason: unknown): RemoteMicStopReason {
  if (typeof reason !== 'string') return 'stopped-by-source'
  return REMOTE_MIC_STOP_REASON_SET.has(reason as RemoteMicStopReason)
    ? (reason as RemoteMicStopReason)
    : 'stopped-by-source'
}

function isVirtualMicOutputReady(platform: 'win' | 'mac' | 'linux', devices: MediaDeviceInfo[]): boolean {
  if (platform === 'win') {
    return devices.some((device) => device.kind === 'audiooutput' && /cable input/i.test(device.label))
  }
  if (platform === 'mac') {
    return devices.some((device) => device.kind === 'audiooutput' && /blackhole/i.test(device.label))
  }
  return false
}

function getVirtualAudioProviderForPlatform(
  platform: 'win' | 'mac' | 'linux'
): VirtualAudioInstallResult['provider'] | null {
  if (platform === 'win') return 'vb-cable'
  if (platform === 'mac') return 'blackhole'
  return null
}

function getVirtualAudioDeviceName(platform: 'win' | 'mac' | 'linux'): string {
  if (platform === 'win') return 'VB-CABLE'
  if (platform === 'mac') return 'BlackHole 2ch'
  return 'Virtual Audio Device'
}

export default function App() {
  const { t } = useI18n()
  const [appView, setAppView] = useState<AppView>('lobby')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [userName, setUserName] = useState<string>('')
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const toastTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false)
  const [remoteMicSession, setRemoteMicSession] = useState<RemoteMicSession>({ state: 'idle' })
  const [virtualAudioInstallerState, setVirtualAudioInstallerState] = useState<VirtualAudioInstallerState>({
    inProgress: false,
    platformSupported: false,
    bundleReady: true
  })
  const remoteMicRequestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remoteMicHeartbeatSendRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const remoteMicHeartbeatWatchRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const remoteMicLastHeartbeatAtRef = useRef<number>(0)

  // Chat state
  const [isChatOpen, setIsChatOpen] = useState(false)

  // Audio pipeline
  const audioPipelineRef = useRef(getAudioPipeline())
  const [pipelineReady, setPipelineReady] = useState(false)

  // Detect local platform for display
  const localPlatform: 'win' | 'mac' | 'linux' = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('win')) return 'win'
    if (ua.includes('mac')) return 'mac'
    if (ua.includes('linux')) return 'linux'
    return 'win'  // Default
  }, [])

  /**
   * Show a toast notification
   */
  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])

    const timeoutId = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
      toastTimeoutsRef.current.delete(id)
    }, 3000)
    toastTimeoutsRef.current.set(id, timeoutId)
  }, [])

  const {
    messages: chatMessages,
    unreadCount: chatUnreadCount,
    sendMessage: sendChatMessage,
    addSystemMessage,
    markAsRead: markChatAsRead,
    reset: resetChat
  } = useDataChannel({
    p2pManager: peerManager,
    userName,
    isChatOpen,
    onMessageTooLong: () => showToast(t('chat.messageTooLong'), 'warning')
  })

  const clearRemoteMicTimers = useCallback(() => {
    if (remoteMicRequestTimerRef.current) {
      clearTimeout(remoteMicRequestTimerRef.current)
      remoteMicRequestTimerRef.current = null
    }
    if (remoteMicHeartbeatSendRef.current) {
      clearInterval(remoteMicHeartbeatSendRef.current)
      remoteMicHeartbeatSendRef.current = null
    }
    if (remoteMicHeartbeatWatchRef.current) {
      clearInterval(remoteMicHeartbeatWatchRef.current)
      remoteMicHeartbeatWatchRef.current = null
    }
  }, [])

  const resetRemoteMicSession = useCallback((nextState: RemoteMicSession = { state: 'idle' }) => {
    clearRemoteMicTimers()
    setRemoteMicSession(nextState)
  }, [clearRemoteMicTimers])

  /**
   * Dismiss a toast
   */
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timeoutId = toastTimeoutsRef.current.get(id)
    if (timeoutId) {
      clearTimeout(timeoutId)
      toastTimeoutsRef.current.delete(id)
    }
  }, [])

  /**
   * Room callbacks for sound notifications
   */
  const onPeerJoinCallback = useCallback((peerId: string, peerName: string) => {
    AppLog.info('Peer joined', { peerId, peerName })
    if (soundEnabled) {
      soundManager.playJoin()
    }
    showToast(t('room.participantJoined', { name: peerName }), 'success')
    addSystemMessage(t('chat.joined', { name: peerName }))
  }, [soundEnabled, showToast, t, addSystemMessage])

  const onPeerLeaveCallback = useCallback((peerId: string, peerName: string) => {
    AppLog.info('Peer left', { peerId, peerName })
    if (soundEnabled) {
      soundManager.playLeave()
    }
    showToast(t('room.participantLeft', { name: peerName }), 'info')

    if (
      remoteMicSession.state !== 'idle' &&
      (remoteMicSession.sourcePeerId === peerId || remoteMicSession.targetPeerId === peerId)
    ) {
      ; (peerManager as any).setAudioRoutingMode?.('broadcast')
      resetRemoteMicSession({ state: 'idle' })
      showToast(t('remoteMic.peerDisconnected'), 'info')
    }

    setRemoteStreams(prev => {
      const updated = new Map(prev)
      updated.delete(peerId)
      return updated
    })
    addSystemMessage(t('chat.left', { name: peerName }))
  }, [soundEnabled, showToast, t, addSystemMessage, remoteMicSession, resetRemoteMicSession])

  const onConnectionStateChangeCallback = useCallback((state: ConnectionState) => {
    AppLog.info('Connection state changed', { state })
    if (state === 'connected' && soundEnabled) {
      soundManager.playConnected()
    } else if (state === 'failed' && soundEnabled) {
      soundManager.playError()
    }
  }, [soundEnabled])

  const roomCallbacks = useMemo(() => ({
    onPeerJoin: onPeerJoinCallback,
    onPeerLeave: onPeerLeaveCallback,
    onConnectionStateChange: onConnectionStateChangeCallback
  }), [onPeerJoinCallback, onPeerLeaveCallback, onConnectionStateChangeCallback])

  // Room management
  const {
    roomId,
    peers,
    localPeerId,
    connectionState,
    joinRoom,
    leaveRoom,
    error: roomError
  } = useRoom(roomCallbacks)

  // Media stream management
  const {
    localStream,
    inputDevices,
    videoInputDevices,
    outputDevices,
    virtualMicDeviceStatus = {
      platform: localPlatform,
      supported: localPlatform === 'win' || localPlatform === 'mac',
      detected: false,
      ready: false,
      outputDeviceId: null,
      outputDeviceLabel: null,
      expectedDeviceHint: localPlatform === 'win' ? 'CABLE Input (VB-CABLE)' : 'BlackHole 2ch'
    } as VirtualMicDeviceStatus,
    selectedInputDevice,
    selectedVideoDevice,
    selectedOutputDevice,
    isMuted,
    isVideoEnabled,
    audioLevel,
    isLoading: mediaLoading,
    error: mediaError,
    startCapture,
    stopCapture,
    switchInputDevice,
    switchVideoDevice,
    selectOutputDevice,
    toggleMute,
    toggleVideo,
    refreshDevices
    // Note: setOnStreamChange is available but we use the direct return value from switchInputDevice instead
  } = useMediaStream()

  const syncVirtualAudioInstallerState = useCallback(async (): Promise<VirtualAudioInstallerState> => {
    const fallbackState: VirtualAudioInstallerState = {
      inProgress: false,
      platformSupported: localPlatform === 'win' || localPlatform === 'mac',
      bundleReady: true
    }

    try {
      const state = await window.electronAPI?.getVirtualAudioInstallerState?.()
      if (!state) {
        setVirtualAudioInstallerState(fallbackState)
        return fallbackState
      }

      const normalizedState: VirtualAudioInstallerState = {
        inProgress: state.inProgress,
        platformSupported: state.platformSupported,
        activeProvider: state.activeProvider,
        bundleReady: state.bundleReady !== false,
        bundleMessage: state.bundleMessage
      }
      setVirtualAudioInstallerState(normalizedState)
      return normalizedState
    } catch {
      setVirtualAudioInstallerState(fallbackState)
      return fallbackState
    }
  }, [localPlatform])

  const getInstallerPrecheckMessage = useCallback((reason?: string) => {
    return t('remoteMic.installPrecheckFailed', {
      reason: reason || t('remoteMic.installBundleMissingReasonDefault')
    })
  }, [t])

  const getRemoteMicRejectMessage = useCallback((reason?: string): string => {
    switch (reason) {
      case 'busy':
        return t('remoteMic.rejectedBusy')
      case 'virtual-device-missing':
        return t('remoteMic.rejectedVirtualDeviceMissing')
      case 'virtual-device-install-failed':
        return t('remoteMic.rejectedInstallFailed')
      case 'virtual-device-restart-required':
        return t('remoteMic.rejectedRestartRequired')
      case 'user-cancelled':
        return t('remoteMic.rejectedUserCancelled')
      case 'rejected':
        return t('remoteMic.requestRejected')
      default:
        return t('remoteMic.requestRejected')
    }
  }, [t])

  const installVirtualAudioDriver = useCallback(async (requestId: string): Promise<VirtualAudioInstallResult | null> => {
    const provider = getVirtualAudioProviderForPlatform(localPlatform)
    if (!provider) {
      return {
        provider: 'vb-cable',
        state: 'unsupported',
        message: 'Unsupported platform',
        correlationId: requestId
      }
    }

    const installerState = await syncVirtualAudioInstallerState()
    if (installerState.bundleReady === false) {
      return {
        provider,
        state: 'failed',
        message: installerState.bundleMessage || t('remoteMic.installBundleMissingReasonDefault'),
        correlationId: requestId
      }
    }

    setVirtualAudioInstallerState((prev) => ({
      ...prev,
      inProgress: true
    }))
    try {
      const result = await window.electronAPI?.installVirtualAudioDriver?.(provider, requestId)
      await syncVirtualAudioInstallerState()
      return result || null
    } catch (err: any) {
      await syncVirtualAudioInstallerState()
      return {
        provider,
        state: 'failed',
        message: err?.message || String(err),
        correlationId: requestId
      }
    }
  }, [localPlatform, syncVirtualAudioInstallerState, t])

  const finalizeRemoteMicSession = useCallback((reason?: string, notify: boolean = false) => {
    ; (peerManager as any).setAudioRoutingMode?.('broadcast')
    resetRemoteMicSession({ state: 'idle' })
    if (notify && reason) {
      showToast(reason, 'info')
    }
  }, [resetRemoteMicSession, showToast])

  const handleRequestRemoteMic = useCallback((targetPeerId: string) => {
    if (remoteMicSession.state === 'pendingOutgoing' || remoteMicSession.state === 'pendingIncoming' || remoteMicSession.state === 'active') {
      showToast(t('remoteMic.busy'), 'warning')
      return
    }

    const requestId = (peerManager as any).sendRemoteMicRequest?.(targetPeerId)
    if (!requestId) {
      showToast(t('remoteMic.requestFailed'), 'error')
      return
    }

    const targetName = peers.get(targetPeerId)?.name || 'Unknown'
    const expiresAt = Date.now() + REMOTE_MIC_OUTGOING_TIMEOUT_MS
    setRemoteMicSession({
      state: 'pendingOutgoing',
      requestId,
      sourcePeerId: localPeerId,
      targetPeerId,
      targetName,
      role: 'source',
      expiresAt
    })

    if (remoteMicRequestTimerRef.current) {
      clearTimeout(remoteMicRequestTimerRef.current)
    }
    remoteMicRequestTimerRef.current = setTimeout(() => {
      ; (peerManager as any).stopRemoteMicSession?.('request-timeout')
      setRemoteMicSession({
        state: 'expired',
        requestId,
        sourcePeerId: localPeerId,
        targetPeerId,
        targetName,
        role: 'source',
        reason: 'request-timeout'
      })
      showToast(t('remoteMic.requestTimeout'), 'warning')
    }, REMOTE_MIC_OUTGOING_TIMEOUT_MS)
  }, [remoteMicSession.state, showToast, t, peers, localPeerId])

  const handleRespondRemoteMicRequest = useCallback(async (accept: boolean) => {
    if (remoteMicSession.state !== 'pendingIncoming' || !remoteMicSession.requestId) {
      return
    }

    if (!accept) {
      const ok = (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'rejected')
      if (!ok) {
        showToast(t('remoteMic.responseFailed'), 'error')
        finalizeRemoteMicSession()
        return
      }
      showToast(t('remoteMic.rejectedByTarget'), 'info')
      finalizeRemoteMicSession()
      return
    }

    if (virtualMicDeviceStatus.ready) {
      const ok = (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, true, 'accepted')
      if (!ok) {
        showToast(t('remoteMic.responseFailed'), 'error')
        finalizeRemoteMicSession()
      }
      return
    }

    const installProvider = getVirtualAudioProviderForPlatform(localPlatform)
    if (!installProvider) {
      ; (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.installUnsupportedPlatform'), 'warning')
      finalizeRemoteMicSession()
      return
    }

    const installerState = await syncVirtualAudioInstallerState()
    if (installerState.bundleReady === false) {
      ; (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'virtual-device-install-failed')
      showToast(getInstallerPrecheckMessage(installerState.bundleMessage), 'warning')
      finalizeRemoteMicSession()
      return
    }

    let installTimedOut = false
    if (remoteMicRequestTimerRef.current) {
      clearTimeout(remoteMicRequestTimerRef.current)
    }

    const installExpiresAt = Date.now() + REMOTE_MIC_INSTALL_TIMEOUT_MS
    setRemoteMicSession(prev => ({
      ...prev,
      isInstallingVirtualDevice: true,
      needsVirtualDeviceSetup: true,
      installError: undefined,
      expiresAt: installExpiresAt
    }))
    showToast(t('remoteMic.installStarting', {
      device: virtualMicDeviceStatus.expectedDeviceHint || getVirtualAudioDeviceName(localPlatform)
    }), 'info')

    remoteMicRequestTimerRef.current = setTimeout(() => {
      installTimedOut = true
      ; (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.installTimeout'), 'warning')
      finalizeRemoteMicSession()
    }, REMOTE_MIC_INSTALL_TIMEOUT_MS)

    const installResult = await installVirtualAudioDriver(remoteMicSession.requestId)
    if (installTimedOut) {
      return
    }

    if (!installResult) {
      ; (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.installFailed'), 'error')
      finalizeRemoteMicSession()
      return
    }

    if (installResult.state === 'reboot-required') {
      ; (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'virtual-device-restart-required')
      showToast(t('remoteMic.installNeedsRestart'), 'warning')
      finalizeRemoteMicSession()
      return
    }

    if (installResult.state === 'user-cancelled') {
      ; (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'user-cancelled')
      showToast(t('remoteMic.installCancelled'), 'warning')
      finalizeRemoteMicSession()
      return
    }

    if (installResult.state === 'failed' || installResult.state === 'unsupported') {
      ; (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.installFailed'), 'error')
      finalizeRemoteMicSession()
      return
    }

    await refreshDevices()
    const devices = typeof navigator.mediaDevices?.enumerateDevices === 'function'
      ? await navigator.mediaDevices.enumerateDevices()
      : []
    const readyAfterInstall = devices.length > 0
      ? isVirtualMicOutputReady(localPlatform, devices)
      : virtualMicDeviceStatus.ready
    if (!readyAfterInstall) {
      ; (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, false, 'virtual-device-install-failed')
      showToast(t('remoteMic.virtualDeviceMissing'), 'warning')
      finalizeRemoteMicSession()
      return
    }

    setRemoteMicSession(prev => ({
      ...prev,
      isInstallingVirtualDevice: false,
      needsVirtualDeviceSetup: false
    }))

    const ok = (peerManager as any).respondRemoteMicRequest?.(remoteMicSession.requestId, true, 'accepted')
    if (!ok) {
      showToast(t('remoteMic.responseFailed'), 'error')
      finalizeRemoteMicSession()
      return
    }
    showToast(t('remoteMic.installCompleted', {
      device: virtualMicDeviceStatus.expectedDeviceHint || getVirtualAudioDeviceName(localPlatform)
    }), 'success')
  }, [
    remoteMicSession,
    showToast,
    t,
    finalizeRemoteMicSession,
    virtualMicDeviceStatus.expectedDeviceHint,
    virtualMicDeviceStatus.ready,
    localPlatform,
    installVirtualAudioDriver,
    refreshDevices,
    syncVirtualAudioInstallerState,
    getInstallerPrecheckMessage
  ])

  const handleStopRemoteMic = useCallback((reason: RemoteMicStopReason = 'stopped-by-source') => {
    const normalizedReason = normalizeRemoteMicStopReason(reason)
    const session = remoteMicSession
    if (!session.requestId) {
      finalizeRemoteMicSession()
      return
    }

    if (session.role === 'source' && session.targetPeerId) {
      ; (peerManager as any).sendRemoteMicStop?.(session.targetPeerId, session.requestId, normalizedReason)
    } else if (session.role === 'target' && session.sourcePeerId) {
      ; (peerManager as any).sendRemoteMicStop?.(session.sourcePeerId, session.requestId, normalizedReason)
    }

    ; (peerManager as any).stopRemoteMicSession?.(normalizedReason)
    finalizeRemoteMicSession()
  }, [remoteMicSession, finalizeRemoteMicSession])

  // Screen sharing
  const {
    isScreenSharing,
    startScreenShare,
    stopScreenShare
  } = useScreenShare(
    // onTrackReady: replace video track in peer connections
    useCallback((stream: MediaStream) => {
      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        peerManager.replaceTrack(videoTrack)
        peerManager.broadcastMuteStatus(isMuted, isSpeakerMuted, true, true)
      }
    }, [isMuted, isSpeakerMuted]),
    // onTrackStopped: revert to camera and broadcast status
    useCallback(() => {
      if (localStream) {
        const cameraTrack = localStream.getVideoTracks()[0]
        if (cameraTrack) {
          peerManager.replaceTrack(cameraTrack)
        }
      }
      peerManager.broadcastMuteStatus(isMuted, isSpeakerMuted, isVideoEnabled, false)
    }, [localStream, isMuted, isSpeakerMuted, isVideoEnabled])
  )

  /**
   * Initialize audio pipeline and log system info
   */
  useEffect(() => {
    logger.logSystemInfo()
    AppLog.info('Application starting')

    const initPipeline = async () => {
      try {
        await audioPipelineRef.current.initialize()
        setPipelineReady(true)
        AppLog.info('Audio pipeline initialized')
      } catch (err) {
        AppLog.error('Failed to initialize audio pipeline', { error: err })
        setPipelineReady(true)
      }
    }

    initPipeline()

    const electronAPI = window.electronAPI

    // Listen for download-logs from menu bar
    let unsubscribeDownloadLogs: (() => void) | undefined
    if (electronAPI?.onDownloadLogs) {
      unsubscribeDownloadLogs = electronAPI.onDownloadLogs(() => {
        AppLog.info('Log download triggered via menu')
        logger.downloadLogs()
        showToast(t('settings.downloadLogs'), 'success')
      })
    }

    // Listen for tray toggle mute
    // Note: handleToggleMute excluded from deps intentionally - listener re-subscribes via IPC
    let unsubscribeTrayMute: (() => void) | undefined
    if (electronAPI?.onTrayToggleMute) {
      unsubscribeTrayMute = electronAPI.onTrayToggleMute(() => {
        AppLog.info('Mute toggle triggered via tray')
        handleToggleMute()
      })
    }

    // Listen for tray leave call
    let unsubscribeTrayLeave: (() => void) | undefined
    if (electronAPI?.onTrayLeaveCall) {
      unsubscribeTrayLeave = electronAPI.onTrayLeaveCall(() => {
        AppLog.info('Leave call triggered via tray')
        setShowLeaveConfirm(true)
        // Show the window so user can see the confirmation dialog
        electronAPI?.showWindow?.()
      })
    }

    // Capture the current pipeline reference for cleanup
    const pipeline = audioPipelineRef.current
    const toastTimeouts = toastTimeoutsRef.current

    return () => {
      unsubscribeDownloadLogs?.()
      unsubscribeTrayMute?.()
      unsubscribeTrayLeave?.()
      toastTimeouts.forEach(timeoutId => clearTimeout(timeoutId))
      toastTimeouts.clear()
      clearRemoteMicTimers()
      pipeline.destroy()
      soundManager.destroy()
      AppLog.info('Application cleanup')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast, t, clearRemoteMicTimers])

  useEffect(() => {
    syncVirtualAudioInstallerState()
  }, [syncVirtualAudioInstallerState])

  /**
   * Set up remote stream handler and mute status handler
   */
  useEffect(() => {
    peerManager.setCallbacks({
      onRemoteStream: (peerId: string, stream: MediaStream) => {
        AppLog.info('Remote stream received in App.tsx', {
          peerId,
          streamId: stream.id,
          trackCount: stream.getTracks().length,
          audioTracks: stream.getAudioTracks().map(t => ({ id: t.id, enabled: t.enabled, muted: t.muted }))
        })

        // Verify the stream has audio tracks
        const audioTracks = stream.getAudioTracks()
        if (audioTracks.length === 0) {
          AppLog.warn('Remote stream has no audio tracks!', { peerId, streamId: stream.id })
        }

        setRemoteStreams(prev => {
          const updated = new Map(prev)
          updated.set(peerId, stream)
          AppLog.debug('Remote streams updated', { count: updated.size, peers: Array.from(updated.keys()) })
          return updated
        })
      },
      onError: (error: Error, context: string) => {
        AppLog.error('Peer manager error', { context, error: error.message })
        showToast(`Connection error: ${error.message}`, 'error')
      }
    })
  }, [showToast])

  /**
   * Remote microphone control channel handler.
   */
  useEffect(() => {
    const handleRemoteMicControlMessage = (peerId: string, message: RemoteMicControlMessage) => {
      switch (message.type) {
        case 'rm_request': {
          if (remoteMicSession.state === 'active' || remoteMicSession.state === 'pendingIncoming' || remoteMicSession.state === 'pendingOutgoing') {
            ; (peerManager as any).respondRemoteMicRequest?.(message.requestId, false, 'busy')
            return
          }

          const sourceName = message.sourceName || peers.get(peerId)?.name || 'Unknown'
          const expiresAt = Date.now() + REMOTE_MIC_REQUEST_TIMEOUT_MS
          setRemoteMicSession({
            state: 'pendingIncoming',
            requestId: message.requestId,
            sourcePeerId: peerId,
            sourceName,
            targetPeerId: localPeerId,
            role: 'target',
            expiresAt,
            needsVirtualDeviceSetup: !virtualMicDeviceStatus.ready,
            isInstallingVirtualDevice: false
          })

          if ((localPlatform === 'win' || localPlatform === 'mac') && !virtualMicDeviceStatus.ready) {
            syncVirtualAudioInstallerState()
          }

          if (remoteMicRequestTimerRef.current) {
            clearTimeout(remoteMicRequestTimerRef.current)
          }
          remoteMicRequestTimerRef.current = setTimeout(() => {
            ; (peerManager as any).respondRemoteMicRequest?.(message.requestId, false, 'rejected')
            setRemoteMicSession({
              state: 'expired',
              requestId: message.requestId,
              sourcePeerId: peerId,
              sourceName,
              targetPeerId: localPeerId,
              role: 'target',
              reason: 'request-timeout'
            })
          }, REMOTE_MIC_REQUEST_TIMEOUT_MS)

          showToast(t('remoteMic.requestReceived', { name: sourceName }), 'info')
          break
        }

        case 'rm_response': {
          if (remoteMicSession.state !== 'pendingOutgoing' || remoteMicSession.requestId !== message.requestId) {
            return
          }

          if (remoteMicRequestTimerRef.current) {
            clearTimeout(remoteMicRequestTimerRef.current)
            remoteMicRequestTimerRef.current = null
          }

          if (message.accepted) {
            const targetPeerId = remoteMicSession.targetPeerId || peerId
            const routeSet = (peerManager as any).setAudioRoutingMode?.('exclusive', targetPeerId)
            if (!routeSet) {
              showToast(t('remoteMic.routingFailed'), 'error')
              finalizeRemoteMicSession()
              return
            }

            ; (peerManager as any).sendRemoteMicStart?.(targetPeerId, message.requestId)
            setRemoteMicSession({
              state: 'active',
              requestId: message.requestId,
              sourcePeerId: localPeerId,
              targetPeerId,
              targetName: remoteMicSession.targetName || peers.get(targetPeerId)?.name || 'Unknown',
              role: 'source',
              startedAt: Date.now()
            })

            if (remoteMicHeartbeatSendRef.current) {
              clearInterval(remoteMicHeartbeatSendRef.current)
            }
            remoteMicHeartbeatSendRef.current = setInterval(() => {
              ; (peerManager as any).sendRemoteMicHeartbeat?.(targetPeerId, message.requestId)
            }, REMOTE_MIC_HEARTBEAT_INTERVAL_MS)

            showToast(t('remoteMic.requestAccepted'), 'success')
          } else {
            setRemoteMicSession({
              state: 'rejected',
              requestId: message.requestId,
              sourcePeerId: localPeerId,
              targetPeerId: remoteMicSession.targetPeerId,
              role: 'source',
              reason: message.reason || 'rejected'
            })
            showToast(getRemoteMicRejectMessage(message.reason), 'warning')
          }
          break
        }

        case 'rm_start': {
          if (remoteMicSession.state !== 'pendingIncoming' || remoteMicSession.requestId !== message.requestId) {
            return
          }

          if (remoteMicRequestTimerRef.current) {
            clearTimeout(remoteMicRequestTimerRef.current)
            remoteMicRequestTimerRef.current = null
          }

          remoteMicLastHeartbeatAtRef.current = Date.now()
          setRemoteMicSession(prev => ({
            ...prev,
            state: 'active',
            startedAt: Date.now()
          }))

          if (remoteMicHeartbeatWatchRef.current) {
            clearInterval(remoteMicHeartbeatWatchRef.current)
          }

          remoteMicHeartbeatWatchRef.current = setInterval(() => {
            const elapsed = Date.now() - remoteMicLastHeartbeatAtRef.current
            if (elapsed > REMOTE_MIC_HEARTBEAT_TIMEOUT_MS) {
              ; (peerManager as any).sendRemoteMicStop?.(peerId, message.requestId, 'heartbeat-timeout')
              finalizeRemoteMicSession(t('remoteMic.heartbeatTimeout'), true)
            }
          }, 1000)

          showToast(t('remoteMic.activeAsTarget'), 'success')
          break
        }

        case 'rm_heartbeat': {
          if (
            remoteMicSession.state === 'active' &&
            remoteMicSession.role === 'target' &&
            remoteMicSession.requestId === message.requestId &&
            remoteMicSession.sourcePeerId === peerId
          ) {
            remoteMicLastHeartbeatAtRef.current = Date.now()
          }
          break
        }

        case 'rm_stop': {
          if (remoteMicSession.requestId && remoteMicSession.requestId !== message.requestId) {
            return
          }
          finalizeRemoteMicSession(t('remoteMic.stopped'), true)
          break
        }
      }
    }

    const setOnRemoteMicControl = (peerManager as any).setOnRemoteMicControl?.bind(peerManager)
    if (typeof setOnRemoteMicControl !== 'function') {
      return
    }

    setOnRemoteMicControl(handleRemoteMicControlMessage)
    return () => {
      setOnRemoteMicControl(null)
    }
  }, [
    finalizeRemoteMicSession,
    getRemoteMicRejectMessage,
    localPeerId,
    localPlatform,
    peers,
    remoteMicSession,
    showToast,
    syncVirtualAudioInstallerState,
    t,
    virtualMicDeviceStatus.ready
  ])

  useEffect(() => {
    if (remoteMicSession.state !== 'rejected' && remoteMicSession.state !== 'expired') {
      return
    }

    const timer = setTimeout(() => {
      setRemoteMicSession({ state: 'idle' })
    }, 2500)

    return () => clearTimeout(timer)
  }, [remoteMicSession.state])

  /**
   * Sync call state with system tray
   */
  useEffect(() => {
    const electronAPI = window.electronAPI
    if (electronAPI?.updateCallState) {
      const inCall = appView === 'room' && connectionState === 'connected'
      electronAPI.updateCallState({ inCall, muted: isMuted })
      AppLog.debug('Synced call state with tray', { inCall, muted: isMuted })
    }
  }, [appView, connectionState, isMuted])

  /**
   * Flash window when peer joins (if window is not focused)
   */
  useEffect(() => {
    const electronAPI = window.electronAPI
    if (electronAPI?.flashWindow && peers.size > 0 && !document.hasFocus()) {
      electronAPI.flashWindow()
    }
  }, [peers.size])



  /**
   * Handle mute toggle with sound and broadcast to peers
   */
  const handleToggleMute = useCallback(() => {
    const newMuted = !isMuted
    const effectiveVideoEnabled = isScreenSharing ? true : isVideoEnabled
    toggleMute()
    if (soundEnabled) {
      soundManager.playClick()
    }
    // Broadcast mute status to all peers (including video state)
    peerManager.broadcastMuteStatus(newMuted, isSpeakerMuted, effectiveVideoEnabled, isScreenSharing)
  }, [toggleMute, soundEnabled, isMuted, isSpeakerMuted, isVideoEnabled, isScreenSharing])

  /**
   * Handle speaker mute toggle
   */
  const handleToggleSpeakerMute = useCallback(() => {
    const newSpeakerMuted = !isSpeakerMuted
    const effectiveVideoEnabled = isScreenSharing ? true : isVideoEnabled
    setIsSpeakerMuted(newSpeakerMuted)
    if (soundEnabled) {
      soundManager.playClick()
    }
    // Broadcast mute status to all peers (including video state)
    peerManager.broadcastMuteStatus(isMuted, newSpeakerMuted, effectiveVideoEnabled, isScreenSharing)
  }, [soundEnabled, isMuted, isSpeakerMuted, isVideoEnabled, isScreenSharing])

  /**
   * Handle video toggle with broadcast to peers
   */
  const handleToggleVideo = useCallback(() => {
    const newVideoEnabled = !isVideoEnabled
    const effectiveVideoEnabled = isScreenSharing ? true : newVideoEnabled
    toggleVideo()
    // Broadcast mute status including video state to all peers
    peerManager.broadcastMuteStatus(isMuted, isSpeakerMuted, effectiveVideoEnabled, isScreenSharing)
  }, [toggleVideo, isVideoEnabled, isMuted, isSpeakerMuted, isScreenSharing])

  /**
   * Handle screen share toggle
   */
  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare()
    } else {
      const hasNativeScreenShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function'
      const hasElectronFallback = typeof (window as any).electronAPI?.getScreenSources === 'function'
      if (!hasNativeScreenShare && !hasElectronFallback) {
        showToast(t('errors.screenShareNotSupported'), 'error')
        return
      }
      const success = await startScreenShare()
      if (!success) {
        showToast(t('errors.screenShareFailed'), 'error')
      }
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare, showToast, t])

  /**
   * Handle sending a chat message
   */
  const handleSendChatMessage = useCallback((content: string) => {
    sendChatMessage(content)
  }, [sendChatMessage])

  /**
   * Toggle chat panel
   */
  const handleToggleChat = useCallback(() => {
    setIsChatOpen(prev => {
      if (!prev) {
        markChatAsRead()
      }
      return !prev
    })
  }, [markChatAsRead])

  /**
   * Mark chat as read
   */
  const handleMarkChatRead = useCallback(() => {
    markChatAsRead()
  }, [markChatAsRead])

  /**
   * Cancel search and return to lobby
   */
  const handleCancelSearch = useCallback(() => {
    AppLog.info('User cancelled search')
    ; (peerManager as any).stopRemoteMicSession?.('unknown')
    resetRemoteMicSession({ state: 'idle' })
    leaveRoom()
    stopCapture()
    if (isScreenSharing) stopScreenShare()
    audioPipelineRef.current.disconnect()
    setRemoteStreams(new Map())
    setIsChatOpen(false)
    resetChat()
    setAppView('lobby')
  }, [leaveRoom, stopCapture, isScreenSharing, stopScreenShare, resetChat, resetRemoteMicSession])

  /**
   * Keyboard shortcuts
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Ctrl+Shift+L - Download logs (also handled by menu, but keep for direct use)
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        AppLog.info('Log download triggered via keyboard shortcut')
        logger.downloadLogs()
        showToast(t('settings.downloadLogs'), 'success')
        return
      }

      if (appView === 'room') {
        switch (e.key.toLowerCase()) {
          case 'm':
            handleToggleMute()
            break
          case 'l':
            handleToggleSpeakerMute()
            break
          case 'v':
            handleToggleVideo()
            break
          case 't':
            handleToggleChat()
            break
          case 's':
            handleToggleScreenShare()
            break
          case 'escape':
            if (connectionState === 'signaling' || connectionState === 'connecting') {
              handleCancelSearch()
            } else {
              setShowLeaveConfirm(true)
            }
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
     
  }, [appView, connectionState, showToast, t, handleToggleMute, handleToggleSpeakerMute, handleToggleVideo, handleToggleChat, handleToggleScreenShare, handleCancelSearch])

  /**
   * Join room handler - switch to room view IMMEDIATELY, then start capture
   */
  const handleJoinRoom = useCallback(async (roomIdInput: string, name: string, cameraEnabled: boolean = false) => {
    setUserName(name)
    setGlobalError(null)

    AppLog.info('Attempting to join room', { roomId: roomIdInput, userName: name, cameraEnabled })

    // Switch to room view IMMEDIATELY so user sees the searching overlay
    setAppView('room')

    // Now do the async work (capture + join) - user sees the overlay during this
    try {
      // Start capture (this is the slow part)
      // Use browser's built-in AEC first, then RNNoise for additional noise suppression
      const rawStream = await startCapture({
        echoCancellation: settings.echoCancellationEnabled,
        noiseSuppression: false, // Let RNNoise handle this instead of browser
        autoGainControl: settings.autoGainControlEnabled,
        videoEnabled: cameraEnabled  // Pass camera state from lobby
      } as any)

      if (rawStream) {
        // Process through AudioPipeline for RNNoise AI noise suppression
        AppLog.info('Connecting stream to AudioPipeline for AI noise suppression')

        try {
          // Set noise suppression state before connecting
          audioPipelineRef.current.setNoiseSuppression(settings.noiseSuppressionEnabled)

          // Connect raw stream to pipeline, get processed stream
          const processedStream = await audioPipelineRef.current.connectInputStream(rawStream)

          // Log pipeline status
          const nsStatus = audioPipelineRef.current.getNoiseSuppressionStatus()
          AppLog.info('AudioPipeline connected', {
            enabled: nsStatus.enabled,
            active: nsStatus.active,
            wasmReady: nsStatus.wasmReady
          })

          // Create combined stream: processed audio + raw video
          const combinedStream = new MediaStream([
            ...processedStream.getAudioTracks(),
            ...rawStream.getVideoTracks()
          ])

          // Send processed stream to WebRTC
          peerManager.setLocalStream(combinedStream)
        } catch (pipelineErr) {
          AppLog.warn('AudioPipeline processing failed, using raw stream', { error: pipelineErr })
          // Fallback: use raw stream if pipeline fails
          peerManager.setLocalStream(rawStream)
        }
      }

      // Join the signaling room
      await joinRoom(roomIdInput, name)

      // Set initial mute status including video state so peers know camera is off
      peerManager.broadcastMuteStatus(isMuted, isSpeakerMuted, cameraEnabled)

      AppLog.info('Successfully joined room', { roomId: roomIdInput, cameraEnabled })

    } catch (err: any) {
      AppLog.error('Failed to join room', { roomId: roomIdInput, error: err })
      setGlobalError(err.message || t('errors.connectionFailed'))
      // Go back to lobby on error
      setAppView('lobby')
    }
  }, [startCapture, settings, joinRoom, t, isMuted, isSpeakerMuted])

  /**
   * Update local stream in peer manager when it changes
   */
  useEffect(() => {
    if (localStream && appView === 'room') {
      peerManager.setLocalStream(localStream)
    }
  }, [localStream, appView])

  /**
   * Leave room handler
   */
  const handleLeaveRoom = useCallback(() => {
    AppLog.info('Leaving room', { roomId })
    setShowLeaveConfirm(false)
    ; (peerManager as any).stopRemoteMicSession?.('unknown')
    resetRemoteMicSession({ state: 'idle' })
    leaveRoom()
    stopCapture()
    if (isScreenSharing) stopScreenShare()
    audioPipelineRef.current.disconnect()
    setRemoteStreams(new Map())
    setIsSpeakerMuted(false)
    setIsChatOpen(false)
    resetChat()
    setAppView('lobby')
  }, [leaveRoom, stopCapture, roomId, isScreenSharing, stopScreenShare, resetChat, resetRemoteMicSession])

  /**
   * Handle input device change
   * Gets the new stream directly from switchInputDevice to ensure track replacement
   */
  const handleInputDeviceChange = useCallback(async (deviceId: string) => {
    AppLog.info('Switching input device', { deviceId })

    const newRawStream = await switchInputDevice(deviceId)

    if (newRawStream) {
      try {
        // Reconnect through AudioPipeline for RNNoise processing
        AppLog.info('Reconnecting new device through AudioPipeline')
        const processedStream = await audioPipelineRef.current.connectInputStream(newRawStream)

        const newTrack = processedStream.getAudioTracks()[0]
        if (newTrack) {
          AppLog.info('Replacing audio track in peer connections', {
            trackId: newTrack.id,
            label: newTrack.label
          })
          peerManager.replaceTrack(newTrack)
          // Also update the local stream reference in peer manager
          peerManager.setLocalStream(processedStream)
        } else {
          AppLog.error('Processed stream has no audio tracks after device switch')
        }
      } catch (pipelineErr) {
        // Fallback: use raw stream if pipeline fails
        AppLog.warn('AudioPipeline failed on device switch, using raw stream', { error: pipelineErr })
        const newTrack = newRawStream.getAudioTracks()[0]
        if (newTrack) {
          peerManager.replaceTrack(newTrack)
          peerManager.setLocalStream(newRawStream)
        }
      }
    } else {
      AppLog.warn('switchInputDevice returned null - device switch may have failed')
    }
  }, [switchInputDevice])

  /**
   * Handle video device change
   */
  const handleVideoDeviceChange = useCallback(async (deviceId: string) => {
    AppLog.info('Switching video device', { deviceId })
    const newStream = await switchVideoDevice(deviceId)

    if (newStream) {
      // We need to update the peer connection with the new video track
      const videoTrack = newStream.getVideoTracks()[0]
      if (videoTrack) {
        AppLog.info('Replacing video track in peer connections', {
          trackId: videoTrack.id,
          label: videoTrack.label
        })
        peerManager.replaceTrack(videoTrack)
        // Update local stream ref
        // Note: setLocalStream in peerManager handles adding tracks, 
        // but relies on existing senders for replacement.
        peerManager.setLocalStream(newStream)
      }
    }
  }, [switchVideoDevice])

  /**
   * Handle settings change
   */
  const handleSettingsChange = useCallback((newSettings: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }))

    if (newSettings.noiseSuppressionEnabled !== undefined) {
      audioPipelineRef.current.setNoiseSuppression(newSettings.noiseSuppressionEnabled)
    }

    AppLog.debug('Settings changed', { newSettings })
  }, [])

  const handleOpenRemoteMicSetup = useCallback(async () => {
    const opened = await window.electronAPI?.openRemoteMicSetupDoc?.()
    if (!opened) {
      showToast(t('remoteMic.setupDocUnavailable'), 'warning')
    }
  }, [showToast, t])

  const handleInstallRemoteMicDriver = useCallback(async () => {
    if (!getVirtualAudioProviderForPlatform(localPlatform)) {
      showToast(t('remoteMic.installUnsupportedPlatform'), 'warning')
      return
    }

    const installerState = await syncVirtualAudioInstallerState()
    if (installerState.bundleReady === false) {
      showToast(getInstallerPrecheckMessage(installerState.bundleMessage), 'warning')
      return
    }

    showToast(t('remoteMic.installStarting', {
      device: virtualMicDeviceStatus.expectedDeviceHint || getVirtualAudioDeviceName(localPlatform)
    }), 'info')
    const result = await installVirtualAudioDriver(`manual-${Date.now()}`)
    if (!result) {
      showToast(t('remoteMic.installFailed'), 'error')
      return
    }

    if (result.state === 'reboot-required') {
      showToast(t('remoteMic.installNeedsRestart'), 'warning')
      return
    }
    if (result.state === 'user-cancelled') {
      showToast(t('remoteMic.installCancelled'), 'warning')
      return
    }
    if (result.state === 'failed' || result.state === 'unsupported') {
      showToast(t('remoteMic.installFailed'), 'error')
      return
    }

    await refreshDevices()
    const devices = typeof navigator.mediaDevices?.enumerateDevices === 'function'
      ? await navigator.mediaDevices.enumerateDevices()
      : []
    const ready = devices.length > 0
      ? isVirtualMicOutputReady(localPlatform, devices)
      : virtualMicDeviceStatus.ready

    if (ready) {
      showToast(t('remoteMic.installCompleted', {
        device: virtualMicDeviceStatus.expectedDeviceHint || getVirtualAudioDeviceName(localPlatform)
      }), 'success')
    } else {
      showToast(t('remoteMic.virtualDeviceMissing'), 'warning')
    }
  }, [
    installVirtualAudioDriver,
    localPlatform,
    refreshDevices,
    showToast,
    t,
    virtualMicDeviceStatus.expectedDeviceHint,
    virtualMicDeviceStatus.ready,
    syncVirtualAudioInstallerState,
    getInstallerPrecheckMessage
  ])

  const handleRecheckVirtualMicDevice = useCallback(async () => {
    await refreshDevices()
    await syncVirtualAudioInstallerState()

    const devices = typeof navigator.mediaDevices?.enumerateDevices === 'function'
      ? await navigator.mediaDevices.enumerateDevices()
      : []
    const ready = devices.length > 0
      ? isVirtualMicOutputReady(localPlatform, devices)
      : virtualMicDeviceStatus.ready
    showToast(
      ready ? t('remoteMic.ready') : t('remoteMic.notReady'),
      ready ? 'success' : 'warning'
    )
  }, [localPlatform, refreshDevices, showToast, syncVirtualAudioInstallerState, t, virtualMicDeviceStatus.ready])

  const handleRemoteMicRoutingError = useCallback((peerId: string, error: string) => {
    AppLog.error('Remote mic sink routing failed', { peerId, error })
    showToast(t('remoteMic.routingFailed'), 'error')
    handleStopRemoteMic('routing-failed')
  }, [showToast, t, handleStopRemoteMic])

  /**
   * Copy room ID to clipboard
   */
  const handleCopyRoomId = useCallback(async () => {
    if (roomId) {
      try {
        await navigator.clipboard.writeText(roomId)
        showToast(t('room.roomIdCopied'), 'success')
      } catch (err) {
        AppLog.error('Failed to copy room ID', { error: err })
      }
    }
  }, [roomId, showToast, t])

  /**
   * Toggle sound notifications
   */
  const handleToggleSound = useCallback(() => {
    const newValue = !soundEnabled
    setSoundEnabled(newValue)
    soundManager.setEnabled(newValue)
    showToast(newValue ? t('room.soundEnabled') : t('room.soundDisabled'), 'info')
  }, [soundEnabled, showToast, t])

  // Aggregate errors
  const displayError = globalError || roomError || mediaError

  // Show overlay during signaling or connecting phases (but only if we're in room view)
  const showConnectionOverlay = appView === 'room' &&
    (connectionState === 'signaling' || connectionState === 'connecting' || connectionState === 'idle')

  // Render loading state
  if (!pipelineReady) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Initializing audio system...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-100">
      {/* Error Banner */}
      {displayError && (
        <ErrorBanner
          message={displayError}
          onDismiss={() => setGlobalError(null)}
        />
      )}

      {/* Connection Overlay with Cancel */}
      {showConnectionOverlay && (
        <ConnectionOverlay
          state={connectionState === 'idle' ? 'signaling' : connectionState}
          onCancel={handleCancelSearch}
        />
      )}

      {/* Leave Confirmation Dialog */}
      {showLeaveConfirm && (
        <LeaveConfirmDialog
          onConfirm={handleLeaveRoom}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}

      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onDismiss={() => dismissToast(toast.id)}
          />
        ))}
      </div>

      {/* Main Content */}
      {appView === 'lobby' && (
        <LobbyView
          onJoinRoom={handleJoinRoom}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          videoInputDevices={videoInputDevices}
          selectedInputDevice={selectedInputDevice}
          selectedOutputDevice={selectedOutputDevice}
          selectedVideoDevice={selectedVideoDevice}
          onInputDeviceChange={handleInputDeviceChange}
          onOutputDeviceChange={selectOutputDevice}
          onVideoDeviceChange={handleVideoDeviceChange}
          onRefreshDevices={refreshDevices}
          audioLevel={audioLevel}
          isLoading={mediaLoading}
          onOpenSettings={() => setAppView('settings')}
        />
      )}

      {appView === 'room' && (
        <RoomView
          userName={userName}
          roomId={roomId}
          localPeerId={localPeerId}
          localPlatform={localPlatform}
          peers={peers}
          remoteStreams={remoteStreams}
          localStream={localStream}
          connectionState={connectionState}
          isMuted={isMuted}
          isVideoEnabled={isVideoEnabled}
          isSpeakerMuted={isSpeakerMuted}
          audioLevel={audioLevel}
          selectedOutputDevice={selectedOutputDevice}
          inputDevices={inputDevices}
          videoInputDevices={videoInputDevices}
          outputDevices={outputDevices}
          selectedInputDevice={selectedInputDevice}
          selectedVideoDevice={selectedVideoDevice}
          soundEnabled={soundEnabled}
          onToggleMute={handleToggleMute}
          onToggleVideo={handleToggleVideo}
          onToggleSpeakerMute={handleToggleSpeakerMute}
          onLeaveRoom={() => setShowLeaveConfirm(true)}
          onInputDeviceChange={handleInputDeviceChange}
          onVideoDeviceChange={handleVideoDeviceChange}
          onOutputDeviceChange={selectOutputDevice}
          onCopyRoomId={handleCopyRoomId}
          onToggleSound={handleToggleSound}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          p2pManager={peerManager}
          chatMessages={chatMessages}
          onSendChatMessage={handleSendChatMessage}
          chatUnreadCount={chatUnreadCount}
          isChatOpen={isChatOpen}
          onToggleChat={handleToggleChat}
          onMarkChatRead={handleMarkChatRead}
          isScreenSharing={isScreenSharing}
          onToggleScreenShare={handleToggleScreenShare}
          remoteMicSession={remoteMicSession}
          virtualMicDeviceStatus={virtualMicDeviceStatus}
          virtualAudioInstallerState={virtualAudioInstallerState}
          onRequestRemoteMic={handleRequestRemoteMic}
          onRespondRemoteMicRequest={handleRespondRemoteMicRequest}
          onStopRemoteMic={handleStopRemoteMic}
          onOpenRemoteMicSetup={handleOpenRemoteMicSetup}
          onRemoteMicRoutingError={handleRemoteMicRoutingError}
        />
      )}

      {appView === 'settings' && (
        <SettingsPanel
          settings={settings}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          videoInputDevices={videoInputDevices}
          selectedInputDevice={selectedInputDevice}
          selectedOutputDevice={selectedOutputDevice}
          selectedVideoDevice={selectedVideoDevice}
          localStream={localStream}
          onSettingsChange={handleSettingsChange}
          onInputDeviceChange={handleInputDeviceChange}
          onOutputDeviceChange={selectOutputDevice}
          onVideoDeviceChange={handleVideoDeviceChange}
          onClose={() => setAppView('lobby')}
          onShowToast={showToast}
          virtualMicDeviceStatus={virtualMicDeviceStatus}
          virtualAudioInstallerState={virtualAudioInstallerState}
          onInstallRemoteMicDriver={handleInstallRemoteMicDriver}
          onRecheckRemoteMicDevice={handleRecheckVirtualMicDevice}
          onOpenRemoteMicSetup={handleOpenRemoteMicSetup}
        />
      )}
    </div>
  )
}
