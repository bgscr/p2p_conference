import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ModerationControlMessage, Peer } from '@/types'
import type { PeerManager } from '../signaling'

interface PendingMuteAllRequest {
  requestId: string
  requestedByPeerId: string
  requestedByName: string
}

interface RaisedHandQueueEntry {
  peerId: string
  name: string
  raisedAt: number
  isLocal: boolean
}

interface UseModerationControlsOptions {
  enabled: boolean
  peerManager: PeerManager
  localPeerId: string
  userName: string
  peers: Map<string, Peer>
  isMuted: boolean
  muteLocalForModeration: () => void
  showToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  t: (key: string, params?: Record<string, string | number>) => string
  setGlobalError: (message: string | null) => void
}

interface UseModerationControlsResult {
  roomLocked: boolean
  roomLockOwnerName: string | null
  raisedHandQueue: RaisedHandQueueEntry[]
  isHandRaised: boolean
  pendingMuteAllRequest: PendingMuteAllRequest | null
  resetModerationState: () => void
  handleToggleRoomLock: () => void
  handleRequestMuteAll: () => void
  handleToggleHandRaise: () => void
  handleRespondMuteAllRequest: (requestId: string, accepted: boolean) => void
}

export function useModerationControls({
  enabled,
  peerManager,
  localPeerId,
  userName,
  peers,
  isMuted,
  muteLocalForModeration,
  showToast,
  t,
  setGlobalError
}: UseModerationControlsOptions): UseModerationControlsResult {
  const [roomLocked, setRoomLocked] = useState(false)
  const [roomLockOwnerPeerId, setRoomLockOwnerPeerId] = useState<string | null>(null)
  const [raisedHands, setRaisedHands] = useState<Map<string, number>>(new Map())
  const [isHandRaised, setIsHandRaised] = useState(false)
  const [pendingMuteAllRequest, setPendingMuteAllRequest] = useState<PendingMuteAllRequest | null>(null)

  const resetModerationState = useCallback(() => {
    setRoomLocked(false)
    setRoomLockOwnerPeerId(null)
    setRaisedHands(new Map())
    setIsHandRaised(false)
    setPendingMuteAllRequest(null)
  }, [])

  const roomLockOwnerName = useMemo(() => {
    if (!roomLockOwnerPeerId) {
      return null
    }
    if (roomLockOwnerPeerId === localPeerId) {
      return userName || t('room.you')
    }
    return peers.get(roomLockOwnerPeerId)?.name || null
  }, [localPeerId, peers, roomLockOwnerPeerId, t, userName])

  const raisedHandQueue = useMemo(() => {
    return Array.from(raisedHands.entries())
      .map(([peerId, raisedAt]) => ({
        peerId,
        raisedAt,
        isLocal: peerId === localPeerId,
        name: peerId === localPeerId
          ? `${userName || t('room.you')} (${t('room.you')})`
          : peers.get(peerId)?.name || peerId
      }))
      .sort((a, b) => a.raisedAt - b.raisedAt)
  }, [localPeerId, peers, raisedHands, t, userName])

  useEffect(() => {
    if (!enabled) {
      peerManager.setOnModerationControl(null)
      resetModerationState()
      return
    }

    const snapshot = peerManager.getModerationState()
    setRoomLocked(snapshot.roomLocked)
    setRoomLockOwnerPeerId(snapshot.roomLockOwnerPeerId)
    setIsHandRaised(snapshot.localHandRaised)
    setRaisedHands(new Map(snapshot.raisedHands.map((item) => [item.peerId, item.raisedAt])))

    const handleModerationControl = (peerId: string, message: ModerationControlMessage) => {
      switch (message.type) {
        case 'mod_room_lock':
          setRoomLocked(message.locked)
          setRoomLockOwnerPeerId(message.locked ? message.lockedByPeerId : null)
          break
        case 'mod_room_locked_notice':
          setRoomLocked(true)
          setRoomLockOwnerPeerId(message.lockedByPeerId)
          setGlobalError(t('moderation.roomLockedError'))
          showToast(t('moderation.roomLockedError'), 'warning')
          break
        case 'mod_mute_all_request':
          if (peerId === localPeerId) {
            break
          }
          setPendingMuteAllRequest({
            requestId: message.requestId,
            requestedByPeerId: message.requestedByPeerId,
            requestedByName: message.requestedByName
          })
          break
        case 'mod_mute_all_response':
          if (peerId === localPeerId) {
            break
          }
          showToast(
            message.accepted
              ? t('moderation.muteAllAccepted')
              : t('moderation.muteAllDeclined'),
            message.accepted ? 'success' : 'info'
          )
          break
        case 'mod_hand_raise':
          setRaisedHands(prev => {
            const updated = new Map(prev)
            if (message.raised) {
              updated.set(message.peerId, message.ts)
            } else {
              updated.delete(message.peerId)
            }
            return updated
          })
          if (message.peerId === localPeerId) {
            setIsHandRaised(message.raised)
          }
          break
      }
    }

    peerManager.setOnModerationControl(handleModerationControl)
    return () => {
      peerManager.setOnModerationControl(null)
    }
  }, [enabled, localPeerId, peerManager, resetModerationState, setGlobalError, showToast, t])

  useEffect(() => {
    setRaisedHands(prev => {
      const validPeerIds = new Set(peers.keys())
      validPeerIds.add(localPeerId)
      let changed = false
      const updated = new Map(prev)
      prev.forEach((_raisedAt, peerId) => {
        if (!validPeerIds.has(peerId)) {
          updated.delete(peerId)
          changed = true
        }
      })
      return changed ? updated : prev
    })
  }, [localPeerId, peers])

  const handleToggleRoomLock = useCallback(() => {
    if (!enabled) {
      return
    }

    const nextLocked = !roomLocked
    const ok = peerManager.setRoomLocked(nextLocked)
    if (!ok) {
      showToast(t('moderation.lockActionFailed'), 'error')
      return
    }

    showToast(nextLocked ? t('moderation.roomLocked') : t('moderation.roomUnlocked'), 'info')
  }, [enabled, peerManager, roomLocked, showToast, t])

  const handleRequestMuteAll = useCallback(() => {
    if (!enabled) {
      return
    }

    const requestId = peerManager.requestMuteAll()
    if (!requestId) {
      showToast(t('moderation.muteAllFailed'), 'warning')
      return
    }

    showToast(t('moderation.muteAllRequested'), 'success')
  }, [enabled, peerManager, showToast, t])

  const handleToggleHandRaise = useCallback(() => {
    if (!enabled) {
      return
    }

    const nextRaised = !isHandRaised
    const ok = peerManager.setHandRaised(nextRaised)
    if (!ok) {
      showToast(t('moderation.handRaiseFailed'), 'error')
      return
    }

    setIsHandRaised(nextRaised)
    showToast(nextRaised ? t('moderation.handRaised') : t('moderation.handLowered'), 'info')
  }, [enabled, isHandRaised, peerManager, showToast, t])

  const handleRespondMuteAllRequest = useCallback((requestId: string, accepted: boolean) => {
    if (!pendingMuteAllRequest) {
      return
    }

    peerManager.respondMuteAllRequest(pendingMuteAllRequest.requestedByPeerId, requestId, accepted)

    if (accepted && !isMuted) {
      muteLocalForModeration()
    }

    setPendingMuteAllRequest(null)
    showToast(accepted ? t('moderation.youMuted') : t('moderation.muteAllDeclined'), accepted ? 'warning' : 'info')
  }, [isMuted, muteLocalForModeration, peerManager, pendingMuteAllRequest, showToast, t])

  return {
    roomLocked,
    roomLockOwnerName,
    raisedHandQueue,
    isHandRaised,
    pendingMuteAllRequest,
    resetModerationState,
    handleToggleRoomLock,
    handleRequestMuteAll,
    handleToggleHandRaise,
    handleRespondMuteAllRequest
  }
}
