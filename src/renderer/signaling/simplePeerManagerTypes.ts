import type {
  ChatMessage,
  ModerationControlMessage,
  RemoteMicControlMessage
} from '@/types'

export interface SignalMessage {
  v: number
  type: 'announce' | 'offer' | 'answer' | 'ice-candidate' | 'leave' | 'ping' | 'pong' | 'mute-status' | 'room-lock' | 'room-locked'
  from: string
  to?: string
  data?: any
  userName?: string
  platform?: 'win' | 'mac' | 'linux'
  ts?: number
  sessionId?: number
  msgId?: string
}

export interface MuteStatus {
  micMuted: boolean
  speakerMuted: boolean
  videoMuted?: boolean
  videoEnabled?: boolean
  isScreenSharing?: boolean
}

export type PeerEventCallback = (peerId: string, userName: string, platform: 'win' | 'mac' | 'linux') => void
export type StreamCallback = (peerId: string, stream: MediaStream) => void
export type ErrorCallback = (error: Error, context: string) => void
export type MuteStatusCallback = (peerId: string, muteStatus: MuteStatus) => void
export type RemoteMicControlCallback = (peerId: string, message: RemoteMicControlMessage) => void
export type ModerationControlCallback = (peerId: string, message: ModerationControlMessage) => void
export type ChatMessageCallback = ((msg: ChatMessage) => void) | null

export type SignalingState = 'idle' | 'connecting' | 'connected' | 'failed'
