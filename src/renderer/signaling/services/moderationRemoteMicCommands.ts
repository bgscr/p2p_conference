import { PeerLog } from '../../utils/Logger'
import type {
  ModerationControlMessage,
  RemoteMicControlMessage,
  RemoteMicStopReason
} from '@/types'
import type { ControlState } from './controlState'

type RemoteMicResponseReason =
  NonNullable<Extract<RemoteMicControlMessage, { type: 'rm_response' }>['reason']>

interface SetRoomLockedCommandOptions {
  roomId: string | null
  locked: boolean
  selfId: string
  sessionId: number
  controlState: ControlState
  createMessageId: () => string
  now?: () => number
  onModerationControl?: (peerId: string, message: ModerationControlMessage) => void
  broadcastRoomLockSignal: (payload: ModerationControlMessage) => void
  broadcastControlMessage: (payload: ModerationControlMessage) => number
}

interface RequestMuteAllCommandOptions {
  roomId: string | null
  userName: string
  reason: string
  selfId: string
  createRequestId: () => string
  now?: () => number
  broadcastControlMessage: (message: ModerationControlMessage) => number
  onModerationControl?: (peerId: string, message: ModerationControlMessage) => void
}

interface RespondMuteAllRequestCommandOptions {
  peerId: string
  requestId: string
  accepted: boolean
  controlState: ControlState
  now?: () => number
  sendControlMessage: (peerId: string, message: ModerationControlMessage | RemoteMicControlMessage) => boolean
}

interface SetHandRaisedCommandOptions {
  roomId: string | null
  raised: boolean
  selfId: string
  controlState: ControlState
  now?: () => number
  onModerationControl?: (peerId: string, message: ModerationControlMessage) => void
  broadcastControlMessage: (message: ModerationControlMessage) => number
}

interface SendRemoteMicRequestCommandOptions {
  targetPeerId: string
  selfId: string
  userName: string
  controlState: ControlState
  hasPeer: (peerId: string) => boolean
  createRequestId: () => string
  now?: () => number
  sendControlMessage: (peerId: string, message: ModerationControlMessage | RemoteMicControlMessage) => boolean
}

interface RespondRemoteMicRequestCommandOptions {
  requestId: string
  accepted: boolean
  reason: RemoteMicResponseReason
  controlState: ControlState
  now?: () => number
  sendControlMessage: (peerId: string, message: ModerationControlMessage | RemoteMicControlMessage) => boolean
}

interface SendRemoteMicStartCommandOptions {
  peerId: string
  requestId: string
  controlState: ControlState
  now?: () => number
  sendControlMessage: (peerId: string, message: ModerationControlMessage | RemoteMicControlMessage) => boolean
}

interface SendRemoteMicHeartbeatCommandOptions {
  peerId: string
  requestId: string
  now?: () => number
  sendControlMessage: (peerId: string, message: ModerationControlMessage | RemoteMicControlMessage) => boolean
}

interface SendRemoteMicStopCommandOptions {
  peerId: string
  requestId: string
  reason: RemoteMicStopReason
  controlState: ControlState
  now?: () => number
  sendControlMessage: (peerId: string, message: ModerationControlMessage | RemoteMicControlMessage) => boolean
}

interface StopRemoteMicSessionCommandOptions {
  reason: RemoteMicStopReason
  controlState: ControlState
  sendRemoteMicStop: (peerId: string, requestId: string, reason: RemoteMicStopReason) => boolean
  resetAudioRoutingToBroadcast: () => void
}

type ControlMessage = ModerationControlMessage | RemoteMicControlMessage

interface RoomLockSignalEnvelope {
  v: 1
  type: 'room-lock'
  from: string
  data: ModerationControlMessage
  sessionId: number
  msgId: string
}

export interface ModerationRemoteMicAdapter {
  roomId: string | null
  userName: string
  sessionId: number
  controlState: ControlState
  peers: Map<string, unknown>
  onModerationControl?: (peerId: string, message: ModerationControlMessage) => void
  broadcast: (message: RoomLockSignalEnvelope) => void
  broadcastControlMessage: (message: ModerationControlMessage) => number
  sendControlMessage: (peerId: string, message: ControlMessage) => boolean
  setAudioRoutingMode: (mode: 'broadcast' | 'exclusive', targetPeerId?: string) => boolean
}

