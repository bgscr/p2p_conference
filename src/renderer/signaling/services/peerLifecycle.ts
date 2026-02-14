import { PeerLog } from '../../utils/Logger'

type PeerPlatform = 'win' | 'mac' | 'linux'
type ChannelType = 'chat' | 'control'

export interface PeerMuteStatus {
  micMuted: boolean
  speakerMuted: boolean
  videoMuted?: boolean
  videoEnabled?: boolean
  isScreenSharing?: boolean
}

export interface PeerConnectionState {
  pc: RTCPeerConnection
  stream: MediaStream | null
  userName: string
  platform: PeerPlatform
  connectionStartTime: number
  isConnected: boolean
  muteStatus: PeerMuteStatus
  iceRestartAttempts: number
  iceRestartInProgress: boolean
  disconnectTimer: NodeJS.Timeout | null
  reconnectTimer: NodeJS.Timeout | null
  chatDataChannel: RTCDataChannel | null
  controlDataChannel: RTCDataChannel | null
}

export interface CreatePeerConnectionLifecycleOptions {
  peerId: string
  userName: string
  platform: PeerPlatform
  isInitiator: boolean
  localStream: MediaStream | null
  iceServers: RTCIceServer[]
  disconnectGracePeriodMs: number
  getPeer: (peerId: string) => PeerConnectionState | undefined
  removePeer: (peerId: string) => void
  applyAudioRoutingToPeer: (peerId: string) => void
  setupDataChannel: (
    dc: RTCDataChannel,
    peerId: string,
    peerConn: PeerConnectionState,
    channelType: ChannelType
  ) => void
  onSendIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => void
  onAttemptIceRestart: (peerId: string) => void
  onCleanupPeer: (peerId: string) => void
  onStopAnnounceInterval: () => void
  onPeerJoin: (peerId: string, userName: string, platform: PeerPlatform) => void
  onSendLocalMuteStatus: (peerId: string) => void
  onSendRoomLockState: (peerId: string) => void
  onSendLocalHandRaised: (peerId: string) => void
  shouldSendRoomLockState?: () => boolean
  shouldSendLocalHandRaised?: () => boolean
  onRemoteStream: (peerId: string, stream: MediaStream) => void
  now?: () => number
}

export interface CreatePeerConnectionLifecycleResult {
  pc: RTCPeerConnection
  peerConn: PeerConnectionState
}

export interface CleanupPeerLifecycleResourcesOptions<PrevStats> {
  peerId: string
  peers: Map<string, PeerConnectionState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
  previousStats: Map<string, PrevStats>
  peerLastSeen: Map<string, number>
  peerLastPing: Map<string, number>
}

