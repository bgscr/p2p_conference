/**
 * useMediaStream Hook
 * Manages audio device enumeration, capture, and switching
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { MediaLog } from '../utils/Logger'
import type { AudioDevice, AudioProcessingConfig, VirtualMicDeviceStatus } from '@/types'

type MediaCaptureConfig = Partial<AudioProcessingConfig> & {
  videoEnabled?: boolean
}

interface UseMediaStreamResult {
  localStream: MediaStream | null
  inputDevices: AudioDevice[]
  videoInputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  virtualMicDeviceStatus: VirtualMicDeviceStatus
  selectedInputDevice: string | null
  selectedVideoDevice: string | null
  selectedOutputDevice: string | null
  isMuted: boolean
  isVideoEnabled: boolean
  audioLevel: number
  isLoading: boolean
  error: string | null

  startCapture: (config?: MediaCaptureConfig) => Promise<MediaStream | null>
  stopCapture: () => void
  switchInputDevice: (deviceId: string) => Promise<MediaStream | null>
  switchVideoDevice: (deviceId: string) => Promise<MediaStream | null>
  selectOutputDevice: (deviceId: string) => void
  toggleMute: () => void
  toggleVideo: () => void
  refreshDevices: () => Promise<void>
  setOnStreamChange: (callback: (stream: MediaStream) => void) => void
}

// Default audio processing configuration
const DEFAULT_CONFIG: AudioProcessingConfig = {
  sampleRate: 48000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

function getLocalPlatform(): 'win' | 'mac' | 'linux' {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'win'
  if (ua.includes('mac')) return 'mac'
  return 'linux'
}

function getExpectedVirtualMicHint(platform: 'win' | 'mac' | 'linux'): string {
  if (platform === 'win') return 'CABLE Input (VB-CABLE)'
  if (platform === 'mac') return 'BlackHole 2ch'
  return 'Unsupported platform for remote mic mapping'
}

export function useMediaStream(): UseMediaStreamResult {
  const platform = getLocalPlatform()
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([])
  const [videoInputDevices, setVideoInputDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [virtualMicDeviceStatus, setVirtualMicDeviceStatus] = useState<VirtualMicDeviceStatus>({
    platform,
    supported: platform === 'win' || platform === 'mac',
    detected: false,
    ready: false,
    outputDeviceId: null,
    outputDeviceLabel: null,
    expectedDeviceHint: getExpectedVirtualMicHint(platform)
  })
  const [selectedInputDevice, setSelectedInputDevice] = useState<string | null>(null)
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string | null>(null)
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoEnabled, setIsVideoEnabled] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const muteIntentRef = useRef(false)

  const updateVirtualMicDeviceStatus = useCallback((outputs: AudioDevice[]) => {
    const supported = platform === 'win' || platform === 'mac'
    const matcher = platform === 'win'
      ? /cable input/i
      : platform === 'mac'
        ? /blackhole/i
        : null

    const matched = matcher
      ? outputs.find(device => matcher.test(device.label))
      : undefined

    setVirtualMicDeviceStatus({
      platform,
      supported,
      detected: Boolean(matched),
      ready: supported && Boolean(matched),
      outputDeviceId: matched?.deviceId ?? null,
      outputDeviceLabel: matched?.label ?? null,
      expectedDeviceHint: getExpectedVirtualMicHint(platform),
      lastError: supported && !matched ? 'Virtual microphone output device not found' : undefined
    })
  }, [platform])

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    localStreamRef.current = localStream
  }, [localStream])

  /**
   * Set up audio level monitoring using Web Audio API
   * MUST be defined before startCapture and switchInputDevice
   */
  const setupAudioLevelMonitoring = useCallback((stream: MediaStream) => {
    // Only set up if audio track exists
    if (stream.getAudioTracks().length === 0) return

    // Clean up existing context
    if (audioContextRef.current) {
      audioContextRef.current.close()
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    const audioContext = new AudioContext()
    audioContextRef.current = audioContext

    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyserRef.current = analyser

    const source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)
    // Note: Do NOT connect to destination (would cause feedback)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const AUDIO_LEVEL_UPDATE_INTERVAL = 100 // ms (~10fps, sufficient for audio meters)
    let lastUpdateTime = 0

    const updateLevel = () => {
      animationFrameRef.current = requestAnimationFrame(updateLevel)
      const now = performance.now()
      if (now - lastUpdateTime < AUDIO_LEVEL_UPDATE_INTERVAL) return
      lastUpdateTime = now

      analyser.getByteFrequencyData(dataArray)

      // Calculate average volume level (0-100)
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      const normalizedLevel = Math.min(100, (average / 128) * 100)

      setAudioLevel(normalizedLevel)
    }

    updateLevel()
    MediaLog.debug('Audio level monitoring started')
  }, [])

  /**
   * Enumerate all audio and video devices
   */
  const refreshDevices = useCallback(async () => {
    MediaLog.debug('Refreshing devices')

    try {
      const devices = await navigator.mediaDevices.enumerateDevices()

      const inputs: AudioDevice[] = []
      const videoInputs: AudioDevice[] = []
      const outputs: AudioDevice[] = []

      devices.forEach(device => {
        if (device.kind === 'audioinput') {
          inputs.push({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${inputs.length + 1}`,
            kind: 'audioinput',
            groupId: device.groupId
          })
        } else if (device.kind === 'videoinput') {
          videoInputs.push({
            deviceId: device.deviceId,
            label: device.label || `Camera ${videoInputs.length + 1}`,
            kind: 'videoinput',
            groupId: device.groupId
          })
        } else if (device.kind === 'audiooutput') {
          outputs.push({
            deviceId: device.deviceId,
            label: device.label || `Speaker ${outputs.length + 1}`,
            kind: 'audiooutput',
            groupId: device.groupId
          })
        }
      })

      setInputDevices(inputs)
      setVideoInputDevices(videoInputs)
      setOutputDevices(outputs)
      updateVirtualMicDeviceStatus(outputs)

      // Set default devices if not selected
      if (!selectedInputDevice && inputs.length > 0) {
        setSelectedInputDevice(inputs[0].deviceId)
      }
      if (!selectedVideoDevice && videoInputs.length > 0) {
        setSelectedVideoDevice(videoInputs[0].deviceId)
      }
      if (!selectedOutputDevice && outputs.length > 0) {
        setSelectedOutputDevice(outputs[0].deviceId)
      }

      MediaLog.info('Devices enumerated', {
        inputCount: inputs.length,
        videoInputCount: videoInputs.length,
        outputCount: outputs.length
      })
    } catch (err) {
      MediaLog.error('Failed to enumerate devices', { error: err })
      setError('Failed to enumerate devices')
    }
  }, [selectedInputDevice, selectedVideoDevice, selectedOutputDevice, updateVirtualMicDeviceStatus])

  /**
   * Start audio/video capture
   * video: boolean - if true, capture video as well (default: true if available)
   */
  const startCapture = useCallback(async (config?: MediaCaptureConfig): Promise<MediaStream | null> => {
    setIsLoading(true)
    setError(null)

    const finalConfig = { ...DEFAULT_CONFIG, ...config }

    MediaLog.info('Starting capture', { config: finalConfig })

    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: selectedInputDevice ? { exact: selectedInputDevice } : undefined,
          sampleRate: finalConfig.sampleRate,
          channelCount: finalConfig.channelCount,
          echoCancellation: finalConfig.echoCancellation,
          noiseSuppression: finalConfig.noiseSuppression,
          autoGainControl: finalConfig.autoGainControl
        },
        video: selectedVideoDevice
          ? { deviceId: { exact: selectedVideoDevice } }
          : true // Default to any camera if not selected, or can be passed in config
      }

      // Add timeout wrapper to prevent getUserMedia from hanging indefinitely
      const CAPTURE_TIMEOUT_MS = 10000 // 10 seconds

      MediaLog.debug('Calling getUserMedia', {
        audioDeviceId: selectedInputDevice || 'default',
        videoDeviceId: selectedVideoDevice || 'default'
      })

      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Media capture timed out. The device may be in use by another application.')), CAPTURE_TIMEOUT_MS)
        )
      ])

      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !muteIntentRef.current
      }

      MediaLog.debug('getUserMedia returned successfully', { streamId: stream.id })
      setLocalStream(stream)

      // Refresh devices to get labels (now that we have permission)
      await refreshDevices()

      // Set up audio level monitoring
      setupAudioLevelMonitoring(stream)

      // Initialize states based on stream tracks
      setIsMuted(muteIntentRef.current)

      // Handle video enabled state - check if videoEnabled option was passed
      const videoTrack = stream.getVideoTracks()[0]
      const shouldEnableVideo = config?.videoEnabled ?? false  // Default: camera OFF
      if (videoTrack) {
        videoTrack.enabled = shouldEnableVideo
        setIsVideoEnabled(shouldEnableVideo)
        MediaLog.info('Video toggled', { enabled: shouldEnableVideo })
      }

      MediaLog.info('Capture started', {
        streamId: stream.id,
        tracks: stream.getTracks().map(t => ({ kind: t.kind, label: t.label }))
      })

      setIsLoading(false)
      return stream
    } catch (err: any) {
      MediaLog.error('Failed to start capture', { error: err })

      if (err.name === 'NotAllowedError') {
        setError('Permission denied. Please allow access to microphone and camera.')
      } else if (err.name === 'NotFoundError') {
        setError('No device found. Please connect a microphone/camera and try again.')
      } else {
        setError(`Failed to access media devices: ${err.message}`)
      }
      setIsLoading(false)
      return null
    }
  }, [selectedInputDevice, selectedVideoDevice, refreshDevices, setupAudioLevelMonitoring])

  // Track if cleanup has already been done to prevent double cleanup
  const cleanupDoneRef = useRef(false)

  /**
   * Stop capture - with guard against double cleanup
   */
  const stopCapture = useCallback(() => {
    // Guard against double cleanup on Linux
    if (cleanupDoneRef.current) {
      MediaLog.debug('Cleanup already done, skipping')
      return
    }

    // Use ref to get current stream
    const stream = localStreamRef.current
    if (stream) {
      cleanupDoneRef.current = true
      stream.getTracks().forEach(track => {
        track.stop()
        MediaLog.debug('Track stopped', { kind: track.kind, label: track.label })
      })
      setLocalStream(null)
      MediaLog.info('Capture stopped')
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    setAudioLevel(0)
  }, [])  // No dependencies - uses refs

  // Callback for notifying stream changes (used by peer manager)
  const onStreamChangeRef = useRef<((stream: MediaStream) => void) | null>(null)

  /**
   * Set callback for stream changes (device switching)
   */
  const setOnStreamChange = useCallback((callback: (stream: MediaStream) => void) => {
    onStreamChangeRef.current = callback
  }, [])

  /**
   * Switch to a different input device without stopping the stream
   * Returns the new stream for the caller to handle track replacement
   */
  const switchInputDevice = useCallback(async (deviceId: string): Promise<MediaStream | null> => {
    // Use ref to always get current stream (avoid stale closure issues)
    const currentStream = localStreamRef.current
    if (!currentStream) {
      setSelectedInputDevice(deviceId)
      return null
    }

    MediaLog.info('Switching input device', { deviceId })

    try {
      // Get new stream from selected device
      // We need to keep video track if it exists
      const videoTrack = currentStream.getVideoTracks()[0]

      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false // We only ask for audio here, we'll combine later if needed
      })

      // Stop old audio track
      currentStream.getAudioTracks().forEach(track => {
        MediaLog.debug('Stopping old audio track', { label: track.label })
        track.stop()
      })

      // If we had a video track, add it to the new stream
      if (videoTrack) {
        newStream.addTrack(videoTrack)
      }

      const nextAudioTrack = newStream.getAudioTracks()[0]
      if (nextAudioTrack) {
        nextAudioTrack.enabled = !muteIntentRef.current
      }

      // Reset cleanup flag since this is an intentional switch, not a stop
      cleanupDoneRef.current = false

      // Update stream
      setLocalStream(newStream)
      setSelectedInputDevice(deviceId)
      setIsMuted(muteIntentRef.current)

      // Re-setup audio monitoring
      setupAudioLevelMonitoring(newStream)

      // Notify listeners about stream change
      if (onStreamChangeRef.current) {
        MediaLog.debug('Notifying stream change listener')
        onStreamChangeRef.current(newStream)
      }

      MediaLog.info('Input device switched successfully', {
        deviceId,
        newStreamId: newStream.id
      })

      return newStream
    } catch (err) {
      MediaLog.error('Failed to switch input device', { deviceId, error: err })
      setError('Failed to switch microphone')
      return null
    }
  }, [setupAudioLevelMonitoring])

  /**
   * Switch to a different video device
   */
  const switchVideoDevice = useCallback(async (deviceId: string): Promise<MediaStream | null> => {
    const currentStream = localStreamRef.current
    if (!currentStream) {
      setSelectedVideoDevice(deviceId)
      return null
    }

    MediaLog.info('Switching video device', { deviceId })

    try {
      // Get new video stream
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: false
      })

      const newVideoTrack = videoStream.getVideoTracks()[0]

      // Stop old video track
      currentStream.getVideoTracks().forEach(track => {
        MediaLog.debug('Stopping old video track', { label: track.label })
        track.stop()
        currentStream.removeTrack(track)
      })

      // Add new video track to current stream
      if (newVideoTrack) {
        currentStream.addTrack(newVideoTrack)

        // Respect current enabled state
        newVideoTrack.enabled = isVideoEnabled
      }

      // Update state
      setSelectedVideoDevice(deviceId)

      // Force update to trigger effects
      setLocalStream(new MediaStream(currentStream.getTracks()))

      // Notify listeners about stream change
      if (onStreamChangeRef.current) {
        onStreamChangeRef.current(currentStream)
      }

      MediaLog.info('Video device switched successfully', { deviceId })
      return currentStream
    } catch (err) {
      MediaLog.error('Failed to switch video device', { deviceId, error: err })
      setError('Failed to switch camera')
      return null
    }
  }, [isVideoEnabled])

  /**
   * Select output device (for HTMLAudioElement.setSinkId)
   */
  const selectOutputDevice = useCallback((deviceId: string) => {
    setSelectedOutputDevice(deviceId)
    MediaLog.info('Output device selected', { deviceId })
  }, [])


  /**
   * Toggle mute state
   */
  const toggleMute = useCallback(() => {
    const nextMuted = !muteIntentRef.current
    muteIntentRef.current = nextMuted

    const audioTrack = localStreamRef.current?.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !nextMuted
    }

    setIsMuted(nextMuted)
    MediaLog.info('Mute toggled', { muted: nextMuted })
  }, [])

  /**
   * Toggle video state
   */
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setIsVideoEnabled(videoTrack.enabled)
        MediaLog.info('Video toggled', { enabled: videoTrack.enabled })
      } else {
        // If no video track, we might need to add one? 
        // For now assume track exists if we started with video. 
        // If track was stopped/removed, we'd need to re-request getUserMedia, 
        // but 'enabled' toggle is cleaner for temporary off.
        MediaLog.warn('No video track to toggle')
      }
    }
  }, [])

  // Listen for device changes (hot-plug)
  useEffect(() => {
    const handleDeviceChange = () => {
      MediaLog.info('Device change detected')
      refreshDevices()
    }

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)

    // Initial device enumeration
    refreshDevices()

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [refreshDevices])

  // Cleanup on unmount only - empty deps means only on unmount
  useEffect(() => {
    return () => {
      // Use ref-based stopCapture which has no dependencies
      stopCapture()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // Empty deps - only run on unmount

  return {
    localStream,
    inputDevices,
    videoInputDevices,
    outputDevices,
    virtualMicDeviceStatus,
    selectedInputDevice,
    selectedVideoDevice,
    selectedOutputDevice,
    isMuted,
    isVideoEnabled,
    audioLevel,
    isLoading,
    error,
    startCapture,
    stopCapture,
    switchInputDevice,
    switchVideoDevice,
    selectOutputDevice,
    toggleMute,
    toggleVideo,
    refreshDevices,
    setOnStreamChange
  }
}
