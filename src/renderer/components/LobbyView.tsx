/**
 * LobbyView Component
 * Initial screen for entering room ID and configuring audio before joining
 */

import React, { useState, useEffect, useRef } from 'react'
import { DeviceSelector } from './DeviceSelector'
import { AudioMeter } from './AudioMeter'
import { useI18n } from '../hooks/useI18n'
import { UILog } from '../utils/Logger'
import { getAudioPipeline } from '../audio-processor/AudioPipeline'
import type { AudioDevice } from '@/types'

interface LobbyViewProps {
  onJoinRoom: (roomId: string, userName: string) => void
  inputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  selectedInputDevice: string | null
  selectedOutputDevice: string | null
  onInputDeviceChange: (deviceId: string) => void
  onOutputDeviceChange: (deviceId: string) => void
  onRefreshDevices: () => void
  audioLevel: number
  isLoading: boolean
  videoInputDevices: AudioDevice[]
  selectedVideoDevice: string | null
  onVideoDeviceChange: (deviceId: string) => void
  onOpenSettings: () => void
}

/**
 * Generate a random room ID with sufficient entropy
 */
function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let result = ''
  const array = new Uint32Array(12)
  crypto.getRandomValues(array)
  for (let i = 0; i < 12; i++) {
    result += chars[array[i] % chars.length]
  }
  return result
}

