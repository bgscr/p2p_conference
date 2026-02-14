/**
 * Main Application Component
 * P2P Conference System - Serverless Audio Conferencing
 */

import { useState, useCallback, useRef, useMemo } from 'react'
import { useRoom } from './hooks/useRoom'
import { useMediaStream } from './hooks/useMediaStream'
import { useI18n } from './hooks/useI18n'
import { peerManager } from './signaling'
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
  VirtualMicDeviceStatus
} from '@/types'
import { useScreenShare } from './hooks/useScreenShare'
import { useDataChannel } from './hooks/useDataChannel'
import { useConferenceHotkeys } from './hooks/useConferenceHotkeys'
import { useConferenceController } from './hooks/useConferenceController'
import { useAppRuntimeEffects } from './hooks/useAppRuntimeEffects'
import { useAppUiActions } from './hooks/useAppUiActions'
import { useModerationControls } from './hooks/useModerationControls'
import { useToastNotifications } from './hooks/useToastNotifications'
import { executeSessionExitCleanup } from './hooks/sessionExitCleanup'
import {
  useSessionLifecycle,
  normalizeRemoteMicStopReason,
  isVirtualMicOutputReady,
  getVirtualAudioProviderForPlatform,
  getVirtualAudioDeviceName
} from './hooks/useSessionLifecycle'
import { isFeatureEnabled } from './config/featureFlags'

// App states
type AppView = 'lobby' | 'room' | 'settings'

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

export {
  normalizeRemoteMicStopReason,
  isVirtualMicOutputReady,
  getVirtualAudioProviderForPlatform,
  getVirtualAudioDeviceName
}

