import { PeerLog } from '../../utils/Logger'

export interface RestartPeerState {
  pc: {
    iceConnectionState: RTCIceConnectionState
    connectionState: RTCPeerConnectionState
    signalingState: RTCSignalingState
    createOffer: (options?: RTCOfferOptions) => Promise<RTCSessionDescriptionInit>
    setLocalDescription: (description: RTCSessionDescriptionInit) => Promise<void>
  }
  iceRestartAttempts: number
  iceRestartInProgress: boolean
  reconnectTimer: NodeJS.Timeout | null
}

interface AttemptIceRestartOptions {
  peerId: string
  getPeer: (peerId: string) => RestartPeerState | undefined
  cleanupPeer: (peerId: string) => void
  configureOpusCodec: (sdp: string) => string
  sendOffer: (peerId: string, offer: RTCSessionDescriptionInit) => void
  retryRestart: (peerId: string) => void
  maxAttempts: number
  restartDelay: number
  failedTimeout: number
}

interface OfferSignalMessage {
  v: 1
  type: 'offer'
  from: string
  data: {
    type: RTCSessionDescriptionInit['type']
    sdp: RTCSessionDescriptionInit['sdp']
  }
  userName: string
}

export interface IceRestartAdapter {
  peers: Map<string, RestartPeerState>
  userName: string
  cleanupPeer: (peerId: string) => void
  configureOpusCodec: (sdp: string) => string
  sendToPeer: (peerId: string, message: OfferSignalMessage) => void
  attemptIceRestart: (peerId: string) => void | Promise<void>
}

interface AttemptIceRestartWithAdapterOptions {
  peerId: string
  selfId: string
  adapter: IceRestartAdapter
  maxAttempts: number
  restartDelay: number
  failedTimeout: number
}

export async function attemptIceRestartForPeer(options: AttemptIceRestartOptions): Promise<void> {
  const {
    peerId,
    getPeer,
    cleanupPeer,
    configureOpusCodec,
    sendOffer,
    retryRestart,
    maxAttempts,
    restartDelay,
    failedTimeout
  } = options

  const peer = getPeer(peerId)
  if (!peer) {
    PeerLog.warn('Cannot restart ICE - peer not found', { peerId })
    return
  }

  if (peer.iceRestartInProgress) {
    PeerLog.debug('ICE restart already in progress', { peerId })
    return
  }

  if (peer.iceRestartAttempts >= maxAttempts) {
    PeerLog.warn('Max ICE restart attempts reached, giving up', { peerId, attempts: peer.iceRestartAttempts })
    cleanupPeer(peerId)
    return
  }

  peer.iceRestartAttempts++
  peer.iceRestartInProgress = true

  PeerLog.info('Attempting ICE restart', {
    peerId,
    attempt: peer.iceRestartAttempts,
    maxAttempts,
    currentIceState: peer.pc.iceConnectionState,
    currentConnState: peer.pc.connectionState
  })

  if (peer.reconnectTimer) {
    clearTimeout(peer.reconnectTimer)
  }

  peer.reconnectTimer = setTimeout(() => {
    const currentPeer = getPeer(peerId)
    if (currentPeer && currentPeer.iceRestartInProgress) {
      PeerLog.warn('ICE restart timed out', { peerId, attempt: currentPeer.iceRestartAttempts })
      currentPeer.iceRestartInProgress = false

      if (currentPeer.iceRestartAttempts < maxAttempts) {
        retryRestart(peerId)
      } else {
        cleanupPeer(peerId)
      }
    }
  }, failedTimeout)

  try {
    if (peer.pc.signalingState === 'closed') {
      PeerLog.warn('Cannot restart ICE - peer connection is closed', { peerId })
      peer.iceRestartInProgress = false
      cleanupPeer(peerId)
      return
    }

    const offer = await peer.pc.createOffer({ iceRestart: true })
    const configuredSdp = configureOpusCodec(offer.sdp || '')
    const configuredOffer: RTCSessionDescriptionInit = {
      type: offer.type,
      sdp: configuredSdp
    }

    await peer.pc.setLocalDescription(configuredOffer)
    sendOffer(peerId, configuredOffer)

    PeerLog.info('ICE restart offer sent', { peerId, attempt: peer.iceRestartAttempts })
  } catch (err) {
    PeerLog.error('ICE restart failed to create offer', { peerId, error: String(err) })
    peer.iceRestartInProgress = false

    if (peer.iceRestartAttempts >= maxAttempts) {
      cleanupPeer(peerId)
    } else {
      const delay = restartDelay * Math.pow(2, peer.iceRestartAttempts - 1)
      PeerLog.info('Scheduling next ICE restart attempt', { peerId, delayMs: delay })
      setTimeout(() => retryRestart(peerId), delay)
    }
  }
}

export async function attemptIceRestartWithAdapter(
  options: AttemptIceRestartWithAdapterOptions
): Promise<void> {
  const {
    peerId,
    selfId,
    adapter,
    maxAttempts,
    restartDelay,
    failedTimeout
  } = options

  await attemptIceRestartForPeer({
    peerId,
    getPeer: (id) => adapter.peers.get(id),
    cleanupPeer: (id) => adapter.cleanupPeer(id),
    configureOpusCodec: (sdp) => adapter.configureOpusCodec(sdp),
    sendOffer: (targetPeerId, offer) => {
      adapter.sendToPeer(targetPeerId, {
        v: 1,
        type: 'offer',
        from: selfId,
        data: {
          type: offer.type,
          sdp: offer.sdp
        },
        userName: adapter.userName
      })
    },
    retryRestart: (id) => {
      void adapter.attemptIceRestart(id)
    },
    maxAttempts,
    restartDelay,
    failedTimeout
  })
}
