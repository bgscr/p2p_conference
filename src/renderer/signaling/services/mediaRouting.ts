import { PeerLog, SignalingLog } from '../../utils/Logger'
import type { AudioRoutingMode } from '@/types'

interface PeerWithConnection {
  pc: RTCPeerConnection
}

interface ResolveRoutedAudioTrackOptions {
  peerId: string
  fallbackTrack?: MediaStreamTrack
  localStream: MediaStream | null
  audioRoutingMode: AudioRoutingMode
  audioRoutingTargetPeerId: string | null
}

interface ApplyAudioRoutingToPeerOptions {
  peerId: string
  peers: Map<string, PeerWithConnection>
  localStream: MediaStream | null
  getRoutedAudioTrackForPeer: (peerId: string, fallbackTrack?: MediaStreamTrack) => MediaStreamTrack | null
  audioRoutingMode: AudioRoutingMode
}

interface SyncLocalStreamToPeersOptions {
  stream: MediaStream
  peers: Map<string, PeerWithConnection>
  getRoutedAudioTrackForPeer: (peerId: string, fallbackTrack?: MediaStreamTrack) => MediaStreamTrack | null
  audioRoutingMode: AudioRoutingMode
}

interface ReplaceTrackAcrossPeersOptions {
  newTrack: MediaStreamTrack
  peers: Map<string, PeerWithConnection>
  getRoutedAudioTrackForPeer: (peerId: string, fallbackTrack?: MediaStreamTrack) => MediaStreamTrack | null
  localStream: MediaStream | null
  audioRoutingMode: AudioRoutingMode
}

interface UpdateAudioRoutingModeOptions {
  mode: AudioRoutingMode
  targetPeerId?: string
  peers: Map<string, unknown>
  setAudioRoutingState: (mode: AudioRoutingMode, targetPeerId: string | null) => void
  applyAudioRouting: () => void
}

function findSenderByKindOrCodec(
  senders: RTCRtpSender[],
  kind: string
): RTCRtpSender | undefined {
  return senders.find((sender) => sender.track?.kind === kind) ||
    senders.find((sender) => {
      const params = sender.getParameters()
      return params.codecs?.some((codec) => codec.mimeType.toLowerCase().includes(kind))
    })
}

export function shouldSendAudioToPeer(
  audioRoutingMode: AudioRoutingMode,
  audioRoutingTargetPeerId: string | null,
  peerId: string
): boolean {
  if (audioRoutingMode === 'broadcast') {
    return true
  }
  return audioRoutingTargetPeerId === peerId
}

export function updateAudioRoutingMode(options: UpdateAudioRoutingModeOptions): boolean {
  const {
    mode,
    targetPeerId,
    peers,
    setAudioRoutingState,
    applyAudioRouting
  } = options

  if (mode === 'exclusive') {
    if (!targetPeerId) {
      PeerLog.warn('Exclusive audio routing requires a target peer')
      return false
    }

    if (!peers.has(targetPeerId)) {
      PeerLog.warn('Exclusive audio routing target not found', { targetPeerId })
      return false
    }

    setAudioRoutingState('exclusive', targetPeerId)
  } else {
    setAudioRoutingState('broadcast', null)
  }

  PeerLog.info('Audio routing mode updated', {
    mode,
    targetPeerId: mode === 'exclusive' ? targetPeerId : null
  })

  applyAudioRouting()
  return true
}

export function resolveRoutedAudioTrackForPeer(options: ResolveRoutedAudioTrackOptions): MediaStreamTrack | null {
  const {
    peerId,
    fallbackTrack,
    localStream,
    audioRoutingMode,
    audioRoutingTargetPeerId
  } = options

  const localAudioTrack = fallbackTrack && fallbackTrack.kind === 'audio'
    ? fallbackTrack
    : localStream?.getAudioTracks()[0] ?? null

  if (!localAudioTrack) {
    return null
  }

  if (!shouldSendAudioToPeer(audioRoutingMode, audioRoutingTargetPeerId, peerId)) {
    return null
  }

  return localAudioTrack
}

export function applyAudioRoutingToPeer(options: ApplyAudioRoutingToPeerOptions): void {
  const {
    peerId,
    peers,
    localStream,
    getRoutedAudioTrackForPeer,
    audioRoutingMode
  } = options

  const peer = peers.get(peerId)
  if (!peer) {
    return
  }

  const routedTrack = getRoutedAudioTrackForPeer(peerId)
  const senders = peer.pc.getSenders()
  const audioSender = findSenderByKindOrCodec(senders, 'audio')

  if (audioSender) {
    audioSender.replaceTrack(routedTrack ?? null)
      .then(() => {
        PeerLog.debug('Applied audio routing to sender', {
          peerId,
          mode: audioRoutingMode,
          routed: Boolean(routedTrack)
        })
      })
      .catch((err) => {
        PeerLog.error('Failed to apply audio routing to sender', { peerId, error: String(err) })
      })
    return
  }

  if (routedTrack && localStream) {
    try {
      peer.pc.addTrack(routedTrack, localStream)
      PeerLog.debug('Added routed audio track for peer', { peerId })
    } catch (err) {
      PeerLog.error('Failed to add routed audio track', { peerId, error: String(err) })
    }
  }
}

