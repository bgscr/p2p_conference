/**
 * Global type declarations
 */

import type { ElectronAPI } from '../../electron/preload'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

/**
 * Connection state machine states
 */
export type ConnectionState = 'idle' | 'signaling' | 'connecting' | 'connected' | 'failed'

/**
 * Audio/Video device information
 */
export interface AudioDevice {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput' | 'videoinput'
  groupId: string
}

/**
 * Peer information
 */
export interface Peer {
  id: string
  name: string
  isMuted: boolean
  isVideoMuted?: boolean
  isSpeakerMuted?: boolean
  audioLevel: number
  connectionState: RTCPeerConnectionState
  platform?: 'win' | 'mac' | 'linux'
}

/**
 * Room information
 */
export interface RoomInfo {
  roomId: string
  participants: Peer[]
  localPeerId: string
}

/**
 * Signaling message types
 */
export interface SignalData {
  type: 'offer' | 'answer' | 'ice-candidate'
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

/**
 * App settings
 */
export interface AppSettings {
  noiseSuppressionEnabled: boolean
  echoCancellationEnabled: boolean
  autoGainControlEnabled: boolean
  selectedInputDevice: string | null
  selectedVideoDevice: string | null
  selectedOutputDevice: string | null
}

/**
 * Connection quality statistics
 */
export interface ConnectionQuality {
  peerId: string
  rtt: number // Round-trip time in ms
  packetLoss: number // Packet loss percentage
  jitter: number // Jitter in ms
  bytesReceived: number
  bytesSent: number
  quality: 'excellent' | 'good' | 'fair' | 'poor'
  connectionState: RTCPeerConnectionState
}

/**
 * Audio processing configuration
 */
export interface AudioProcessingConfig {
  sampleRate: number
  channelCount: number
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

export { }
