/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ModerationControlMessage, ModerationState, Peer } from '@/types'
import { useModerationControls } from '../renderer/hooks/useModerationControls'

type ModerationHandler = ((peerId: string, message: ModerationControlMessage) => void) | null

function createPeer(id: string, name: string): Peer {
  return {
    id,
    name,
    isMuted: false,
    isVideoMuted: false,
    isSpeakerMuted: false,
    isScreenSharing: false,
    audioLevel: 0,
    connectionState: 'connected'
  }
}

function createPeerManager(snapshot?: Partial<ModerationState>) {
  let moderationHandler: ModerationHandler = null
  const baseSnapshot: ModerationState = {
    roomLocked: false,
    roomLockOwnerPeerId: null,
    localHandRaised: false,
    raisedHands: []
  }

  const peerManager = {
    setOnModerationControl: vi.fn((handler: ModerationHandler) => {
      moderationHandler = handler
    }),
    getModerationState: vi.fn(() => ({
      ...baseSnapshot,
      ...snapshot
    })),
    setRoomLocked: vi.fn(() => true),
    requestMuteAll: vi.fn(() => 'request-1'),
    setHandRaised: vi.fn(() => true),
    respondMuteAllRequest: vi.fn()
  }

  return {
    peerManager,
    emit(peerId: string, message: ModerationControlMessage) {
      moderationHandler?.(peerId, message)
    },
    getHandler() {
      return moderationHandler
    }
  }
}

function createTranslator() {
  return (key: string) => {
    if (key === 'room.you') return 'You'
    return key
  }
}

