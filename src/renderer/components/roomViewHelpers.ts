import type { ConnectionState } from '@/types'

interface TranslateFn {
  (key: string, params?: Record<string, string | number>): string
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function getStatusText(
  connectionState: ConnectionState,
  participantCount: number,
  t: TranslateFn
): string {
  switch (connectionState) {
    case 'idle': return t('room.notConnected')
    case 'signaling': return t('room.searchingParticipants')
    case 'connecting': return t('room.connecting')
    case 'connected': return t('room.participantsConnected', { count: participantCount })
    case 'failed': return t('room.connectionFailed')
    default: return ''
  }
}
