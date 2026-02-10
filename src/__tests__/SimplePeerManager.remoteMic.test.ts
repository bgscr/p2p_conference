/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SimplePeerManager } from '../renderer/signaling/SimplePeerManager'

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

function createMockPeer() {
  return {
    pc: {
      getSenders: () => [],
      addTrack: vi.fn()
    },
    stream: null,
    userName: 'Peer',
    platform: 'win',
    connectionStartTime: Date.now(),
    isConnected: true,
    muteStatus: { micMuted: false, speakerMuted: false },
    iceRestartAttempts: 0,
    iceRestartInProgress: false,
    disconnectTimer: null,
    reconnectTimer: null,
    chatDataChannel: null,
    controlDataChannel: {
      readyState: 'open',
      send: vi.fn()
    }
  }
}

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
    const peer = createMockPeer()
    ; (manager as any).peers.set('peer-1', peer)

    const requestId = manager.sendRemoteMicRequest('peer-1')

    expect(requestId).toBeTruthy()
    expect(peer.controlDataChannel.send).toHaveBeenCalledTimes(1)
    expect(peer.controlDataChannel.send).toHaveBeenCalledWith(expect.stringContaining('"type":"rm_request"'))
  })

  it('sends response to pending remote mic request', () => {
    const peer = createMockPeer()
    ; (manager as any).peers.set('peer-2', peer)
    ; (manager as any).pendingRemoteMicRequests.set('req-123', 'peer-2')

    const ok = manager.respondRemoteMicRequest('req-123', true, 'accepted')
    expect(ok).toBe(true)
    expect(peer.controlDataChannel.send).toHaveBeenCalledWith(expect.stringContaining('"type":"rm_response"'))
  })
})
