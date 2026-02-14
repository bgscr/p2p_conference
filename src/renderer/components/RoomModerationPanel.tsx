interface RaisedHandEntry {
  peerId: string
  name: string
  raisedAt: number
  isLocal: boolean
}

interface PendingMuteAllRequest {
  requestId: string
  requestedByPeerId: string
  requestedByName: string
}

interface RoomModerationPanelProps {
  enabled: boolean
  roomLocked: boolean
  roomLockOwnerName: string | null
  raisedHands: RaisedHandEntry[]
  pendingMuteAllRequest: PendingMuteAllRequest | null
  onToggleRoomLock?: () => void
  onToggleHandRaise?: () => void
  onRespondMuteAllRequest?: (requestId: string, accepted: boolean) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

export function RoomModerationPanel({
  enabled,
  roomLocked,
  roomLockOwnerName,
  raisedHands,
  pendingMuteAllRequest,
  onToggleRoomLock,
  onToggleHandRaise,
  onRespondMuteAllRequest,
  t
}: RoomModerationPanelProps) {
  if (!enabled) {
    return null
  }

  return (
    <>
      {roomLocked && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-center justify-between gap-3" data-testid="room-locked-banner">
          <p className="text-sm text-amber-900">
            {t('moderation.roomLockedBy', { name: roomLockOwnerName || t('moderation.someone') })}
          </p>
          {onToggleRoomLock && (
            <button
              onClick={onToggleRoomLock}
              className="px-3 py-1 text-xs rounded bg-amber-700 text-white hover:bg-amber-800 transition-colors"
            >
              {t('moderation.unlockRoom')}
            </button>
          )}
        </div>
      )}

      {raisedHands.length > 0 && (
        <div className="mx-4 mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2" data-testid="raised-hands-queue">
          <div className="text-xs font-semibold tracking-wide uppercase text-indigo-700 mb-2">
            {t('moderation.handRaiseQueue')}
          </div>
          <div className="space-y-1">
            {raisedHands.map((hand) => (
              <div key={hand.peerId} className="flex items-center justify-between text-sm text-indigo-900">
                <span>{hand.name}</span>
                {hand.isLocal && onToggleHandRaise && (
                  <button
                    onClick={onToggleHandRaise}
                    className="text-xs px-2 py-0.5 rounded bg-indigo-100 hover:bg-indigo-200"
                  >
                    {t('moderation.lowerHand')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingMuteAllRequest && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200 p-5 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">{t('moderation.muteAllRequestTitle')}</h3>
            <p className="text-sm text-gray-600">
              {t('moderation.muteAllRequestPrompt', { name: pendingMuteAllRequest.requestedByName })}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => onRespondMuteAllRequest?.(pendingMuteAllRequest.requestId, false)}
                className="px-3 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {t('moderation.decline')}
              </button>
              <button
                onClick={() => onRespondMuteAllRequest?.(pendingMuteAllRequest.requestId, true)}
                className="px-3 py-2 text-sm rounded text-white bg-rose-600 hover:bg-rose-700 transition-colors"
              >
                {t('moderation.acceptAndMute')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
