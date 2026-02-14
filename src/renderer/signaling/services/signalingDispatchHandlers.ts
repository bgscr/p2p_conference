import { handleSignalingDispatch, type DispatchableSignalMessage } from './signalingDispatch'

type SignalPlatform = 'win' | 'mac' | 'linux'

interface BuildSignalingDispatchHandlersOptions {
  onRecordPeerActivity: (peerId: string) => void
  onAnnounce: (peerId: string, userName: string, platform: SignalPlatform) => void
  onOffer: (peerId: string, offer: RTCSessionDescriptionInit, userName: string, platform: SignalPlatform) => void
  onAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => void
  onIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => void
  onLeave: (peerId: string) => void
  onPing: (peerId: string) => void
  onMuteStatus: (peerId: string, data: unknown) => void
  onRoomLock: (peerId: string, data: unknown) => void
  onRoomLocked: (peerId: string, data: unknown) => void
}

export interface SignalingDispatchAdapter {
  recordPeerActivity: (peerId: string) => void
  handleAnnounce: (peerId: string, userName: string, platform: SignalPlatform) => Promise<void> | void
  handleOffer: (peerId: string, offer: RTCSessionDescriptionInit, userName: string, platform: SignalPlatform) => Promise<void> | void
  handleAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => Promise<void> | void
  handleIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => Promise<void> | void
  handlePeerLeave: (peerId: string) => void
  sendPong: (peerId: string) => void
  handleMuteStatus: (peerId: string, data: unknown) => void
  handleRoomLockMessage: (peerId: string, data: unknown) => void
  handleRoomLockedMessage: (peerId: string, data: unknown) => void
}

interface HandleSignalingDispatchWithAdapterOptions {
  selfId: string
  message: DispatchableSignalMessage
  adapter: SignalingDispatchAdapter
}

export function buildSignalingDispatchHandlers(options: BuildSignalingDispatchHandlersOptions) {
  const {
    onRecordPeerActivity,
    onAnnounce,
    onOffer,
    onAnswer,
    onIceCandidate,
    onLeave,
    onPing,
    onMuteStatus,
    onRoomLock,
    onRoomLocked
  } = options

  return {
    onRecordPeerActivity: (peerId: string) => {
      onRecordPeerActivity(peerId)
    },
    onAnnounce: (peerId: string, userName: string, platform: SignalPlatform) => {
      onAnnounce(peerId, userName, platform)
    },
    onOffer: (peerId: string, offer: RTCSessionDescriptionInit, userName: string, platform: SignalPlatform) => {
      onOffer(peerId, offer, userName, platform)
    },
    onAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => {
      onAnswer(peerId, answer)
    },
    onIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => {
      onIceCandidate(peerId, candidate)
    },
    onLeave: (peerId: string) => {
      onLeave(peerId)
    },
    onPing: (peerId: string) => {
      onPing(peerId)
    },
    onPong: () => {
      // Activity already recorded.
    },
    onMuteStatus: (peerId: string, data: unknown) => {
      onMuteStatus(peerId, data)
    },
    onRoomLock: (peerId: string, data: unknown) => {
      onRoomLock(peerId, data)
    },
    onRoomLocked: (peerId: string, data: unknown) => {
      onRoomLocked(peerId, data)
    }
  }
}

export function handleSignalingDispatchWithAdapter(
  options: HandleSignalingDispatchWithAdapterOptions
): void {
  const {
    selfId,
    message,
    adapter
  } = options

  handleSignalingDispatch({
    selfId,
    message,
    handlers: buildSignalingDispatchHandlers({
      onRecordPeerActivity: (peerId) => {
        adapter.recordPeerActivity(peerId)
      },
      onAnnounce: (peerId, userName, platform) => {
        void adapter.handleAnnounce(peerId, userName, platform)
      },
      onOffer: (peerId, offer, userName, platform) => {
        void adapter.handleOffer(peerId, offer, userName, platform)
      },
      onAnswer: (peerId, answer) => {
        void adapter.handleAnswer(peerId, answer)
      },
      onIceCandidate: (peerId, candidate) => {
        void adapter.handleIceCandidate(peerId, candidate)
      },
      onLeave: (peerId) => {
        adapter.handlePeerLeave(peerId)
      },
      onPing: (peerId) => {
        adapter.sendPong(peerId)
      },
      onMuteStatus: (peerId, data) => {
        adapter.handleMuteStatus(peerId, data)
      },
      onRoomLock: (peerId, data) => {
        adapter.handleRoomLockMessage(peerId, data)
      },
      onRoomLocked: (peerId, data) => {
        adapter.handleRoomLockedMessage(peerId, data)
      }
    })
  })
}