export default function App() {
  const { t } = useI18n()
  const moderationEnabled = isFeatureEnabled('moderation_controls')
  const [appView, setAppView] = useState<AppView>('lobby')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [userName, setUserName] = useState<string>('')
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const {
    toasts,
    showToast,
    dismissToast,
    clearToasts
  } = useToastNotifications()
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false)
  const [isPushToTalkActive, setIsPushToTalkActive] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const audioPipelineRef = useRef(getAudioPipeline())
  const [pipelineReady, setPipelineReady] = useState(false)
  const localPlatform: 'win' | 'mac' | 'linux' = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('win')) return 'win'
    if (ua.includes('mac')) return 'mac'
    if (ua.includes('linux')) return 'linux'
    return 'win'  // Default
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

    setRemoteStreams(prev => {
      const updated = new Map(prev)
      updated.delete(peerId)
      return updated
    })
    addSystemMessage(t('chat.left', { name: peerName }))
  }, [soundEnabled, showToast, t, addSystemMessage])

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

  const {
    roomId,
    peers,
    localPeerId,
    connectionState,
    joinRoom,
    leaveRoom,
    error: roomError
  } = useRoom(roomCallbacks)

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
  } = useMediaStream()

  const {
    remoteMicSession,
    virtualAudioInstallerState,
    clearRemoteMicTimers,
    resetRemoteMicSession,
    handlePeerDisconnected,
    handleRequestRemoteMic,
    handleRespondRemoteMicRequest,
    handleStopRemoteMic,
    handleInstallRemoteMicDriver,
    handleRecheckVirtualMicDevice
  } = useSessionLifecycle({
    peerManager,
    t,
    showToast,
    localPlatform,
    localPeerId,
    peers,
    virtualMicDeviceStatus,
    refreshDevices
  })

  const {
    diagnosticsExportInProgress,
    handleCopyRoomId,
    handleToggleSound,
    handleOpenRemoteMicSetup,
    handleExportDiagnostics
  } = useAppUiActions({
    t,
    showToast,
    roomId,
    localPeerId,
    userName,
    connectionState,
    participantCount: peers.size + 1,
    remoteMicState: remoteMicSession.state,
    soundEnabled,
    setSoundEnabled,
    onCopyError: (error) => AppLog.error('Failed to copy room ID', { error }),
    onDiagnosticsError: (error) => AppLog.error('Diagnostics export failed', { error: String(error) })
  })

  const {
    isScreenSharing,
    startScreenShare,
    stopScreenShare
  } = useScreenShare(
    useCallback((stream: MediaStream) => {
      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        peerManager.replaceTrack(videoTrack)
        peerManager.broadcastMuteStatus(isMuted, isSpeakerMuted, true, true)
      }
    }, [isMuted, isSpeakerMuted]),
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

  const handleToggleMute = useCallback(() => {
    const newMuted = !isMuted
    const effectiveVideoEnabled = isScreenSharing ? true : isVideoEnabled
    toggleMute()
    if (soundEnabled) {
      soundManager.playClick()
    }
    peerManager.broadcastMuteStatus(newMuted, isSpeakerMuted, effectiveVideoEnabled, isScreenSharing)
  }, [toggleMute, soundEnabled, isMuted, isSpeakerMuted, isVideoEnabled, isScreenSharing])

  const handleToggleSpeakerMute = useCallback(() => {
    const newSpeakerMuted = !isSpeakerMuted
    const effectiveVideoEnabled = isScreenSharing ? true : isVideoEnabled
    setIsSpeakerMuted(newSpeakerMuted)
    if (soundEnabled) {
      soundManager.playClick()
    }
    peerManager.broadcastMuteStatus(isMuted, newSpeakerMuted, effectiveVideoEnabled, isScreenSharing)
  }, [soundEnabled, isMuted, isSpeakerMuted, isVideoEnabled, isScreenSharing])

  const handleToggleVideo = useCallback(() => {
    const newVideoEnabled = !isVideoEnabled
    const effectiveVideoEnabled = isScreenSharing ? true : newVideoEnabled
    toggleVideo()
    peerManager.broadcastMuteStatus(isMuted, isSpeakerMuted, effectiveVideoEnabled, isScreenSharing)
  }, [toggleVideo, isVideoEnabled, isMuted, isSpeakerMuted, isScreenSharing])

  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare()
    } else {
      const hasNativeScreenShare = typeof navigator.mediaDevices?.getDisplayMedia === 'function'
      const hasElectronFallback = typeof window.electronAPI?.getScreenSources === 'function'
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

  const handleRequestLeaveConfirm = useCallback(() => {
    setShowLeaveConfirm(true)
  }, [])

  useAppRuntimeEffects({
    p2pManager: peerManager,
    audioPipeline: audioPipelineRef.current,
    peers,
    appView,
    connectionState,
    isMuted,
    localStream,
    showToast,
    t,
    clearToasts,
    clearRemoteMicTimers,
    onToggleMute: handleToggleMute,
    onRequestLeaveConfirm: handleRequestLeaveConfirm,
    onPipelineReady: setPipelineReady,
    onPeerDisconnected: handlePeerDisconnected,
    setRemoteStreams
  })

  const muteLocalForModeration = useCallback(() => {
    if (isMuted) {
      return
    }

    const effectiveVideoEnabled = isScreenSharing ? true : isVideoEnabled
    toggleMute()
    peerManager.broadcastMuteStatus(true, isSpeakerMuted, effectiveVideoEnabled, isScreenSharing)
    if (soundEnabled) {
      soundManager.playClick()
    }
  }, [isMuted, isScreenSharing, isSpeakerMuted, isVideoEnabled, soundEnabled, toggleMute])

  const {
    roomLocked,
    roomLockOwnerName,
    raisedHandQueue,
    isHandRaised,
    pendingMuteAllRequest,
    resetModerationState,
    handleToggleRoomLock,
    handleRequestMuteAll,
    handleToggleHandRaise,
    handleRespondMuteAllRequest
  } = useModerationControls({
    enabled: moderationEnabled,
    peerManager,
    localPeerId,
    userName,
    peers,
    isMuted,
    muteLocalForModeration,
    showToast,
    t,
    setGlobalError
  })

  const handleSendChatMessage = useCallback((content: string) => {
    sendChatMessage(content)
  }, [sendChatMessage])

  const handleToggleChat = useCallback(() => {
    setIsChatOpen(prev => {
      if (!prev) {
        markChatAsRead()
      }
      return !prev
    })
  }, [markChatAsRead])

  const handleMarkChatRead = useCallback(() => {
    markChatAsRead()
  }, [markChatAsRead])

  const handleCancelSearch = useCallback(() => {
    AppLog.info('User cancelled search')
    executeSessionExitCleanup({
      leaveRoom,
      stopCapture,
      isScreenSharing,
      stopScreenShare,
      stopRemoteMicSession: () => { peerManager.stopRemoteMicSession('unknown') },
      resetRemoteMicSession: () => { resetRemoteMicSession({ state: 'idle' }) },
      disconnectAudioPipeline: () => audioPipelineRef.current.disconnect(),
      clearRemoteStreams: () => setRemoteStreams(new Map()),
      resetPushToTalk: () => setIsPushToTalkActive(false),
      closeChat: () => setIsChatOpen(false),
      resetModerationState,
      resetChat,
      setAppView
    })
  }, [leaveRoom, stopCapture, isScreenSharing, stopScreenShare, resetChat, resetModerationState, resetRemoteMicSession])

  const handleDownloadLogsShortcut = useCallback(() => {
    AppLog.info('Log download triggered via keyboard shortcut')
    logger.downloadLogs()
  }, [])

  const {
    handleJoinRoom,
    handleInputDeviceChange,
    handleVideoDeviceChange,
    handleSettingsChange
  } = useConferenceController({
    p2pManager: peerManager,
    settings,
    isMuted,
    isSpeakerMuted,
    audioPipeline: audioPipelineRef.current,
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
  })

  useConferenceHotkeys({
    appView,
    connectionState,
    showToast,
    translate: t,
    onToggleMute: handleToggleMute,
    onToggleSpeakerMute: handleToggleSpeakerMute,
    onToggleVideo: handleToggleVideo,
    onToggleChat: handleToggleChat,
    onToggleScreenShare: handleToggleScreenShare,
    onCancelSearch: handleCancelSearch,
    onRequestLeaveConfirm: handleRequestLeaveConfirm,
    onDownloadLogs: handleDownloadLogsShortcut,
    pushToTalkEnabled: isFeatureEnabled('push_to_talk') && Boolean(settings.pushToTalkEnabled),
    pushToTalkKey: settings.pushToTalkKey || 'space',
    isMuted,
    onPushToTalkStateChange: setIsPushToTalkActive
  })

  const handleLeaveRoom = useCallback(() => {
    AppLog.info('Leaving room', { roomId })
    setShowLeaveConfirm(false)
    executeSessionExitCleanup({
      leaveRoom,
      stopCapture,
      isScreenSharing,
      stopScreenShare,
      stopRemoteMicSession: () => { peerManager.stopRemoteMicSession('unknown') },
      resetRemoteMicSession: () => { resetRemoteMicSession({ state: 'idle' }) },
      disconnectAudioPipeline: () => audioPipelineRef.current.disconnect(),
      clearRemoteStreams: () => setRemoteStreams(new Map()),
      resetSpeakerMute: () => setIsSpeakerMuted(false),
      resetPushToTalk: () => setIsPushToTalkActive(false),
      closeChat: () => setIsChatOpen(false),
      resetModerationState,
      resetChat,
      setAppView
    })
  }, [leaveRoom, stopCapture, roomId, isScreenSharing, stopScreenShare, resetChat, resetModerationState, resetRemoteMicSession])

  const handleRemoteMicRoutingError = useCallback((peerId: string, error: string) => {
    AppLog.error('Remote mic sink routing failed', { peerId, error })
    showToast(t('remoteMic.routingFailed'), 'error')
    handleStopRemoteMic('routing-failed')
  }, [showToast, t, handleStopRemoteMic])

  const displayError = globalError || roomError || mediaError

  const showConnectionOverlay = appView === 'room' &&
    (connectionState === 'signaling' || connectionState === 'connecting' || connectionState === 'idle')

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
          pushToTalkEnabled={isFeatureEnabled('push_to_talk') && Boolean(settings.pushToTalkEnabled)}
          isPushToTalkActive={isFeatureEnabled('push_to_talk') && isPushToTalkActive}
          remoteMicSession={remoteMicSession}
          virtualMicDeviceStatus={virtualMicDeviceStatus}
          virtualAudioInstallerState={virtualAudioInstallerState}
          onRequestRemoteMic={handleRequestRemoteMic}
          onRespondRemoteMicRequest={handleRespondRemoteMicRequest}
          onStopRemoteMic={handleStopRemoteMic}
          onOpenRemoteMicSetup={handleOpenRemoteMicSetup}
          onRemoteMicRoutingError={handleRemoteMicRoutingError}
          moderationEnabled={moderationEnabled}
          roomLocked={roomLocked}
          roomLockOwnerName={roomLockOwnerName}
          raisedHands={raisedHandQueue}
          isHandRaised={isHandRaised}
          pendingMuteAllRequest={pendingMuteAllRequest}
          onToggleRoomLock={handleToggleRoomLock}
          onRequestMuteAll={handleRequestMuteAll}
          onToggleHandRaise={handleToggleHandRaise}
          onRespondMuteAllRequest={handleRespondMuteAllRequest}
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
          onExportDiagnostics={isFeatureEnabled('diagnostics_panel') ? handleExportDiagnostics : undefined}
          diagnosticsExportInProgress={isFeatureEnabled('diagnostics_panel') ? diagnosticsExportInProgress : undefined}
        />
      )}
    </div>
  )
}