export const LobbyView: React.FC<LobbyViewProps> = ({
  onJoinRoom,
  inputDevices,
  outputDevices,
  videoInputDevices,
  selectedInputDevice,
  selectedOutputDevice,
  selectedVideoDevice,
  onInputDeviceChange,
  onOutputDeviceChange,
  onVideoDeviceChange,
  onRefreshDevices,
  audioLevel: _audioLevel,
  isLoading,
  onOpenSettings
}) => {
  const { t } = useI18n()
  const [roomId, setRoomId] = useState('')
  const [userName, setUserName] = useState('')
  const [testingMic, setTestingMic] = useState(false)
  const [testingSpeaker, setTestingSpeaker] = useState(false)
  const [testingCamera, setTestingCamera] = useState(false)
  const [testAudioLevel, setTestAudioLevel] = useState(0)
  const [showPrivacyNotice, setShowPrivacyNotice] = useState(false)
  const [isJoining, setIsJoining] = useState(false)

  // Refs for audio testing
  const testStreamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  // Generate default username
  useEffect(() => {
    const storedName = localStorage.getItem('p2p-conf-username')
    if (storedName) {
      setUserName(storedName)
    } else {
      setUserName(`User-${Math.random().toString(36).slice(2, 7)}`)
    }
  }, [])

  // Cleanup on unmount
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMicTest()
      stopCameraTest()
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  // Stop mic test when device changes, then restart
  useEffect(() => {
    if (testingMic && selectedInputDevice) {
      stopMicTest()
      startMicTest()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInputDevice])

  // Restart camera test when device changes
  useEffect(() => {
    if (testingCamera && selectedVideoDevice) {
      stopCameraTest()
      startCameraTest()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoDevice])

  // Attach stream to video element when it becomes available
  useEffect(() => {
    if (testingCamera && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current
      // Explicitly play to ensure it starts (sometimes needed)
      videoRef.current.play().catch(e => UILog.warn('Failed to autoplay video preview', { error: e }))
    }
  }, [testingCamera])

  /**
   * Start microphone test with audio level monitoring
   */
  const startMicTest = async () => {
    UILog.info('Starting microphone test')

    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedInputDevice
          ? { deviceId: { exact: selectedInputDevice } }
          : true,
        video: false
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      testStreamRef.current = stream

      onRefreshDevices()

      const pipeline = getAudioPipeline()
      await pipeline.initialize()
      await pipeline.connectInputStream(stream)

      analyserRef.current = pipeline.getAnalyserNode()
      const analyser = analyserRef.current

      if (!analyser) {
        throw new Error('Pipeline analyser not available')
      }

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateLevel = () => {
        if (!analyserRef.current) return

        analyserRef.current.getByteFrequencyData(dataArray)

        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        const normalizedLevel = Math.min(100, (average / 128) * 100)

        setTestAudioLevel(normalizedLevel)
        animationFrameRef.current = requestAnimationFrame(updateLevel)
      }

      updateLevel()
      setTestingMic(true)

      UILog.info('Microphone test started successfully with noise suppression pipeline')
    } catch (err) {
      UILog.error('Microphone test failed', { error: err })
      alert(t('lobby.micPermissionDenied'))
    }
  }

  /**
   * Stop microphone test
   */
  const stopMicTest = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    // Disconnect pipeline but don't destroy it (App manages destruction)
    const pipeline = getAudioPipeline()
    pipeline.disconnect()

    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach(track => track.stop())
      testStreamRef.current = null
    }

    analyserRef.current = null
    setTestAudioLevel(0)
    setTestingMic(false)

    UILog.debug('Microphone test stopped')
  }

  /**
   * Test speaker by playing a frequency sweep
   */
  const handleTestSpeaker = async () => {
    if (testingSpeaker) {
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
      setTestingSpeaker(false)
      return
    }

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
      const ctx = new AudioContextClass()
      audioContextRef.current = ctx

      // Create oscillator for test tone
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      // Sweep from 440Hz to 880Hz
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 1)

      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1)

      osc.connect(gain)

      // Connect to specific output device if selected (Chrome only)
      if (selectedOutputDevice && (ctx.destination as any).setSinkId) {
        try {
          await (ctx.destination as any).setSinkId(selectedOutputDevice)
        } catch (err) {
          console.warn('Failed to set output device for test', err)
        }
      }

      gain.connect(ctx.destination)

      osc.start()
      osc.stop(ctx.currentTime + 1)

      setTestingSpeaker(true)

      // Auto stop after duration
      setTimeout(() => {
        setTestingSpeaker(false)
        if (audioContextRef.current === ctx) {
          ctx.close()
          audioContextRef.current = null
        }
      }, 1000)

    } catch (err) {
      UILog.error('Speaker test failed', { error: err })
    }
  }

  /**
   * Start camera test
   */
  const startCameraTest = async () => {
    try {
      const constraints = {
        audio: false,
        video: selectedVideoDevice
          ? { deviceId: { exact: selectedVideoDevice } }
          : true
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      cameraStreamRef.current = stream



      setTestingCamera(true)
      UILog.info('Camera test started')
    } catch (err) {
      UILog.error('Camera test failed', { error: err })
      alert(t('lobby.cameraPermissionDenied'))
    }
  }

  /**
   * Stop camera test
   */
  const stopCameraTest = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(track => track.stop())
      cameraStreamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setTestingCamera(false)
  }

  const handleTestCamera = () => {
    if (testingCamera) {
      stopCameraTest()
    } else {
      startCameraTest()
    }
  }

  const handleUserNameChange = (name: string) => {
    setUserName(name)
    localStorage.setItem('p2p-conf-username', name)
  }

  const handleGenerateRoom = () => {
    const newRoomId = generateRoomId()
    setRoomId(newRoomId)
    UILog.debug('Generated room ID', { roomId: newRoomId })
  }

  const handleJoin = async () => {
    if (roomId.trim().length < 4) {
      alert(t('lobby.roomIdMinLength'))
      return
    }
    if (userName.trim().length < 2) {
      alert(t('lobby.nameMinLength'))
      return
    }

    setIsJoining(true)
    UILog.info('Joining room', { roomId: roomId.trim(), userName: userName.trim() })

    // Stop mic test FIRST and wait for release
    stopMicTest()

    // Give the audio system time to fully release the mic
    // This prevents race condition on Linux where getUserMedia hangs
    await new Promise(resolve => setTimeout(resolve, 100))

    onJoinRoom(roomId.trim(), userName.trim())
  }

  const handleTestMic = () => {
    if (testingMic) {
      stopMicTest()
    } else {
      startMicTest()
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="card max-w-md w-full p-8 animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900" data-testid="lobby-title">{t('app.name')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('app.tagline')}</p>
        </div>

        {/* Form */}
        <div className="space-y-6">
          {/* User Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('lobby.yourName')}
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => handleUserNameChange(e.target.value)}
              placeholder={t('lobby.enterName')}
              className="input"
              maxLength={32}
              data-testid="lobby-name-input"
            />
          </div>

          {/* Room ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('lobby.roomId')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder={t('lobby.enterRoomId')}
                className="input flex-1"
                maxLength={32}
                data-testid="lobby-room-input"
              />
              <button
                onClick={handleGenerateRoom}
                className="btn btn-secondary whitespace-nowrap"
                title={t('lobby.generate')}
                data-testid="lobby-generate-btn"
              >
                {t('lobby.generate')}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {t('lobby.shareRoomId')}
            </p>
            {roomId.length > 0 && roomId.length < 8 && (
              <p className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {t('lobby.roomIdSecurityWarning')}
              </p>
            )}
          </div>

          {/* Audio Devices */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{t('lobby.audioSetup')}</span>
              <button
                onClick={handleTestMic}
                className={`text-sm ${testingMic ? 'text-red-600 hover:text-red-700' : 'text-blue-600 hover:text-blue-700'} font-medium`}
              >
                {testingMic ? `■ ${t('lobby.stopTest')}` : `▶ ${t('lobby.testMicrophone')}`}
              </button>
            </div>

            <DeviceSelector
              label={t('lobby.microphone')}
              devices={inputDevices}
              selectedDeviceId={selectedInputDevice}
              onSelect={onInputDeviceChange}
              icon="mic"
            />

            {testingMic && (
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">{t('lobby.inputLevel')}</span>
                  <span className="text-xs font-mono text-gray-600">{Math.round(testAudioLevel)}%</span>
                </div>
                <AudioMeter level={testAudioLevel} />
                <p className="text-xs text-green-600 mt-2">
                  ✓ {t('lobby.micWorking')}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">{t('lobby.speaker')}</span>
              <button
                onClick={handleTestSpeaker}
                className={`text-sm ${testingSpeaker ? 'text-red-600 hover:text-red-700' : 'text-blue-600 hover:text-blue-700'} font-medium`}
              >
                {testingSpeaker ? `■ ${t('lobby.stopTest')}` : `▶ ${t('lobby.testSpeaker')}`}
              </button>
            </div>

            <DeviceSelector
              label=""
              devices={outputDevices}
              selectedDeviceId={selectedOutputDevice}
              onSelect={onOutputDeviceChange}
              icon="speaker"
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-sm font-medium text-gray-700">{t('settings.videoDevice')}</span>
              <button
                onClick={handleTestCamera}
                className={`text-sm ${testingCamera ? 'text-red-600 hover:text-red-700' : 'text-blue-600 hover:text-blue-700'} font-medium`}
              >
                {testingCamera ? `■ ${t('lobby.stopTest')}` : `▶ ${t('lobby.testCamera')}`}
              </button>
            </div>

            <DeviceSelector
              label=""
              devices={videoInputDevices}
              selectedDeviceId={selectedVideoDevice}
              onSelect={onVideoDeviceChange}
              icon="video"
            />

            {testingCamera && (
              <div className="bg-black rounded-lg overflow-hidden aspect-video relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>

          {/* Privacy Notice */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div
              className="flex items-start gap-2 cursor-pointer"
              onClick={() => setShowPrivacyNotice(!showPrivacyNotice)}
            >
              <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-yellow-800 font-medium">{t('lobby.privacyNotice')}</p>
                {showPrivacyNotice && (
                  <p className="text-xs text-yellow-700 mt-1">
                    {t('lobby.privacyText')}
                  </p>
                )}
              </div>
              <svg
                className={`w-4 h-4 text-yellow-600 transform transition-transform ${showPrivacyNotice ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Join Button */}
          <button
            onClick={handleJoin}
            disabled={isLoading || isJoining || roomId.length < 4}
            className="btn btn-primary w-full py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="lobby-join-btn"
          >
            {(isLoading || isJoining) ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('lobby.joining')}
              </span>
            ) : (
              t('lobby.joinRoom')
            )}
          </button>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center">
          <span className="text-xs text-gray-400">
            {t('app.name')} {t('app.version')}
          </span>
          <button
            onClick={onOpenSettings}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {t('lobby.settings')}
          </button>
        </div>
      </div>
    </div>
  )
}