export function createPeerConnectionLifecycle(options: CreatePeerConnectionLifecycleOptions): CreatePeerConnectionLifecycleResult {
  const {
    peerId,
    userName,
    platform,
    isInitiator,
    localStream,
    iceServers,
    disconnectGracePeriodMs,
    getPeer,
    removePeer,
    applyAudioRoutingToPeer,
    setupDataChannel,
    onSendIceCandidate,
    onAttemptIceRestart,
    onCleanupPeer,
    onStopAnnounceInterval,
    onPeerJoin,
    onSendLocalMuteStatus,
    onSendRoomLockState,
    onSendLocalHandRaised,
    shouldSendRoomLockState,
    shouldSendLocalHandRaised,
    onRemoteStream,
    now = () => Date.now()
  } = options

  PeerLog.info('Creating RTCPeerConnection', { peerId, userName, platform })

  const pc = new RTCPeerConnection({ iceServers })
  const peerConn: PeerConnectionState = {
    pc,
    stream: null,
    userName,
    platform,
    connectionStartTime: now(),
    isConnected: false,
    muteStatus: { micMuted: false, speakerMuted: false },
    iceRestartAttempts: 0,
    iceRestartInProgress: false,
    disconnectTimer: null,
    reconnectTimer: null,
    chatDataChannel: null,
    controlDataChannel: null
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream)
    })
    applyAudioRoutingToPeer(peerId)
  }

  if (isInitiator) {
    const chatDc = pc.createDataChannel('chat', { ordered: true })
    setupDataChannel(chatDc, peerId, peerConn, 'chat')
    peerConn.chatDataChannel = chatDc

    const controlDc = pc.createDataChannel('control', { ordered: true })
    setupDataChannel(controlDc, peerId, peerConn, 'control')
    peerConn.controlDataChannel = controlDc
  }

  pc.ondatachannel = (event) => {
    PeerLog.info('Received data channel from peer', { peerId, label: event.channel.label })
    if (event.channel.label === 'chat') {
      peerConn.chatDataChannel = event.channel
      setupDataChannel(event.channel, peerId, peerConn, 'chat')
    } else if (event.channel.label === 'control') {
      peerConn.controlDataChannel = event.channel
      setupDataChannel(event.channel, peerId, peerConn, 'control')
    }
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      PeerLog.debug('Sending ICE candidate', { peerId, type: event.candidate.type })
      onSendIceCandidate(peerId, event.candidate.toJSON())
    }
  }

  pc.oniceconnectionstatechange = () => {
    const iceState = pc.iceConnectionState
    const currentPeer = getPeer(peerId)

    PeerLog.info('ICE state', { peerId, state: iceState })

    if (iceState === 'connected' || iceState === 'completed') {
      if (currentPeer) {
        if (currentPeer.disconnectTimer) {
          clearTimeout(currentPeer.disconnectTimer)
          currentPeer.disconnectTimer = null
        }
        if (currentPeer.reconnectTimer) {
          clearTimeout(currentPeer.reconnectTimer)
          currentPeer.reconnectTimer = null
        }
        currentPeer.iceRestartInProgress = false
        currentPeer.iceRestartAttempts = 0
      }
    } else if (iceState === 'failed') {
      PeerLog.warn('ICE connection failed, attempting restart', { peerId })
      onAttemptIceRestart(peerId)
    } else if (iceState === 'disconnected') {
      PeerLog.warn('ICE connection disconnected, scheduling reconnect attempt', { peerId })

      if (currentPeer?.disconnectTimer) {
        clearTimeout(currentPeer.disconnectTimer)
      }

      if (currentPeer) {
        currentPeer.disconnectTimer = setTimeout(() => {
          const peer = getPeer(peerId)
          if (peer && peer.pc.iceConnectionState === 'disconnected') {
            PeerLog.info('ICE still disconnected after grace period, attempting restart', { peerId })
            onAttemptIceRestart(peerId)
          }
        }, disconnectGracePeriodMs)
      }
    }
  }

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState
    const currentPeer = getPeer(peerId)

    PeerLog.info('Connection state', { peerId, state })

    if (state === 'connected') {
      if (currentPeer) {
        currentPeer.isConnected = true
        currentPeer.iceRestartInProgress = false

        if (currentPeer.disconnectTimer) {
          clearTimeout(currentPeer.disconnectTimer)
          currentPeer.disconnectTimer = null
        }
        if (currentPeer.reconnectTimer) {
          clearTimeout(currentPeer.reconnectTimer)
          currentPeer.reconnectTimer = null
        }
      }

      onStopAnnounceInterval()
      onPeerJoin(peerId, userName, platform)

      setTimeout(() => {
        onSendLocalMuteStatus(peerId)
      }, 500)

      if (shouldSendRoomLockState?.() ?? true) {
        setTimeout(() => {
          onSendRoomLockState(peerId)
        }, 600)
      }

      if (shouldSendLocalHandRaised?.() ?? true) {
        setTimeout(() => {
          onSendLocalHandRaised(peerId)
        }, 800)
      }
    } else if (state === 'disconnected') {
      PeerLog.warn('Connection disconnected, ICE restart may recover', { peerId })
    } else if (state === 'failed') {
      if (currentPeer && !currentPeer.iceRestartInProgress) {
        PeerLog.warn('Connection failed and no restart in progress, removing peer', { peerId })
        onCleanupPeer(peerId)
      }
    } else if (state === 'closed') {
      if (currentPeer?.isConnected) {
        currentPeer.isConnected = false
        onCleanupPeer(peerId)
      } else {
        removePeer(peerId)
      }
    }
  }

  pc.ontrack = (event) => {
    PeerLog.info('Received remote track', {
      peerId,
      kind: event.track.kind,
      trackId: event.track.id,
      streamCount: event.streams?.length || 0
    })

    let remoteStream: MediaStream
    if (event.streams && event.streams[0]) {
      remoteStream = event.streams[0]
    } else {
      PeerLog.info('Creating MediaStream from track (no stream in event)', { peerId })
      remoteStream = new MediaStream([event.track])
    }

    peerConn.stream = remoteStream

    PeerLog.info('Calling onRemoteStream callback', {
      peerId,
      streamId: remoteStream.id,
      trackCount: remoteStream.getTracks().length,
      audioTracks: remoteStream.getAudioTracks().length
    })
    onRemoteStream(peerId, remoteStream)
  }

  return { pc, peerConn }
}

export function cleanupPeerLifecycleResources<PrevStats>(
  options: CleanupPeerLifecycleResourcesOptions<PrevStats>
): PeerConnectionState | null {
  const {
    peerId,
    peers,
    pendingCandidates,
    previousStats,
    peerLastSeen,
    peerLastPing
  } = options

  const peer = peers.get(peerId)
  if (!peer) {
    return null
  }

  PeerLog.info('Cleaning up peer', { peerId, userName: peer.userName })

  if (peer.disconnectTimer) {
    clearTimeout(peer.disconnectTimer)
    peer.disconnectTimer = null
  }
  if (peer.reconnectTimer) {
    clearTimeout(peer.reconnectTimer)
    peer.reconnectTimer = null
  }

  if (peer.chatDataChannel) {
    try {
      peer.chatDataChannel.close()
    } catch {
      // DataChannel may already be closed.
    }
    peer.chatDataChannel = null
  }

  if (peer.controlDataChannel) {
    try {
      peer.controlDataChannel.close()
    } catch {
      // DataChannel may already be closed.
    }
    peer.controlDataChannel = null
  }

  try {
    peer.pc.close()
  } catch (err) {
    PeerLog.warn('Error closing peer connection during cleanup', { peerId, error: String(err) })
  }

  peers.delete(peerId)
  pendingCandidates.delete(peerId)
  previousStats.delete(peerId)
  peerLastSeen.delete(peerId)
  peerLastPing.delete(peerId)

  return peer
}