export function syncLocalStreamToPeers(options: SyncLocalStreamToPeersOptions): void {
  const {
    stream,
    peers,
    getRoutedAudioTrackForPeer,
    audioRoutingMode
  } = options

  peers.forEach((peer, peerId) => {
    const senders = peer.pc.getSenders()
    const tracks = stream.getTracks()

    tracks.forEach((track) => {
      const shouldRouteAudio = track.kind === 'audio'
      const trackToSend = shouldRouteAudio ? getRoutedAudioTrackForPeer(peerId, track) : track

      const existingSenderExact = trackToSend
        ? senders.find((sender) => sender.track?.id === trackToSend.id)
        : undefined
      if (existingSenderExact) {
        SignalingLog.debug('Track already being sent', { peerId, trackKind: track.kind, trackId: track.id })
        return
      }

      const existingSenderKind = findSenderByKindOrCodec(senders, track.kind)
      if (existingSenderKind) {
        SignalingLog.info('Replacing existing track of same kind', {
          peerId,
          kind: track.kind,
          routeMode: shouldRouteAudio ? audioRoutingMode : 'n/a',
          routed: Boolean(trackToSend)
        })
        existingSenderKind.replaceTrack(trackToSend ?? null)
          .catch((err) => SignalingLog.error('Failed to replace track', { peerId, error: String(err) }))
        return
      }

      if (!trackToSend) {
        SignalingLog.debug('Skipping addTrack due to routing policy', { peerId, trackKind: track.kind })
        return
      }

      SignalingLog.info('Adding new track to peer', { peerId, trackKind: track.kind })
      try {
        peer.pc.addTrack(trackToSend, stream)
      } catch (err) {
        SignalingLog.error('Failed to add track', { peerId, error: String(err) })
      }
    })
  })
}

export function replaceTrackAcrossPeers(options: ReplaceTrackAcrossPeersOptions): void {
  const {
    newTrack,
    peers,
    getRoutedAudioTrackForPeer,
    localStream,
    audioRoutingMode
  } = options

  if (!newTrack) {
    PeerLog.error('replaceTrack called with null/undefined track')
    return
  }

  const trackKind = newTrack.kind
  PeerLog.info('Replacing track in all peers', {
    trackKind,
    trackId: newTrack.id,
    label: newTrack.label,
    peerCount: peers.size,
    trackEnabled: newTrack.enabled,
    trackReadyState: newTrack.readyState
  })

  if (peers.size === 0) {
    PeerLog.warn('No peers to replace track for')
    return
  }

  peers.forEach((peer, peerId) => {
    const senders = peer.pc.getSenders()
    const routedTrack = trackKind === 'audio'
      ? getRoutedAudioTrackForPeer(peerId, newTrack)
      : newTrack

    PeerLog.debug('Peer senders', {
      peerId,
      senderCount: senders.length,
      routeMode: trackKind === 'audio' ? audioRoutingMode : undefined,
      routed: Boolean(routedTrack),
      senderTracks: senders.map((sender) => ({
        kind: sender.track?.kind,
        id: sender.track?.id,
        readyState: sender.track?.readyState
      }))
    })

    const matchingSender = findSenderByKindOrCodec(senders, trackKind)
    if (matchingSender) {
      PeerLog.info('Replacing track for peer', {
        peerId,
        kind: trackKind,
        oldTrackId: matchingSender.track?.id,
        newTrackId: routedTrack?.id
      })

      matchingSender.replaceTrack(routedTrack ?? null)
        .then(() => {
          PeerLog.info('Track replaced successfully', {
            peerId,
            kind: trackKind,
            trackId: routedTrack?.id,
            routed: Boolean(routedTrack)
          })
        })
        .catch((err) => {
          PeerLog.error('Replace track failed', { peerId, kind: trackKind, error: String(err) })
        })
      return
    }

    if (!routedTrack) {
      PeerLog.debug('Skipping addTrack due to routing policy', { peerId, kind: trackKind })
      return
    }

    PeerLog.warn('No matching sender found for peer, attempting to add track', { peerId, kind: trackKind })
    try {
      if (localStream) {
        peer.pc.addTrack(routedTrack, localStream)
        PeerLog.info('Track added to peer (no existing sender)', { peerId, kind: trackKind })
      }
    } catch (err) {
      PeerLog.error('Failed to add track to peer', { peerId, kind: trackKind, error: String(err) })
    }
  })
}
