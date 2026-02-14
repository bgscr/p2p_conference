import { describe, expect, it, vi } from 'vitest'
import { handleSignalingDispatch, type DispatchableSignalMessage } from '../renderer/signaling/services/signalingDispatch'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}))

function buildHandlers() {
  return {
    onRecordPeerActivity: vi.fn(),
    onAnnounce: vi.fn(),
    onOffer: vi.fn(),
    onAnswer: vi.fn(),
    onIceCandidate: vi.fn(),
    onLeave: vi.fn(),
    onPing: vi.fn(),
    onPong: vi.fn(),
    onMuteStatus: vi.fn(),
    onRoomLock: vi.fn(),
    onRoomLocked: vi.fn()
  }
}

describe('signalingDispatch service', () => {
  it('ignores self messages and messages targeted to a different peer', () => {
    const handlers = buildHandlers()

    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'announce', from: 'self-peer' },
      handlers
    })

    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'announce', from: 'peer-a', to: 'peer-b' },
      handlers
    })

    expect(handlers.onRecordPeerActivity).not.toHaveBeenCalled()
    expect(handlers.onAnnounce).not.toHaveBeenCalled()
  })

  it('dispatches announce with default user and platform values', () => {
    const handlers = buildHandlers()
    const message: DispatchableSignalMessage = {
      type: 'announce',
      from: 'peer-a'
    }

    handleSignalingDispatch({
      selfId: 'self-peer',
      message,
      handlers
    })

    expect(handlers.onRecordPeerActivity).toHaveBeenCalledWith('peer-a')
    expect(handlers.onAnnounce).toHaveBeenCalledWith('peer-a', 'Unknown', 'win')
  })

  it('dispatches offer/answer/ice/leave to matching handlers', () => {
    const handlers = buildHandlers()
    const offer = { type: 'offer', sdp: 'offer-sdp' } as unknown as RTCSessionDescriptionInit
    const answer = { type: 'answer', sdp: 'answer-sdp' } as unknown as RTCSessionDescriptionInit
    const candidate = { candidate: 'candidate:1 1 udp 1 0.0.0.0 9 typ host' } as RTCIceCandidateInit

    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'offer', from: 'peer-a', data: offer, userName: 'Alice', platform: 'mac' },
      handlers
    })
    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'answer', from: 'peer-a', data: answer },
      handlers
    })
    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'ice-candidate', from: 'peer-a', data: candidate },
      handlers
    })
    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'leave', from: 'peer-a' },
      handlers
    })

    expect(handlers.onOffer).toHaveBeenCalledWith('peer-a', offer, 'Alice', 'mac')
    expect(handlers.onAnswer).toHaveBeenCalledWith('peer-a', answer)
    expect(handlers.onIceCandidate).toHaveBeenCalledWith('peer-a', candidate)
    expect(handlers.onLeave).toHaveBeenCalledWith('peer-a')
  })

  it('dispatches ping/pong/mute-status and moderation payloads', () => {
    const handlers = buildHandlers()
    const mutePayload = { micMuted: true, speakerMuted: false }
    const roomLockPayload = { locked: true }
    const roomLockedPayload = { lockedBy: 'host-1' }

    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'ping', from: 'peer-a' },
      handlers
    })
    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'pong', from: 'peer-a' },
      handlers
    })
    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'mute-status', from: 'peer-a', data: mutePayload },
      handlers
    })
    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'room-lock', from: 'peer-a', data: roomLockPayload },
      handlers
    })
    handleSignalingDispatch({
      selfId: 'self-peer',
      message: { type: 'room-locked', from: 'peer-a', data: roomLockedPayload },
      handlers
    })

    expect(handlers.onPing).toHaveBeenCalledWith('peer-a')
    expect(handlers.onPong).toHaveBeenCalledWith('peer-a')
    expect(handlers.onMuteStatus).toHaveBeenCalledWith('peer-a', mutePayload)
    expect(handlers.onRoomLock).toHaveBeenCalledWith('peer-a', roomLockPayload)
    expect(handlers.onRoomLocked).toHaveBeenCalledWith('peer-a', roomLockedPayload)
  })
})
