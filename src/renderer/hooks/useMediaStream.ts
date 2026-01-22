/**
 * useMediaStream Hook
 * Manages audio device enumeration, capture, and switching
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { MediaLog } from '../utils/Logger'
import type { AudioDevice, AudioProcessingConfig } from '@/types'

interface UseMediaStreamResult {
  localStream: MediaStream | null
  inputDevices: AudioDevice[]
  outputDevices: AudioDevice[]
  selectedInputDevice: string | null
  selectedOutputDevice: string | null
  isMuted: boolean
  audioLevel: number
  isLoading: boolean
  error: string | null
  
  startCapture: (config?: Partial<AudioProcessingConfig>) => Promise<MediaStream | null>
  stopCapture: () => void
  switchInputDevice: (deviceId: string) => Promise<void>
  selectOutputDevice: (deviceId: string) => void
  toggleMute: () => void
  refreshDevices: () => Promise<void>
}

// Default audio processing configuration
const DEFAULT_CONFIG: AudioProcessingConfig = {
  sampleRate: 48000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

export function useMediaStream(): UseMediaStreamResult {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [selectedInputDevice, setSelectedInputDevice] = useState<string | null>(null)
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  /**
   * Set up audio level monitoring using Web Audio API
   * MUST be defined before startCapture and switchInputDevice
   */
  const setupAudioLevelMonitoring = useCallback((stream: MediaStream) => {
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

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray)
      
      // Calculate average volume level (0-100)
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      const normalizedLevel = Math.min(100, (average / 128) * 100)
      
      setAudioLevel(normalizedLevel)
      animationFrameRef.current = requestAnimationFrame(updateLevel)
    }

    updateLevel()
    MediaLog.debug('Audio level monitoring started')
  }, [])

  /**
   * Enumerate all audio devices
   */
  const refreshDevices = useCallback(async () => {
    MediaLog.debug('Refreshing audio devices')
    
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      
      const inputs: AudioDevice[] = []
      const outputs: AudioDevice[] = []

      devices.forEach(device => {
        if (device.kind === 'audioinput') {
          inputs.push({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${inputs.length + 1}`,
            kind: 'audioinput',
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
      setOutputDevices(outputs)

      // Set default devices if not selected
      if (!selectedInputDevice && inputs.length > 0) {
        setSelectedInputDevice(inputs[0].deviceId)
      }
      if (!selectedOutputDevice && outputs.length > 0) {
        setSelectedOutputDevice(outputs[0].deviceId)
      }

      MediaLog.info('Audio devices enumerated', { 
        inputCount: inputs.length, 
        outputCount: outputs.length 
      })
    } catch (err) {
      MediaLog.error('Failed to enumerate devices', { error: err })
      setError('Failed to enumerate audio devices')
    }
  }, [selectedInputDevice, selectedOutputDevice])

  /**
   * Start audio capture from microphone
   */
  const startCapture = useCallback(async (config?: Partial<AudioProcessingConfig>): Promise<MediaStream | null> => {
    setIsLoading(true)
    setError(null)

    const finalConfig = { ...DEFAULT_CONFIG, ...config }

    MediaLog.info('Starting audio capture', { config: finalConfig })

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
        video: false
      }

      // Add timeout wrapper to prevent getUserMedia from hanging indefinitely
      // This is particularly important on Linux where audio devices can get "locked"
      const CAPTURE_TIMEOUT_MS = 10000 // 10 seconds
      
      MediaLog.debug('Calling getUserMedia', { deviceId: selectedInputDevice || 'default' })
      
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Microphone capture timed out. The audio device may be in use by another application.')), CAPTURE_TIMEOUT_MS)
        )
      ])
      
      MediaLog.debug('getUserMedia returned successfully', { streamId: stream.id })
      setLocalStream(stream)

      // Refresh devices to get labels (now that we have permission)
      await refreshDevices()

      // Set up audio level monitoring
      setupAudioLevelMonitoring(stream)

      MediaLog.info('Audio capture started', { 
        streamId: stream.id,
        tracks: stream.getTracks().map(t => ({ kind: t.kind, label: t.label }))
      })
      
      setIsLoading(false)
      return stream
    } catch (err: any) {
      MediaLog.error('Failed to start capture', { error: err })
      
      if (err.name === 'NotAllowedError') {
        setError('Microphone permission denied. Please allow access in your browser/system settings.')
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Please connect a microphone and try again.')
      } else {
        setError(`Failed to access microphone: ${err.message}`)
      }
      setIsLoading(false)
      return null
    }
  }, [selectedInputDevice, refreshDevices, setupAudioLevelMonitoring])

  // Track if cleanup has already been done to prevent double cleanup
  const cleanupDoneRef = useRef(false)
  
  /**
   * Stop audio capture - with guard against double cleanup
   */
  const stopCapture = useCallback(() => {
    // Guard against double cleanup on Linux
    if (cleanupDoneRef.current) {
      MediaLog.debug('Cleanup already done, skipping')
      return
    }
    
    if (localStream) {
      cleanupDoneRef.current = true
      localStream.getTracks().forEach(track => {
        track.stop()
        MediaLog.debug('Track stopped', { kind: track.kind, label: track.label })
      })
      setLocalStream(null)
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
    if (localStream) {
      MediaLog.info('Audio capture stopped')
    }
  }, [localStream])

  /**
   * Switch to a different input device without stopping the stream
   */
  const switchInputDevice = useCallback(async (deviceId: string) => {
    if (!localStream) {
      setSelectedInputDevice(deviceId)
      return
    }

    MediaLog.info('Switching input device', { deviceId })

    try {
      // Get new stream from selected device
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      })

      // Stop old tracks
      localStream.getTracks().forEach(track => track.stop())

      // Update stream
      setLocalStream(newStream)
      setSelectedInputDevice(deviceId)

      // Re-setup audio monitoring
      setupAudioLevelMonitoring(newStream)

      MediaLog.info('Input device switched', { deviceId })
    } catch (err) {
      MediaLog.error('Failed to switch input device', { deviceId, error: err })
      setError('Failed to switch microphone')
    }
  }, [localStream, setupAudioLevelMonitoring])

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
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsMuted(!audioTrack.enabled)
        MediaLog.info('Mute toggled', { muted: !audioTrack.enabled })
      }
    }
  }, [localStream])

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture()
    }
  }, [stopCapture])

  return {
    localStream,
    inputDevices,
    outputDevices,
    selectedInputDevice,
    selectedOutputDevice,
    isMuted,
    audioLevel,
    isLoading,
    error,
    startCapture,
    stopCapture,
    switchInputDevice,
    selectOutputDevice,
    toggleMute,
    refreshDevices
  }
}
