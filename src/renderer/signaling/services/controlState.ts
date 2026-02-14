import type {
  ModerationControlMessage,
  ModerationState,
  RemoteMicControlMessage
} from '@/types'

export interface ControlState {
  pendingRemoteMicRequests: Map<string, string>
  pendingOutgoingRemoteMicRequestId: string | null
  activeRemoteMicTargetPeerId: string | null
  activeRemoteMicSourcePeerId: string | null
  activeRemoteMicRequestId: string | null
  roomLocked: boolean
  roomLockOwnerPeerId: string | null
  raisedHands: Map<string, number>
  localHandRaised: boolean
  pendingMuteAllRequests: Map<string, string>
}

export interface RemoteMicControlHandlers {
  onRemoteMicControl?: (peerId: string, message: RemoteMicControlMessage) => void
  resetAudioRoutingToBroadcast?: () => void
}

export interface ModerationControlHandlers {
  onModerationControl?: (peerId: string, message: ModerationControlMessage) => void
}

export interface ControlDisconnectHandlers {
  onRemoteMicControl?: (peerId: string, message: RemoteMicControlMessage) => void
  resetAudioRoutingToBroadcast?: () => void
  now?: () => number
  createRequestId?: () => string
}

export interface ModerationDisconnectHandlers {
  onModerationControl?: (peerId: string, message: ModerationControlMessage) => void
  now?: () => number
}

const REMOTE_MIC_MESSAGE_TYPES = new Set([
  'rm_request',
  'rm_response',
  'rm_start',
  'rm_stop',
  'rm_heartbeat'
])

const MODERATION_MESSAGE_TYPES = new Set([
  'mod_room_lock',
  'mod_room_locked_notice',
  'mod_mute_all_request',
  'mod_mute_all_response',
  'mod_hand_raise'
])

export function createControlState(): ControlState {
  return {
    pendingRemoteMicRequests: new Map(),
    pendingOutgoingRemoteMicRequestId: null,
    activeRemoteMicTargetPeerId: null,
    activeRemoteMicSourcePeerId: null,
    activeRemoteMicRequestId: null,
    roomLocked: false,
    roomLockOwnerPeerId: null,
    raisedHands: new Map(),
    localHandRaised: false,
    pendingMuteAllRequests: new Map()
  }
}

export function isRemoteMicControlMessage(data: unknown): data is RemoteMicControlMessage {
  if (!data || typeof data !== 'object') {
    return false
  }
  const maybe = data as Record<string, unknown>
  return typeof maybe.type === 'string' &&
    REMOTE_MIC_MESSAGE_TYPES.has(maybe.type) &&
    typeof maybe.requestId === 'string'
}

export function isModerationControlMessage(data: unknown): data is ModerationControlMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const maybe = data as Record<string, unknown>
  if (typeof maybe.type !== 'string' || !MODERATION_MESSAGE_TYPES.has(maybe.type)) {
    return false
  }

  switch (maybe.type) {
    case 'mod_room_lock':
      return typeof maybe.locked === 'boolean' && typeof maybe.lockedByPeerId === 'string'
    case 'mod_room_locked_notice':
      return typeof maybe.lockedByPeerId === 'string'
    case 'mod_mute_all_request':
      return typeof maybe.requestId === 'string' &&
        typeof maybe.requestedByPeerId === 'string' &&
        typeof maybe.requestedByName === 'string'
    case 'mod_mute_all_response':
      return typeof maybe.requestId === 'string' && typeof maybe.accepted === 'boolean'
    case 'mod_hand_raise':
      return typeof maybe.peerId === 'string' && typeof maybe.raised === 'boolean'
    default:
      return false
  }
}

export function applyRemoteMicControlMessage(
  state: ControlState,
  peerId: string,
  message: RemoteMicControlMessage,
  handlers: RemoteMicControlHandlers
): void {
  switch (message.type) {
    case 'rm_request':
      state.pendingRemoteMicRequests.set(message.requestId, peerId)
      break
    case 'rm_response':
      if (state.pendingOutgoingRemoteMicRequestId === message.requestId) {
        state.pendingOutgoingRemoteMicRequestId = null
      }
      if (message.accepted) {
        state.activeRemoteMicTargetPeerId = peerId
        state.activeRemoteMicRequestId = message.requestId
      } else {
        if (state.activeRemoteMicTargetPeerId === peerId) {
          state.activeRemoteMicTargetPeerId = null
        }
        if (state.activeRemoteMicRequestId === message.requestId) {
          state.activeRemoteMicRequestId = null
        }
      }
      break
    case 'rm_start':
      state.activeRemoteMicSourcePeerId = peerId
      state.activeRemoteMicRequestId = message.requestId
      break
    case 'rm_stop':
      state.pendingRemoteMicRequests.delete(message.requestId)
      if (state.activeRemoteMicTargetPeerId === peerId) {
        handlers.resetAudioRoutingToBroadcast?.()
        state.activeRemoteMicTargetPeerId = null
      }
      if (state.activeRemoteMicSourcePeerId === peerId) {
        state.activeRemoteMicSourcePeerId = null
      }
      if (state.activeRemoteMicRequestId === message.requestId) {
        state.activeRemoteMicRequestId = null
      }
      break
    case 'rm_heartbeat':
      break
  }

  handlers.onRemoteMicControl?.(peerId, message)
}

