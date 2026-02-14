import { describe, expect, it, vi } from 'vitest'
import {
  applyModerationControlMessage,
  applyRemoteMicControlMessage,
  buildModerationState,
  createControlState,
  getControlDebugInfo,
  handleModerationPeerDisconnect,
  handleRemoteMicPeerDisconnect,
  isModerationControlMessage,
  isRemoteMicControlMessage,
  parseRoomLockSignalPayload,
  parseRoomLockedSignalPayload,
  resetControlState
} from '../renderer/signaling/services/controlState'

describe('controlState services', () => {
  it('validates remote mic and moderation control message guards', () => {
    expect(isRemoteMicControlMessage(null)).toBe(false)
    expect(isRemoteMicControlMessage({})).toBe(false)
    expect(isRemoteMicControlMessage({ type: 'rm_unknown', requestId: '1' })).toBe(false)
    expect(isRemoteMicControlMessage({ type: 'rm_request', requestId: '1' })).toBe(true)
    expect(isRemoteMicControlMessage({ type: 'rm_response', requestId: '2', accepted: true })).toBe(true)

    expect(isModerationControlMessage(null)).toBe(false)
    expect(isModerationControlMessage({ type: 'mod_room_lock', locked: true })).toBe(false)
    expect(isModerationControlMessage({ type: 'mod_room_lock', locked: true, lockedByPeerId: 'host' })).toBe(true)
    expect(isModerationControlMessage({ type: 'mod_room_locked_notice', lockedByPeerId: 'host' })).toBe(true)
    expect(isModerationControlMessage({
      type: 'mod_mute_all_request',
      requestId: 'r1',
      requestedByPeerId: 'host',
      requestedByName: 'Host'
    })).toBe(true)
    expect(isModerationControlMessage({ type: 'mod_mute_all_response', requestId: 'r2', accepted: false })).toBe(true)
    expect(isModerationControlMessage({ type: 'mod_hand_raise', peerId: 'p1', raised: true })).toBe(true)
    expect(isModerationControlMessage({ type: 'mod_unknown' })).toBe(false)
  })

  it('applies remote mic control state transitions and callbacks', () => {
    const state = createControlState()
    const onRemoteMicControl = vi.fn()
    const resetAudioRoutingToBroadcast = vi.fn()

    applyRemoteMicControlMessage(state, 'peer-a', {
      type: 'rm_request',
      requestId: 'req-1',
      sourcePeerId: 'peer-a',
      sourceName: 'Peer A',
      targetPeerId: 'local',
      ts: 1
    }, { onRemoteMicControl, resetAudioRoutingToBroadcast })
    expect(state.pendingRemoteMicRequests.get('req-1')).toBe('peer-a')

    state.pendingOutgoingRemoteMicRequestId = 'req-2'
    applyRemoteMicControlMessage(state, 'peer-a', {
      type: 'rm_response',
      requestId: 'req-2',
      accepted: true,
      ts: 2
    }, { onRemoteMicControl, resetAudioRoutingToBroadcast })
    expect(state.pendingOutgoingRemoteMicRequestId).toBeNull()
    expect(state.activeRemoteMicTargetPeerId).toBe('peer-a')
    expect(state.activeRemoteMicRequestId).toBe('req-2')

    applyRemoteMicControlMessage(state, 'peer-a', {
      type: 'rm_response',
      requestId: 'req-2',
      accepted: false,
      reason: 'rejected',
      ts: 3
    }, { onRemoteMicControl, resetAudioRoutingToBroadcast })
    expect(state.activeRemoteMicTargetPeerId).toBeNull()
    expect(state.activeRemoteMicRequestId).toBeNull()

    applyRemoteMicControlMessage(state, 'peer-a', {
      type: 'rm_start',
      requestId: 'req-3',
      ts: 4
    }, { onRemoteMicControl, resetAudioRoutingToBroadcast })
    expect(state.activeRemoteMicSourcePeerId).toBe('peer-a')
    expect(state.activeRemoteMicRequestId).toBe('req-3')

    state.activeRemoteMicTargetPeerId = 'peer-a'
    state.pendingRemoteMicRequests.set('req-3', 'peer-a')
    applyRemoteMicControlMessage(state, 'peer-a', {
      type: 'rm_stop',
      requestId: 'req-3',
      reason: 'stopped-by-source',
      ts: 5
    }, { onRemoteMicControl, resetAudioRoutingToBroadcast })
    expect(state.pendingRemoteMicRequests.has('req-3')).toBe(false)
    expect(state.activeRemoteMicTargetPeerId).toBeNull()
    expect(state.activeRemoteMicSourcePeerId).toBeNull()
    expect(state.activeRemoteMicRequestId).toBeNull()
    expect(resetAudioRoutingToBroadcast).toHaveBeenCalledTimes(1)

    applyRemoteMicControlMessage(state, 'peer-a', {
      type: 'rm_heartbeat',
      requestId: 'req-3',
      ts: 6
    }, { onRemoteMicControl, resetAudioRoutingToBroadcast })
    expect(onRemoteMicControl).toHaveBeenCalledTimes(6)
  })

  it('applies moderation control state transitions and callbacks', () => {
    const state = createControlState()
    const onModerationControl = vi.fn()

    applyModerationControlMessage(state, 'host', {
      type: 'mod_room_lock',
      locked: true,
      lockedByPeerId: 'host',
      ts: 1
    }, { onModerationControl })
    expect(state.roomLocked).toBe(true)
    expect(state.roomLockOwnerPeerId).toBe('host')

    applyModerationControlMessage(state, 'host', {
      type: 'mod_room_lock',
      locked: false,
      lockedByPeerId: 'host',
      ts: 2
    }, { onModerationControl })
    expect(state.roomLocked).toBe(false)
    expect(state.roomLockOwnerPeerId).toBeNull()

    applyModerationControlMessage(state, 'host', {
      type: 'mod_room_locked_notice',
      lockedByPeerId: 'host',
      ts: 3
    }, { onModerationControl })
    expect(state.roomLocked).toBe(true)
    expect(state.roomLockOwnerPeerId).toBe('host')

    applyModerationControlMessage(state, 'host', {
      type: 'mod_mute_all_request',
      requestId: 'mute-1',
      requestedByPeerId: 'host',
      requestedByName: 'Host',
      ts: 4
    }, { onModerationControl })
    expect(state.pendingMuteAllRequests.get('mute-1')).toBe('host')

    applyModerationControlMessage(state, 'host', {
      type: 'mod_mute_all_response',
      requestId: 'mute-1',
      accepted: true,
      ts: 5
    }, { onModerationControl })

    applyModerationControlMessage(state, 'peer-a', {
      type: 'mod_hand_raise',
      peerId: 'peer-a',
      raised: true,
      ts: 6
    }, { onModerationControl })
    expect(state.raisedHands.get('peer-a')).toBe(6)

    applyModerationControlMessage(state, 'peer-a', {
      type: 'mod_hand_raise',
      peerId: 'peer-a',
      raised: false,
      ts: 7
    }, { onModerationControl })
    expect(state.raisedHands.has('peer-a')).toBe(false)
    expect(onModerationControl).toHaveBeenCalledTimes(7)
  })

  it('parses room lock payloads and fallback timestamp paths', () => {
    expect(parseRoomLockSignalPayload(null)).toBeNull()
    expect(parseRoomLockSignalPayload({ type: 'mod_room_locked_notice', lockedByPeerId: 'host', ts: 1 })).toBeNull()

    const roomLock = parseRoomLockSignalPayload({
      type: 'mod_room_lock',
      locked: true,
      lockedByPeerId: 'host',
      ts: 2
    })
    expect(roomLock?.type).toBe('mod_room_lock')

    expect(parseRoomLockedSignalPayload(null)).toBeNull()
    expect(parseRoomLockedSignalPayload({})).toBeNull()

    const now = vi.fn(() => 1234)
    const withFallbackTs = parseRoomLockedSignalPayload({ lockedByPeerId: 'host' }, now)
    const withProvidedTs = parseRoomLockedSignalPayload({ lockedByPeerId: 'host', ts: 4567 }, now)
    expect(withFallbackTs).toEqual({
      type: 'mod_room_locked_notice',
      lockedByPeerId: 'host',
      ts: 1234
    })
    expect(withProvidedTs?.ts).toBe(4567)
  })

  it('uses default fallback generators when disconnect handlers omit now/createRequestId', () => {
    const state = createControlState()
    const onRemoteMicControl = vi.fn()

    state.activeRemoteMicSourcePeerId = 'peer-default'
    state.activeRemoteMicRequestId = null
    handleRemoteMicPeerDisconnect(state, 'peer-default', {
      onRemoteMicControl
    })

    expect(onRemoteMicControl).toHaveBeenCalledWith('peer-default', expect.objectContaining({
      type: 'rm_stop',
      requestId: 'rm-stop-fallback',
      reason: 'peer-disconnected'
    }))

    const parsed = parseRoomLockedSignalPayload({ lockedByPeerId: 'host-default' })
    expect(parsed?.ts).toBeTypeOf('number')
  })

  it('handles remote mic peer disconnect for target, source, and pending requests', () => {
    const state = createControlState()
    const onRemoteMicControl = vi.fn()
    const resetAudioRoutingToBroadcast = vi.fn()
    const now = vi.fn(() => 999)

    state.activeRemoteMicTargetPeerId = 'peer-a'
    state.activeRemoteMicSourcePeerId = 'peer-a'
    state.activeRemoteMicRequestId = 'active-req'
    state.pendingOutgoingRemoteMicRequestId = 'active-req'
    state.pendingRemoteMicRequests.set('pending-1', 'peer-a')
    state.pendingRemoteMicRequests.set('pending-2', 'peer-b')

    handleRemoteMicPeerDisconnect(state, 'peer-a', {
      onRemoteMicControl,
      resetAudioRoutingToBroadcast,
      now
    })
    expect(state.activeRemoteMicTargetPeerId).toBeNull()
    expect(state.activeRemoteMicSourcePeerId).toBeNull()
    expect(state.activeRemoteMicRequestId).toBeNull()
    expect(state.pendingOutgoingRemoteMicRequestId).toBeNull()
    expect(state.pendingRemoteMicRequests.has('pending-1')).toBe(false)
    expect(state.pendingRemoteMicRequests.has('pending-2')).toBe(true)
    expect(resetAudioRoutingToBroadcast).toHaveBeenCalledTimes(1)
    expect(onRemoteMicControl).toHaveBeenCalledWith('peer-a', expect.objectContaining({
      type: 'rm_stop',
      requestId: 'active-req',
      reason: 'peer-disconnected',
      ts: 999
    }))

    state.activeRemoteMicSourcePeerId = 'peer-c'
    handleRemoteMicPeerDisconnect(state, 'peer-c', {
      onRemoteMicControl,
      createRequestId: () => 'generated-req',
      now
    })
    expect(onRemoteMicControl).toHaveBeenCalledWith('peer-c', expect.objectContaining({
      type: 'rm_stop',
      requestId: 'generated-req',
      reason: 'peer-disconnected'
    }))
  })

  it('handles moderation peer disconnect branches and clears lock/requests', () => {
    const state = createControlState()
    const onModerationControl = vi.fn()
    const now = vi.fn(() => 321)

    state.raisedHands.set('peer-a', 100)
    state.raisedHands.set('peer-b', 200)
    state.pendingMuteAllRequests.set('mute-1', 'peer-a')
    state.pendingMuteAllRequests.set('mute-2', 'peer-b')
    state.roomLocked = true
    state.roomLockOwnerPeerId = 'peer-a'

    handleModerationPeerDisconnect(state, 'peer-a', { onModerationControl, now })
    expect(state.raisedHands.has('peer-a')).toBe(false)
    expect(state.pendingMuteAllRequests.has('mute-1')).toBe(false)
    expect(state.pendingMuteAllRequests.has('mute-2')).toBe(true)
    expect(state.roomLocked).toBe(false)
    expect(state.roomLockOwnerPeerId).toBeNull()
    expect(onModerationControl).toHaveBeenCalledWith('peer-a', expect.objectContaining({
      type: 'mod_hand_raise',
      peerId: 'peer-a',
      raised: false,
      ts: 321
    }))
    expect(onModerationControl).toHaveBeenCalledWith('peer-a', expect.objectContaining({
      type: 'mod_room_lock',
      locked: false,
      lockedByPeerId: 'peer-a',
      ts: 321
    }))

    const before = onModerationControl.mock.calls.length
    handleModerationPeerDisconnect(state, 'peer-z', { onModerationControl, now })
    expect(onModerationControl.mock.calls.length).toBe(before)
  })

  it('builds moderation snapshot, resets state, and exposes debug info', () => {
    const state = createControlState()
    state.roomLocked = true
    state.roomLockOwnerPeerId = 'host'
    state.localHandRaised = true
    state.raisedHands.set('peer-b', 20)
    state.raisedHands.set('peer-a', 10)
    state.pendingMuteAllRequests.set('mute-1', 'peer-a')
    state.pendingRemoteMicRequests.set('rm-1', 'peer-a')
    state.pendingOutgoingRemoteMicRequestId = 'out-1'
    state.activeRemoteMicTargetPeerId = 'peer-a'
    state.activeRemoteMicSourcePeerId = 'peer-b'
    state.activeRemoteMicRequestId = 'active-1'

    const moderationState = buildModerationState(state)
    expect(moderationState.raisedHands).toEqual([
      { peerId: 'peer-a', raisedAt: 10 },
      { peerId: 'peer-b', raisedAt: 20 }
    ])

    const debugInfo = getControlDebugInfo(state)
    expect(debugInfo).toMatchObject({
      pendingRemoteMicRequests: 1,
      pendingOutgoingRemoteMicRequestId: 'out-1',
      activeRemoteMicTargetPeerId: 'peer-a',
      activeRemoteMicSourcePeerId: 'peer-b',
      activeRemoteMicRequestId: 'active-1',
      roomLocked: true,
      roomLockOwnerPeerId: 'host',
      localHandRaised: true,
      pendingMuteAllRequests: 1
    })

    resetControlState(state)
    expect(state.pendingRemoteMicRequests.size).toBe(0)
    expect(state.pendingOutgoingRemoteMicRequestId).toBeNull()
    expect(state.activeRemoteMicTargetPeerId).toBeNull()
    expect(state.activeRemoteMicSourcePeerId).toBeNull()
    expect(state.activeRemoteMicRequestId).toBeNull()
    expect(state.roomLocked).toBe(false)
    expect(state.roomLockOwnerPeerId).toBeNull()
    expect(state.localHandRaised).toBe(false)
    expect(state.raisedHands.size).toBe(0)
    expect(state.pendingMuteAllRequests.size).toBe(0)
  })
})
