import type {
  ModerationControlMessage,
  RemoteMicControlMessage
} from '@/types'
import {
  createPeerConnectionLifecycle,
  type CreatePeerConnectionLifecycleResult,
  type CreatePeerConnectionLifecycleOptions,
  type PeerConnectionState,
  type PeerMuteStatus
} from './peerLifecycle'

type PeerPlatform = 'win' | 'mac' | 'linux'
type ChannelType = 'chat' | 'control'

type LifecycleSignalMessage = {
  v: number
  type: 'ice-candidate' | 'mute-status' | 'room-lock'
  from: string
  data?: unknown
}

interface BuildPeerConnectionLifecycleOptions {
  peerId: string
  userName: string
  platform: PeerPlatform
  isInitiator: boolean
  localStream: MediaStream | null
  iceServers: RTCIceServer[]
  disconnectGracePeriodMs: number
  peers: Map<string, PeerConnectionState>
  applyAudioRoutingToPeer: (peerId: string) => void
  setupDataChannel: (
    dc: RTCDataChannel,
    peerId: string,
    peerConn: PeerConnectionState,
    channelType: ChannelType
  ) => void
  sendToPeer: (peerId: string, message: LifecycleSignalMessage) => void
  sendControlMessage: (peerId: string, message: ModerationControlMessage | RemoteMicControlMessage) => boolean
  attemptIceRestart: (peerId: string) => void | Promise<void>
  cleanupPeer: (peerId: string) => void
  stopAnnounceInterval: () => void
  onPeerJoin: (peerId: string, userName: string, platform: PeerPlatform) => void
  onRemoteStream: (peerId: string, stream: MediaStream) => void
  getLocalMuteStatus: () => PeerMuteStatus
  isRoomLocked: () => boolean
  getRoomLockOwnerPeerId: () => string | null
  isLocalHandRaised: () => boolean
  selfId: string
  now?: () => number
}

export interface PeerConnectionRuntimeAdapter {
  localStream: MediaStream | null
  peers: Map<string, PeerConnectionState>
  localMuteStatus: PeerMuteStatus
  roomLocked: boolean
  roomLockOwnerPeerId: string | null
  localHandRaised: boolean
  applyAudioRoutingToPeer: (peerId: string) => void
  setupDataChannel: (
    dc: RTCDataChannel,
    peerId: string,
    peerConn: PeerConnectionState,
    channelType: ChannelType
  ) => void
  sendToPeer: (peerId: string, message: LifecycleSignalMessage) => void
  sendControlMessage: (peerId: string, message: ModerationControlMessage | RemoteMicControlMessage) => boolean
  attemptIceRestart: (peerId: string) => void
  cleanupPeer: (peerId: string) => void
  stopAnnounceInterval: () => void
  onPeerJoin: (peerId: string, userName: string, platform: PeerPlatform) => void
  onRemoteStream: (peerId: string, stream: MediaStream) => void
}

interface CreatePeerConnectionWithAdapterOptions {
  adapter: PeerConnectionRuntimeAdapter
  peerId: string
  userName: string
  platform: PeerPlatform
  isInitiator?: boolean
  selfId: string
  iceServers: RTCIceServer[]
  disconnectGracePeriodMs: number
  now?: () => number
}

export function buildPeerConnectionLifecycleOptions(
  options: BuildPeerConnectionLifecycleOptions
): CreatePeerConnectionLifecycleOptions {
  const {
    peerId,
    userName,
    platform,
    isInitiator,
    localStream,
    iceServers,
    disconnectGracePeriodMs,
    peers,
    applyAudioRoutingToPeer,
    setupDataChannel,
    sendToPeer,
    sendControlMessage,
    attemptIceRestart,
    cleanupPeer,
    stopAnnounceInterval,
    onPeerJoin,
    onRemoteStream,
    getLocalMuteStatus,
    isRoomLocked,
    getRoomLockOwnerPeerId,
    isLocalHandRaised,
    selfId,
    now = () => Date.now()
  } = options

  return {
    peerId,
    userName,
    platform,
    isInitiator,
    localStream,
    iceServers,
    disconnectGracePeriodMs,
    getPeer: (id) => peers.get(id),
    removePeer: (id) => {
      peers.delete(id)
    },
    applyAudioRoutingToPeer,
    setupDataChannel,
    onSendIceCandidate: (id, candidate) => {
      sendToPeer(id, {
        v: 1,
        type: 'ice-candidate',
        from: selfId,
        data: candidate
      })
    },
    onAttemptIceRestart: (id) => {
      attemptIceRestart(id)
    },
    onCleanupPeer: (id) => {
      cleanupPeer(id)
    },
    onStopAnnounceInterval: () => {
      stopAnnounceInterval()
    },
    onPeerJoin,
    onSendLocalMuteStatus: (id) => {
      sendToPeer(id, {
        v: 1,
        type: 'mute-status',
        from: selfId,
        data: getLocalMuteStatus()
      })
    },
    onSendRoomLockState: (id) => {
      sendToPeer(id, {
        v: 1,
        type: 'room-lock',
        from: selfId,
        data: {
          type: 'mod_room_lock',
          locked: true,
          lockedByPeerId: getRoomLockOwnerPeerId() || selfId,
          ts: now()
        }
      })
    },
    onSendLocalHandRaised: (id) => {
      sendControlMessage(id, {
        type: 'mod_hand_raise',
        peerId: selfId,
        raised: true,
        ts: now()
      })
    },
    shouldSendRoomLockState: () => isRoomLocked(),
    shouldSendLocalHandRaised: () => isLocalHandRaised(),
    onRemoteStream,
    now
  }
}

export function createPeerConnectionForRuntime(
  options: BuildPeerConnectionLifecycleOptions
): RTCPeerConnection {
  const lifecycleOptions = buildPeerConnectionLifecycleOptions(options)
  const result: CreatePeerConnectionLifecycleResult = createPeerConnectionLifecycle(lifecycleOptions)
  options.peers.set(options.peerId, result.peerConn)
  return result.pc
}

export function createPeerConnectionWithAdapter(
  options: CreatePeerConnectionWithAdapterOptions
): RTCPeerConnection {
  const {
    adapter,
    peerId,
    userName,
    platform,
    isInitiator = false,
    selfId,
    iceServers,
    disconnectGracePeriodMs,
    now = () => Date.now()
  } = options

  return createPeerConnectionForRuntime({
    peerId,
    userName,
    platform,
    isInitiator,
    localStream: adapter.localStream,
    iceServers,
    disconnectGracePeriodMs,
    peers: adapter.peers,
    applyAudioRoutingToPeer: (id) => adapter.applyAudioRoutingToPeer(id),
    setupDataChannel: (dc, id, peerConn, channelType) => adapter.setupDataChannel(dc, id, peerConn, channelType),
    sendToPeer: (id, message) => adapter.sendToPeer(id, message),
    sendControlMessage: (id, message) => adapter.sendControlMessage(id, message),
    attemptIceRestart: (id) => {
      void adapter.attemptIceRestart(id)
    },
    cleanupPeer: (id) => adapter.cleanupPeer(id),
    stopAnnounceInterval: () => adapter.stopAnnounceInterval(),
    onPeerJoin: adapter.onPeerJoin,
    onRemoteStream: adapter.onRemoteStream,
    getLocalMuteStatus: () => adapter.localMuteStatus,
    isRoomLocked: () => adapter.roomLocked,
    getRoomLockOwnerPeerId: () => adapter.roomLockOwnerPeerId,
    isLocalHandRaised: () => adapter.localHandRaised,
    selfId,
    now
  })
}
