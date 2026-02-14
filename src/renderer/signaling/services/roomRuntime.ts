import { PeerLog, SignalingLog } from '../../utils/Logger'

export interface AnnounceTimersState {
  announceInterval: NodeJS.Timeout | null
  announceDebounceTimer: NodeJS.Timeout | null
}

export interface HeartbeatTimerState {
  heartbeatInterval: NodeJS.Timeout | null
}

export interface LeavePeerState {
  pc: {
    close: () => void
  }
  disconnectTimer: NodeJS.Timeout | null
  reconnectTimer: NodeJS.Timeout | null
}

interface CountHealthyPeerConnectionsPeerState {
  pc: {
    connectionState: RTCPeerConnectionState
  }
}

interface CreateAnnounceLoopOptions {
  announceStartTime: number
  announceIntervalMs: number
  announceDurationMs: number
  getHealthyPeerCount: () => number
  onStop: () => void
  onReannounce: (elapsedMs: number) => void
  now?: () => number
}

interface ScheduleBroadcastAnnounceOptions<TMessage> {
  announceDebounceTimer: NodeJS.Timeout | null
  announceDebounceMs: number
  createMessage: (ts: number) => TMessage
  getPeerCount: () => number
  broadcast: (message: TMessage) => void
  onComplete: () => void
  now?: () => number
}

interface CreateManagedAnnounceLoopOptions {
  announceStartTime: number
  announceIntervalMs: number
  announceDurationMs: number
  getHealthyPeerCount: () => number
  onStop: () => void
  onReannounce: () => void
  now?: () => number
}

interface CreateHeartbeatLoopOptions {
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  hasSignalingChannel: () => boolean
  getPeerIds: () => string[]
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  onPeerTimeout: (peerId: string, lastSeen: number) => void
  onPingPeer: (peerId: string, now: number) => void
  now?: () => number
}

interface CreateManagedHeartbeatLoopOptions {
  heartbeatInterval: NodeJS.Timeout | null
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  hasSignalingChannel: () => boolean
  getPeerIds: () => string[]
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  onPeerTimeout: (peerId: string, lastSeen: number) => void
  onPingPeer: (peerId: string) => void
  now?: () => number
}

interface ScheduleBroadcastAnnounceWithAdapterOptions<TMessage> {
  announceDebounceTimer: NodeJS.Timeout | null
  announceDebounceMs: number
  createAnnounceMessage: (ts: number) => TMessage
  getPeerCount: () => number
  broadcast: (message: TMessage) => void
  onTimerCleared?: () => void
  now?: () => number
}

interface StartManagedAnnounceLoopWithAdapterOptions {
  announceStartTime: number
  announceInterval: NodeJS.Timeout | null
  announceDebounceTimer: NodeJS.Timeout | null
  announceIntervalMs: number
  announceDurationMs: number
  getHealthyPeerCount: () => number
  onStop: () => void
  onReannounce: () => void
  now?: () => number
}

interface StartManagedHeartbeatLoopWithAdapterOptions {
  heartbeatInterval: NodeJS.Timeout | null
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  hasSignalingChannel: () => boolean
  getPeerIds: () => string[]
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  onPeerTimeout: (peerId: string, seenAt: number) => void
  onPingPeer: (peerId: string) => void
  now?: () => number
}

export function clearAnnounceTimers(state: AnnounceTimersState): AnnounceTimersState {
  if (state.announceInterval) {
    clearInterval(state.announceInterval)
  }
  if (state.announceDebounceTimer) {
    clearTimeout(state.announceDebounceTimer)
  }

  return {
    announceInterval: null,
    announceDebounceTimer: null
  }
}

export function createAnnounceLoop(options: CreateAnnounceLoopOptions): NodeJS.Timeout {
  const {
    announceStartTime,
    announceIntervalMs,
    announceDurationMs,
    getHealthyPeerCount,
    onStop,
    onReannounce,
    now = () => Date.now()
  } = options

  return setInterval(() => {
    const elapsed = now() - announceStartTime

    if (elapsed > announceDurationMs && getHealthyPeerCount() > 0) {
      onStop()
      return
    }

    if (getHealthyPeerCount() === 0) {
      onReannounce(elapsed)
    }
  }, announceIntervalMs)
}

export function scheduleBroadcastAnnounce<TMessage>(options: ScheduleBroadcastAnnounceOptions<TMessage>): NodeJS.Timeout {
  const {
    announceDebounceTimer,
    announceDebounceMs,
    createMessage,
    getPeerCount,
    broadcast,
    onComplete,
    now = () => Date.now()
  } = options

  if (announceDebounceTimer) {
    clearTimeout(announceDebounceTimer)
  }

  return setTimeout(() => {
    const ts = now()
    const message = createMessage(ts)
    SignalingLog.debug('Broadcasting announce', { peerCount: getPeerCount() })
    broadcast(message)
    onComplete()
  }, announceDebounceMs)
}

export function countHealthyPeerConnections(
  peers: Map<string, CountHealthyPeerConnectionsPeerState>
): number {
  let count = 0
  peers.forEach((peer) => {
    const state = peer.pc.connectionState
    if (state === 'connected' || state === 'connecting') {
      count++
    }
  })
  return count
}

