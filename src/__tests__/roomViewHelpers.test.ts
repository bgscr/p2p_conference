import { describe, expect, it, vi } from 'vitest'
import { formatDuration, getStatusText } from '../renderer/components/roomViewHelpers'

describe('roomViewHelpers', () => {
  it('formats duration for minute and hour ranges', () => {
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('resolves status text for known connection states', () => {
    const t = vi.fn((key: string, params?: Record<string, string | number>) => {
      if (key === 'room.participantsConnected') {
        return `connected:${params?.count ?? 0}`
      }
      return key
    })

    expect(getStatusText('idle', 2, t)).toBe('room.notConnected')
    expect(getStatusText('signaling', 2, t)).toBe('room.searchingParticipants')
    expect(getStatusText('connecting', 2, t)).toBe('room.connecting')
    expect(getStatusText('connected', 3, t)).toBe('connected:3')
    expect(getStatusText('failed', 1, t)).toBe('room.connectionFailed')
  })

  it('returns empty text for unknown states', () => {
    const t = vi.fn((key: string) => key)
    expect(getStatusText('reconnecting' as never, 0, t)).toBe('')
  })
})
