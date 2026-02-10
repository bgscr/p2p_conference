/**
 * Global type declarations
 */

import type { ElectronAPI } from '../../electron/preload'

declare global {
  interface Window {
    electronAPI?: ElectronAPI
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
  isScreenSharing?: boolean
  audioLevel: number
  connectionState: RTCPeerConnectionState
  platform?: 'win' | 'mac' | 'linux'
  virtualMicReady?: boolean
  virtualMicDeviceLabel?: string
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

/**
 * Chat message
 */
export interface ChatMessage {
  id: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  type: 'text' | 'system'
}

/**
 * Remote microphone mapping
 */
export type AudioRoutingMode = 'broadcast' | 'exclusive'

export type RemoteMicSessionState =
  | 'idle'
  | 'pendingOutgoing'
  | 'pendingIncoming'
  | 'active'
  | 'rejected'
  | 'expired'
  | 'error'

export type RemoteMicStopReason =
  | 'stopped-by-source'
  | 'stopped-by-target'
  | 'rejected'
  | 'busy'
  | 'request-timeout'
  | 'heartbeat-timeout'
  | 'peer-disconnected'
  | 'virtual-device-missing'
  | 'virtual-device-install-failed'
  | 'virtual-device-restart-required'
  | 'user-cancelled'
  | 'routing-failed'
  | 'unknown'

export type VirtualAudioInstallState =
  | 'installed'
  | 'already-installed'
  | 'reboot-required'
  | 'user-cancelled'
  | 'failed'
  | 'unsupported'

export interface VirtualAudioInstallResult {
  provider: 'vb-cable' | 'blackhole'
  state: VirtualAudioInstallState
  code?: number
  requiresRestart?: boolean
  message?: string
  correlationId?: string
}

export interface VirtualAudioInstallerState {
  inProgress: boolean
  platformSupported: boolean
  activeProvider?: 'vb-cable' | 'blackhole'
  bundleReady?: boolean
  bundleMessage?: string
}

export interface RemoteMicRequest {
  type: 'rm_request'
  requestId: string
  sourcePeerId: string
  sourceName: string
  targetPeerId: string
  ts: number
}

export interface RemoteMicResponse {
  type: 'rm_response'
  requestId: string
  accepted: boolean
  reason?:
    | 'accepted'
    | 'rejected'
    | 'busy'
    | 'virtual-device-missing'
    | 'virtual-device-install-failed'
    | 'virtual-device-restart-required'
    | 'user-cancelled'
    | 'unknown'
  ts: number
}

export interface RemoteMicStart {
  type: 'rm_start'
  requestId: string
  ts: number
}

export interface RemoteMicStop {
  type: 'rm_stop'
  requestId: string
  reason?: RemoteMicStopReason
  ts: number
}

export interface RemoteMicHeartbeat {
  type: 'rm_heartbeat'
  requestId: string
  ts: number
}

export type RemoteMicControlMessage =
  | RemoteMicRequest
  | RemoteMicResponse
  | RemoteMicStart
  | RemoteMicStop
  | RemoteMicHeartbeat

export interface RemoteMicSession {
  state: RemoteMicSessionState
  requestId?: string
  sourcePeerId?: string
  sourceName?: string
  targetPeerId?: string
  targetName?: string
  role?: 'source' | 'target'
  reason?: string
  startedAt?: number
  expiresAt?: number
  needsVirtualDeviceSetup?: boolean
  isInstallingVirtualDevice?: boolean
  installError?: string
}

export interface VirtualMicDeviceStatus {
  platform: 'win' | 'mac' | 'linux'
  supported: boolean
  detected: boolean
  ready: boolean
  outputDeviceId: string | null
  outputDeviceLabel: string | null
  expectedDeviceHint: string
  lastError?: string
}

export { }
