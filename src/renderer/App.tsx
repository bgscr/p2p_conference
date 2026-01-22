/**
 * Main Application Component
 * P2P Conference System - Serverless Audio Conferencing
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
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

import type { ConnectionState, AppSettings } from '@/types'

// App states
type AppView = 'lobby' | 'room' | 'settings'

interface ToastMessage {
  id: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
}

interface MuteStatus {
  micMuted: boolean
  speakerMuted: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  noiseSuppressionEnabled: true,
  echoCancellationEnabled: true,
  autoGainControlEnabled: true,
  selectedInputDevice: null,
  selectedOutputDevice: null
}

export default function App() {
  const { t } = useI18n()
  const [appView, setAppView] = useState<AppView>('lobby')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [userName, setUserName] = useState<string>('')
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [remoteMuteStatuses, setRemoteMuteStatuses] = useState<Map<string, MuteStatus>>(new Map())
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false)
  
  // Audio pipeline
  const audioPipelineRef = useRef(getAudioPipeline())
  const [pipelineReady, setPipelineReady] = useState(false)

  /**
   * Show a toast notification
   */
  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  /**
   * Dismiss a toast
   */
  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  /**
   * Room callbacks for sound notifications
   */
  const roomCallbacks = {
    onPeerJoin: useCallback((peerId: string, peerName: string) => {
      AppLog.info('Peer joined', { peerId, peerName })
      if (soundEnabled) {
        soundManager.playJoin()
      }
      showToast(t('room.participantJoined', { name: peerName }), 'success')
    }, [soundEnabled, showToast, t]),
    
    onPeerLeave: useCallback((peerId: string, peerName: string) => {
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
      
      setRemoteMuteStatuses(prev => {
        const updated = new Map(prev)
        updated.delete(peerId)
        return updated
      })
    }, [soundEnabled, showToast, t]),
    
    onConnectionStateChange: useCallback((state: ConnectionState) => {
      AppLog.info('Connection state changed', { state })
      if (state === 'connected' && soundEnabled) {
        soundManager.playConnected()
      } else if (state === 'failed' && soundEnabled) {
        soundManager.playError()
      }
    }, [soundEnabled])
  }
  
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
    outputDevices,
    selectedInputDevice,
    selectedOutputDevice,
    isMuted,
    audioLevel,
    isLoading: mediaLoading,
    error: mediaError,
    startCapture,
    stopCapture,
    switchInputDevice,
    selectOutputDevice,
    toggleMute,
    refreshDevices
  } = useMediaStream()

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
    
    const electronAPI = (window as any).electronAPI
    
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
    
    return () => {
      unsubscribeDownloadLogs?.()
      unsubscribeTrayMute?.()
      unsubscribeTrayLeave?.()
      audioPipelineRef.current.destroy()
      soundManager.destroy()
      AppLog.info('Application cleanup')
    }
  }, [showToast, t])

  /**
   * Set up remote stream handler and mute status handler
   */
  useEffect(() => {
    peerManager.setCallbacks({
      onRemoteStream: (peerId: string, stream: MediaStream) => {
        AppLog.info('Remote stream received', { peerId, streamId: stream.id })
        setRemoteStreams(prev => {
          const updated = new Map(prev)
          updated.set(peerId, stream)
          return updated
        })
      },
      onError: (error: Error, context: string) => {
        AppLog.error('Peer manager error', { context, error: error.message })
        showToast(`Connection error: ${error.message}`, 'error')
      },
      onPeerMuteChange: (peerId: string, muteStatus: MuteStatus) => {
        AppLog.debug('Remote peer mute status changed', { peerId, ...muteStatus })
        setRemoteMuteStatuses(prev => {
          const updated = new Map(prev)
          updated.set(peerId, muteStatus)
          return updated
        })
      }
    })
  }, [showToast])

  /**
   * Sync call state with system tray
   */
  useEffect(() => {
    const electronAPI = (window as any).electronAPI
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
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.flashWindow && peers.size > 0 && !document.hasFocus()) {
      electronAPI.flashWindow()
    }
  }, [peers.size])

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
  }, [appView, connectionState, showToast, t])

  /**
   * Handle mute toggle with sound and broadcast to peers
   */
  const handleToggleMute = useCallback(() => {
    const newMuted = !isMuted
    toggleMute()
    if (soundEnabled) {
      soundManager.playClick()
    }
    // Broadcast mute status to all peers
    peerManager.broadcastMuteStatus(newMuted, isSpeakerMuted)
  }, [toggleMute, soundEnabled, isMuted, isSpeakerMuted])

  /**
   * Handle speaker mute toggle
   */
  const handleToggleSpeakerMute = useCallback(() => {
    const newSpeakerMuted = !isSpeakerMuted
    setIsSpeakerMuted(newSpeakerMuted)
    if (soundEnabled) {
      soundManager.playClick()
    }
    // Broadcast mute status to all peers
    peerManager.broadcastMuteStatus(isMuted, newSpeakerMuted)
  }, [soundEnabled, isMuted, isSpeakerMuted])

  /**
   * Cancel search and return to lobby
   */
  const handleCancelSearch = useCallback(() => {
    AppLog.info('User cancelled search')
    leaveRoom()
    stopCapture()
    audioPipelineRef.current.disconnect()
    setRemoteStreams(new Map())
    setRemoteMuteStatuses(new Map())
    setAppView('lobby')
  }, [leaveRoom, stopCapture])

  /**
   * Join room handler - switch to room view IMMEDIATELY, then start capture
   */
  const handleJoinRoom = useCallback(async (roomIdInput: string, name: string) => {
    setUserName(name)
    setGlobalError(null)
    
    AppLog.info('Attempting to join room', { roomId: roomIdInput, userName: name })
    
    // Switch to room view IMMEDIATELY so user sees the searching overlay
    setAppView('room')
    
    // Now do the async work (capture + join) - user sees the overlay during this
    try {
      // Start capture (this is the slow part)
      const stream = await startCapture({
        echoCancellation: settings.echoCancellationEnabled,
        noiseSuppression: settings.noiseSuppressionEnabled,
        autoGainControl: settings.autoGainControlEnabled
      })
      
      if (stream) {
        peerManager.setLocalStream(stream)
      }
      
      // Join the signaling room
      await joinRoom(roomIdInput, name)
      
      AppLog.info('Successfully joined room', { roomId: roomIdInput })
      
    } catch (err: any) {
      AppLog.error('Failed to join room', { roomId: roomIdInput, error: err })
      setGlobalError(err.message || t('errors.connectionFailed'))
      // Go back to lobby on error
      setAppView('lobby')
    }
  }, [startCapture, settings, joinRoom, t])

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
    leaveRoom()
    stopCapture()
    audioPipelineRef.current.disconnect()
    setRemoteStreams(new Map())
    setRemoteMuteStatuses(new Map())
    setIsSpeakerMuted(false)
    setAppView('lobby')
  }, [leaveRoom, stopCapture, roomId])

  /**
   * Handle input device change
   */
  const handleInputDeviceChange = useCallback(async (deviceId: string) => {
    AppLog.debug('Switching input device', { deviceId })
    await switchInputDevice(deviceId)
    
    if (localStream) {
      const newTrack = localStream.getAudioTracks()[0]
      if (newTrack) {
        peerManager.replaceTrack(newTrack)
      }
    }
  }, [switchInputDevice, localStream])

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
          selectedInputDevice={selectedInputDevice}
          selectedOutputDevice={selectedOutputDevice}
          onInputDeviceChange={handleInputDeviceChange}
          onOutputDeviceChange={selectOutputDevice}
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
          peers={peers}
          remoteStreams={remoteStreams}
          remoteMuteStatuses={remoteMuteStatuses}
          connectionState={connectionState}
          isMuted={isMuted}
          isSpeakerMuted={isSpeakerMuted}
          audioLevel={audioLevel}
          selectedOutputDevice={selectedOutputDevice}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          selectedInputDevice={selectedInputDevice}
          soundEnabled={soundEnabled}
          onToggleMute={handleToggleMute}
          onToggleSpeakerMute={handleToggleSpeakerMute}
          onLeaveRoom={() => setShowLeaveConfirm(true)}
          onInputDeviceChange={handleInputDeviceChange}
          onOutputDeviceChange={selectOutputDevice}
          onCopyRoomId={handleCopyRoomId}
          onToggleSound={handleToggleSound}
          settings={settings}
          onSettingsChange={handleSettingsChange}
        />
      )}
      
      {appView === 'settings' && (
        <SettingsPanel
          settings={settings}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          selectedInputDevice={selectedInputDevice}
          selectedOutputDevice={selectedOutputDevice}
          onSettingsChange={handleSettingsChange}
          onInputDeviceChange={handleInputDeviceChange}
          onOutputDeviceChange={selectOutputDevice}
          onClose={() => setAppView('lobby')}
          onShowToast={showToast}
        />
      )}
    </div>
  )
}