export function createManagedAnnounceLoop(options: CreateManagedAnnounceLoopOptions): NodeJS.Timeout {
  const {
    announceStartTime,
    announceIntervalMs,
    announceDurationMs,
    getHealthyPeerCount,
    onStop,
    onReannounce,
    now = () => Date.now()
  } = options

  return createAnnounceLoop({
    announceStartTime,
    announceIntervalMs,
    announceDurationMs,
    getHealthyPeerCount,
    onStop,
    onReannounce: (elapsed) => {
      SignalingLog.debug('Re-announcing', { elapsed: `${Math.round(elapsed / 1000)}s` })
      onReannounce()
    },
    now
  })
}

export function clearHeartbeatTimer(state: HeartbeatTimerState): HeartbeatTimerState {
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval)
  }

  return {
    heartbeatInterval: null
  }
}

export function clearManagedHeartbeatLoop(heartbeatInterval: NodeJS.Timeout | null): NodeJS.Timeout | null {
  const next = clearHeartbeatTimer({ heartbeatInterval })
  return next.heartbeatInterval
}

export function createHeartbeatLoop(options: CreateHeartbeatLoopOptions): NodeJS.Timeout {
  const {
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    hasSignalingChannel,
    getPeerIds,
    peerLastSeen,
    peerLastPing,
    onPeerTimeout,
    onPingPeer,
    now = () => Date.now()
  } = options

  return setInterval(() => {
    if (!hasSignalingChannel()) {
      return
    }

    const peerIds = getPeerIds()
    if (peerIds.length === 0) {
      return
    }

    const currentTime = now()
    peerIds.forEach((peerId) => {
      const lastSeen = peerLastSeen.get(peerId)
      if (!lastSeen) {
        peerLastSeen.set(peerId, currentTime)
      }

      const seenAt = peerLastSeen.get(peerId) ?? currentTime
      if (currentTime - seenAt > heartbeatTimeoutMs) {
        onPeerTimeout(peerId, seenAt)
        peerLastSeen.delete(peerId)
        peerLastPing.delete(peerId)
        return
      }

      const lastPing = peerLastPing.get(peerId) ?? 0
      if (currentTime - lastPing >= heartbeatIntervalMs) {
        peerLastPing.set(peerId, currentTime)
        onPingPeer(peerId, currentTime)
      }
    })
  }, heartbeatIntervalMs)
}

export function createManagedHeartbeatLoop(options: CreateManagedHeartbeatLoopOptions): NodeJS.Timeout {
  const {
    heartbeatInterval,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    hasSignalingChannel,
    getPeerIds,
    peerLastSeen,
    peerLastPing,
    onPeerTimeout,
    onPingPeer,
    now = () => Date.now()
  } = options

  clearManagedHeartbeatLoop(heartbeatInterval)

  return createHeartbeatLoop({
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    hasSignalingChannel,
    getPeerIds,
    peerLastSeen,
    peerLastPing,
    onPeerTimeout,
    onPingPeer: (peerId) => {
      onPingPeer(peerId)
    },
    now
  })
}

export function shutdownPeersForLeave(peers: Map<string, LeavePeerState>): void {
  peers.forEach((peer, peerId) => {
    if (peer.disconnectTimer) {
      clearTimeout(peer.disconnectTimer)
    }
    if (peer.reconnectTimer) {
      clearTimeout(peer.reconnectTimer)
    }

    try {
      peer.pc.close()
    } catch (err) {
      PeerLog.warn('Error closing peer connection', { peerId, error: String(err) })
    }
  })
}

export function closeBroadcastChannelSafe(channel: BroadcastChannel | null): BroadcastChannel | null {
  if (!channel) {
    return null
  }

  try {
    channel.close()
  } catch {
    // ignored
  }

  return null
}

export function scheduleBroadcastAnnounceWithAdapter<TMessage>(
  options: ScheduleBroadcastAnnounceWithAdapterOptions<TMessage>
): NodeJS.Timeout {
  const {
    announceDebounceTimer,
    announceDebounceMs,
    createAnnounceMessage,
    getPeerCount,
    broadcast,
    onTimerCleared,
    now = () => Date.now()
  } = options

  return scheduleBroadcastAnnounce({
    announceDebounceTimer,
    announceDebounceMs,
    createMessage: createAnnounceMessage,
    getPeerCount,
    broadcast,
    onComplete: () => {
      onTimerCleared?.()
    },
    now
  })
}

export function startManagedAnnounceLoopWithAdapter(
  options: StartManagedAnnounceLoopWithAdapterOptions
): AnnounceTimersState {
  const {
    announceStartTime,
    announceInterval,
    announceDebounceTimer,
    announceIntervalMs,
    announceDurationMs,
    getHealthyPeerCount,
    onStop,
    onReannounce,
    now = () => Date.now()
  } = options

  const cleared = clearAnnounceTimers({
    announceInterval,
    announceDebounceTimer
  })

  return {
    ...cleared,
    announceInterval: createManagedAnnounceLoop({
      announceStartTime,
      announceIntervalMs,
      announceDurationMs,
      getHealthyPeerCount,
      onStop,
      onReannounce,
      now
    })
  }
}

export function startManagedHeartbeatLoopWithAdapter(
  options: StartManagedHeartbeatLoopWithAdapterOptions
): NodeJS.Timeout {
  const {
    heartbeatInterval,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    hasSignalingChannel,
    getPeerIds,
    peerLastSeen,
    peerLastPing,
    onPeerTimeout,
    onPingPeer,
    now = () => Date.now()
  } = options

  return createManagedHeartbeatLoop({
    heartbeatInterval,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
    hasSignalingChannel,
    getPeerIds,
    peerLastSeen,
    peerLastPing,
    onPeerTimeout,
    onPingPeer,
    now
  })
}
