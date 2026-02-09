/**
 * RoomView Component
 * Main conference room interface showing participants and controls
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { ParticipantCard } from './ParticipantCard'
import { AudioMeter } from './AudioMeter'
import { DeviceSelector } from './DeviceSelector'
import { ChatPanel } from './ChatPanel'
import { useI18n } from '../hooks/useI18n'
import { logger } from '../utils/Logger'
import type { Peer, AudioDevice, ConnectionState, AppSettings, ConnectionQuality, ChatMessage } from '@/types'
import { SimplePeerManager } from '../signaling/SimplePeerManager'

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
  p2pManager?: SimplePeerManager
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
  onToggleScreenShare
}) => {
  const { t } = useI18n()
  const [showDevicePanel, setShowDevicePanel] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [copied, setCopied] = useState(false)
  const [peerVolumes, setPeerVolumes] = useState<Map<string, number>>(new Map())
  const [connectionStats, setConnectionStats] = useState<Map<string, ConnectionQuality>>(new Map())
  const [networkStatus, setNetworkStatus] = useState<{
    isOnline: boolean
    isReconnecting: boolean
    reconnectAttempts: number
  }>({ isOnline: true, isReconnecting: false, reconnectAttempts: 0 })

  const startTimeRef = useRef(Date.now())
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peerVolumeHandlersRef = useRef<Map<string, (volume: number) => void>>(new Map())

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

  // Clean up per-peer volume state/callbacks for peers that left.
  useEffect(() => {
    const activePeerIds = new Set(peers.keys())

    peerVolumeHandlersRef.current.forEach((_, peerId) => {
      if (!activePeerIds.has(peerId)) {
        peerVolumeHandlersRef.current.delete(peerId)
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

  // Periodic connection stats update
  useEffect(() => {
    if (!p2pManager) return

    const updateStats = async () => {
      const stats = await p2pManager.getConnectionStats()
      setConnectionStats(prev => {
        // Only update if stats actually changed to avoid unnecessary re-renders
        if (prev.size !== stats.size) return stats
        for (const [peerId, quality] of stats) {
          const prevQuality = prev.get(peerId)
          if (!prevQuality ||
            prevQuality.quality !== quality.quality ||
            prevQuality.rtt !== quality.rtt ||
            prevQuality.packetLoss !== quality.packetLoss ||
            prevQuality.jitter !== quality.jitter) {
            return stats
          }
        }
        return prev
      })
    }

    // Initial update
    updateStats()

    const interval = setInterval(updateStats, 2000)
    return () => clearInterval(interval)
  }, [p2pManager])

  // Network status monitoring
  useEffect(() => {
    if (!p2pManager) return

    // Set up network status change callback
    p2pManager.setOnNetworkStatusChange((isOnline) => {
      const status = p2pManager.getNetworkStatus()
      setNetworkStatus({
        isOnline,
        isReconnecting: status.wasInRoomWhenOffline && !isOnline,
        reconnectAttempts: status.reconnectAttempts
      })
    })

    // Also poll network status periodically (for reconnect attempts counter)
    const statusInterval = setInterval(() => {
      const status = p2pManager.getNetworkStatus()
      setNetworkStatus(prev => {
        // Only update if changed
        if (prev.isOnline !== status.isOnline ||
          prev.reconnectAttempts !== status.reconnectAttempts ||
          prev.isReconnecting !== status.wasInRoomWhenOffline) {
          return {
            isOnline: status.isOnline,
            isReconnecting: status.wasInRoomWhenOffline && status.reconnectAttempts > 0,
            reconnectAttempts: status.reconnectAttempts
          }
        }
        return prev
      })
    }, 1000)

    return () => {
      clearInterval(statusInterval)
      p2pManager.setOnNetworkStatusChange(() => { })  // Clear callback
    }
  }, [p2pManager])

  // Manual reconnect handler
  const handleManualReconnect = async () => {
    if (p2pManager) {
      await p2pManager.manualReconnect()
    }
  }

  // Format duration
  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Connection status text
  const getStatusText = (): string => {
    switch (connectionState) {
      case 'idle': return t('room.notConnected')
      case 'signaling': return t('room.searchingParticipants')
      case 'connecting': return t('room.connecting')
      case 'connected': return t('room.participantsConnected', { count: peers.size })
      case 'failed': return t('room.connectionFailed')
      default: return ''
    }
  }

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

  // Handle download logs
  const handleDownloadLogs = () => {
    logger.downloadLogs()
  }

  const peersArray = Array.from(peers.values())
  const participantCount = peersArray.length + 1
  const canToggleScreenShare = isScreenSharing || peersArray.length > 0

  // Show warning if approaching limit
  const showParticipantWarning = participantCount >= 8

  return (
    <div className="flex h-full">
    <div className="flex flex-col flex-1 min-w-0">
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
              <span className="text-sm text-gray-600">{getStatusText()}</span>
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

      {/* Main Content - Participants Grid */}
      <main className="flex-1 p-4 overflow-y-auto">
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
              return (
                <ParticipantCard
                  key={peer.id}
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
                  outputDeviceId={selectedOutputDevice}
                  localSpeakerMuted={isSpeakerMuted}
                  volume={getPeerVolume(peer.id)}
                  onVolumeChange={getPeerVolumeChangeHandler(peer.id)}
                  platform={peer.platform}
                  connectionQuality={connectionStats.get(peer.id)}
                />
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
      </main>

      {/* Control Bar */}
      <footer className="bg-white border-t border-gray-200 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          {/* Left: Audio Level */}
          <div className="flex items-center gap-3 w-48">
            <AudioMeter level={isMuted ? 0 : audioLevel} size="sm" />
            <span className="text-xs text-gray-400">{isMuted ? t('room.muted') : t('room.live')}</span>
          </div>

          {/* Center: Main Controls */}
          <div className="flex items-center gap-3">
            {/* Camera Toggle Button */}
            <button
              onClick={onToggleVideo}
              className={`
                 w-14 h-14 rounded-full flex items-center justify-center transition-all
                 ${!isVideoEnabled
                  ? 'bg-red-100 text-red-600 hover:bg-red-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
               `}
              title={!isVideoEnabled ? t('room.startVideo') : t('room.stopVideo')}
              data-testid="room-video-btn"
            >
              {!isVideoEnabled ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>

            {/* Screen Share Button */}
            <button
              onClick={onToggleScreenShare}
              disabled={!canToggleScreenShare}
              className={`
                w-12 h-12 rounded-full flex items-center justify-center transition-all
                ${!canToggleScreenShare
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : isScreenSharing
                  ? 'bg-green-100 text-green-600 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
              title={isScreenSharing ? t('room.stopScreenShare') : t('room.screenShareHint')}
              data-testid="room-screenshare-btn"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </button>

            {/* Mute Microphone Button */}
            <button
              onClick={onToggleMute}
              className={`
                w-14 h-14 rounded-full flex items-center justify-center transition-all
                ${isMuted
                  ? 'bg-red-100 text-red-600 hover:bg-red-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
              title={isMuted ? t('room.unmuteHint') : t('room.muteHint')}
              data-testid="room-mute-btn"
            >
              {isMuted ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 3l18 18" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>

            {/* Mute Speaker Button */}
            <button
              onClick={onToggleSpeakerMute}
              className={`
                w-12 h-12 rounded-full flex items-center justify-center transition-all
                ${isSpeakerMuted
                  ? 'bg-red-100 text-red-600 hover:bg-red-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
              title={isSpeakerMuted ? t('room.speakerMuted') : t('common.speaker')}
              data-testid="room-speaker-btn"
            >
              {isSpeakerMuted ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              )}
            </button>

            {/* Sound Notifications Toggle */}
            <button
              onClick={onToggleSound}
              className={`
                w-12 h-12 rounded-full flex items-center justify-center transition-all
                ${soundEnabled
                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                }
              `}
              title={soundEnabled ? t('room.muteNotifications') : t('room.enableNotifications')}
              data-testid="room-sound-btn"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                {!soundEnabled && (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                )}
              </svg>
            </button>

            {/* Chat Toggle */}
            <button
              onClick={() => {
                onToggleChat()
                if (!isChatOpen) onMarkChatRead()
              }}
              className={`
                w-12 h-12 rounded-full flex items-center justify-center transition-all relative
                ${isChatOpen
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
              title={t('room.toggleChat')}
              data-testid="room-chat-btn"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {chatUnreadCount > 0 && !isChatOpen && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center" data-testid="chat-unread-badge">
                  {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                </span>
              )}
            </button>

            {/* Device Settings */}
            <button
              onClick={() => setShowDevicePanel(!showDevicePanel)}
              className={`
                w-12 h-12 rounded-full flex items-center justify-center transition-all
                ${showDevicePanel
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
              title={t('room.audioSettings')}
              data-testid="room-settings-btn"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {/* Leave Button */}
            <button
              onClick={onLeaveRoom}
              className="w-14 h-14 rounded-full bg-red-600 text-white hover:bg-red-700 flex items-center justify-center transition-colors"
              title={t('room.leaveCallHint')}
              data-testid="room-leave-btn"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
              </svg>
            </button>
          </div>

          {/* Right: Participant Count */}
          <div className="w-48 text-right">
            <span className={`text-sm ${showParticipantWarning ? 'text-yellow-600 font-medium' : 'text-gray-500'}`}>
              {participantCount} {t('room.inCall')}
            </span>
          </div>
        </div>

        {/* Device Panel */}
        {showDevicePanel && (
          <div className="max-w-4xl mx-auto mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 animate-fade-in">
            <DeviceSelector
              label={t('common.microphone')}
              devices={inputDevices}
              selectedDeviceId={selectedInputDevice}
              onSelect={onInputDeviceChange}
              icon="mic"
            />
            <DeviceSelector
              label={t('common.camera')}
              devices={videoInputDevices}
              selectedDeviceId={selectedVideoDevice}
              onSelect={onVideoDeviceChange}
              icon="video"
            />
            <DeviceSelector
              label={t('common.speaker')}
              devices={outputDevices}
              selectedDeviceId={selectedOutputDevice}
              onSelect={onOutputDeviceChange}
              icon="speaker"
            />

            {/* Noise Suppression Toggle */}
            <div className="col-span-2 flex items-center justify-between py-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.noiseSuppressionEnabled}
                  onChange={(e) => onSettingsChange({ noiseSuppressionEnabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{t('room.noiseSuppressionBrowser')}</span>
              </label>
              <span className="text-xs text-gray-500">
                {settings.noiseSuppressionEnabled ? t('room.on') : t('room.off')}
              </span>
            </div>

            {/* Download Logs Button */}
            <div className="col-span-2 flex items-center justify-between py-2 border-t border-gray-100 mt-2">
              <span className="text-sm text-gray-600">{t('room.havingIssues')}</span>
              <button
                onClick={handleDownloadLogs}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t('room.downloadLogs')}
              </button>
            </div>
          </div>
        )}
      </footer>
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
