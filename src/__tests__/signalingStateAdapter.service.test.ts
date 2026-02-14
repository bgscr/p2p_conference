import { describe, expect, it, vi } from 'vitest'
import {
  handleModerationSignalWithAdapter,
  handlePeerMuteStatusWithAdapter,
  recordPeerActivityWithAdapter,
  updateSignalingStateWithAdapter
} from '../renderer/signaling/services/signalingStateAdapter'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}))

describe('signalingStateAdapter service', () => {
  it('updates signaling state only when the state actually changes', () => {
    const setState = vi.fn()
    const onStateChange = vi.fn()

    expect(updateSignalingStateWithAdapter({
      currentState: 'connected',
      nextState: 'connected',
      setState,
      onStateChange
    })).toBe(false)
    expect(setState).not.toHaveBeenCalled()
    expect(onStateChange).not.toHaveBeenCalled()

    expect(updateSignalingStateWithAdapter({
      currentState: 'connecting',
      nextState: 'connected',
      setState,
      onStateChange
    })).toBe(true)
    expect(setState).toHaveBeenCalledWith('connected')
    expect(onStateChange).toHaveBeenCalledWith('connected')
  })

  it('records peer activity timestamps into both tracking maps', () => {
    const peerLastSeen = new Map<string, number>()
    const peerLastPing = new Map<string, number>()

    recordPeerActivityWithAdapter({
      peerId: 'peer-1',
      peerLastSeen,
      peerLastPing,
      now: () => 1234
    })

    expect(peerLastSeen.get('peer-1')).toBe(1234)
    expect(peerLastPing.get('peer-1')).toBe(1234)
  })

  it('updates mute status and emits callback when peer exists', () => {
    const peers = new Map([
      ['peer-1', { muteStatus: { micMuted: false, speakerMuted: false } }]
    ])
    const onPeerMuteChange = vi.fn()

    handlePeerMuteStatusWithAdapter({
      peerId: 'peer-1',
      data: { micMuted: true },
      peers,
      onPeerMuteChange
    })

    expect(peers.get('peer-1')?.muteStatus.micMuted).toBe(true)
    expect(onPeerMuteChange).toHaveBeenCalledWith('peer-1', {
      micMuted: true,
      speakerMuted: false,
      videoMuted: undefined,
      isScreenSharing: undefined
    })
  })

  it('does not emit mute callback when peer is missing', () => {
    const onPeerMuteChange = vi.fn()

    handlePeerMuteStatusWithAdapter({
      peerId: 'missing-peer',
      data: { micMuted: true },
      peers: new Map(),
      onPeerMuteChange
    })

    expect(onPeerMuteChange).not.toHaveBeenCalled()
  })

  it('dispatches moderation payloads only when parser returns a message', () => {
    const onModerationMessage = vi.fn()
    const parsePayload = vi.fn((data: unknown) => {
      if (typeof data === 'object' && data && (data as { ok?: boolean }).ok) {
        return { type: 'mod_room_lock', locked: true }
      }
      return null
    })

    handleModerationSignalWithAdapter({
      peerId: 'peer-1',
      data: { ok: false },
      parsePayload,
      invalidPayloadLog: 'Invalid moderation payload',
      onModerationMessage
    })
    expect(onModerationMessage).not.toHaveBeenCalled()

    handleModerationSignalWithAdapter({
      peerId: 'peer-1',
      data: { ok: true },
      parsePayload,
      invalidPayloadLog: 'Invalid moderation payload',
      onModerationMessage
    })
    expect(onModerationMessage).toHaveBeenCalledWith('peer-1', {
      type: 'mod_room_lock',
      locked: true
    })
  })
})
