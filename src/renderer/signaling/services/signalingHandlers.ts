import { PeerLog, SignalingLog } from '../../utils/Logger'

export type PeerPlatform = 'win' | 'mac' | 'linux'

interface AnnouncePeerState {
  pc: {
    connectionState: RTCPeerConnectionState
    close: () => void
  }
  isConnected: boolean
  iceRestartInProgress: boolean
  connectionStartTime?: number
}

interface HandleAnnounceSignalOptions {
  peerId: string
  userName: string
  platform: PeerPlatform
  selfId: string
  roomLocked: boolean
  roomLockOwnerPeerId: string | null
  localUserName: string
  localPlatform: PeerPlatform
  now?: () => number
  getPeer: (peerId: string) => AnnouncePeerState | undefined
  removePeer: (peerId: string) => void
  createOffer: (peerId: string, userName: string, platform: PeerPlatform) => Promise<void>
  sendRoomLockedNotice: (peerId: string, lockedByPeerId: string, ts: number) => void
  sendAnnounceReply: (peerId: string, userName: string, platform: PeerPlatform, ts: number) => void
  newConnectionStaleMs?: number
}

const DEFAULT_NEW_CONNECTION_STALE_MS = 15000

interface CreateOfferSignalOptions {
  peerId: string
  userName: string
  platform: PeerPlatform
  selfId: string
  localUserName: string
  localPlatform: PeerPlatform
  createPeerConnection: (peerId: string, userName: string, platform: PeerPlatform, isInitiator?: boolean) => RTCPeerConnection
  configureOpusCodec: (sdp: string) => string
  sendOffer: (peerId: string, payload: RTCSessionDescriptionInit, userName: string, platform: PeerPlatform) => void
  onFailure: (peerId: string) => void
}

interface OfferPeerState {
  pc: {
    close: () => void
    setRemoteDescription: (description: RTCSessionDescription) => Promise<void>
    createAnswer: () => Promise<RTCSessionDescriptionInit>
    setLocalDescription: (description: RTCSessionDescriptionInit) => Promise<void>
    addIceCandidate: (candidate: RTCIceCandidate) => Promise<void>
    remoteDescription: RTCSessionDescription | null
  }
}

interface HandleOfferSignalOptions {
  peerId: string
  offer: RTCSessionDescriptionInit
  userName: string
  platform: PeerPlatform
  getPeer: (peerId: string) => OfferPeerState | undefined
  removePeer: (peerId: string) => void
  createPeerConnection: (peerId: string, userName: string, platform: PeerPlatform, isInitiator?: boolean) => RTCPeerConnection
  getPendingCandidates: (peerId: string) => RTCIceCandidateInit[]
  clearPendingCandidates: (peerId: string) => void
  sendAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => void
}

interface HandleAnswerSignalOptions {
  peerId: string
  answer: RTCSessionDescriptionInit
  getPeer: (peerId: string) => OfferPeerState | undefined
  getPendingCandidates: (peerId: string) => RTCIceCandidateInit[]
  clearPendingCandidates: (peerId: string) => void
}

interface HandleIceCandidateSignalOptions {
  peerId: string
  candidate: RTCIceCandidateInit
  getPeer: (peerId: string) => OfferPeerState | undefined
  getPendingCandidates: (peerId: string) => RTCIceCandidateInit[]
  setPendingCandidates: (peerId: string, candidates: RTCIceCandidateInit[]) => void
}

export async function handleAnnounceSignal(options: HandleAnnounceSignalOptions): Promise<void> {
  const {
    peerId,
    userName,
    platform,
    selfId,
    roomLocked,
    roomLockOwnerPeerId,
    localUserName,
    localPlatform,
    getPeer,
    removePeer,
    createOffer,
    sendRoomLockedNotice,
    sendAnnounceReply,
    now = () => Date.now(),
    newConnectionStaleMs = DEFAULT_NEW_CONNECTION_STALE_MS
  } = options

  PeerLog.info('Received announce', { peerId, userName, platform })

  if (roomLocked && !getPeer(peerId)) {
    SignalingLog.info('Rejecting announce while room is locked', {
      peerId,
      roomLockOwnerPeerId
    })
    sendRoomLockedNotice(peerId, roomLockOwnerPeerId || selfId, now())
    return
  }

  const existingPeer = getPeer(peerId)
  if (existingPeer) {
    const state = existingPeer.pc.connectionState
    const connectionAgeMs = typeof existingPeer.connectionStartTime === 'number'
      ? Math.max(0, now() - existingPeer.connectionStartTime)
      : 0
    const isStaleNewConnection = state === 'new' && connectionAgeMs >= newConnectionStaleMs

    PeerLog.info('Check existing peer', {
      peerId,
      state,
      isConnected: existingPeer.isConnected,
      connectionAgeMs,
      isStaleNewConnection
    })

    const keepExistingConnection =
      (state === 'connected' || state === 'connecting') ||
      (state === 'new' && !isStaleNewConnection) ||
      (state === 'disconnected' && existingPeer.iceRestartInProgress)

    if (keepExistingConnection) {
      PeerLog.info('Ignoring duplicate announce - connection is alive', { peerId, state })
      return
    }

    PeerLog.info('Cleaning up dead peer', { peerId, state })
    try {
      existingPeer.pc.close()
    } catch {
      // ignore close errors
    }
    removePeer(peerId)
  }

  if (selfId > peerId) {
    PeerLog.info('Initiating connection', { selfId, peerId })
    await createOffer(peerId, userName, platform)
    return
  }

  PeerLog.info('Waiting for peer to initiate', { selfId, peerId })
  sendAnnounceReply(peerId, localUserName, localPlatform, now())
}

