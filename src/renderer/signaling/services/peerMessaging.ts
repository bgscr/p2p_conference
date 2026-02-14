import { PeerLog, SignalingLog } from '../../utils/Logger'

export interface MuteStatusLike {
  micMuted: boolean
  speakerMuted: boolean
  videoMuted?: boolean
  videoEnabled?: boolean
  isScreenSharing?: boolean
}

interface BroadcastMuteStatusOptions<TMuteStatus extends MuteStatusLike> {
  micMuted: boolean
  speakerMuted: boolean
  videoEnabled?: boolean
  isScreenSharing?: boolean
  peers: Map<string, unknown>
  setLocalMuteStatus: (status: TMuteStatus) => void
  broadcastSignal: (payload: Required<MuteStatusLike>) => void
}

interface GetPeerMuteStatusOptions<TMuteStatus extends MuteStatusLike> {
  peerId: string
  peers: Map<string, { muteStatus: TMuteStatus }>
  fallbackMuteStatus: TMuteStatus
}

interface BroadcastChatMessageOptions {
  content: string
  senderName: string
  senderId: string
  peers: Map<string, { chatDataChannel: RTCDataChannel | null }>
  createMessageId: () => string
  now?: () => number
  maxLength?: number
}

export function broadcastMuteStatusToPeers<TMuteStatus extends MuteStatusLike>(
  options: BroadcastMuteStatusOptions<TMuteStatus>
): void {
  const {
    micMuted,
    speakerMuted,
    videoEnabled = true,
    isScreenSharing = false,
    peers,
    setLocalMuteStatus,
    broadcastSignal
  } = options

  const videoMuted = !videoEnabled
  setLocalMuteStatus({
    micMuted,
    speakerMuted,
    videoMuted,
    videoEnabled,
    isScreenSharing
  } as TMuteStatus)

  if (peers.size === 0) {
    return
  }

  SignalingLog.debug('Broadcasting mute status', {
    micMuted,
    speakerMuted,
    videoMuted,
    isScreenSharing
  })

  broadcastSignal({
    micMuted,
    speakerMuted,
    videoMuted,
    videoEnabled,
    isScreenSharing
  })
}

export function getPeerMuteStatusSnapshot<TMuteStatus extends MuteStatusLike>(
  options: GetPeerMuteStatusOptions<TMuteStatus>
): TMuteStatus {
  const {
    peerId,
    peers,
    fallbackMuteStatus
  } = options

  return peers.get(peerId)?.muteStatus ?? fallbackMuteStatus
}

export function getAllPeerMuteStatusSnapshots<TMuteStatus extends MuteStatusLike>(
  peers: Map<string, { muteStatus: TMuteStatus }>
): Map<string, TMuteStatus> {
  const result = new Map<string, TMuteStatus>()
  peers.forEach((peer, id) => {
    result.set(id, peer.muteStatus)
  })
  return result
}

export function broadcastChatMessageToPeers(options: BroadcastChatMessageOptions): void {
  const {
    senderName,
    senderId,
    peers,
    createMessageId,
    now = () => Date.now(),
    maxLength = 5000
  } = options

  let content = options.content
  if (content.length > maxLength) {
    PeerLog.warn('Chat message too long, truncating', { length: content.length })
    content = content.substring(0, maxLength)
  }

  const message = {
    type: 'chat',
    id: createMessageId(),
    senderId,
    senderName,
    content,
    timestamp: now()
  }

  const jsonStr = JSON.stringify(message)
  let sentCount = 0

  peers.forEach((peer, peerId) => {
    if (peer.chatDataChannel && peer.chatDataChannel.readyState === 'open') {
      try {
        peer.chatDataChannel.send(jsonStr)
        sentCount++
      } catch (err) {
        PeerLog.error('Failed to send chat message', { peerId, error: String(err) })
      }
    }
  })

  PeerLog.debug('Chat message sent', { sentCount, totalPeers: peers.size })
}