export function applyModerationControlMessage(
  state: ControlState,
  peerId: string,
  message: ModerationControlMessage,
  handlers: ModerationControlHandlers
): void {
  switch (message.type) {
    case 'mod_room_lock':
      state.roomLocked = message.locked
      state.roomLockOwnerPeerId = message.locked ? message.lockedByPeerId : null
      break
    case 'mod_room_locked_notice':
      state.roomLocked = true
      state.roomLockOwnerPeerId = message.lockedByPeerId
      break
    case 'mod_mute_all_request':
      state.pendingMuteAllRequests.set(message.requestId, peerId)
      break
    case 'mod_mute_all_response':
      break
    case 'mod_hand_raise':
      if (message.raised) {
        state.raisedHands.set(peerId, message.ts)
      } else {
        state.raisedHands.delete(peerId)
      }
      break
  }

  handlers.onModerationControl?.(peerId, message)
}

export function parseRoomLockSignalPayload(data: unknown): Extract<ModerationControlMessage, { type: 'mod_room_lock' }> | null {
  if (!isModerationControlMessage(data) || data.type !== 'mod_room_lock') {
    return null
  }
  return data
}

export function parseRoomLockedSignalPayload(data: unknown, now: () => number = () => Date.now()): Extract<ModerationControlMessage, { type: 'mod_room_locked_notice' }> | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const maybe = data as Record<string, unknown>
  if (typeof maybe.lockedByPeerId !== 'string') {
    return null
  }

  return {
    type: 'mod_room_locked_notice',
    lockedByPeerId: maybe.lockedByPeerId,
    ts: typeof maybe.ts === 'number' ? maybe.ts : now()
  }
}

export function handleRemoteMicPeerDisconnect(
  state: ControlState,
  peerId: string,
  handlers: ControlDisconnectHandlers
): void {
  const disconnectedActiveTarget = state.activeRemoteMicTargetPeerId === peerId
  const disconnectedActiveSource = state.activeRemoteMicSourcePeerId === peerId

  if (disconnectedActiveTarget) {
    state.activeRemoteMicTargetPeerId = null
    state.pendingOutgoingRemoteMicRequestId = null
    handlers.resetAudioRoutingToBroadcast?.()
  }

  if (disconnectedActiveSource) {
    state.activeRemoteMicSourcePeerId = null
  }

  if (disconnectedActiveTarget || disconnectedActiveSource) {
    const createRequestId = handlers.createRequestId ?? (() => 'rm-stop-fallback')
    const now = handlers.now ?? (() => Date.now())
    const requestId = state.activeRemoteMicRequestId || createRequestId()
    state.activeRemoteMicRequestId = null
    handlers.onRemoteMicControl?.(peerId, {
      type: 'rm_stop',
      requestId,
      reason: 'peer-disconnected',
      ts: now()
    })
  }

  state.pendingRemoteMicRequests.forEach((sourcePeerId, requestId) => {
    if (sourcePeerId === peerId) {
      state.pendingRemoteMicRequests.delete(requestId)
    }
  })
}

export function handleModerationPeerDisconnect(
  state: ControlState,
  peerId: string,
  handlers: ModerationDisconnectHandlers
): void {
  const now = handlers.now ?? (() => Date.now())
  const ts = now()

  const hadRaisedHand = state.raisedHands.delete(peerId)
  if (hadRaisedHand) {
    handlers.onModerationControl?.(peerId, {
      type: 'mod_hand_raise',
      peerId,
      raised: false,
      ts
    })
  }

  state.pendingMuteAllRequests.forEach((requestPeerId, requestId) => {
    if (requestPeerId === peerId) {
      state.pendingMuteAllRequests.delete(requestId)
    }
  })

  if (state.roomLocked && state.roomLockOwnerPeerId === peerId) {
    state.roomLocked = false
    state.roomLockOwnerPeerId = null
    handlers.onModerationControl?.(peerId, {
      type: 'mod_room_lock',
      locked: false,
      lockedByPeerId: peerId,
      ts
    })
  }
}

export function buildModerationState(state: ControlState): ModerationState {
  return {
    roomLocked: state.roomLocked,
    roomLockOwnerPeerId: state.roomLockOwnerPeerId,
    localHandRaised: state.localHandRaised,
    raisedHands: Array.from(state.raisedHands.entries())
      .map(([peerId, raisedAt]) => ({ peerId, raisedAt }))
      .sort((a, b) => a.raisedAt - b.raisedAt)
  }
}

export function resetControlState(state: ControlState): void {
  state.pendingRemoteMicRequests.clear()
  state.pendingOutgoingRemoteMicRequestId = null
  state.activeRemoteMicTargetPeerId = null
  state.activeRemoteMicSourcePeerId = null
  state.activeRemoteMicRequestId = null
  state.roomLocked = false
  state.roomLockOwnerPeerId = null
  state.localHandRaised = false
  state.raisedHands.clear()
  state.pendingMuteAllRequests.clear()
}

export function getControlDebugInfo(state: ControlState): Record<string, unknown> {
  return {
    pendingRemoteMicRequests: state.pendingRemoteMicRequests.size,
    pendingOutgoingRemoteMicRequestId: state.pendingOutgoingRemoteMicRequestId,
    activeRemoteMicTargetPeerId: state.activeRemoteMicTargetPeerId,
    activeRemoteMicSourcePeerId: state.activeRemoteMicSourcePeerId,
    activeRemoteMicRequestId: state.activeRemoteMicRequestId,
    roomLocked: state.roomLocked,
    roomLockOwnerPeerId: state.roomLockOwnerPeerId,
    localHandRaised: state.localHandRaised,
    raisedHands: Array.from(state.raisedHands.entries()).map(([peerId, raisedAt]) => ({ peerId, raisedAt })),
    pendingMuteAllRequests: state.pendingMuteAllRequests.size
  }
}
