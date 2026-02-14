import { describe, it, expect, vi } from 'vitest'
import {
  applyAudioRoutingToPeer,
  replaceTrackAcrossPeers,
  resolveRoutedAudioTrackForPeer,
  shouldSendAudioToPeer,
  syncLocalStreamToPeers,
  updateAudioRoutingMode
} from '../renderer/signaling/services/mediaRouting'

vi.mock('../renderer/utils/Logger', () => ({
  PeerLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  SignalingLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

function createTrack(kind: 'audio' | 'video', id: string): MediaStreamTrack {
  return {
    kind,
    id,
    label: `${kind}-${id}`,
    enabled: true,
    readyState: 'live'
  } as unknown as MediaStreamTrack
}

function createSender(track: MediaStreamTrack | null) {
  return {
    track,
    replaceTrack: vi.fn().mockResolvedValue(undefined),
    getParameters: vi.fn().mockReturnValue({ codecs: [] })
  } as unknown as RTCRtpSender
}

function createPeerConnection(senders: RTCRtpSender[]) {
  return {
    getSenders: vi.fn().mockReturnValue(senders),
    addTrack: vi.fn()
  } as unknown as RTCPeerConnection
}

describe('mediaRouting service', () => {
  it('routes audio to all peers in broadcast mode and only target in exclusive mode', () => {
    expect(shouldSendAudioToPeer('broadcast', null, 'peer-1')).toBe(true)
    expect(shouldSendAudioToPeer('exclusive', 'peer-1', 'peer-1')).toBe(true)
    expect(shouldSendAudioToPeer('exclusive', 'peer-1', 'peer-2')).toBe(false)
  })

  it('resolves routed audio track based on mode and fallback/local stream', () => {
    const fallbackTrack = createTrack('audio', 'fallback-audio')
    const localAudioTrack = createTrack('audio', 'local-audio')
    const localStream = {
      getAudioTracks: () => [localAudioTrack]
    } as unknown as MediaStream

    const routedFromFallback = resolveRoutedAudioTrackForPeer({
      peerId: 'peer-1',
      fallbackTrack,
      localStream,
      audioRoutingMode: 'broadcast',
      audioRoutingTargetPeerId: null
    })
    expect(routedFromFallback?.id).toBe('fallback-audio')

    const routedFromLocal = resolveRoutedAudioTrackForPeer({
      peerId: 'peer-1',
      localStream,
      audioRoutingMode: 'broadcast',
      audioRoutingTargetPeerId: null
    })
    expect(routedFromLocal?.id).toBe('local-audio')

    const suppressed = resolveRoutedAudioTrackForPeer({
      peerId: 'peer-2',
      fallbackTrack,
      localStream,
      audioRoutingMode: 'exclusive',
      audioRoutingTargetPeerId: 'peer-1'
    })
    expect(suppressed).toBeNull()
  })

  it('applies routing with replaceTrack when sender exists and addTrack when sender is missing', () => {
    const audioTrack = createTrack('audio', 'a-1')
    const localStream = { getAudioTracks: () => [audioTrack] } as unknown as MediaStream

    const sender = createSender(audioTrack)
    const pcWithSender = createPeerConnection([sender])
    const pcWithoutSender = createPeerConnection([])

    const peers = new Map([
      ['peer-1', { pc: pcWithSender }],
      ['peer-2', { pc: pcWithoutSender }]
    ])

    applyAudioRoutingToPeer({
      peerId: 'peer-1',
      peers,
      localStream,
      getRoutedAudioTrackForPeer: () => null,
      audioRoutingMode: 'exclusive'
    })
    expect((sender.replaceTrack as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(null)

    applyAudioRoutingToPeer({
      peerId: 'peer-2',
      peers,
      localStream,
      getRoutedAudioTrackForPeer: () => audioTrack,
      audioRoutingMode: 'broadcast'
    })
    expect((pcWithoutSender.addTrack as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(audioTrack, localStream)
  })

  it('syncs local stream by replacing existing kind sender and skipping null-routed tracks', () => {
    const audioTrack = createTrack('audio', 'a-2')
    const stream = { getTracks: () => [audioTrack] } as unknown as MediaStream

    const sender = createSender(createTrack('audio', 'old-audio'))
    const pc = createPeerConnection([sender])
    const peers = new Map([['peer-1', { pc }]])

    syncLocalStreamToPeers({
      stream,
      peers,
      getRoutedAudioTrackForPeer: () => null,
      audioRoutingMode: 'exclusive'
    })

    expect((sender.replaceTrack as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(null)
    expect((pc.addTrack as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('replaces tracks across peers and adds track when sender is absent', () => {
    const newAudioTrack = createTrack('audio', 'new-audio')
    const localStream = {
      getAudioTracks: () => [newAudioTrack]
    } as unknown as MediaStream

    const sender = createSender(createTrack('audio', 'old-audio'))
    const pcWithSender = createPeerConnection([sender])
    const pcWithoutSender = createPeerConnection([])

    const peers = new Map([
      ['peer-1', { pc: pcWithSender }],
      ['peer-2', { pc: pcWithoutSender }]
    ])

    replaceTrackAcrossPeers({
      newTrack: newAudioTrack,
      peers,
      getRoutedAudioTrackForPeer: (peerId, fallbackTrack) => peerId === 'peer-1' ? fallbackTrack ?? null : newAudioTrack,
      localStream,
      audioRoutingMode: 'broadcast'
    })

    expect((sender.replaceTrack as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(newAudioTrack)
    expect((pcWithoutSender.addTrack as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(newAudioTrack, localStream)
  })

  it('updates routing mode with validation and applies routing when accepted', () => {
    const setAudioRoutingState = vi.fn()
    const applyAudioRouting = vi.fn()
    const peers = new Map<string, unknown>([['peer-1', {}]])

    expect(updateAudioRoutingMode({
      mode: 'exclusive',
      peers,
      setAudioRoutingState,
      applyAudioRouting
    })).toBe(false)

    expect(updateAudioRoutingMode({
      mode: 'exclusive',
      targetPeerId: 'missing-peer',
      peers,
      setAudioRoutingState,
      applyAudioRouting
    })).toBe(false)

    expect(updateAudioRoutingMode({
      mode: 'exclusive',
      targetPeerId: 'peer-1',
      peers,
      setAudioRoutingState,
      applyAudioRouting
    })).toBe(true)

    expect(updateAudioRoutingMode({
      mode: 'broadcast',
      targetPeerId: 'peer-1',
      peers,
      setAudioRoutingState,
      applyAudioRouting
    })).toBe(true)

    expect(setAudioRoutingState).toHaveBeenNthCalledWith(1, 'exclusive', 'peer-1')
    expect(setAudioRoutingState).toHaveBeenNthCalledWith(2, 'broadcast', null)
    expect(applyAudioRouting).toHaveBeenCalledTimes(2)
  })
})