export async function createOfferSignal(options: CreateOfferSignalOptions): Promise<void> {
  const {
    peerId,
    userName,
    platform,
    createPeerConnection,
    configureOpusCodec,
    sendOffer,
    localUserName,
    localPlatform,
    onFailure
  } = options

  PeerLog.info('Creating offer', { peerId })

  try {
    const pc = createPeerConnection(peerId, userName, platform, true)
    const offer = await pc.createOffer()

    const configuredSdp = configureOpusCodec(offer.sdp || '')
    const configuredOffer: RTCSessionDescriptionInit = {
      type: offer.type,
      sdp: configuredSdp
    }

    await pc.setLocalDescription(configuredOffer)
    sendOffer(peerId, configuredOffer, localUserName, localPlatform)

    PeerLog.info('Offer sent (trickle ICE, Opus configured)', { peerId })
  } catch (err) {
    PeerLog.error('Failed to create offer', { peerId, error: String(err) })
    onFailure(peerId)
  }
}

export async function handleOfferSignal(options: HandleOfferSignalOptions): Promise<void> {
  const {
    peerId,
    offer,
    userName,
    platform,
    getPeer,
    removePeer,
    createPeerConnection,
    getPendingCandidates,
    clearPendingCandidates,
    sendAnswer
  } = options

  PeerLog.info('Received offer', { peerId })

  const existing = getPeer(peerId)
  if (existing) {
    try {
      existing.pc.close()
    } catch {
      // ignore close errors
    }
    removePeer(peerId)
  }

  try {
    const pc = createPeerConnection(peerId, userName, platform, false)
    await pc.setRemoteDescription(new RTCSessionDescription(offer))

    const pending = getPendingCandidates(peerId)
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch {
        PeerLog.warn('Failed to add pending ICE candidate', { peerId })
      }
    }
    clearPendingCandidates(peerId)

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    sendAnswer(peerId, answer)
    PeerLog.info('Answer sent (trickle ICE)', { peerId })
  } catch (err) {
    PeerLog.error('Failed to handle offer', { peerId, error: String(err) })
    removePeer(peerId)
  }
}

export async function handleAnswerSignal(options: HandleAnswerSignalOptions): Promise<void> {
  const {
    peerId,
    answer,
    getPeer,
    getPendingCandidates,
    clearPendingCandidates
  } = options

  PeerLog.info('Received answer', { peerId })

  const peer = getPeer(peerId)
  if (!peer) {
    return
  }

  try {
    await peer.pc.setRemoteDescription(new RTCSessionDescription(answer))

    const pending = getPendingCandidates(peerId)
    for (const candidate of pending) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch {
        PeerLog.warn('Failed to add pending ICE candidate', { peerId })
      }
    }
    clearPendingCandidates(peerId)
  } catch (err) {
    PeerLog.error('Failed to handle answer', { peerId, error: String(err) })
  }
}

export async function handleIceCandidateSignal(options: HandleIceCandidateSignalOptions): Promise<void> {
  const {
    peerId,
    candidate,
    getPeer,
    getPendingCandidates,
    setPendingCandidates
  } = options

  const peer = getPeer(peerId)
  if (!peer || !peer.pc.remoteDescription) {
    const pending = getPendingCandidates(peerId)
    pending.push(candidate)
    setPendingCandidates(peerId, pending)
    PeerLog.debug('Queued ICE candidate', { peerId, queueSize: pending.length })
    return
  }

  try {
    await peer.pc.addIceCandidate(new RTCIceCandidate(candidate))
    PeerLog.debug('Added ICE candidate', { peerId })
  } catch (err) {
    PeerLog.error('Failed to add ICE candidate', { peerId, error: String(err) })
  }
}
