import { SignalingLog } from '../../utils/Logger'
import {
  cleanupPeerLifecycleResources,
  type PeerConnectionState
} from './peerLifecycle'

type PeerPlatform = 'win' | 'mac' | 'linux'

interface CleanedPeerSummary {
  userName: string
  platform: PeerPlatform
}

interface HandlePostPeerCleanupOptions {
  peerId: string
  peer: CleanedPeerSummary
  roomId: string | null
  onRemoteMicPeerDisconnect: (peerId: string) => void
  onModerationPeerDisconnect: (peerId: string) => void
  onPeerLeave: (peerId: string, userName: string, platform: PeerPlatform) => void
  getHealthyPeerCount: () => number
  onRestartPeerDiscovery: () => void
}

interface RunPeerCleanupFlowOptions<PrevStats> {
  peerId: string
  peers: Map<string, PeerConnectionState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
  previousStats: Map<string, PrevStats>
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  roomId: string | null
  onRemoteMicPeerDisconnect: (peerId: string) => void
  onModerationPeerDisconnect: (peerId: string) => void
  onPeerLeave: (peerId: string, userName: string, platform: PeerPlatform) => void
  getHealthyPeerCount: () => number
  onRestartPeerDiscovery: () => void
}

export interface PeerCleanupRuntimeAdapter<PrevStats> {
  peers: Map<string, PeerConnectionState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
  previousStats: Map<string, PrevStats>
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
  roomId: string | null
  onRemoteMicPeerDisconnect: (peerId: string) => void
  onModerationPeerDisconnect: (peerId: string) => void
  onPeerLeave: (peerId: string, userName: string, platform: PeerPlatform) => void
  getHealthyPeerCount: () => number
  onRestartPeerDiscovery: () => void
}

interface RunPeerCleanupFlowWithAdapterOptions<PrevStats> {
  peerId: string
  adapter: PeerCleanupRuntimeAdapter<PrevStats>
}

export function handlePostPeerCleanup(options: HandlePostPeerCleanupOptions): void {
  const {
    peerId,
    peer,
    roomId,
    onRemoteMicPeerDisconnect,
    onModerationPeerDisconnect,
    onPeerLeave,
    getHealthyPeerCount,
    onRestartPeerDiscovery
  } = options

  onRemoteMicPeerDisconnect(peerId)
  onModerationPeerDisconnect(peerId)
  onPeerLeave(peerId, peer.userName, peer.platform)

  if (getHealthyPeerCount() === 0 && roomId) {
    SignalingLog.info('No healthy peers, restarting peer discovery')
    onRestartPeerDiscovery()
  }
}

export function runPeerCleanupFlow<PrevStats>(options: RunPeerCleanupFlowOptions<PrevStats>): boolean {
  const {
    peerId,
    peers,
    pendingCandidates,
    previousStats,
    peerLastSeen,
    peerLastPing,
    roomId,
    onRemoteMicPeerDisconnect,
    onModerationPeerDisconnect,
    onPeerLeave,
    getHealthyPeerCount,
    onRestartPeerDiscovery
  } = options

  const peer = cleanupPeerLifecycleResources({
    peerId,
    peers,
    pendingCandidates,
    previousStats,
    peerLastSeen,
    peerLastPing
  })
  if (!peer) {
    return false
  }

  handlePostPeerCleanup({
    peerId,
    peer: {
      userName: peer.userName,
      platform: peer.platform
    },
    roomId,
    onRemoteMicPeerDisconnect,
    onModerationPeerDisconnect,
    onPeerLeave,
    getHealthyPeerCount,
    onRestartPeerDiscovery
  })
  return true
}

export function runPeerCleanupFlowWithAdapter<PrevStats>(
  options: RunPeerCleanupFlowWithAdapterOptions<PrevStats>
): boolean {
  const {
    peerId,
    adapter
  } = options

  return runPeerCleanupFlow({
    peerId,
    peers: adapter.peers,
    pendingCandidates: adapter.pendingCandidates,
    previousStats: adapter.previousStats,
    peerLastSeen: adapter.peerLastSeen,
    peerLastPing: adapter.peerLastPing,
    roomId: adapter.roomId,
    onRemoteMicPeerDisconnect: (id) => adapter.onRemoteMicPeerDisconnect(id),
    onModerationPeerDisconnect: (id) => adapter.onModerationPeerDisconnect(id),
    onPeerLeave: (id, userName, platform) => adapter.onPeerLeave(id, userName, platform),
    getHealthyPeerCount: () => adapter.getHealthyPeerCount(),
    onRestartPeerDiscovery: () => adapter.onRestartPeerDiscovery()
  })
}
