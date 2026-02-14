import { SignalingLog } from '../../utils/Logger'

interface PeerMuteStateLike {
  micMuted: boolean
  speakerMuted: boolean
  videoMuted?: boolean
  isScreenSharing?: boolean
}

interface RecordPeerActivityOptions {
  peerId: string
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  now?: () => number
}

interface HandlePeerMuteStatusOptions<TMuteStatus extends PeerMuteStateLike> {
  peerId: string
  data: {
    micMuted?: boolean
    speakerMuted?: boolean
    videoMuted?: boolean
    isScreenSharing?: boolean
  }
  peers: Map<string, { muteStatus: TMuteStatus }>
  onPeerMuteChange: (peerId: string, muteStatus: TMuteStatus) => void
}

interface HandleModerationSignalPayloadOptions<TModerationMessage> {
  peerId: string
  data: unknown
  parsePayload: (data: unknown) => TModerationMessage | null
  invalidPayloadLog: string
  onModerationMessage: (peerId: string, message: TModerationMessage) => void
}

export function recordPeerActivityTimestamps(options: RecordPeerActivityOptions): void {
  const {
    peerId,
    peerLastSeen,
    peerLastPing,
    now = () => Date.now()
  } = options

  const ts = now()
  peerLastSeen.set(peerId, ts)
  peerLastPing.set(peerId, ts)
}

export function handlePeerMuteStatus<TMuteStatus extends PeerMuteStateLike>(
  options: HandlePeerMuteStatusOptions<TMuteStatus>
): void {
  const {
    peerId,
    data,
    peers,
    onPeerMuteChange
  } = options

  const peer = peers.get(peerId)
  if (!peer) {
    return
  }

  peer.muteStatus = {
    micMuted: data.micMuted ?? peer.muteStatus.micMuted,
    speakerMuted: data.speakerMuted ?? peer.muteStatus.speakerMuted,
    videoMuted: data.videoMuted ?? peer.muteStatus?.videoMuted,
    isScreenSharing: data.isScreenSharing ?? peer.muteStatus?.isScreenSharing
  } as TMuteStatus

  SignalingLog.debug('Peer mute status changed', { peerId, ...peer.muteStatus })
  onPeerMuteChange(peerId, peer.muteStatus)
}

export function handleModerationSignalPayload<TModerationMessage>(
  options: HandleModerationSignalPayloadOptions<TModerationMessage>
): void {
  const {
    peerId,
    data,
    parsePayload,
    invalidPayloadLog,
    onModerationMessage
  } = options

  const payload = parsePayload(data)
  if (!payload) {
    SignalingLog.warn(invalidPayloadLog, { peerId, data })
    return
  }

  onModerationMessage(peerId, payload)
}
