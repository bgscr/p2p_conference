import { PeerLog } from '../../utils/Logger'
import type {
  ChatMessage,
  ModerationControlMessage,
  RemoteMicControlMessage
} from '@/types'

export type DataChannelKind = 'chat' | 'control'

export interface DataChannelPeerState {
  chatDataChannel: RTCDataChannel | null
  controlDataChannel: RTCDataChannel | null
}

interface SetupDataChannelHandlersOptions {
  dc: RTCDataChannel
  peerId: string
  peerConn: DataChannelPeerState
  channelType: DataChannelKind
  onChatMessage?: (message: ChatMessage) => void
  isRemoteMicControlMessage: (data: unknown) => data is RemoteMicControlMessage
  isModerationControlMessage: (data: unknown) => data is ModerationControlMessage
  onRemoteMicControl: (peerId: string, message: RemoteMicControlMessage) => void
  onModerationControl: (peerId: string, message: ModerationControlMessage) => void
}

interface SendControlMessageOptions {
  peerId: string
  message: RemoteMicControlMessage | ModerationControlMessage
  peer: { controlDataChannel: RTCDataChannel | null } | undefined
}

interface BroadcastControlMessageOptions {
  peerIds: Iterable<string>
  sendToPeer: (peerId: string) => boolean
}

function parseChatMessagePayload(data: unknown): ChatMessage | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const maybe = data as Record<string, unknown>
  if (
    maybe.type !== 'chat' ||
    typeof maybe.id !== 'string' ||
    typeof maybe.senderId !== 'string' ||
    typeof maybe.senderName !== 'string' ||
    typeof maybe.content !== 'string' ||
    typeof maybe.timestamp !== 'number'
  ) {
    return null
  }

  return {
    id: maybe.id,
    senderId: maybe.senderId,
    senderName: maybe.senderName,
    content: maybe.content,
    timestamp: maybe.timestamp,
    type: 'text'
  }
}

export function setupDataChannelHandlers(options: SetupDataChannelHandlersOptions): void {
  const {
    dc,
    peerId,
    peerConn,
    channelType,
    onChatMessage,
    isRemoteMicControlMessage,
    isModerationControlMessage,
    onRemoteMicControl,
    onModerationControl
  } = options

  dc.onopen = () => {
    PeerLog.info('DataChannel opened', { peerId, label: dc.label, channelType })
  }

  dc.onclose = () => {
    PeerLog.info('DataChannel closed', { peerId, label: dc.label, channelType })
    if (channelType === 'chat' && peerConn.chatDataChannel === dc) {
      peerConn.chatDataChannel = null
    }
    if (channelType === 'control' && peerConn.controlDataChannel === dc) {
      peerConn.controlDataChannel = null
    }
  }

  dc.onerror = (event) => {
    PeerLog.error('DataChannel error', { peerId, channelType, error: String(event) })
  }

  dc.onmessage = (event) => {
    try {
      if (typeof event.data !== 'string') {
        return
      }

      const payload = JSON.parse(event.data)
      if (channelType === 'chat') {
        const chatMessage = parseChatMessagePayload(payload)
        if (chatMessage && onChatMessage) {
          onChatMessage(chatMessage)
        }
        return
      }

      if (channelType === 'control') {
        if (isRemoteMicControlMessage(payload)) {
          onRemoteMicControl(peerId, payload)
          return
        }
        if (isModerationControlMessage(payload)) {
          onModerationControl(peerId, payload)
          return
        }

        PeerLog.warn('Invalid control message payload', { peerId, payload })
      }
    } catch (err) {
      PeerLog.warn('Failed to parse DataChannel message', { peerId, channelType, error: String(err) })
    }
  }
}

export function sendControlMessageToPeer(options: SendControlMessageOptions): boolean {
  const {
    peerId,
    message,
    peer
  } = options

  if (!peer?.controlDataChannel || peer.controlDataChannel.readyState !== 'open') {
    PeerLog.warn('Control channel not ready', { peerId, type: message.type })
    return false
  }

  try {
    peer.controlDataChannel.send(JSON.stringify(message))
    return true
  } catch (err) {
    PeerLog.error('Failed to send control message', { peerId, type: message.type, error: String(err) })
    return false
  }
}

export function broadcastControlMessageToPeers(options: BroadcastControlMessageOptions): number {
  const {
    peerIds,
    sendToPeer
  } = options

  let sentCount = 0
  for (const peerId of peerIds) {
    if (sendToPeer(peerId)) {
      sentCount++
    }
  }
  return sentCount
}
