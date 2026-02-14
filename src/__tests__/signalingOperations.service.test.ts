import { beforeEach, describe, expect, it, vi } from 'vitest'

const signalingHandlerMocks = vi.hoisted(() => ({
  handleAnnounceSignal: vi.fn(),
  createOfferSignal: vi.fn(),
  handleOfferSignal: vi.fn(),
  handleAnswerSignal: vi.fn(),
  handleIceCandidateSignal: vi.fn()
}))

vi.mock('../renderer/signaling/services/signalingHandlers', () => ({
  handleAnnounceSignal: signalingHandlerMocks.handleAnnounceSignal,
  createOfferSignal: signalingHandlerMocks.createOfferSignal,
  handleOfferSignal: signalingHandlerMocks.handleOfferSignal,
  handleAnswerSignal: signalingHandlerMocks.handleAnswerSignal,
  handleIceCandidateSignal: signalingHandlerMocks.handleIceCandidateSignal
}))

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  PeerLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import {
  createOfferOperationWithAdapter,
  handleAnnounceOperationWithAdapter,
  handleAnswerOperationWithAdapter,
  handleIceCandidateOperationWithAdapter,
  handleOfferOperationWithAdapter
} from '../renderer/signaling/services/signalingOperations'

function createAdapter() {
  return {
    roomLocked: true,
    roomLockOwnerPeerId: 'host-1',
    userName: 'Local User',
    localPlatform: 'win' as const,
    peers: new Map<string, any>([['peer-a', { state: true }]]),
    pendingCandidates: new Map<string, RTCIceCandidateInit[]>([
      ['peer-a', [{ candidate: 'candidate-1' }]]
    ]),
    createOffer: vi.fn(),
    createPeerConnection: vi.fn(),
    configureOpusCodec: vi.fn((sdp: string) => sdp),
    sendToPeer: vi.fn()
  }
}

describe('signalingOperations service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    signalingHandlerMocks.handleAnnounceSignal.mockReset()
    signalingHandlerMocks.createOfferSignal.mockReset()
    signalingHandlerMocks.handleOfferSignal.mockReset()
    signalingHandlerMocks.handleAnswerSignal.mockReset()
    signalingHandlerMocks.handleIceCandidateSignal.mockReset()
  })

  it('adapts announce operations and maps outgoing signaling payloads', async () => {
    const adapter = createAdapter()
    signalingHandlerMocks.handleAnnounceSignal.mockImplementation(async (options: any) => {
      options.sendRoomLockedNotice('peer-a', 'host-1', 999)
      options.sendAnnounceReply('peer-a', 'Local User', 'win', 1001)
    })

    await handleAnnounceOperationWithAdapter({
      adapter: adapter as any,
      peerId: 'peer-a',
      userName: 'Remote',
      platform: 'mac',
      selfId: 'self-1',
      now: () => 999
    })

    expect(signalingHandlerMocks.handleAnnounceSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: 'peer-a',
        roomLocked: true,
        roomLockOwnerPeerId: 'host-1',
        localUserName: 'Local User',
        localPlatform: 'win'
      })
    )
    expect(adapter.sendToPeer).toHaveBeenNthCalledWith(1, 'peer-a', {
      v: 1,
      type: 'room-locked',
      from: 'self-1',
      data: { lockedByPeerId: 'host-1', ts: 999 }
    })
    expect(adapter.sendToPeer).toHaveBeenNthCalledWith(2, 'peer-a', {
      v: 1,
      type: 'announce',
      from: 'self-1',
      userName: 'Local User',
      platform: 'win',
      ts: 1001
    })
  })

  it('removes failed peers and maps offer payloads through adapter', async () => {
    const adapter = createAdapter()
    signalingHandlerMocks.createOfferSignal.mockImplementation(async (options: any) => {
      options.sendOffer('peer-a', { type: 'offer', sdp: 'offer-sdp' }, 'Local User', 'win')
      options.onFailure('peer-a')
    })

    await createOfferOperationWithAdapter({
      adapter: adapter as any,
      peerId: 'peer-a',
      userName: 'Remote',
      platform: 'linux',
      selfId: 'self-2'
    })

    expect(adapter.sendToPeer).toHaveBeenCalledWith('peer-a', {
      v: 1,
      type: 'offer',
      from: 'self-2',
      data: { type: 'offer', sdp: 'offer-sdp' },
      userName: 'Local User',
      platform: 'win'
    })
    expect(adapter.peers.has('peer-a')).toBe(false)
  })

  it('adapts offer/answer/ice operations with pending-candidate map transitions', async () => {
    const adapter = createAdapter()
    signalingHandlerMocks.handleOfferSignal.mockImplementation(async (options: any) => {
      expect(options.getPendingCandidates('peer-a')).toEqual([{ candidate: 'candidate-1' }])
      options.clearPendingCandidates('peer-a')
      options.sendAnswer('peer-a', { type: 'answer', sdp: 'answer-sdp' })
    })
    signalingHandlerMocks.handleAnswerSignal.mockImplementation(async (options: any) => {
      options.clearPendingCandidates('peer-a')
    })
    signalingHandlerMocks.handleIceCandidateSignal.mockImplementation(async (options: any) => {
      const pending = options.getPendingCandidates('peer-a')
      pending.push({ candidate: 'candidate-2' })
      options.setPendingCandidates('peer-a', pending)
    })

    await handleOfferOperationWithAdapter({
      adapter: adapter as any,
      peerId: 'peer-a',
      offer: { type: 'offer', sdp: 'offer-sdp' },
      userName: 'Remote',
      platform: 'mac',
      selfId: 'self-3'
    })
    expect(adapter.pendingCandidates.has('peer-a')).toBe(false)
    expect(adapter.sendToPeer).toHaveBeenCalledWith('peer-a', {
      v: 1,
      type: 'answer',
      from: 'self-3',
      data: { type: 'answer', sdp: 'answer-sdp' }
    })

    adapter.pendingCandidates.set('peer-a', [{ candidate: 'candidate-3' }])
    await handleAnswerOperationWithAdapter({
      adapter: adapter as any,
      peerId: 'peer-a',
      answer: { type: 'answer', sdp: 'answer-sdp' }
    })
    expect(adapter.pendingCandidates.has('peer-a')).toBe(false)

    await handleIceCandidateOperationWithAdapter({
      adapter: adapter as any,
      peerId: 'peer-a',
      candidate: { candidate: 'candidate-2' }
    })
    expect(adapter.pendingCandidates.get('peer-a')).toEqual([{ candidate: 'candidate-2' }])
  })
})
