import type { PeerPlatform } from './signalingHandlers'
import {
  createOfferSignal,
  handleAnnounceSignal,
  handleAnswerSignal,
  handleIceCandidateSignal,
  handleOfferSignal
} from './signalingHandlers'

interface AnnouncePeerState {
  pc: {
    connectionState: RTCPeerConnectionState
    close: () => void
  }
  isConnected: boolean
  iceRestartInProgress: boolean
  connectionStartTime?: number
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

interface AnnounceSignalMessage {
  v: 1
  type: 'announce' | 'room-locked'
  from: string
  data?: {
    lockedByPeerId: string
    ts: number
  }
  userName?: string
  platform?: PeerPlatform
  ts?: number
}

interface OfferSignalMessage {
  v: 1
  type: 'offer'
  from: string
  data: {
    type: RTCSdpType
    sdp: string | undefined
  }
  userName: string
  platform: PeerPlatform
}

interface AnswerSignalMessage {
  v: 1
  type: 'answer'
  from: string
  data: {
    type: RTCSdpType
    sdp: string | undefined
  }
}

interface HandleAnnounceOperationOptions {
  peerId: string
  userName: string
  platform: PeerPlatform
  selfId: string
  roomLocked: boolean
  roomLockOwnerPeerId: string | null
  localUserName: string
  localPlatform: PeerPlatform
  peers: Map<string, AnnouncePeerState>
  createOffer: (peerId: string, userName: string, platform: PeerPlatform) => Promise<void>
  sendToPeer: (peerId: string, message: AnnounceSignalMessage) => void
  now?: () => number
}

interface CreateOfferOperationOptions {
  peerId: string
  userName: string
  platform: PeerPlatform
  selfId: string
  localUserName: string
  localPlatform: PeerPlatform
  peers: Map<string, unknown>
  createPeerConnection: (peerId: string, userName: string, platform: PeerPlatform, isInitiator?: boolean) => RTCPeerConnection
  configureOpusCodec: (sdp: string) => string
  sendToPeer: (peerId: string, message: OfferSignalMessage) => void
}

interface HandleOfferOperationOptions {
  peerId: string
  offer: RTCSessionDescriptionInit
  userName: string
  platform: PeerPlatform
  selfId: string
  peers: Map<string, OfferPeerState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
  createPeerConnection: (peerId: string, userName: string, platform: PeerPlatform, isInitiator?: boolean) => RTCPeerConnection
  sendToPeer: (peerId: string, message: AnswerSignalMessage) => void
}

interface HandleAnswerOperationOptions {
  peerId: string
  answer: RTCSessionDescriptionInit
  peers: Map<string, OfferPeerState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
}

interface HandleIceCandidateOperationOptions {
  peerId: string
  candidate: RTCIceCandidateInit
  peers: Map<string, OfferPeerState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
}

export interface SignalingOperationsAdapter {
  roomLocked: boolean
  roomLockOwnerPeerId: string | null
  userName: string
  localPlatform: PeerPlatform
  peers: Map<string, AnnouncePeerState & OfferPeerState>
  pendingCandidates: Map<string, RTCIceCandidateInit[]>
  createOffer: (peerId: string, userName: string, platform: PeerPlatform) => Promise<void>
  createPeerConnection: (peerId: string, userName: string, platform: PeerPlatform, isInitiator?: boolean) => RTCPeerConnection
  configureOpusCodec: (sdp: string) => string
  sendToPeer: (peerId: string, message: AnnounceSignalMessage | OfferSignalMessage | AnswerSignalMessage) => void
}

interface HandleAnnounceOperationWithAdapterOptions {
  adapter: SignalingOperationsAdapter
  peerId: string
  userName: string
  platform: PeerPlatform
  selfId: string
  now?: () => number
}

interface CreateOfferOperationWithAdapterOptions {
  adapter: SignalingOperationsAdapter
  peerId: string
  userName: string
  platform: PeerPlatform
  selfId: string
}

interface HandleOfferOperationWithAdapterOptions {
  adapter: SignalingOperationsAdapter
  peerId: string
  offer: RTCSessionDescriptionInit
  userName: string
  platform: PeerPlatform
  selfId: string
}

interface HandleAnswerOperationWithAdapterOptions {
  adapter: SignalingOperationsAdapter
  peerId: string
  answer: RTCSessionDescriptionInit
}

interface HandleIceCandidateOperationWithAdapterOptions {
  adapter: SignalingOperationsAdapter
  peerId: string
  candidate: RTCIceCandidateInit
}

export async function handleAnnounceOperation(options: HandleAnnounceOperationOptions): Promise<void> {
  const {
    peerId,
    userName,
    platform,
    selfId,
    roomLocked,
    roomLockOwnerPeerId,
    localUserName,
    localPlatform,
    peers,
    createOffer,
    sendToPeer,
    now
  } = options

  await handleAnnounceSignal({
    peerId,
    userName,
    platform,
    selfId,
    roomLocked,
    roomLockOwnerPeerId,
    localUserName,
    localPlatform,
    getPeer: (id) => peers.get(id),
    removePeer: (id) => {
      peers.delete(id)
    },
    createOffer,
    sendRoomLockedNotice: (targetPeerId, lockedByPeerId, ts) => {
      sendToPeer(targetPeerId, {
        v: 1,
        type: 'room-locked',
        from: selfId,
        data: {
          lockedByPeerId,
          ts
        }
      })
    },
    sendAnnounceReply: (targetPeerId, currentUserName, currentPlatform, ts) => {
      sendToPeer(targetPeerId, {
        v: 1,
        type: 'announce',
        from: selfId,
        userName: currentUserName,
        platform: currentPlatform,
        ts
      })
    },
    now
  })
}

export async function createOfferOperation(options: CreateOfferOperationOptions): Promise<void> {
  const {
    peerId,
    userName,
    platform,
    selfId,
    localUserName,
    localPlatform,
    peers,
    createPeerConnection,
    configureOpusCodec,
    sendToPeer
  } = options

  await createOfferSignal({
    peerId,
    userName,
    platform,
    selfId,
    localUserName,
    localPlatform,
    createPeerConnection,
    configureOpusCodec,
    sendOffer: (targetPeerId, payload, currentUserName, currentPlatform) => {
      sendToPeer(targetPeerId, {
        v: 1,
        type: 'offer',
        from: selfId,
        data: {
          type: payload.type,
          sdp: payload.sdp
        },
        userName: currentUserName,
        platform: currentPlatform
      })
    },
    onFailure: (failedPeerId) => {
      peers.delete(failedPeerId)
    }
  })
}

export async function handleOfferOperation(options: HandleOfferOperationOptions): Promise<void> {
  const {
    peerId,
    offer,
    userName,
    platform,
    selfId,
    peers,
    pendingCandidates,
    createPeerConnection,
    sendToPeer
  } = options

  await handleOfferSignal({
    peerId,
    offer,
    userName,
    platform,
    getPeer: (id) => peers.get(id),
    removePeer: (id) => {
      peers.delete(id)
    },
    createPeerConnection,
    getPendingCandidates: (id) => pendingCandidates.get(id) || [],
    clearPendingCandidates: (id) => {
      pendingCandidates.delete(id)
    },
    sendAnswer: (targetPeerId, answer) => {
      sendToPeer(targetPeerId, {
        v: 1,
        type: 'answer',
        from: selfId,
        data: {
          type: answer.type,
          sdp: answer.sdp
        }
      })
    }
  })
}

export async function handleAnswerOperation(options: HandleAnswerOperationOptions): Promise<void> {
  const {
    peerId,
    answer,
    peers,
    pendingCandidates
  } = options

  await handleAnswerSignal({
    peerId,
    answer,
    getPeer: (id) => peers.get(id),
    getPendingCandidates: (id) => pendingCandidates.get(id) || [],
    clearPendingCandidates: (id) => {
      pendingCandidates.delete(id)
    }
  })
}

export async function handleIceCandidateOperation(options: HandleIceCandidateOperationOptions): Promise<void> {
  const {
    peerId,
    candidate,
    peers,
    pendingCandidates
  } = options

  await handleIceCandidateSignal({
    peerId,
    candidate,
    getPeer: (id) => peers.get(id),
    getPendingCandidates: (id) => pendingCandidates.get(id) || [],
    setPendingCandidates: (id, candidates) => {
      pendingCandidates.set(id, candidates)
    }
  })
}

export async function handleAnnounceOperationWithAdapter(
  options: HandleAnnounceOperationWithAdapterOptions
): Promise<void> {
  const {
    adapter,
    peerId,
    userName,
    platform,
    selfId,
    now = () => Date.now()
  } = options

  await handleAnnounceOperation({
    peerId,
    userName,
    platform,
    selfId,
    roomLocked: adapter.roomLocked,
    roomLockOwnerPeerId: adapter.roomLockOwnerPeerId,
    localUserName: adapter.userName,
    localPlatform: adapter.localPlatform,
    peers: adapter.peers,
    createOffer: (id, targetName, targetPlatform) => adapter.createOffer(id, targetName, targetPlatform),
    sendToPeer: (id, message) => adapter.sendToPeer(id, message),
    now
  })
}

export async function createOfferOperationWithAdapter(
  options: CreateOfferOperationWithAdapterOptions
): Promise<void> {
  const {
    adapter,
    peerId,
    userName,
    platform,
    selfId
  } = options

  await createOfferOperation({
    peerId,
    userName,
    platform,
    selfId,
    localUserName: adapter.userName,
    localPlatform: adapter.localPlatform,
    peers: adapter.peers,
    createPeerConnection: (id, targetName, targetPlatform, isInitiator) =>
      adapter.createPeerConnection(id, targetName, targetPlatform, isInitiator),
    configureOpusCodec: (sdp) => adapter.configureOpusCodec(sdp),
    sendToPeer: (id, message) => adapter.sendToPeer(id, message)
  })
}

export async function handleOfferOperationWithAdapter(
  options: HandleOfferOperationWithAdapterOptions
): Promise<void> {
  const {
    adapter,
    peerId,
    offer,
    userName,
    platform,
    selfId
  } = options

  await handleOfferOperation({
    peerId,
    offer,
    userName,
    platform,
    selfId,
    peers: adapter.peers,
    pendingCandidates: adapter.pendingCandidates,
    createPeerConnection: (id, targetName, targetPlatform, isInitiator) =>
      adapter.createPeerConnection(id, targetName, targetPlatform, isInitiator),
    sendToPeer: (id, message) => adapter.sendToPeer(id, message)
  })
}

export async function handleAnswerOperationWithAdapter(
  options: HandleAnswerOperationWithAdapterOptions
): Promise<void> {
  const {
    adapter,
    peerId,
    answer
  } = options

  await handleAnswerOperation({
    peerId,
    answer,
    peers: adapter.peers,
    pendingCandidates: adapter.pendingCandidates
  })
}

export async function handleIceCandidateOperationWithAdapter(
  options: HandleIceCandidateOperationWithAdapterOptions
): Promise<void> {
  const {
    adapter,
    peerId,
    candidate
  } = options

  await handleIceCandidateOperation({
    peerId,
    candidate,
    peers: adapter.peers,
    pendingCandidates: adapter.pendingCandidates
  })
}