describe('useModerationControls', () => {
  it('resets and no-ops when moderation is disabled', () => {
    const manager = createPeerManager()
    const showToast = vi.fn()
    const muteLocalForModeration = vi.fn()
    const t = createTranslator()
    const peers = new Map([['remote-peer', createPeer('remote-peer', 'Remote')]])
    const options = {
      enabled: false,
      peerManager: manager.peerManager as any,
      localPeerId: 'local-peer',
      userName: 'Local',
      peers,
      isMuted: false,
      muteLocalForModeration,
      showToast,
      t,
      setGlobalError: vi.fn()
    }

    const { result } = renderHook((props: any) => useModerationControls(props), {
      initialProps: options
    })

    expect(manager.peerManager.setOnModerationControl).toHaveBeenCalledWith(null)
    expect(result.current.roomLocked).toBe(false)
    expect(result.current.pendingMuteAllRequest).toBeNull()
    expect(result.current.raisedHandQueue).toEqual([])

    act(() => {
      result.current.handleToggleRoomLock()
      result.current.handleRequestMuteAll()
      result.current.handleToggleHandRaise()
      result.current.handleRespondMuteAllRequest('request-1', true)
    })

    expect(manager.peerManager.setRoomLocked).not.toHaveBeenCalled()
    expect(manager.peerManager.requestMuteAll).not.toHaveBeenCalled()
    expect(manager.peerManager.setHandRaised).not.toHaveBeenCalled()
    expect(manager.peerManager.respondMuteAllRequest).not.toHaveBeenCalled()
    expect(muteLocalForModeration).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })

  it('hydrates from snapshot, resolves owner name, and prunes stale raised hands', async () => {
    const manager = createPeerManager({
      roomLocked: true,
      roomLockOwnerPeerId: 'local-peer',
      localHandRaised: true,
      raisedHands: [
        { peerId: 'local-peer', raisedAt: 10 },
        { peerId: 'remote-peer', raisedAt: 30 },
        { peerId: 'stale-peer', raisedAt: 20 }
      ]
    })
    const peers = new Map([['remote-peer', createPeer('remote-peer', 'Remote User')]])
    const t = createTranslator()
    const options = {
      enabled: true,
      peerManager: manager.peerManager as any,
      localPeerId: 'local-peer',
      userName: 'Local User',
      peers,
      isMuted: false,
      muteLocalForModeration: vi.fn(),
      showToast: vi.fn(),
      t,
      setGlobalError: vi.fn()
    }

    const { result } = renderHook((props: any) => useModerationControls(props), {
      initialProps: options
    })

    await waitFor(() => {
      expect(result.current.raisedHandQueue).toHaveLength(2)
    })

    expect(result.current.roomLocked).toBe(true)
    expect(result.current.roomLockOwnerName).toBe('Local User')
    expect(result.current.isHandRaised).toBe(true)
    expect(result.current.raisedHandQueue[0]?.name).toBe('Local User (You)')
    expect(result.current.raisedHandQueue[1]?.name).toBe('Remote User')
  })

  it('handles moderation control events and toast/error branches', async () => {
    const manager = createPeerManager()
    const showToast = vi.fn()
    const setGlobalError = vi.fn()
    const t = createTranslator()
    const peers = new Map()
    const options = {
      enabled: true,
      peerManager: manager.peerManager as any,
      localPeerId: 'local-peer',
      userName: '',
      peers,
      isMuted: false,
      muteLocalForModeration: vi.fn(),
      showToast,
      t,
      setGlobalError
    }

    const { result } = renderHook((props: any) => useModerationControls(props), {
      initialProps: options
    })

    expect(manager.getHandler()).toBeTypeOf('function')

    act(() => {
      manager.emit('remote-peer', {
        type: 'mod_room_locked_notice',
        lockedByPeerId: 'remote-peer',
        ts: 1
      })
    })
    expect(result.current.roomLocked).toBe(true)
    expect(setGlobalError).toHaveBeenCalledWith('moderation.roomLockedError')
    expect(showToast).toHaveBeenCalledWith('moderation.roomLockedError', 'warning')

    act(() => {
      manager.emit('local-peer', {
        type: 'mod_mute_all_request',
        requestId: 'local-request',
        requestedByPeerId: 'local-peer',
        requestedByName: 'Local',
        ts: 2
      })
    })
    expect(result.current.pendingMuteAllRequest).toBeNull()

    act(() => {
      manager.emit('remote-peer', {
        type: 'mod_mute_all_request',
        requestId: 'remote-request',
        requestedByPeerId: 'remote-peer',
        requestedByName: 'Remote',
        ts: 3
      })
    })
    expect(result.current.pendingMuteAllRequest?.requestId).toBe('remote-request')

    act(() => {
      manager.emit('local-peer', {
        type: 'mod_mute_all_response',
        requestId: 'resp-local',
        accepted: true,
        ts: 4
      })
      manager.emit('remote-peer', {
        type: 'mod_mute_all_response',
        requestId: 'resp-accept',
        accepted: true,
        ts: 5
      })
      manager.emit('remote-peer', {
        type: 'mod_mute_all_response',
        requestId: 'resp-decline',
        accepted: false,
        ts: 6
      })
    })
    expect(showToast).toHaveBeenCalledWith('moderation.muteAllAccepted', 'success')
    expect(showToast).toHaveBeenCalledWith('moderation.muteAllDeclined', 'info')

    act(() => {
      manager.emit('local-peer', {
        type: 'mod_hand_raise',
        peerId: 'local-peer',
        raised: true,
        ts: 7
      })
    })
    expect(result.current.isHandRaised).toBe(true)

    act(() => {
      manager.emit('local-peer', {
        type: 'mod_hand_raise',
        peerId: 'local-peer',
        raised: false,
        ts: 8
      })
    })
    expect(result.current.isHandRaised).toBe(false)
  })

  it('covers lock, mute-all, hand-raise actions including failure branches and cleanup', () => {
    const manager = createPeerManager()
    const showToast = vi.fn()
    const muteLocalForModeration = vi.fn()
    manager.peerManager.setRoomLocked
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
    manager.peerManager.requestMuteAll
      .mockReturnValueOnce('')
      .mockReturnValueOnce('request-2')
    manager.peerManager.setHandRaised
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
    const t = createTranslator()
    const peers = new Map([['remote-peer', createPeer('remote-peer', 'Remote')]])
    const options = {
      enabled: true,
      peerManager: manager.peerManager as any,
      localPeerId: 'local-peer',
      userName: 'Local',
      peers,
      muteLocalForModeration,
      showToast,
      t,
      setGlobalError: vi.fn()
    }

    const { result, unmount, rerender } = renderHook((props: { isMuted: boolean }) =>
      useModerationControls({
        ...options,
        isMuted: props.isMuted,
      }), {
      initialProps: { isMuted: false }
    })

    act(() => {
      result.current.handleToggleRoomLock()
      result.current.handleToggleRoomLock()
      manager.emit('remote-peer', {
        type: 'mod_room_lock',
        locked: true,
        lockedByPeerId: 'remote-peer',
        ts: 10
      })
    })
    act(() => {
      result.current.handleToggleRoomLock()
    })
    expect(showToast).toHaveBeenCalledWith('moderation.lockActionFailed', 'error')
    expect(showToast).toHaveBeenCalledWith('moderation.roomLocked', 'info')
    expect(showToast).toHaveBeenCalledWith('moderation.roomUnlocked', 'info')

    act(() => {
      result.current.handleRequestMuteAll()
      result.current.handleRequestMuteAll()
    })
    expect(showToast).toHaveBeenCalledWith('moderation.muteAllFailed', 'warning')
    expect(showToast).toHaveBeenCalledWith('moderation.muteAllRequested', 'success')

    act(() => {
      result.current.handleToggleHandRaise()
    })
    act(() => {
      result.current.handleToggleHandRaise()
    })
    act(() => {
      result.current.handleToggleHandRaise()
    })
    expect(showToast).toHaveBeenCalledWith('moderation.handRaiseFailed', 'error')
    expect(showToast).toHaveBeenCalledWith('moderation.handRaised', 'info')
    expect(showToast).toHaveBeenCalledWith('moderation.handLowered', 'info')

    act(() => {
      result.current.handleRespondMuteAllRequest('missing-request', true)
      manager.emit('remote-peer', {
        type: 'mod_mute_all_request',
        requestId: 'pending-1',
        requestedByPeerId: 'remote-peer',
        requestedByName: 'Remote',
        ts: 11
      })
    })
    act(() => {
      result.current.handleRespondMuteAllRequest('pending-1', true)
    })
    expect(manager.peerManager.respondMuteAllRequest).toHaveBeenCalledWith('remote-peer', 'pending-1', true)
    expect(muteLocalForModeration).toHaveBeenCalledTimes(1)
    expect(result.current.pendingMuteAllRequest).toBeNull()

    rerender({ isMuted: true })
    act(() => {
      manager.emit('remote-peer', {
        type: 'mod_mute_all_request',
        requestId: 'pending-2',
        requestedByPeerId: 'remote-peer',
        requestedByName: 'Remote',
        ts: 12
      })
    })
    act(() => {
      result.current.handleRespondMuteAllRequest('pending-2', false)
    })
    expect(manager.peerManager.respondMuteAllRequest).toHaveBeenCalledWith('remote-peer', 'pending-2', false)
    expect(muteLocalForModeration).toHaveBeenCalledTimes(1)

    unmount()
    expect(manager.peerManager.setOnModerationControl).toHaveBeenLastCalledWith(null)
  })
})
