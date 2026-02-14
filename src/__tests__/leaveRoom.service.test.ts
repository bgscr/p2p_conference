import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaveRoomWorkflowAdapter } from '../renderer/signaling/services/leaveRoom'
import {
  executeLeaveRoomWorkflowWithAdapter,
  sendBestEffortLeaveSignal
} from '../renderer/signaling/services/leaveRoom'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  PeerLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

function createLeaveAdapter(): LeaveRoomWorkflowAdapter<number> {
  const disconnectTimer = 1 as unknown as NodeJS.Timeout
  const reconnectTimer = 2 as unknown as NodeJS.Timeout

  return {
    roomId: 'room-1',
    topic: 'p2p-conf/room-1',
    sessionId: 99,
    isLeaving: false,
    peers: new Map([
      ['peer-1', {
        pc: { close: vi.fn() },
        disconnectTimer,
        reconnectTimer
      }]
    ]),
    pendingCandidates: new Map([
      ['peer-1', [{ candidate: 'candidate:1 1 udp 1 0.0.0.0 9 typ host' }]]
    ]),
    peerLastSeen: new Map([['peer-1', Date.now()]]),
    peerLastPing: new Map([['peer-1', Date.now()]]),
    previousStats: new Map([['peer-1', 123]]),
    mqtt: { disconnect: vi.fn() },
    broadcastChannel: { close: vi.fn() } as unknown as BroadcastChannel,
    localStream: { id: 'local-stream' } as unknown as MediaStream,
    localMuteStatus: { micMuted: true, speakerMuted: true },
    audioRoutingMode: 'exclusive',
    audioRoutingTargetPeerId: 'peer-1',
    stopAnnounceInterval: vi.fn(),
    stopHeartbeat: vi.fn(),
    sendLeaveSignal: vi.fn(),
    performControlStateReset: vi.fn(),
    performNetworkReconnectReset: vi.fn(),
    updateSignalingState: vi.fn()
  }
}

describe('leaveRoom service workflow', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns early when not in a room or leave already in progress', () => {
    const adapterNoRoom = createLeaveAdapter()
    adapterNoRoom.roomId = null
    expect(executeLeaveRoomWorkflowWithAdapter(adapterNoRoom)).toBe(false)

    const adapterLeaving = createLeaveAdapter()
    adapterLeaving.isLeaving = true
    expect(executeLeaveRoomWorkflowWithAdapter(adapterLeaving)).toBe(false)
  })

  it('tears down runtime and resets adapter state on successful leave', () => {
    const adapter = createLeaveAdapter()
    const peerEntry = adapter.peers.get('peer-1')!
    const mqttRef = adapter.mqtt as { disconnect: ReturnType<typeof vi.fn> }
    const channelRef = adapter.broadcastChannel as unknown as { close: ReturnType<typeof vi.fn> }

    const result = executeLeaveRoomWorkflowWithAdapter(adapter)

    expect(result).toBe(true)
    expect(adapter.stopAnnounceInterval).toHaveBeenCalledTimes(1)
    expect(adapter.stopHeartbeat).toHaveBeenCalledTimes(1)
    expect(adapter.sendLeaveSignal).toHaveBeenCalledTimes(1)
    expect((peerEntry.pc.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
    expect(mqttRef.disconnect).toHaveBeenCalledTimes(1)
    expect(channelRef.close).toHaveBeenCalledTimes(1)
    expect(adapter.mqtt).toBeNull()
    expect(adapter.broadcastChannel).toBeNull()
    expect(adapter.peers.size).toBe(0)
    expect(adapter.pendingCandidates.size).toBe(0)
    expect(adapter.peerLastSeen.size).toBe(0)
    expect(adapter.peerLastPing.size).toBe(0)
    expect(adapter.previousStats.size).toBe(0)
    expect(adapter.roomId).toBeNull()
    expect(adapter.topic).toBe('')
    expect(adapter.localStream).toBeNull()
    expect(adapter.localMuteStatus).toEqual({ micMuted: false, speakerMuted: false })
    expect(adapter.audioRoutingMode).toBe('broadcast')
    expect(adapter.audioRoutingTargetPeerId).toBeNull()
    expect(adapter.performControlStateReset).toHaveBeenCalledTimes(1)
    expect(adapter.performNetworkReconnectReset).toHaveBeenCalledTimes(1)
    expect(adapter.updateSignalingState).toHaveBeenCalledWith('idle')
    expect(adapter.isLeaving).toBe(false)
  })

  it('sends leave signal as best effort only when room exists', () => {
    const broadcast = vi.fn()

    sendBestEffortLeaveSignal({
      roomId: null,
      sessionId: 1,
      selfId: 'self-1',
      broadcast
    })
    expect(broadcast).not.toHaveBeenCalled()

    sendBestEffortLeaveSignal({
      roomId: 'room-2',
      sessionId: 2,
      selfId: 'self-2',
      broadcast
    })
    expect(broadcast).toHaveBeenCalledWith({
      v: 1,
      type: 'leave',
      from: 'self-2',
      sessionId: 2
    })
  })

  it('suppresses best-effort leave broadcast errors', () => {
    const broadcast = vi.fn(() => {
      throw new Error('write-failed')
    })

    expect(() => sendBestEffortLeaveSignal({
      roomId: 'room-3',
      sessionId: 3,
      selfId: 'self-3',
      broadcast
    })).not.toThrow()
  })

  it('resets isLeaving flag even when leave workflow throws', () => {
    const adapter = createLeaveAdapter()
    adapter.sendLeaveSignal = vi.fn(() => {
      throw new Error('send-failed')
    })

    expect(() => executeLeaveRoomWorkflowWithAdapter(adapter)).toThrow('send-failed')
    expect(adapter.isLeaving).toBe(false)
  })
})