interface AdapterCommandOptions {
  adapter: ModerationRemoteMicAdapter
  selfId: string
  createMessageId: () => string
}

export function setRoomLockedCommand(options: SetRoomLockedCommandOptions): boolean {
  const {
    roomId,
    locked,
    selfId,
    controlState,
    now = () => Date.now(),
    onModerationControl,
    broadcastRoomLockSignal,
    broadcastControlMessage
  } = options

  if (!roomId) {
    return false
  }

  controlState.roomLocked = locked
  controlState.roomLockOwnerPeerId = locked ? selfId : null
  const ts = now()

  const payload: ModerationControlMessage = {
    type: 'mod_room_lock',
    locked,
    lockedByPeerId: selfId,
    ts
  }

  onModerationControl?.(selfId, payload)
  broadcastRoomLockSignal(payload)
  broadcastControlMessage(payload)
  return true
}

export function requestMuteAllCommand(options: RequestMuteAllCommandOptions): string | null {
  const {
    roomId,
    userName,
    reason,
    selfId,
    createRequestId,
    now = () => Date.now(),
    broadcastControlMessage,
    onModerationControl
  } = options

  if (!roomId) {
    return null
  }

  const requestId = createRequestId()
  const message: ModerationControlMessage = {
    type: 'mod_mute_all_request',
    requestId,
    requestedByPeerId: selfId,
    requestedByName: userName || reason,
    ts: now()
  }

  const sentCount = broadcastControlMessage(message)
  if (sentCount === 0) {
    PeerLog.warn('Mute-all request not sent: no ready control channels')
    return null
  }

  onModerationControl?.(selfId, message)
  return requestId
}

export function respondMuteAllRequestCommand(options: RespondMuteAllRequestCommandOptions): boolean {
  const {
    peerId,
    requestId,
    accepted,
    controlState,
    now = () => Date.now(),
    sendControlMessage
  } = options

  const message: ModerationControlMessage = {
    type: 'mod_mute_all_response',
    requestId,
    accepted,
    ts: now()
  }

  const sent = sendControlMessage(peerId, message)
  if (sent && controlState.pendingMuteAllRequests.get(requestId) === peerId) {
    controlState.pendingMuteAllRequests.delete(requestId)
  }
  return sent
}

export function setHandRaisedCommand(options: SetHandRaisedCommandOptions): boolean {
  const {
    roomId,
    raised,
    selfId,
    controlState,
    now = () => Date.now(),
    onModerationControl,
    broadcastControlMessage
  } = options

  if (!roomId) {
    return false
  }

  const ts = now()
  controlState.localHandRaised = raised
  if (raised) {
    controlState.raisedHands.set(selfId, ts)
  } else {
    controlState.raisedHands.delete(selfId)
  }

  const message: ModerationControlMessage = {
    type: 'mod_hand_raise',
    peerId: selfId,
    raised,
    ts
  }

  onModerationControl?.(selfId, message)
  broadcastControlMessage(message)
  return true
}

export function sendRemoteMicRequestCommand(options: SendRemoteMicRequestCommandOptions): string | null {
  const {
    targetPeerId,
    selfId,
    userName,
    controlState,
    hasPeer,
    createRequestId,
    now = () => Date.now(),
    sendControlMessage
  } = options

  if (!hasPeer(targetPeerId)) {
    PeerLog.warn('Cannot request remote mic mapping, peer not found', { targetPeerId })
    return null
  }

  const requestId = createRequestId()
  const message: RemoteMicControlMessage = {
    type: 'rm_request',
    requestId,
    sourcePeerId: selfId,
    sourceName: userName,
    targetPeerId,
    ts: now()
  }

  if (!sendControlMessage(targetPeerId, message)) {
    return null
  }

  controlState.pendingOutgoingRemoteMicRequestId = requestId
  controlState.activeRemoteMicRequestId = requestId
  controlState.activeRemoteMicTargetPeerId = targetPeerId
  return requestId
}

