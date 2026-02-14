import type {
  AudioRoutingMode,
  ConnectionQuality
} from '@/types'
import {
  calculateConnectionStats,
  type PreviousStats
} from '../connectionStats'

interface MuteStatusLike {
  micMuted: boolean
  speakerMuted: boolean
  videoMuted?: boolean
  videoEnabled?: boolean
  isScreenSharing?: boolean
}

interface PeerConnectionForStats {
  connectionState: RTCPeerConnectionState
  getStats: () => Promise<{ forEach: (cb: (stat: any) => void) => void }>
}

interface PeerStateForStats {
  pc: PeerConnectionForStats
}

interface CollectConnectionStatsOptions {
  peers: Map<string, PeerStateForStats>
  previousStats: Map<string, PreviousStats>
  onStatsError?: (peerId: string, error: unknown) => void
  now?: () => number
}

interface PeerStateForSnapshot {
  userName: string
  stream: MediaStream | null
  muteStatus: MuteStatusLike
}

interface MqttDebugSnapshot {
  isConnected: () => boolean
  isSubscribed: () => boolean
  getConnectedCount: () => number
  getConnectionStatus: () => unknown[]
  getTotalMessageCount: () => number
  getDeduplicatorSize: () => number
}

interface BuildDebugInfoOptions {
  selfId: string
  roomId: string | null
  userName: string
  topic: string
  sessionId: number
  signalingState: string
  mqtt: MqttDebugSnapshot | null
  peers: Map<string, unknown>
  localMuteStatus: MuteStatusLike
  audioRoutingMode: AudioRoutingMode
  audioRoutingTargetPeerId: string | null
  controlDebugInfo: Record<string, unknown>
  isJoining: boolean
  isLeaving: boolean
  networkOnline: boolean
  networkWasInRoomWhenOffline: boolean
  networkReconnectAttempts: number
}

export async function collectConnectionStatsForPeers(
  options: CollectConnectionStatsOptions
): Promise<Map<string, ConnectionQuality>> {
  const {
    peers,
    previousStats,
    onStatsError,
    now = () => Date.now()
  } = options

  const stats = new Map<string, ConnectionQuality>()

  for (const [peerId, peer] of peers) {
    try {
      const currentTimestamp = now()

      if (peer.pc.connectionState !== 'connected') {
        const result = calculateConnectionStats(
          peerId,
          peer.pc.connectionState,
          { forEach: () => {} },
          previousStats.get(peerId) || null,
          currentTimestamp
        )
        stats.set(peerId, result.quality)
        continue
      }

      const rtcStats = await peer.pc.getStats()
      const prevStats = previousStats.get(peerId) || null
      const result = calculateConnectionStats(
        peerId,
        peer.pc.connectionState,
        rtcStats,
        prevStats,
        currentTimestamp
      )
      stats.set(peerId, result.quality)
      previousStats.set(peerId, result.newPreviousStats)
    } catch (error) {
      onStatsError?.(peerId, error)
    }
  }

  return stats
}

export function buildPeerSnapshot(
  peers: Map<string, PeerStateForSnapshot>
): Map<string, { userName: string; stream: MediaStream | null; muteStatus: MuteStatusLike }> {
  const result = new Map<string, { userName: string; stream: MediaStream | null; muteStatus: MuteStatusLike }>()
  peers.forEach((peer, id) => {
    result.set(id, {
      userName: peer.userName,
      stream: peer.stream,
      muteStatus: peer.muteStatus
    })
  })
  return result
}

export function buildPeerManagerDebugInfo(options: BuildDebugInfoOptions): Record<string, unknown> {
  const {
    selfId,
    roomId,
    userName,
    topic,
    sessionId,
    signalingState,
    mqtt,
    peers,
    localMuteStatus,
    audioRoutingMode,
    audioRoutingTargetPeerId,
    controlDebugInfo,
    isJoining,
    isLeaving,
    networkOnline,
    networkWasInRoomWhenOffline,
    networkReconnectAttempts
  } = options

  return {
    selfId,
    roomId,
    userName,
    topic,
    sessionId,
    signalingState,
    mqttConnected: mqtt?.isConnected() || false,
    mqttSubscribed: mqtt?.isSubscribed() || false,
    mqttBrokerCount: mqtt?.getConnectedCount() || 0,
    mqttBrokerStatus: mqtt?.getConnectionStatus() || [],
    mqttMessagesReceived: mqtt?.getTotalMessageCount() || 0,
    mqttDedupCacheSize: mqtt?.getDeduplicatorSize() || 0,
    peerCount: peers.size,
    peers: Array.from(peers.keys()),
    localMuteStatus,
    audioRoutingMode,
    audioRoutingTargetPeerId,
    ...controlDebugInfo,
    isJoining,
    isLeaving,
    networkOnline,
    networkWasInRoomWhenOffline,
    networkReconnectAttempts
  }
}
