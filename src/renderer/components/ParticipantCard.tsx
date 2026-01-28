/**
 * ParticipantCard Component
 * Displays a single participant in the conference room
 */

import React, { useRef, useEffect, useState } from 'react'
import { AudioMeter } from './AudioMeter'
import { useI18n } from '../hooks/useI18n'
import { AudioLog } from '../utils/Logger'

interface ParticipantCardProps {
  name: string
  peerId: string
  isMicMuted: boolean
  isSpeakerMuted: boolean
  isLocal: boolean
  audioLevel: number
  connectionState: RTCPeerConnectionState | 'connected'
  stream?: MediaStream
  outputDeviceId?: string | null
  localSpeakerMuted?: boolean  // Whether local user has muted their speaker
  volume?: number  // Per-participant volume (0-150, 100 = normal)
  onVolumeChange?: (volume: number) => void  // Callback for volume change
  platform?: 'win' | 'mac' | 'linux'
}

export const ParticipantCard: React.FC<ParticipantCardProps> = ({
  name,
  peerId,
  isMicMuted,
  isSpeakerMuted,
  isLocal,
  audioLevel,
  connectionState,
  stream,
  outputDeviceId,
  localSpeakerMuted = false,
  volume = 100,
  onVolumeChange,
  platform
}) => {
  const { t } = useI18n()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationRef = useRef<number | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)

  // Set up audio playback for remote streams
  useEffect(() => {
    if (!stream || isLocal) return

    const audioElement = audioRef.current
    if (!audioElement) return

    AudioLog.debug('Setting up audio playback', {
      peerId,
      streamId: stream.id,
      trackCount: stream.getTracks().length,
      audioTracks: stream.getAudioTracks().length
    })

    // Verify stream has audio tracks
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      AudioLog.error('Stream has no audio tracks!', { peerId, streamId: stream.id })
      return
    }

    // Log track state
    audioTracks.forEach((track, idx) => {
      AudioLog.debug(`Audio track ${idx}`, {
        id: track.id,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      })
    })

    audioElement.srcObject = stream

    // Mute audio element if local speaker is muted
    audioElement.muted = localSpeakerMuted

    // Try to play with retry mechanism
    const playAudio = async () => {
      try {
        await audioElement.play()
        AudioLog.info('Audio playback started successfully', { peerId })
      } catch (err: any) {
        AudioLog.warn('Autoplay blocked, will retry on user interaction', { error: err.message })

        // Set up a one-time click handler to retry playback
        const handleUserInteraction = () => {
          audioElement.play()
            .then(() => AudioLog.info('Audio playback started after user interaction', { peerId }))
            .catch(e => AudioLog.error('Still failed to play after interaction', e))
          document.removeEventListener('click', handleUserInteraction)
          document.removeEventListener('keydown', handleUserInteraction)
        }

        document.addEventListener('click', handleUserInteraction, { once: true })
        document.addEventListener('keydown', handleUserInteraction, { once: true })
      }
    }

    playAudio()

    // Set up audio level monitoring
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }

    const ctx = audioContextRef.current
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyserRef.current = analyser

    // Create gain node for per-participant volume control
    const gainNode = ctx.createGain()
    gainNode.gain.value = volume / 100
    gainNodeRef.current = gainNode

    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)
    // Note: We use the audio element for playback, gain is controlled via element.volume
    // The gainNode here is for future AudioContext-based playback if needed

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      setRemoteAudioLevel(Math.min(100, (avg / 128) * 100))
      animationRef.current = requestAnimationFrame(updateLevel)
    }

    updateLevel()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect()
        gainNodeRef.current = null
      }
    }
  }, [stream, isLocal])

  // Update audio element volume when volume prop changes
  useEffect(() => {
    const audioElement = audioRef.current
    if (audioElement && !isLocal) {
      // HTML audio element volume is 0-1, but we allow up to 150% (1.5)
      audioElement.volume = Math.min(1, volume / 100)
      // For volumes > 100%, we'd need Web Audio API gain node
      // For now, cap at 100% on element level
    }
  }, [volume, isLocal])

  // Update muted state when localSpeakerMuted changes
  useEffect(() => {
    const audioElement = audioRef.current
    if (audioElement && !isLocal) {
      audioElement.muted = localSpeakerMuted
    }
  }, [localSpeakerMuted, isLocal])

  // Set output device for remote audio
  useEffect(() => {
    const audioElement = audioRef.current
    if (!audioElement || !outputDeviceId || isLocal) return

    if ('setSinkId' in audioElement) {
      (audioElement as any).setSinkId(outputDeviceId).catch((err: Error) => {
        AudioLog.warn('Failed to set output device', err)
      })
    }
  }, [outputDeviceId, isLocal])

  // Get connection status color
  const getStatusColor = (): string => {
    switch (connectionState) {
      case 'connected':
        return 'bg-green-500'
      case 'connecting':
        return 'bg-yellow-500'
      case 'disconnected':
      case 'failed':
        return 'bg-red-500'
      default:
        return 'bg-gray-400'
    }
  }

  // Generate avatar initials
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  // Generate avatar color based on peer ID
  const getAvatarColor = (id: string): string => {
    const colors = [
      'bg-blue-500',
      'bg-green-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-teal-500',
      'bg-orange-500',
      'bg-cyan-500'
    ]
    const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[hash % colors.length]
  }

  const displayLevel = isLocal ? audioLevel : remoteAudioLevel
  const showMicIndicator = isMicMuted
  const showSpeakerIndicator = isSpeakerMuted

  return (
    <div className={`
      card p-4 flex flex-col items-center gap-3 transition-all
      ${displayLevel > 10 && !isMicMuted ? 'ring-2 ring-green-400 ring-opacity-50' : ''}
    `}>
      {/* Hidden audio element for remote streams */}
      {!isLocal && <audio ref={audioRef} autoPlay playsInline />}

      {/* Avatar */}
      <div className="relative">
        <div className={`
          w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold
          ${isLocal ? 'bg-blue-600' : getAvatarColor(peerId)}
          ${displayLevel > 10 && !isMicMuted ? 'animate-pulse-ring' : ''}
        `}>
          {getInitials(name)}
        </div>

        {/* Mic mute indicator (bottom-right) */}
        {showMicIndicator && (
          <div
            className="absolute -bottom-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center"
            title={t('room.micMuted')}
          >
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
            </svg>
          </div>
        )}

        {/* Speaker mute indicator (bottom-left) */}
        {showSpeakerIndicator && (
          <div
            className="absolute -bottom-1 -left-1 w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center"
            title={t('room.speakerMuted')}
          >
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          </div>
        )}

        {/* Connection status dot */}
        <div className={`absolute top-0 right-0 w-3 h-3 rounded-full border-2 border-white ${getStatusColor()}`} />
      </div>

      {/* Name and Platform */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-1">
          {platform && (
            <span className="text-gray-400" title={platform === 'win' ? 'Windows' : platform === 'mac' ? 'macOS' : 'Linux'}>
              {platform === 'win' && (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                </svg>
              )}
              {platform === 'mac' && (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
              )}
              {platform === 'linux' && (
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587.26 1.35.352 2.14.352.79 0 1.553-.092 2.14-.352.237.482.68.83 1.208.946.75.2 1.69-.004 2.616-.47.865-.465 1.964-.4 2.774-.6.406-.13.766-.267.94-.6.175-.34.143-.804-.105-1.485-.076-.242-.018-.571.039-.97.028-.135.055-.337.055-.536a1.08 1.08 0 00-.132-.602c-.205-.41-.551-.544-.864-.68-.312-.133-.598-.2-.797-.4a3.36 3.36 0 01-.664-.839.443.443 0 00-.109-.135c.123-.805-.009-1.657-.287-2.49-.589-1.77-1.83-3.469-2.716-4.52-.75-1.067-.974-1.928-1.05-3.021-.065-1.49 1.056-5.965-3.17-6.298-.165-.013-.325-.021-.48-.021z" />
                </svg>
              )}
            </span>
          )}
          <p className="font-medium text-gray-900 text-sm truncate max-w-[120px]">
            {name}
          </p>
        </div>
        {!isLocal && connectionState !== 'connected' && (
          <p className="text-xs text-gray-500 capitalize">
            {connectionState}
          </p>
        )}
      </div>

      {/* Audio Level Meter */}
      <div className="w-full">
        <AudioMeter level={isMicMuted ? 0 : displayLevel} size="sm" />
      </div>

      {/* Per-participant Volume Control (for remote participants only) */}
      {!isLocal && onVolumeChange && (
        <div className="w-full mt-2">
          <button
            onClick={() => setShowVolumeSlider(!showVolumeSlider)}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 w-full justify-center"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            {volume}%
          </button>
          {showVolumeSlider && (
            <div className="mt-2 px-2 animate-fade-in">
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => onVolumeChange(parseInt(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
