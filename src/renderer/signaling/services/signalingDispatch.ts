import { SignalingLog } from '../../utils/Logger'

type SignalMessageType =
  | 'announce'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'leave'
  | 'ping'
  | 'pong'
  | 'mute-status'
  | 'room-lock'
  | 'room-locked'

export interface DispatchableSignalMessage {
  type: SignalMessageType
  from: string
  to?: string
  data?: unknown
  userName?: string
  platform?: 'win' | 'mac' | 'linux'
}

interface SignalingMessageHandlers {
  onRecordPeerActivity: (peerId: string) => void
  onAnnounce: (peerId: string, userName: string, platform: 'win' | 'mac' | 'linux') => void
  onOffer: (peerId: string, offer: RTCSessionDescriptionInit, userName: string, platform: 'win' | 'mac' | 'linux') => void
  onAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => void
  onIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => void
  onLeave: (peerId: string) => void
  onPing: (peerId: string) => void
  onPong: (peerId: string) => void
  onMuteStatus: (peerId: string, data: unknown) => void
  onRoomLock: (peerId: string, data: unknown) => void
  onRoomLocked: (peerId: string, data: unknown) => void
}

interface HandleSignalingDispatchOptions {
  selfId: string
  message: DispatchableSignalMessage
  handlers: SignalingMessageHandlers
}

export function handleSignalingDispatch(options: HandleSignalingDispatchOptions): void {
  const {
    selfId,
    message,
    handlers
  } = options

  if (message.from === selfId) {
    return
  }

  if (message.to && message.to !== selfId) {
    return
  }

  handlers.onRecordPeerActivity(message.from)

  if (message.type !== 'ping' && message.type !== 'pong' && message.type !== 'mute-status') {
    SignalingLog.info('Received signaling message', {
      type: message.type,
      from: message.from,
      userName: message.userName
    })
  }

  switch (message.type) {
    case 'announce':
      handlers.onAnnounce(message.from, message.userName || 'Unknown', message.platform || 'win')
      break
    case 'offer':
      handlers.onOffer(message.from, message.data as RTCSessionDescriptionInit, message.userName || 'Unknown', message.platform || 'win')
      break
    case 'answer':
      handlers.onAnswer(message.from, message.data as RTCSessionDescriptionInit)
      break
    case 'ice-candidate':
      handlers.onIceCandidate(message.from, message.data as RTCIceCandidateInit)
      break
    case 'leave':
      handlers.onLeave(message.from)
      break
    case 'ping':
      handlers.onPing(message.from)
      break
    case 'pong':
      handlers.onPong(message.from)
      break
    case 'mute-status':
      handlers.onMuteStatus(message.from, message.data)
      break
    case 'room-lock':
      handlers.onRoomLock(message.from, message.data)
      break
    case 'room-locked':
      handlers.onRoomLocked(message.from, message.data)
      break
  }
}
