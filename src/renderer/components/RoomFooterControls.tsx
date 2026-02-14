import { useState } from 'react'
import { AudioMeter } from './AudioMeter'
import { DeviceSelector } from './DeviceSelector'
import { logger } from '../utils/Logger'
import type { AudioDevice, AppSettings } from '@/types'

interface RoomFooterControlsProps {
  t: (key: string, params?: Record<string, string | number>) => string
  isMuted: boolean
  audioLevel: number
  isVideoEnabled: boolean
  isSpeakerMuted: boolean
  isScreenSharing: boolean
  canToggleScreenShare: boolean
  soundEnabled: boolean
  isChatOpen: boolean
  chatUnreadCount: number
  showParticipantWarning: boolean
  participantCount: number
  inputDevices: AudioDevice[]
  videoInputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  selectedInputDevice: string | null
  selectedVideoDevice: string | null
  selectedOutputDevice: string | null
  settings: AppSettings
  onToggleVideo: () => void
  onToggleScreenShare: () => void
  onToggleMute: () => void
  onToggleSpeakerMute: () => void
  onToggleSound: () => void
  onToggleChat: () => void
  onMarkChatRead: () => void
  onLeaveRoom: () => void
  onInputDeviceChange: (deviceId: string) => void
  onVideoDeviceChange: (deviceId: string) => void
  onOutputDeviceChange: (deviceId: string) => void
  onSettingsChange: (settings: Partial<AppSettings>) => void
  moderationEnabled?: boolean
  isRoomLocked?: boolean
  isHandRaised?: boolean
  onToggleRoomLock?: () => void
  onRequestMuteAll?: () => void
  onToggleHandRaise?: () => void
}

export function RoomFooterControls({
  t,
  isMuted,
  audioLevel,
  isVideoEnabled,
  isSpeakerMuted,
  isScreenSharing,
  canToggleScreenShare,
  soundEnabled,
  isChatOpen,
  chatUnreadCount,
  showParticipantWarning,
  participantCount,
  inputDevices,
  videoInputDevices,
  outputDevices,
  selectedInputDevice,
  selectedVideoDevice,
  selectedOutputDevice,
  settings,
  onToggleVideo,
  onToggleScreenShare,
  onToggleMute,
  onToggleSpeakerMute,
  onToggleSound,
  onToggleChat,
  onMarkChatRead,
  onLeaveRoom,
  onInputDeviceChange,
  onVideoDeviceChange,
  onOutputDeviceChange,
  onSettingsChange,
  moderationEnabled = false,
  isRoomLocked = false,
  isHandRaised = false,
  onToggleRoomLock,
  onRequestMuteAll,
  onToggleHandRaise
}: RoomFooterControlsProps) {
  const [showDevicePanel, setShowDevicePanel] = useState(false)

  const handleDownloadLogs = () => {
    logger.downloadLogs()
  }

  return (
    <footer className="bg-white border-t border-gray-200 px-4 py-4">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3 w-48">
          <AudioMeter level={isMuted ? 0 : audioLevel} size="sm" />
          <span className="text-xs text-gray-400">{isMuted ? t('room.muted') : t('room.live')}</span>
        </div>

        <div className="flex items-center gap-3">
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

          {moderationEnabled && (
            <>
              <button
                onClick={onToggleRoomLock}
                className={`
                  w-12 h-12 rounded-full flex items-center justify-center transition-all
                  ${isRoomLocked
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
                title={isRoomLocked ? t('moderation.unlockRoom') : t('moderation.lockRoom')}
                data-testid="room-lock-btn"
              >
                {isRoomLocked ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 11V7a3 3 0 10-6 0v4m11 0a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6a2 2 0 012-2h16z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 11V7a4 4 0 118 0m-8 4h8m-8 0a2 2 0 00-2 2v6a2 2 0 002 2m8-10a2 2 0 012 2v6a2 2 0 01-2 2m-8 0h8" />
                  </svg>
                )}
              </button>

              <button
                onClick={onRequestMuteAll}
                className="w-12 h-12 rounded-full flex items-center justify-center transition-all bg-rose-100 text-rose-700 hover:bg-rose-200"
                title={t('moderation.requestMuteAll')}
                data-testid="room-mute-all-btn"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5a3 3 0 016 0v6a3 3 0 11-6 0V5zM5 11a7 7 0 0014 0m-7 7v3m0 0H9m3 0h3" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                </svg>
              </button>

              <button
                onClick={onToggleHandRaise}
                className={`
                  w-12 h-12 rounded-full flex items-center justify-center transition-all
                  ${isHandRaised
                    ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
                title={isHandRaised ? t('moderation.lowerHand') : t('moderation.raiseHand')}
                data-testid="room-hand-raise-btn"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M7 11V7a1 1 0 112 0v4m0 0V5a1 1 0 112 0v6m0 0V6a1 1 0 112 0v5m0 0V8a1 1 0 112 0v6.5a3.5 3.5 0 01-3.5 3.5h-2A4.5 4.5 0 016 13.5V12a1 1 0 112 0v-.5z" />
                </svg>
              </button>
            </>
          )}

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

        <div className="w-48 text-right">
          <span className={`text-sm ${showParticipantWarning ? 'text-yellow-600 font-medium' : 'text-gray-500'}`}>
            {participantCount} {t('room.inCall')}
          </span>
        </div>
      </div>

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
  )
}
