import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRoomConnectionMonitoring } from '../renderer/hooks/useRoomConnectionMonitoring'
import type { PeerManager } from '../renderer/signaling'
import type { ConnectionQuality } from '@/types'

function createQuality(quality: ConnectionQuality['quality']): ConnectionQuality {
  return {
    peerId: 'peer-1',
    rtt: 10,
    packetLoss: 0,
    jitter: 1,
    bytesReceived: 100,
    bytesSent: 200,
    quality,
    connectionState: 'connected'
  }
}

describe('useRoomConnectionMonitoring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('returns defaults when p2p manager is not provided', async () => {
    const { result } = renderHook(() => useRoomConnectionMonitoring(undefined))

    expect(result.current.connectionStats.size).toBe(0)
    expect(result.current.networkStatus).toEqual({
      isOnline: true,
      isReconnecting: false,
      reconnectAttempts: 0
    })

    await act(async () => {
      await result.current.handleManualReconnect()
    })
  })

  it('polls connection stats and triggers manual reconnect', async () => {
    const statsMapA = new Map([['peer-1', createQuality('good')]])
    const statsMapB = new Map([['peer-1', createQuality('excellent')]])
    const getConnectionStats = vi
      .fn()
      .mockResolvedValueOnce(statsMapA)
      .mockResolvedValue(statsMapB)
    const manualReconnect = vi.fn().mockResolvedValue(true)

    const manager = {
      getConnectionStats,
      manualReconnect,
      setOnNetworkStatusChange: vi.fn(),
      getNetworkStatus: vi.fn().mockReturnValue({
        isOnline: true,
        wasInRoomWhenOffline: false,
        reconnectAttempts: 0
      })
    } as unknown as PeerManager

    const { result } = renderHook(() =>
      useRoomConnectionMonitoring(manager, {
        statsIntervalMs: 25,
        networkIntervalMs: 5000
      })
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.connectionStats.get('peer-1')?.quality).toBe('good')

    await act(async () => {
      vi.advanceTimersByTime(30)
      await Promise.resolve()
    })
    expect(result.current.connectionStats.get('peer-1')?.quality).toBe('excellent')

    await act(async () => {
      await result.current.handleManualReconnect()
    })
    expect(manualReconnect).toHaveBeenCalledTimes(1)
  })

  it('updates network state from callback and polling, then clears callback on unmount', async () => {
    let networkStatus = {
      isOnline: true,
      wasInRoomWhenOffline: false,
      reconnectAttempts: 0
    }

    let callback: ((isOnline: boolean) => void) | undefined
    const setOnNetworkStatusChange = vi.fn((cb: (isOnline: boolean) => void) => {
      callback = cb
    })

    const manager = {
      getConnectionStats: vi.fn().mockResolvedValue(new Map()),
      manualReconnect: vi.fn().mockResolvedValue(true),
      setOnNetworkStatusChange,
      getNetworkStatus: vi.fn(() => networkStatus)
    } as unknown as PeerManager

    const { result, unmount } = renderHook(() =>
      useRoomConnectionMonitoring(manager, {
        statsIntervalMs: 5000,
        networkIntervalMs: 25
      })
    )

    act(() => {
      networkStatus = {
        isOnline: false,
        wasInRoomWhenOffline: true,
        reconnectAttempts: 1
      }
      callback?.(false)
    })

    expect(result.current.networkStatus).toEqual({
      isOnline: false,
      isReconnecting: true,
      reconnectAttempts: 1
    })

    await act(async () => {
      networkStatus = {
        isOnline: true,
        wasInRoomWhenOffline: true,
        reconnectAttempts: 2
      }
      vi.advanceTimersByTime(30)
    })

    expect(result.current.networkStatus).toEqual({
      isOnline: true,
      isReconnecting: true,
      reconnectAttempts: 2
    })

    unmount()
    expect(setOnNetworkStatusChange).toHaveBeenCalled()
  })
})