export function respondRemoteMicRequestCommand(options: RespondRemoteMicRequestCommandOptions): boolean {
  const {
    requestId,
    accepted,
    reason,
    controlState,
    now = () => Date.now(),
    sendControlMessage
  } = options

  const sourcePeerId = controlState.pendingRemoteMicRequests.get(requestId)
  if (!sourcePeerId) {
    PeerLog.warn('No pending remote mic request found', { requestId })
    return false
  }

  const sent = sendControlMessage(sourcePeerId, {
    type: 'rm_response',
    requestId,
    accepted,
    reason,
    ts: now()
  })

  if (!sent) {
    return false
  }

  if (accepted) {
    controlState.activeRemoteMicSourcePeerId = sourcePeerId
    controlState.activeRemoteMicRequestId = requestId
  }

  controlState.pendingRemoteMicRequests.delete(requestId)
  return true
}

export function sendRemoteMicStartCommand(options: SendRemoteMicStartCommandOptions): boolean {
  const {
    peerId,
    requestId,
    controlState,
    now = () => Date.now(),
    sendControlMessage
  } = options

  const sent = sendControlMessage(peerId, {
    type: 'rm_start',
    requestId,
    ts: now()
  })

  if (sent) {
    controlState.activeRemoteMicTargetPeerId = peerId
    controlState.activeRemoteMicRequestId = requestId
  }
  return sent
}

export function sendRemoteMicHeartbeatCommand(options: SendRemoteMicHeartbeatCommandOptions): boolean {
  const {
    peerId,
    requestId,
    now = () => Date.now(),
    sendControlMessage
  } = options

  return sendControlMessage(peerId, {
    type: 'rm_heartbeat',
    requestId,
    ts: now()
  })
}

export function sendRemoteMicStopCommand(options: SendRemoteMicStopCommandOptions): boolean {
  const {
    peerId,
    requestId,
    reason,
    controlState,
    now = () => Date.now(),
    sendControlMessage
  } = options

  const sent = sendControlMessage(peerId, {
    type: 'rm_stop',
    requestId,
    reason,
    ts: now()
  })

  if (sent && controlState.activeRemoteMicRequestId === requestId) {
    controlState.activeRemoteMicRequestId = null
    if (controlState.activeRemoteMicTargetPeerId === peerId) {
      controlState.activeRemoteMicTargetPeerId = null
    }
    if (controlState.activeRemoteMicSourcePeerId === peerId) {
      controlState.activeRemoteMicSourcePeerId = null
    }
  }

  return sent
}

export function stopRemoteMicSessionCommand(options: StopRemoteMicSessionCommandOptions): void {
  const {
    reason,
    controlState,
    sendRemoteMicStop,
    resetAudioRoutingToBroadcast
  } = options

  const requestId = controlState.activeRemoteMicRequestId
  if (requestId && controlState.activeRemoteMicTargetPeerId) {
    sendRemoteMicStop(controlState.activeRemoteMicTargetPeerId, requestId, reason)
  }
  if (requestId && controlState.activeRemoteMicSourcePeerId) {
    sendRemoteMicStop(controlState.activeRemoteMicSourcePeerId, requestId, reason)
  }

  resetAudioRoutingToBroadcast()
  controlState.pendingOutgoingRemoteMicRequestId = null
  controlState.activeRemoteMicRequestId = null
  controlState.activeRemoteMicSourcePeerId = null
  controlState.activeRemoteMicTargetPeerId = null
  controlState.pendingRemoteMicRequests.clear()
}

export function setRoomLockedWithAdapter(
  options: AdapterCommandOptions & {
    locked: boolean
  }
): boolean {
  const {
    adapter,
    locked,
    selfId,
    createMessageId
  } = options

  return setRoomLockedCommand({
    roomId: adapter.roomId,
    locked,
    selfId,
    sessionId: adapter.sessionId,
    controlState: adapter.controlState,
    createMessageId,
    onModerationControl: adapter.onModerationControl,
    broadcastRoomLockSignal: (payload) => {
      adapter.broadcast({
        v: 1,
        type: 'room-lock',
        from: selfId,
        data: payload,
        sessionId: adapter.sessionId,
        msgId: createMessageId()
      })
    },
    broadcastControlMessage: (message) => adapter.broadcastControlMessage(message)
  })
}

export function requestMuteAllWithAdapter(
  options: AdapterCommandOptions & {
    reason?: string
  }
): string | null {
  const {
    adapter,
    reason = 'host-request',
    selfId,
    createMessageId
  } = options

  return requestMuteAllCommand({
    roomId: adapter.roomId,
    userName: adapter.userName,
    reason,
    selfId,
    createRequestId: createMessageId,
    broadcastControlMessage: (message) => adapter.broadcastControlMessage(message),
    onModerationControl: adapter.onModerationControl
  })
}

