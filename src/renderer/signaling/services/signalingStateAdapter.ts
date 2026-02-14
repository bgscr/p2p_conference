import { SignalingLog } from '../../utils/Logger'
import {
  handleModerationSignalPayload,
  handlePeerMuteStatus,
  recordPeerActivityTimestamps
} from './signalingStateHandlers'

interface PeerMuteStateLike {
  micMuted: boolean
  speakerMuted: boolean
  videoMuted?: boolean
  isScreenSharing?: boolean
}

interface UpdateSignalingStateWithAdapterOptions<TSignalingState extends string> {
  currentState: TSignalingState
  nextState: TSignalingState
  setState: (state: TSignalingState) => void
  onStateChange?: (state: TSignalingState) => void
}

interface RecordPeerActivityWithAdapterOptions {
  peerId: string
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  now?: () => number
}

interface HandlePeerMuteStatusWithAdapterOptions<TMuteStatus extends PeerMuteStateLike> {
  peerId: string
  data: unknown
  peers: Map<string, { muteStatus: TMuteStatus }>
  onPeerMuteChange: (peerId: string, muteStatus: TMuteStatus) => void
}

interface HandleModerationSignalWithAdapterOptions<TModerationMessage> {
  peerId: string
  data: unknown
  parsePayload: (data: unknown) => TModerationMessage | null
  invalidPayloadLog: string
  onModerationMessage: (peerId: string, message: TModerationMessage) => void
}

export function updateSignalingStateWithAdapter<TSignalingState extends string>(
  options: UpdateSignalingStateWithAdapterOptions<TSignalingState>
): boolean {
  const {
    currentState,
    nextState,
    setState,
    onStateChange
  } = options

  if (currentState === nextState) {
    return false
  }

  setState(nextState)
  SignalingLog.info('Signaling state changed', { state: nextState })
  onStateChange?.(nextState)
  return true
}

export function recordPeerActivityWithAdapter(options: RecordPeerActivityWithAdapterOptions): void {
  recordPeerActivityTimestamps(options)
}

export function handlePeerMuteStatusWithAdapter<TMuteStatus extends PeerMuteStateLike>(
  options: HandlePeerMuteStatusWithAdapterOptions<TMuteStatus>
): void {
  const {
    peerId,
    data,
    peers,
    onPeerMuteChange
  } = options

  handlePeerMuteStatus({
    peerId,
    data: data as {
      micMuted?: boolean
      speakerMuted?: boolean
      videoMuted?: boolean
      isScreenSharing?: boolean
    },
    peers,
    onPeerMuteChange
  })
}

export function handleModerationSignalWithAdapter<TModerationMessage>(
  options: HandleModerationSignalWithAdapterOptions<TModerationMessage>
): void {
  handleModerationSignalPayload(options)
}
