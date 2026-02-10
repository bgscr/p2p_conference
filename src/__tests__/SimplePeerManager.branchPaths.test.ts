/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimplePeerManager, selfId } from '../renderer/signaling/SimplePeerManager'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  PeerLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

type ChannelState = 'open' | 'closing' | 'closed'

function createControlChannel(state: ChannelState = 'open') {
  return {
    readyState: state,
    send: vi.fn(),
    close: vi.fn(),
  } as any
}

function createPeer(overrides: Record<string, any> = {}) {
  const pc = overrides.pc || {
    getSenders: vi.fn(() => []),
    addTrack: vi.fn(),
    close: vi.fn(),
    connectionState: 'connected',
    iceConnectionState: 'connected',
  }

  return {
    pc,
    stream: null,
    userName: 'Peer',
    platform: 'win',
    connectionStartTime: Date.now(),
    isConnected: true,
    muteStatus: { micMuted: false, speakerMuted: false, videoMuted: false, isScreenSharing: false },
    iceRestartAttempts: 0,
    iceRestartInProgress: false,
    disconnectTimer: null,
    reconnectTimer: null,
    chatDataChannel: null,
    controlDataChannel: null,
    ...overrides,
  }
}

describe('SimplePeerManager branch path coverage', () => {
  let manager: SimplePeerManager
  let managerAny: any

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new SimplePeerManager()
    managerAny = manager as any
  })

  afterEach(() => {
    vi.useRealTimers()
    manager.leaveRoom()
  })

  it('validates control channel payload shapes and parse failures', () => {
    const dc: any = { label: 'control', readyState: 'open' }
    const peerConn = createPeer({ controlDataChannel: dc })
    const handleRemoteMicControlMessageSpy = vi.spyOn(managerAny, 'handleRemoteMicControlMessage')

    managerAny.setupDataChannel(dc, 'peer-1', peerConn, 'control')

    dc.onmessage?.({ data: new ArrayBuffer(1) })
    dc.onmessage?.({ data: JSON.stringify(null) })
    dc.onmessage?.({ data: JSON.stringify(1) })
    dc.onmessage?.({ data: JSON.stringify({}) })
    dc.onmessage?.({ data: JSON.stringify({ type: 123 }) })
    dc.onmessage?.({ data: JSON.stringify({ type: 'unknown', requestId: 'req-x' }) })
    dc.onmessage?.({ data: JSON.stringify({ type: 'rm_request' }) })
    dc.onmessage?.({ data: '{"type":"rm_request",' })

    expect(handleRemoteMicControlMessageSpy).not.toHaveBeenCalled()

    dc.onmessage?.({
      data: JSON.stringify({ type: 'rm_request', requestId: 'req-ok', sourcePeerId: 'peer-1', ts: Date.now() })
    })
    expect(handleRemoteMicControlMessageSpy).toHaveBeenCalledWith(
      'peer-1',
      expect.objectContaining({ type: 'rm_request', requestId: 'req-ok' })
    )
  })

  it('clears chat/control data channel references on close', () => {
    const chatDc: any = { label: 'chat', readyState: 'open' }
    const controlDc: any = { label: 'control', readyState: 'open' }
    const peerConn = createPeer({ chatDataChannel: chatDc, controlDataChannel: controlDc })

    managerAny.setupDataChannel(chatDc, 'peer-1', peerConn, 'chat')
    managerAny.setupDataChannel(controlDc, 'peer-1', peerConn, 'control')

    chatDc.onclose?.()
    controlDc.onclose?.()

    expect(peerConn.chatDataChannel).toBeNull()
    expect(peerConn.controlDataChannel).toBeNull()
  })

  it('handles all remote mic control message types and state transitions', () => {
    const remoteMicCallback = vi.fn()
    manager.setOnRemoteMicControl(remoteMicCallback)
    const setAudioRoutingModeSpy = vi.spyOn(manager, 'setAudioRoutingMode').mockReturnValue(true)

    managerAny.handleRemoteMicControlMessage('peer-a', {
      type: 'rm_request',
      requestId: 'req-1',
      sourcePeerId: 'peer-a',
      ts: Date.now()
    })
    expect(managerAny.pendingRemoteMicRequests.get('req-1')).toBe('peer-a')

    managerAny.pendingOutgoingRemoteMicRequestId = 'req-2'
    managerAny.handleRemoteMicControlMessage('peer-a', {
      type: 'rm_response',
      requestId: 'req-2',
      accepted: true,
      reason: 'accepted',
      ts: Date.now()
    })
    expect(managerAny.pendingOutgoingRemoteMicRequestId).toBeNull()
    expect(managerAny.activeRemoteMicTargetPeerId).toBe('peer-a')
    expect(managerAny.activeRemoteMicRequestId).toBe('req-2')

    managerAny.activeRemoteMicTargetPeerId = 'peer-a'
    managerAny.activeRemoteMicRequestId = 'req-3'
    managerAny.handleRemoteMicControlMessage('peer-a', {
      type: 'rm_response',
      requestId: 'req-3',
      accepted: false,
      reason: 'rejected',
      ts: Date.now()
    })
    expect(managerAny.activeRemoteMicTargetPeerId).toBeNull()
    expect(managerAny.activeRemoteMicRequestId).toBeNull()

    managerAny.handleRemoteMicControlMessage('peer-b', {
      type: 'rm_start',
      requestId: 'req-4',
      ts: Date.now()
    })
    expect(managerAny.activeRemoteMicSourcePeerId).toBe('peer-b')
    expect(managerAny.activeRemoteMicRequestId).toBe('req-4')

    managerAny.pendingRemoteMicRequests.set('req-stop', 'peer-b')
    managerAny.activeRemoteMicTargetPeerId = 'peer-b'
    managerAny.activeRemoteMicSourcePeerId = 'peer-b'
    managerAny.activeRemoteMicRequestId = 'req-stop'
    managerAny.handleRemoteMicControlMessage('peer-b', {
      type: 'rm_stop',
      requestId: 'req-stop',
      reason: 'stopped-by-source',
      ts: Date.now()
    })
    expect(setAudioRoutingModeSpy).toHaveBeenCalledWith('broadcast')
    expect(managerAny.pendingRemoteMicRequests.has('req-stop')).toBe(false)
    expect(managerAny.activeRemoteMicTargetPeerId).toBeNull()
    expect(managerAny.activeRemoteMicSourcePeerId).toBeNull()
    expect(managerAny.activeRemoteMicRequestId).toBeNull()

    managerAny.handleRemoteMicControlMessage('peer-b', {
      type: 'rm_heartbeat',
      requestId: 'req-hb',
      ts: Date.now()
    })

    expect(remoteMicCallback).toHaveBeenCalled()
  })

  it('covers send/response/start guards when control channels are not open', () => {
    managerAny.peers.set('peer-1', createPeer({ controlDataChannel: createControlChannel('closing') }))

    expect(manager.sendRemoteMicRequest('peer-1')).toBeNull()
    expect(manager.respondRemoteMicRequest('missing-req', true, 'accepted')).toBe(false)

    managerAny.pendingRemoteMicRequests.set('req-2', 'peer-1')
    expect(manager.respondRemoteMicRequest('req-2', true, 'accepted')).toBe(false)
    expect(manager.sendRemoteMicStart('peer-1', 'req-2')).toBe(false)
  })

  it('sendRemoteMicStop handles matching and non-matching active request ids', () => {
    const channel = createControlChannel('open')
    managerAny.peers.set('peer-target', createPeer({ controlDataChannel: channel }))

    managerAny.activeRemoteMicRequestId = 'req-a'
    managerAny.activeRemoteMicTargetPeerId = 'peer-target'
    managerAny.activeRemoteMicSourcePeerId = 'peer-target'
    expect(manager.sendRemoteMicStop('peer-target', 'req-a')).toBe(true)
    expect(managerAny.activeRemoteMicRequestId).toBeNull()
    expect(managerAny.activeRemoteMicTargetPeerId).toBeNull()
    expect(managerAny.activeRemoteMicSourcePeerId).toBeNull()

    managerAny.activeRemoteMicRequestId = 'req-b'
    managerAny.activeRemoteMicTargetPeerId = 'peer-target'
    expect(manager.sendRemoteMicStop('peer-target', 'req-c', 'stopped-by-source')).toBe(true)
    expect(managerAny.activeRemoteMicRequestId).toBe('req-b')
    expect(managerAny.activeRemoteMicTargetPeerId).toBe('peer-target')
  })

  it('stopRemoteMicSession sends stop to active target/source and clears state', () => {
    managerAny.peers.set('peer-target', createPeer({ controlDataChannel: createControlChannel('open') }))
    managerAny.peers.set('peer-source', createPeer({ controlDataChannel: createControlChannel('open') }))
    managerAny.pendingOutgoingRemoteMicRequestId = 'req-stop-all'
    managerAny.pendingRemoteMicRequests.set('req-pending', 'peer-source')
    managerAny.activeRemoteMicRequestId = 'req-stop-all'
    managerAny.activeRemoteMicTargetPeerId = 'peer-target'
    managerAny.activeRemoteMicSourcePeerId = 'peer-source'

    const sendStopSpy = vi.spyOn(manager, 'sendRemoteMicStop')
    const setRoutingSpy = vi.spyOn(manager, 'setAudioRoutingMode')

    manager.stopRemoteMicSession()

    expect(sendStopSpy).toHaveBeenCalledWith('peer-target', 'req-stop-all', 'unknown')
    expect(sendStopSpy).toHaveBeenCalledWith('peer-source', 'req-stop-all', 'unknown')
    expect(setRoutingSpy).toHaveBeenCalledWith('broadcast')
    expect(managerAny.pendingOutgoingRemoteMicRequestId).toBeNull()
    expect(managerAny.activeRemoteMicRequestId).toBeNull()
    expect(managerAny.activeRemoteMicTargetPeerId).toBeNull()
    expect(managerAny.activeRemoteMicSourcePeerId).toBeNull()
    expect(managerAny.pendingRemoteMicRequests.size).toBe(0)
  })

  it('routes signaling message switch branches for offer/answer/ice/leave/mute-status', () => {
    const handleOfferSpy = vi.spyOn(managerAny, 'handleOffer').mockResolvedValue(undefined)
    const handleAnswerSpy = vi.spyOn(managerAny, 'handleAnswer').mockResolvedValue(undefined)
    const handleIceSpy = vi.spyOn(managerAny, 'handleIceCandidate').mockResolvedValue(undefined)
    const handleLeaveSpy = vi.spyOn(managerAny, 'handlePeerLeave').mockImplementation(() => undefined)
    const handleMuteSpy = vi.spyOn(managerAny, 'handleMuteStatus').mockImplementation(() => undefined)

    managerAny.handleSignalingMessage({
      v: 1,
      type: 'offer',
      from: 'peer-offer-1',
      data: { type: 'offer', sdp: 'v=0' },
      ts: Date.now()
    })
    expect(handleOfferSpy).toHaveBeenCalledWith('peer-offer-1', { type: 'offer', sdp: 'v=0' }, 'Unknown', 'win')

    managerAny.handleSignalingMessage({
      v: 1,
      type: 'offer',
      from: 'peer-offer-2',
      data: { type: 'offer', sdp: 'v=0' },
      userName: 'Alice',
      platform: 'mac',
      ts: Date.now()
    })
    expect(handleOfferSpy).toHaveBeenCalledWith('peer-offer-2', { type: 'offer', sdp: 'v=0' }, 'Alice', 'mac')

    managerAny.handleSignalingMessage({
      v: 1,
      type: 'answer',
      from: 'peer-answer',
      data: { type: 'answer', sdp: 'v=0' },
      ts: Date.now()
    })
    expect(handleAnswerSpy).toHaveBeenCalledWith('peer-answer', { type: 'answer', sdp: 'v=0' })

    managerAny.handleSignalingMessage({
      v: 1,
      type: 'ice-candidate',
      from: 'peer-ice',
      data: { candidate: 'candidate:1' },
      ts: Date.now()
    })
    expect(handleIceSpy).toHaveBeenCalledWith('peer-ice', { candidate: 'candidate:1' })

    managerAny.handleSignalingMessage({
      v: 1,
      type: 'leave',
      from: 'peer-leave',
      ts: Date.now()
    })
    expect(handleLeaveSpy).toHaveBeenCalledWith('peer-leave')

    managerAny.handleSignalingMessage({
      v: 1,
      type: 'mute-status',
      from: 'peer-mute',
      data: { micMuted: true },
      ts: Date.now()
    })
    expect(handleMuteSpy).toHaveBeenCalledWith('peer-mute', { micMuted: true })

    managerAny.handleSignalingMessage({
      v: 1,
      type: 'offer',
      from: selfId,
      data: { type: 'offer', sdp: 'v=0' },
      ts: Date.now()
    })
    managerAny.handleSignalingMessage({
      v: 1,
      type: 'offer',
      from: 'peer-ignored',
      to: 'other-peer',
      data: { type: 'offer', sdp: 'v=0' },
      ts: Date.now()
    })
    expect(handleOfferSpy).toHaveBeenCalledTimes(2)
  })

  it('updates peer mute status with nullish fallbacks and handles missing peers', () => {
    const peer = createPeer({
      muteStatus: { micMuted: true, speakerMuted: true, videoMuted: true, isScreenSharing: true }
    })
    managerAny.peers.set('peer-1', peer)

    const onPeerMuteChange = vi.fn()
    manager.setCallbacks({ onPeerMuteChange })

    managerAny.handleMuteStatus('peer-1', { speakerMuted: false })
    expect(peer.muteStatus).toEqual({
      micMuted: true,
      speakerMuted: false,
      videoMuted: true,
      isScreenSharing: true
    })
    expect(onPeerMuteChange).toHaveBeenCalledWith('peer-1', peer.muteStatus)

    managerAny.handleMuteStatus('missing-peer', { micMuted: false, speakerMuted: false })
    expect(onPeerMuteChange).toHaveBeenCalledTimes(1)
  })

  it('applies audio routing for addTrack, sender replacement and skipped routes', () => {
    const audioTrack = { id: 'audio-1', kind: 'audio' } as any
    managerAny.localStream = {
      getAudioTracks: () => [audioTrack],
      getTracks: () => [audioTrack]
    } as any

    const addTrackPeerPc = {
      getSenders: vi.fn(() => []),
      addTrack: vi.fn(),
      close: vi.fn(),
      connectionState: 'connected',
      iceConnectionState: 'connected'
    }
    managerAny.peers.set('peer-add', createPeer({ pc: addTrackPeerPc }))
    managerAny.applyAudioRoutingToPeer('peer-add')
    expect(addTrackPeerPc.addTrack).toHaveBeenCalledWith(audioTrack, managerAny.localStream)

    const replaceTrack = vi.fn().mockResolvedValue(undefined)
    const senderPeerPc = {
      getSenders: vi.fn(() => [{
        track: { kind: 'audio', id: 'old-audio' },
        replaceTrack,
        getParameters: vi.fn().mockReturnValue({ codecs: [{ mimeType: 'audio/opus' }] }),
      }]),
      addTrack: vi.fn(),
      close: vi.fn(),
      connectionState: 'connected',
      iceConnectionState: 'connected'
    }
    managerAny.peers.set('peer-replace', createPeer({ pc: senderPeerPc }))
    managerAny.applyAudioRoutingToPeer('peer-replace')
    expect(replaceTrack).toHaveBeenCalledWith(audioTrack)

    managerAny.peers.set('peer-target', createPeer({ pc: addTrackPeerPc }))
    manager.setAudioRoutingMode('exclusive', 'peer-target')
    addTrackPeerPc.addTrack.mockClear()
    managerAny.applyAudioRoutingToPeer('peer-add')
    expect(addTrackPeerPc.addTrack).not.toHaveBeenCalled()

    expect(() => managerAny.applyAudioRoutingToPeer('peer-missing')).not.toThrow()
  })

  it('reconnect flow restarts ICE only for disconnected or failed peers', async () => {
    vi.useFakeTimers()
    managerAny.roomId = 'room-1'
    managerAny.isOnline = true
    managerAny.topic = 'p2p-conference/room-1'
    managerAny.mqtt = {
      isConnected: () => true,
      connectAll: vi.fn().mockResolvedValue([]),
      subscribeAll: vi.fn().mockResolvedValue(0),
      disconnect: vi.fn(),
    }

    const disconnectedPeer = createPeer({
      pc: { getSenders: vi.fn(() => []), addTrack: vi.fn(), close: vi.fn(), connectionState: 'connected', iceConnectionState: 'disconnected' }
    })
    const failedPeer = createPeer({
      pc: { getSenders: vi.fn(() => []), addTrack: vi.fn(), close: vi.fn(), connectionState: 'connected', iceConnectionState: 'failed' }
    })
    const connectedPeer = createPeer({
      pc: { getSenders: vi.fn(() => []), addTrack: vi.fn(), close: vi.fn(), connectionState: 'connected', iceConnectionState: 'connected' }
    })
    managerAny.peers.set('peer-disc', disconnectedPeer)
    managerAny.peers.set('peer-fail', failedPeer)
    managerAny.peers.set('peer-ok', connectedPeer)

    const attemptIceRestartSpy = vi.spyOn(managerAny, 'attemptIceRestart').mockImplementation(() => Promise.resolve())

    managerAny.attemptNetworkReconnect()
    await vi.advanceTimersByTimeAsync(2000)

    expect(attemptIceRestartSpy).toHaveBeenCalledWith('peer-disc')
    expect(attemptIceRestartSpy).toHaveBeenCalledWith('peer-fail')
    expect(attemptIceRestartSpy).not.toHaveBeenCalledWith('peer-ok')
  })
})
