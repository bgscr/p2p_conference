/**
 * RoomView Component
 * Main conference room interface showing participants and controls
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ParticipantCard } from './ParticipantCard'
import { ExpandedParticipantView } from './ExpandedParticipantView'
import { ChatPanel } from './ChatPanel'
import { RoomFooterControls } from './RoomFooterControls'
import { RoomModerationPanel } from './RoomModerationPanel'
import { formatDuration, getStatusText } from './roomViewHelpers'
import { useI18n } from '../hooks/useI18n'
import { useExpandedView } from '../hooks/useExpandedView'
import { useRoomConnectionMonitoring } from '../hooks/useRoomConnectionMonitoring'
import type {
  Peer,
  AudioDevice,
  ConnectionState,
  AppSettings,
  ChatMessage,
  RemoteMicSession,
  VirtualMicDeviceStatus
} from '@/types'
import type { PeerManager } from '../signaling'

interface RoomViewProps {
  userName: string
  roomId: string | null
  localPeerId: string
  localPlatform?: 'win' | 'mac' | 'linux'
  peers: Map<string, Peer>
  remoteStreams: Map<string, MediaStream>
  connectionState: ConnectionState
  isMuted: boolean
  isSpeakerMuted: boolean
  audioLevel: number
  selectedOutputDevice: string | null
  inputDevices: AudioDevice[]
  videoInputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  selectedInputDevice: string | null
  selectedVideoDevice: string | null
  localStream: MediaStream | null
  isVideoEnabled: boolean
  soundEnabled: boolean
  onToggleMute: () => void
  onToggleVideo: () => void
  onToggleSpeakerMute: () => void
  onLeaveRoom: () => void
  onInputDeviceChange: (deviceId: string) => void
  onVideoDeviceChange: (deviceId: string) => void
  onOutputDeviceChange: (deviceId: string) => void
  onCopyRoomId: () => void
  onToggleSound: () => void
  settings: AppSettings
  onSettingsChange: (settings: Partial<AppSettings>) => void
  p2pManager?: PeerManager
  // Chat props
  chatMessages: ChatMessage[]
  onSendChatMessage: (content: string) => void
  chatUnreadCount: number
  isChatOpen: boolean
  onToggleChat: () => void
  onMarkChatRead: () => void
  // Screen share props
  isScreenSharing: boolean
  onToggleScreenShare: () => void
  pushToTalkEnabled?: boolean
  isPushToTalkActive?: boolean
  // Remote microphone mapping
  remoteMicSession?: RemoteMicSession
  virtualMicDeviceStatus?: VirtualMicDeviceStatus
  virtualAudioInstallerState?: {
    inProgress: boolean
    platformSupported: boolean
    bundleReady?: boolean
    bundleMessage?: string
  }
  onRequestRemoteMic?: (targetPeerId: string) => void
  onRespondRemoteMicRequest?: (accepted: boolean) => void
  onStopRemoteMic?: () => void
  onOpenRemoteMicSetup?: () => void
  onRemoteMicRoutingError?: (peerId: string, error: string) => void
  // Moderation controls
  moderationEnabled?: boolean
  roomLocked?: boolean
  roomLockOwnerName?: string | null
  raisedHands?: Array<{
    peerId: string
    name: string
    raisedAt: number
    isLocal: boolean
  }>
  isHandRaised?: boolean
  pendingMuteAllRequest?: {
    requestId: string
    requestedByPeerId: string
    requestedByName: string
  } | null
  onToggleRoomLock?: () => void
  onRequestMuteAll?: () => void
  onToggleHandRaise?: () => void
  onRespondMuteAllRequest?: (requestId: string, accepted: boolean) => void
}

export const RoomView: React.FC<RoomViewProps> = ({
  userName,
  roomId,
  localPeerId,
  localPlatform,
  peers,
  remoteStreams,
  connectionState,
  isMuted,
  isSpeakerMuted,
  audioLevel,
  selectedOutputDevice,
  inputDevices,
  videoInputDevices,
  outputDevices,
  selectedInputDevice,
  selectedVideoDevice,
  localStream,
  isVideoEnabled,
  soundEnabled,
  onToggleMute,
  onToggleVideo,
  onToggleSpeakerMute,
  onLeaveRoom,
  onInputDeviceChange,
  onVideoDeviceChange,
  onOutputDeviceChange,
  onCopyRoomId,
  onToggleSound,
  settings,
  onSettingsChange,
  p2pManager,
  chatMessages,
  onSendChatMessage,
  chatUnreadCount,
  isChatOpen,
  onToggleChat,
  onMarkChatRead,
  isScreenSharing,
  onToggleScreenShare,
  pushToTalkEnabled = false,
  isPushToTalkActive = false,
  remoteMicSession = { state: 'idle' },
  virtualMicDeviceStatus,
  virtualAudioInstallerState,
  onRequestRemoteMic,
  onRespondRemoteMicRequest,
  onStopRemoteMic,
  onOpenRemoteMicSetup,
  onRemoteMicRoutingError,
  moderationEnabled = false,
  roomLocked = false,
  roomLockOwnerName = null,
  raisedHands = [],
  isHandRaised = false,
  pendingMuteAllRequest = null,
  onToggleRoomLock,
  onRequestMuteAll,
  onToggleHandRaise,
  onRespondMuteAllRequest
}) => {
  const { t } = useI18n()
  const [elapsedTime, setElapsedTime] = useState(0)
  const [copied, setCopied] = useState(false)
  const [peerVolumes, setPeerVolumes] = useState<Map<string, number>>(new Map())
  const [remoteMicCountdownSec, setRemoteMicCountdownSec] = useState(0)

  const startTimeRef = useRef(Date.now())
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peerVolumeHandlersRef = useRef<Map<string, (volume: number) => void>>(new Map())
  const expandHandlersRef = useRef<Map<string, () => void>>(new Map())
  const expandedViewRef = useRef<HTMLDivElement>(null)

  const { expandedPeerId, isFullscreen, expandPeer, enterFullscreen, collapse } = useExpandedView(peers)
  const {
    connectionStats,
    networkStatus,
    handleManualReconnect
  } = useRoomConnectionMonitoring(p2pManager)

  const isRemoteMicActive = remoteMicSession.state === 'active'
  const isRemoteMicSource = isRemoteMicActive && remoteMicSession.role === 'source'
  const isRemoteMicTarget = isRemoteMicActive && remoteMicSession.role === 'target'
  const remoteMicIsBusy = remoteMicSession.state === 'pendingIncoming' || remoteMicSession.state === 'pendingOutgoing' || remoteMicSession.state === 'active'
  const isInstallingRemoteDriver = Boolean(remoteMicSession.isInstallingVirtualDevice || virtualAudioInstallerState?.inProgress)
  const needsVirtualDeviceSetup = Boolean(remoteMicSession.needsVirtualDeviceSetup || !virtualMicDeviceStatus?.ready)
  const installerBundleReady = virtualAudioInstallerState?.bundleReady !== false
  const installerPrecheckReason = virtualAudioInstallerState?.bundleMessage || t('remoteMic.installBundleMissingReasonDefault')
  const canInlineInstall =
    (localPlatform === 'win' || localPlatform === 'mac') &&
    (virtualAudioInstallerState?.platformSupported ?? true) &&
    installerBundleReady
  const canAcceptIncomingRequest = !isInstallingRemoteDriver &&
    (virtualMicDeviceStatus?.ready || canInlineInstall)

  // Get volume for a peer (default 100%)
  const getPeerVolume = useCallback((peerId: string): number => {
    return peerVolumes.get(peerId) ?? 100
  }, [peerVolumes])

  // Handle per-participant volume change
  const handlePeerVolumeChange = useCallback((peerId: string, volume: number) => {
    setPeerVolumes(prev => {
      const updated = new Map(prev)
      updated.set(peerId, volume)
      return updated
    })
  }, [])

  // Get a stable callback per peer to keep memoized ParticipantCard updates predictable.
  const getPeerVolumeChangeHandler = useCallback((peerId: string) => {
    const existing = peerVolumeHandlersRef.current.get(peerId)
    if (existing) return existing

    const handler = (volume: number) => handlePeerVolumeChange(peerId, volume)
    peerVolumeHandlersRef.current.set(peerId, handler)
    return handler
  }, [handlePeerVolumeChange])

  // Get a stable expand callback per peer to avoid re-rendering memoized ParticipantCard.
  const getExpandHandler = useCallback((peerId: string) => {
    const existing = expandHandlersRef.current.get(peerId)
    if (existing) return existing

    const handler = () => expandPeer(peerId)
    expandHandlersRef.current.set(peerId, handler)
    return handler
  }, [expandPeer])

  // Clean up per-peer volume state/callbacks for peers that left.
  useEffect(() => {
    const activePeerIds = new Set(peers.keys())

    peerVolumeHandlersRef.current.forEach((_, peerId) => {
      if (!activePeerIds.has(peerId)) {
        peerVolumeHandlersRef.current.delete(peerId)
      }
    })

    expandHandlersRef.current.forEach((_, peerId) => {
      if (!activePeerIds.has(peerId)) {
        expandHandlersRef.current.delete(peerId)
      }
    })

    setPeerVolumes(prev => {
      let changed = false
      const updated = new Map(prev)
      prev.forEach((_, peerId) => {
        if (!activePeerIds.has(peerId)) {
          updated.delete(peerId)
          changed = true
        }
      })
      return changed ? updated : prev
    })
  }, [peers])

  // Timer for call duration
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Countdown for pending remote mic actions.
  useEffect(() => {
    if (
      (remoteMicSession.state !== 'pendingIncoming' && remoteMicSession.state !== 'pendingOutgoing') ||
      !remoteMicSession.expiresAt
    ) {
      setRemoteMicCountdownSec(0)
      return
    }

    const updateCountdown = () => {
      const remainingMs = Math.max(0, remoteMicSession.expiresAt! - Date.now())
      setRemoteMicCountdownSec(Math.ceil(remainingMs / 1000))
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 250)
    return () => clearInterval(interval)
  }, [remoteMicSession.expiresAt, remoteMicSession.state])

  // Handle copy with visual feedback
  const handleCopy = () => {
    onCopyRoomId()
    setCopied(true)
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
    }
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
  }

  // Cleanup copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const peersArray = Array.from(peers.values())
  const participantCount = peersArray.length + 1
  const canToggleScreenShare = isScreenSharing || peersArray.length > 0

  // Show warning if approaching limit
  const showParticipantWarning = participantCount >= 8

  return (
    <div className="flex h-full">
    <div className="relative flex flex-col flex-1 min-w-0">
      {/* Network Status Banner */}
      {(!networkStatus.isOnline || networkStatus.isReconnecting) && (
        <div className={`px-4 py-2 flex items-center justify-between ${!networkStatus.isOnline ? 'bg-red-500' : 'bg-yellow-500'
          } text-white text-sm`}>
          <div className="flex items-center gap-2">
            {!networkStatus.isOnline ? (
              <>
                <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656m-7.072 7.072a9 9 0 010-12.728m3.536 3.536a4 4 0 010 5.656" />
                </svg>
                <span>{t('room.networkOffline')}</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>{t('room.reconnecting')} ({networkStatus.reconnectAttempts}/5)</span>
              </>
            )}
          </div>
          {networkStatus.isOnline && (
            <button
              onClick={handleManualReconnect}
              className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded text-xs transition-colors"
            >
              {t('room.retryNow')}
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: Connection Status */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`status-dot ${connectionState === 'connected' ? 'status-connected' :
                connectionState === 'connecting' || connectionState === 'signaling' ? 'status-connecting' :
                  connectionState === 'failed' ? 'status-failed' : ''
                }`} />
              <span className="text-sm text-gray-600">{getStatusText(connectionState, peers.size, t)}</span>
            </div>
          </div>

          {/* Center: Room ID */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{t('lobby.roomId')}:</span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm font-mono text-gray-700 transition-colors"
              title={t('room.roomIdCopyHint')}
              data-testid="room-copy-btn"
            >
              {roomId}
              {copied ? (
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>

          {/* Right: Duration */}
          <div className="text-sm font-mono text-gray-500">
            {formatDuration(elapsedTime)}
          </div>
        </div>

        {/* Participant Warning */}
        {showParticipantWarning && (
          <div className="mt-2 px-3 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-2 text-sm text-yellow-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{t('room.performanceWarning', { count: participantCount })}</span>
          </div>
        )}
      </header>

      {pushToTalkEnabled && (
        <div className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-sm ${
          isPushToTalkActive
            ? 'border-green-200 bg-green-50 text-green-900'
            : 'border-gray-200 bg-gray-50 text-gray-700'
        }`}>
          {isPushToTalkActive
            ? t('room.pushToTalkSpeaking')
            : t('room.pushToTalkHold')}
        </div>
      )}

      <RoomModerationPanel
        enabled={moderationEnabled}
        roomLocked={roomLocked}
        roomLockOwnerName={roomLockOwnerName}
        raisedHands={raisedHands}
        pendingMuteAllRequest={pendingMuteAllRequest}
        onToggleRoomLock={onToggleRoomLock}
        onToggleHandRaise={onToggleHandRaise}
        onRespondMuteAllRequest={onRespondMuteAllRequest}
        t={t}
      />

      {/* Remote Mic Status Banner */}
      {(remoteMicSession.state === 'pendingOutgoing' || remoteMicSession.state === 'active') && (
        <div className="mx-4 mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 flex items-center justify-between">
          <div className="text-sm text-blue-900">
            {remoteMicSession.state === 'pendingOutgoing'
              ? t('remoteMic.waitingForApproval', { name: remoteMicSession.targetName || 'target' })
              : isRemoteMicSource
                ? t('remoteMic.activeAsSourceName', { name: remoteMicSession.targetName || 'target' })
                : t('remoteMic.activeAsTarget')}
            {(remoteMicSession.state === 'pendingOutgoing' && remoteMicCountdownSec > 0) && (
              <span className="ml-2 text-blue-700">({remoteMicCountdownSec}s)</span>
            )}
          </div>
          {onStopRemoteMic && (
            <button
              onClick={() => onStopRemoteMic?.()}
              className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              {t('remoteMic.stop')}
            </button>
          )}
        </div>
      )}

      {/* Virtual Mic Setup Hint (target role) */}
      {!isRemoteMicSource && virtualMicDeviceStatus && !virtualMicDeviceStatus.ready && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-900">
            {t('remoteMic.virtualDeviceHint', { device: virtualMicDeviceStatus.expectedDeviceHint })}
          </p>
          {onOpenRemoteMicSetup && (
            <button
              onClick={onOpenRemoteMicSetup}
              className="px-2 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors whitespace-nowrap"
            >
              {t('remoteMic.openSetup')}
            </button>
          )}
        </div>
      )}

      {/* Main Content - Participants Grid or Expanded View */}
      <main className="flex-1 p-4 overflow-y-auto">
        {expandedPeerId && peers.get(expandedPeerId) ? (
          <>
            {/* Expanded View */}
            <ExpandedParticipantView
              ref={expandedViewRef}
              peer={peers.get(expandedPeerId)!}
              stream={remoteStreams.get(expandedPeerId)}
              isFullscreen={isFullscreen}
              onCollapse={collapse}
              onEnterFullscreen={() => expandedViewRef.current && enterFullscreen(expandedViewRef.current)}
              connectionQuality={connectionStats.get(expandedPeerId)}
            />
            {/* Keep the expanded peer's ParticipantCard mounted but hidden for audio continuity */}
            {(() => {
              const peer = peers.get(expandedPeerId)!
              const isMappedSourcePeer = isRemoteMicTarget && remoteMicSession.sourcePeerId === peer.id
              const routeRole = isMappedSourcePeer ? 'virtualMic' as const : 'speaker' as const
              const mappedOutputDeviceId = routeRole === 'virtualMic'
                ? (virtualMicDeviceStatus?.outputDeviceId ?? null)
                : selectedOutputDevice
              return (
                <div hidden>
                  <ParticipantCard
                    name={peer.name}
                    peerId={peer.id}
                    isMicMuted={peer.isMuted}
                    isVideoMuted={peer.isVideoMuted === true}
                    isSpeakerMuted={peer.isSpeakerMuted || false}
                    isScreenSharing={peer.isScreenSharing}
                    isLocal={false}
                    audioLevel={peer.audioLevel}
                    connectionState={peer.connectionState}
                    stream={remoteStreams.get(peer.id)}
                    outputDeviceId={mappedOutputDeviceId}
                    localSpeakerMuted={routeRole === 'virtualMic' ? false : isSpeakerMuted}
                    volume={getPeerVolume(peer.id)}
                    onVolumeChange={getPeerVolumeChangeHandler(peer.id)}
                    platform={peer.platform}
                    connectionQuality={connectionStats.get(peer.id)}
                    routeRole={routeRole}
                    isRemoteMicMapped={isMappedSourcePeer}
                    onSinkRoutingError={onRemoteMicRoutingError}
                  />
                </div>
              )
            })()}
          </>
        ) : (
        <div className="max-w-4xl mx-auto">
          {/* Grid of participants */}
          <div className={`grid gap-4 ${peersArray.length === 0 ? 'grid-cols-1 max-w-xs mx-auto' :
            peersArray.length <= 1 ? 'grid-cols-2' :
              peersArray.length <= 3 ? 'grid-cols-2' :
                peersArray.length <= 5 ? 'grid-cols-3' :
                  'grid-cols-4'
            }`}>
            {/* Local User Card */}
            <ParticipantCard
              name={`${userName} (${t('room.you')})`}
              peerId={localPeerId}
              isMicMuted={isMuted}
              isVideoMuted={!isVideoEnabled}
              isSpeakerMuted={isSpeakerMuted}
              isScreenSharing={isScreenSharing}
              isLocal={true}
              audioLevel={audioLevel}
              connectionState="connected"
              stream={localStream || undefined}
              platform={localPlatform}
            />

            {/* Remote Participants */}
            {peersArray.map(peer => {
              const isMappedSourcePeer = isRemoteMicTarget && remoteMicSession.sourcePeerId === peer.id
              const routeRole = isMappedSourcePeer ? 'virtualMic' : 'speaker'
              const mappedOutputDeviceId = routeRole === 'virtualMic'
                ? (virtualMicDeviceStatus?.outputDeviceId ?? null)
                : selectedOutputDevice

              const canRequestMap = !remoteMicIsBusy || (isRemoteMicSource && remoteMicSession.targetPeerId === peer.id)
              const isMappedTarget = isRemoteMicSource && remoteMicSession.targetPeerId === peer.id

              return (
                <div key={peer.id} className="flex flex-col gap-2">
                  <ParticipantCard
                    name={peer.name}
                    peerId={peer.id}
                    isMicMuted={peer.isMuted}
                    isVideoMuted={peer.isVideoMuted === true}
                    isSpeakerMuted={peer.isSpeakerMuted || false}
                    isScreenSharing={peer.isScreenSharing}
                    isLocal={false}
                    audioLevel={peer.audioLevel}
                    connectionState={peer.connectionState}
                    stream={remoteStreams.get(peer.id)}
                    outputDeviceId={mappedOutputDeviceId}
                    localSpeakerMuted={routeRole === 'virtualMic' ? false : isSpeakerMuted}
                    volume={getPeerVolume(peer.id)}
                    onVolumeChange={getPeerVolumeChangeHandler(peer.id)}
                    platform={peer.platform}
                    connectionQuality={connectionStats.get(peer.id)}
                    routeRole={routeRole}
                    isRemoteMicMapped={isMappedSourcePeer || isMappedTarget}
                    onSinkRoutingError={onRemoteMicRoutingError}
                    onExpand={getExpandHandler(peer.id)}
                  />

                  {onRequestRemoteMic && (
                    <button
                      onClick={() => isMappedTarget ? onStopRemoteMic?.() : onRequestRemoteMic(peer.id)}
                      disabled={!canRequestMap}
                      className={`
                        px-2 py-1 rounded text-xs font-medium transition-colors
                        ${!canRequestMap
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : isMappedTarget
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        }
                      `}
                    >
                      {isMappedTarget ? t('remoteMic.stop') : t('remoteMic.mapMic')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Empty State */}
          {peersArray.length === 0 && connectionState !== 'connecting' && (
            <div className="text-center py-12 animate-fade-in">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
                <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <p className="text-gray-500 text-lg mb-2">{t('room.waitingForOthers')}</p>
              <p className="text-gray-400 text-sm mb-4">{t('room.shareRoomIdHint')}</p>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t('room.copied')}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {t('room.copyRoomId')}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        )}
      </main>

      {/* Incoming Remote Mic Request Modal */}
      {remoteMicSession.state === 'pendingIncoming' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200 p-5 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">{t('remoteMic.incomingTitle')}</h3>
            <p className="text-sm text-gray-600">
              {t('remoteMic.incomingPrompt', { name: remoteMicSession.sourceName || 'Unknown' })}
            </p>
            {needsVirtualDeviceSetup && !isInstallingRemoteDriver && installerBundleReady && (
              <p className="text-xs text-amber-700">
                {t('remoteMic.installPrompt', {
                  device: virtualMicDeviceStatus?.expectedDeviceHint ||
                    (localPlatform === 'mac' ? 'BlackHole 2ch' : 'VB-CABLE')
                })}
              </p>
            )}
            {needsVirtualDeviceSetup && !isInstallingRemoteDriver && !installerBundleReady && (
              <p className="text-xs text-red-700">
                {t('remoteMic.installBundleMissing', { reason: installerPrecheckReason })}
              </p>
            )}
            {isInstallingRemoteDriver && (
              <div className="space-y-1">
                <p className="text-xs text-blue-700">{t('remoteMic.installing')}</p>
                <p className="text-xs text-gray-500">{t('remoteMic.installNoCancel')}</p>
              </div>
            )}
            {remoteMicCountdownSec > 0 && (
              <p className="text-xs text-gray-500">{t('remoteMic.expiresIn', { seconds: remoteMicCountdownSec })}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => onRespondRemoteMicRequest?.(false)}
                disabled={isInstallingRemoteDriver}
                className={`
                  px-3 py-2 text-sm rounded border transition-colors
                  ${isInstallingRemoteDriver
                    ? 'border-gray-200 text-gray-400 cursor-not-allowed bg-gray-50'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                {t('remoteMic.reject')}
              </button>
              <button
                onClick={() => onRespondRemoteMicRequest?.(true)}
                disabled={!canAcceptIncomingRequest}
                className={`
                  px-3 py-2 text-sm rounded text-white transition-colors
                  ${canAcceptIncomingRequest
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-gray-400 cursor-not-allowed'
                  }
                `}
              >
                {isInstallingRemoteDriver
                  ? t('remoteMic.installing')
                  : needsVirtualDeviceSetup
                    ? t('remoteMic.installAndAccept')
                    : t('remoteMic.accept')}
              </button>
            </div>
          </div>
        </div>
      )}

      <RoomFooterControls
        t={t}
        isMuted={isMuted}
        audioLevel={audioLevel}
        isVideoEnabled={isVideoEnabled}
        isSpeakerMuted={isSpeakerMuted}
        isScreenSharing={isScreenSharing}
        canToggleScreenShare={canToggleScreenShare}
        soundEnabled={soundEnabled}
        isChatOpen={isChatOpen}
        chatUnreadCount={chatUnreadCount}
        showParticipantWarning={showParticipantWarning}
        participantCount={participantCount}
        inputDevices={inputDevices}
        videoInputDevices={videoInputDevices}
        outputDevices={outputDevices}
        selectedInputDevice={selectedInputDevice}
        selectedVideoDevice={selectedVideoDevice}
        selectedOutputDevice={selectedOutputDevice}
        settings={settings}
        onToggleVideo={onToggleVideo}
        onToggleScreenShare={onToggleScreenShare}
        onToggleMute={onToggleMute}
        onToggleSpeakerMute={onToggleSpeakerMute}
        onToggleSound={onToggleSound}
        onToggleChat={onToggleChat}
        onMarkChatRead={onMarkChatRead}
        onLeaveRoom={onLeaveRoom}
        onInputDeviceChange={onInputDeviceChange}
        onVideoDeviceChange={onVideoDeviceChange}
        onOutputDeviceChange={onOutputDeviceChange}
        onSettingsChange={onSettingsChange}
        moderationEnabled={moderationEnabled}
        isRoomLocked={roomLocked}
        isHandRaised={isHandRaised}
        onToggleRoomLock={onToggleRoomLock}
        onRequestMuteAll={onRequestMuteAll}
        onToggleHandRaise={onToggleHandRaise}
      />
    </div>

    {/* Chat Panel */}
    {isChatOpen && (
      <ChatPanel
        messages={chatMessages}
        onSendMessage={onSendChatMessage}
        onClose={onToggleChat}
      />
    )}
    </div>
  )
}
