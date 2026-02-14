import { useCallback, useEffect, useState } from 'react'
import type { ConnectionQuality } from '@/types'
import type { PeerManager } from '../signaling'

interface NetworkStatusState {
  isOnline: boolean
  isReconnecting: boolean
  reconnectAttempts: number
}

interface UseRoomConnectionMonitoringOptions {
  statsIntervalMs?: number
  networkIntervalMs?: number
}

const DEFAULT_NETWORK_STATUS: NetworkStatusState = {
  isOnline: true,
  isReconnecting: false,
  reconnectAttempts: 0
}

export function useRoomConnectionMonitoring(
  p2pManager?: PeerManager,
  options: UseRoomConnectionMonitoringOptions = {}
) {
  const {
    statsIntervalMs = 2000,
    networkIntervalMs = 1000
  } = options

  const [connectionStats, setConnectionStats] = useState<Map<string, ConnectionQuality>>(new Map())
  const [networkStatus, setNetworkStatus] = useState<NetworkStatusState>(DEFAULT_NETWORK_STATUS)

  useEffect(() => {
    if (!p2pManager) {
      setConnectionStats(new Map())
      return
    }

    const updateStats = async () => {
      const stats = await p2pManager.getConnectionStats()
      setConnectionStats((prev) => {
        if (prev.size !== stats.size) return stats
        for (const [peerId, quality] of stats) {
          const prevQuality = prev.get(peerId)
          if (
            !prevQuality ||
            prevQuality.quality !== quality.quality ||
            prevQuality.rtt !== quality.rtt ||
            prevQuality.packetLoss !== quality.packetLoss ||
            prevQuality.jitter !== quality.jitter
          ) {
            return stats
          }
        }
        return prev
      })
    }

    void updateStats()
    const interval = setInterval(() => {
      void updateStats()
    }, statsIntervalMs)

    return () => clearInterval(interval)
  }, [p2pManager, statsIntervalMs])

  useEffect(() => {
    if (!p2pManager) {
      setNetworkStatus(DEFAULT_NETWORK_STATUS)
      return
    }

    p2pManager.setOnNetworkStatusChange((isOnline) => {
      const status = p2pManager.getNetworkStatus()
      setNetworkStatus({
        isOnline,
        isReconnecting: status.wasInRoomWhenOffline && !isOnline,
        reconnectAttempts: status.reconnectAttempts
      })
    })

    const statusInterval = setInterval(() => {
      const status = p2pManager.getNetworkStatus()
      setNetworkStatus((prev) => {
        const nextState: NetworkStatusState = {
          isOnline: status.isOnline,
          isReconnecting: status.wasInRoomWhenOffline && status.reconnectAttempts > 0,
          reconnectAttempts: status.reconnectAttempts
        }

        if (
          prev.isOnline !== nextState.isOnline ||
          prev.isReconnecting !== nextState.isReconnecting ||
          prev.reconnectAttempts !== nextState.reconnectAttempts
        ) {
          return nextState
        }

        return prev
      })
    }, networkIntervalMs)

    return () => {
      clearInterval(statusInterval)
      p2pManager.setOnNetworkStatusChange(() => { })
    }
  }, [p2pManager, networkIntervalMs])

  const handleManualReconnect = useCallback(async () => {
    if (p2pManager) {
      await p2pManager.manualReconnect()
    }
  }, [p2pManager])

  return {
    connectionStats,
    networkStatus,
    handleManualReconnect
  }
}
