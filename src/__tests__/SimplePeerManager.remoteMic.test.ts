/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SimplePeerManager } from '../renderer/signaling/SimplePeerManager'
import { createControlChannel, createTestPeer } from './helpers/simplePeerManagerTestUtils'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  PeerLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

describe('SimplePeerManager remote mic controls', () => {
  let manager: SimplePeerManager

  beforeEach(() => {
    manager = new SimplePeerManager()
  })

  it('rejects exclusive audio routing without target', () => {
    expect(manager.setAudioRoutingMode('exclusive')).toBe(false)
  })

  it('returns null when requesting remote mic for missing peer', () => {
    const requestId = manager.sendRemoteMicRequest('missing-peer')
    expect(requestId).toBeNull()
  })

  it('sends remote mic request via control channel', () => {
    const peer = createTestPeer({ controlDataChannel: createControlChannel('open') })
    ; (manager as any).peers.set('peer-1', peer)

    const requestId = manager.sendRemoteMicRequest('peer-1')

    expect(requestId).toBeTruthy()
    expect(peer.controlDataChannel.send).toHaveBeenCalledTimes(1)
    expect(peer.controlDataChannel.send).toHaveBeenCalledWith(expect.stringContaining('"type":"rm_request"'))
  })

  it('sends response to pending remote mic request', () => {
    const peer = createTestPeer({ controlDataChannel: createControlChannel('open') })
    ; (manager as any).peers.set('peer-2', peer)
    ; (manager as any).pendingRemoteMicRequests.set('req-123', 'peer-2')

    const ok = manager.respondRemoteMicRequest('req-123', true, 'accepted')
    expect(ok).toBe(true)
    expect(peer.controlDataChannel.send).toHaveBeenCalledWith(expect.stringContaining('"type":"rm_response"'))
  })

  it('supports room lock state and rejects announce while locked', async () => {
    ; (manager as any).roomId = 'room-1'
    const sendToPeerSpy = vi.spyOn(manager as any, 'sendToPeer').mockImplementation(() => { })
    const createOfferSpy = vi.spyOn(manager as any, 'createOffer').mockResolvedValue(undefined)

    expect(manager.setRoomLocked(true)).toBe(true)

    await (manager as any).handleAnnounce('peer-new', 'Bob', 'win')

    expect(sendToPeerSpy).toHaveBeenCalledWith(
      'peer-new',
      expect.objectContaining({ type: 'room-locked' })
    )
    expect(createOfferSpy).not.toHaveBeenCalled()
  })

  it('broadcasts mute-all request and hand-raise moderation messages', () => {
    const peer = createTestPeer({ controlDataChannel: createControlChannel('open') })
    ; (manager as any).roomId = 'room-1'
    ; (manager as any).peers.set('peer-1', peer)

    const requestId = manager.requestMuteAll()
    expect(requestId).toBeTruthy()
    expect(peer.controlDataChannel.send).toHaveBeenCalledWith(expect.stringContaining('"type":"mod_mute_all_request"'))

    const handRaised = manager.setHandRaised(true)
    expect(handRaised).toBe(true)
    expect(peer.controlDataChannel.send).toHaveBeenCalledWith(expect.stringContaining('"type":"mod_hand_raise"'))
    expect(manager.getModerationState().localHandRaised).toBe(true)
  })

  it('sends mute-all response and consumes pending request mapping', () => {
    const peer = createTestPeer({ controlDataChannel: createControlChannel('open') })
    ; (manager as any).peers.set('peer-3', peer)
    ; (manager as any).pendingMuteAllRequests.set('mute-req-1', 'peer-3')

    const ok = manager.respondMuteAllRequest('peer-3', 'mute-req-1', true)
    expect(ok).toBe(true)
    expect(peer.controlDataChannel.send).toHaveBeenCalledWith(expect.stringContaining('"type":"mod_mute_all_response"'))
    expect((manager as any).pendingMuteAllRequests.has('mute-req-1')).toBe(false)
  })
})