export function respondMuteAllRequestWithAdapter(
  options: AdapterCommandOptions & {
    peerId: string
    requestId: string
    accepted: boolean
  }
): boolean {
  const {
    adapter,
    peerId,
    requestId,
    accepted
  } = options

  return respondMuteAllRequestCommand({
    peerId,
    requestId,
    accepted,
    controlState: adapter.controlState,
    sendControlMessage: (peerId, message) => adapter.sendControlMessage(peerId, message)
  })
}

export function setHandRaisedWithAdapter(
  options: AdapterCommandOptions & {
    raised: boolean
  }
): boolean {
  const {
    adapter,
    selfId,
    raised
  } = options

  return setHandRaisedCommand({
    roomId: adapter.roomId,
    raised,
    selfId,
    controlState: adapter.controlState,
    onModerationControl: adapter.onModerationControl,
    broadcastControlMessage: (message) => adapter.broadcastControlMessage(message)
  })
}

export function sendRemoteMicRequestWithAdapter(
  options: AdapterCommandOptions & {
    targetPeerId: string
  }
): string | null {
  const {
    adapter,
    targetPeerId,
    selfId,
    createMessageId
  } = options

  return sendRemoteMicRequestCommand({
    targetPeerId,
    selfId,
    userName: adapter.userName,
    controlState: adapter.controlState,
    hasPeer: (peerId) => adapter.peers.has(peerId),
    createRequestId: createMessageId,
    sendControlMessage: (peerId, message) => adapter.sendControlMessage(peerId, message)
  })
}

export function respondRemoteMicRequestWithAdapter(
  options: AdapterCommandOptions & {
    requestId: string
    accepted: boolean
    reason: RemoteMicResponseReason
  }
): boolean {
  const {
    adapter,
    requestId,
    accepted,
    reason
  } = options

  return respondRemoteMicRequestCommand({
    requestId,
    accepted,
    reason,
    controlState: adapter.controlState,
    sendControlMessage: (peerId, message) => adapter.sendControlMessage(peerId, message)
  })
}

export function sendRemoteMicStartWithAdapter(
  options: AdapterCommandOptions & {
    peerId: string
    requestId: string
  }
): boolean {
  const {
    adapter,
    peerId,
    requestId
  } = options

  return sendRemoteMicStartCommand({
    peerId,
    requestId,
    controlState: adapter.controlState,
    sendControlMessage: (targetPeerId, message) => adapter.sendControlMessage(targetPeerId, message)
  })
}

export function sendRemoteMicHeartbeatWithAdapter(
  options: AdapterCommandOptions & {
    peerId: string
    requestId: string
  }
): boolean {
  const {
    adapter,
    peerId,
    requestId
  } = options

  return sendRemoteMicHeartbeatCommand({
    peerId,
    requestId,
    sendControlMessage: (targetPeerId, message) => adapter.sendControlMessage(targetPeerId, message)
  })
}

export function sendRemoteMicStopWithAdapter(
  options: AdapterCommandOptions & {
    peerId: string
    requestId: string
    reason: RemoteMicStopReason
  }
): boolean {
  const {
    adapter,
    peerId,
    requestId,
    reason
  } = options

  return sendRemoteMicStopCommand({
    peerId,
    requestId,
    reason,
    controlState: adapter.controlState,
    sendControlMessage: (targetPeerId, message) => adapter.sendControlMessage(targetPeerId, message)
  })
}

export function stopRemoteMicSessionWithAdapter(
  options: AdapterCommandOptions & {
    reason: RemoteMicStopReason
  }
): void {
  const {
    adapter,
    reason,
    selfId,
    createMessageId
  } = options

  stopRemoteMicSessionCommand({
    reason,
    controlState: adapter.controlState,
    sendRemoteMicStop: (peerId, requestId, stopReason) =>
      sendRemoteMicStopWithAdapter({
        adapter,
        peerId,
        requestId,
        reason: stopReason,
        selfId,
        createMessageId
      }),
    resetAudioRoutingToBroadcast: () => {
      adapter.setAudioRoutingMode('broadcast')
    }
  })
}
