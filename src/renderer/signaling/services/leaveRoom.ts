import { SignalingLog } from '../../utils/Logger'
import {
  closeBroadcastChannelSafe,
  shutdownPeersForLeave,
  type LeavePeerState
} from './roomRuntime'

interface MqttDisconnectable {
  disconnect: () => void
}

interface TeardownRoomRuntimeOptions<PrevStats> {
  peers: Map<string, LeavePeerState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  previousStats: Map<string, PrevStats>
  mqtt: MqttDisconnectable | null
  broadcastChannel: BroadcastChannel | null
}

interface TeardownRoomRuntimeResult {
  mqtt: null
  broadcastChannel: BroadcastChannel | null
}

interface SendBestEffortLeaveSignalOptions {
  roomId: string | null
  sessionId: number
  selfId: string
  broadcast: (message: { v: 1; type: 'leave'; from: string; sessionId: number }) => void
}

interface LocalMuteStatus {
  micMuted: boolean
  speakerMuted: boolean
  videoMuted?: boolean
  videoEnabled?: boolean
  isScreenSharing?: boolean
}

export interface LeaveRoomWorkflowAdapter<PrevStats> {
  roomId: string | null
  topic: string
  sessionId: number
  isLeaving: boolean
  peers: Map<string, LeavePeerState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  previousStats: Map<string, PrevStats>
  mqtt: MqttDisconnectable | null
  broadcastChannel: BroadcastChannel | null
  localStream: MediaStream | null
  localMuteStatus: LocalMuteStatus
  audioRoutingMode: string
  audioRoutingTargetPeerId: string | null
  stopAnnounceInterval: () => void
  stopHeartbeat: () => void
  sendLeaveSignal: () => void
  performControlStateReset: () => void
  performNetworkReconnectReset: () => void
  updateSignalingState: (state: 'idle') => void
}

export function teardownRoomRuntime<PrevStats>(
  options: TeardownRoomRuntimeOptions<PrevStats>
): TeardownRoomRuntimeResult {
  const {
    peers,
    pendingCandidates,
    peerLastSeen,
    peerLastPing,
    previousStats,
    mqtt,
    broadcastChannel
  } = options

  shutdownPeersForLeave(peers)
  peers.clear()
  pendingCandidates.clear()
  peerLastSeen.clear()
  peerLastPing.clear()

  if (mqtt) {
    mqtt.disconnect()
  }

  previousStats.clear()

  return {
    mqtt: null,
    broadcastChannel: closeBroadcastChannelSafe(broadcastChannel)
  }
}

export function sendBestEffortLeaveSignal(options: SendBestEffortLeaveSignalOptions): void {
  const {
    roomId,
    sessionId,
    selfId,
    broadcast
  } = options

  if (!roomId) {
    return
  }

  try {
    broadcast({
      v: 1,
      type: 'leave',
      from: selfId,
      sessionId
    })
  } catch {
    // Best-effort leave signal.
  }
}

export function executeLeaveRoomWorkflowWithAdapter<PrevStats>(
  adapter: LeaveRoomWorkflowAdapter<PrevStats>
): boolean {
  if (!adapter.roomId) {
    SignalingLog.debug('Already left room, skipping')
    return false
  }

  if (adapter.isLeaving) {
    SignalingLog.warn('Leave already in progress, ignoring')
    return false
  }

  adapter.isLeaving = true

  try {
    SignalingLog.info('Leaving room', { roomId: adapter.roomId, sessionId: adapter.sessionId })

    adapter.stopAnnounceInterval()
    adapter.stopHeartbeat()
    adapter.sendLeaveSignal()

    const runtimeAfterTeardown = teardownRoomRuntime({
      peers: adapter.peers,
      pendingCandidates: adapter.pendingCandidates,
      peerLastSeen: adapter.peerLastSeen,
      peerLastPing: adapter.peerLastPing,
      previousStats: adapter.previousStats,
      mqtt: adapter.mqtt,
      broadcastChannel: adapter.broadcastChannel
    })

    adapter.mqtt = runtimeAfterTeardown.mqtt
    adapter.broadcastChannel = runtimeAfterTeardown.broadcastChannel
    adapter.roomId = null
    adapter.topic = ''
    adapter.localStream = null
    adapter.localMuteStatus = { micMuted: false, speakerMuted: false }
    adapter.audioRoutingMode = 'broadcast'
    adapter.audioRoutingTargetPeerId = null
    adapter.performControlStateReset()
    adapter.performNetworkReconnectReset()
    adapter.updateSignalingState('idle')

    SignalingLog.info('Left room successfully')
    return true
  } finally {
    adapter.isLeaving = false
  }
}
