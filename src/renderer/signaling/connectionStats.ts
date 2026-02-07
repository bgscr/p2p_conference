/**
 * Connection Quality Statistics Calculator
 * Extracted from SimplePeerManager for testability
 */

import type { ConnectionQuality } from '@/types'

export interface PreviousStats {
  packetsReceived: number
  packetsLost: number
  timestamp: number
}

/**
 * Calculate connection quality from WebRTC stats report
 * Used by SimplePeerManager.getConnectionStats() and tests
 */
export function calculateConnectionStats(
  peerId: string,
  connectionState: RTCPeerConnectionState,
  rtcStats: { forEach: (cb: (stat: any) => void) => void },
  previousStats: PreviousStats | null,
  currentTimestamp: number
): { quality: ConnectionQuality; newPreviousStats: PreviousStats } {

  // If connection is not yet established, return default values
  if (connectionState !== 'connected') {
    return {
      quality: {
        peerId,
        rtt: 0,
        packetLoss: 0,
        jitter: 0,
        bytesReceived: 0,
        bytesSent: 0,
        quality: 'fair',
        connectionState
      },
      newPreviousStats: previousStats || { packetsReceived: 0, packetsLost: 0, timestamp: currentTimestamp }
    }
  }

  let rtt = 0
  let packetLoss = 0
  let jitter = 0
  let bytesReceived = 0
  let bytesSent = 0
  let currentPacketsReceived = 0
  let currentPacketsLost = 0

  // First pass: find the transport to get selectedCandidatePairId
  let selectedCandidatePairId: string | null = null
  rtcStats.forEach((stat: any) => {
    if (stat.type === 'transport' && stat.selectedCandidatePairId) {
      selectedCandidatePairId = stat.selectedCandidatePairId
    }
  })

  rtcStats.forEach((stat: any) => {
    // Get round-trip time from the selected/nominated candidate-pair
    if (stat.type === 'candidate-pair') {
      // Check if this is the nominated/selected pair
      const isSelected = selectedCandidatePairId
        ? stat.id === selectedCandidatePairId
        : (stat.nominated === true || stat.state === 'succeeded')

      if (isSelected) {
        // Prefer currentRoundTripTime (instant measurement)
        if (stat.currentRoundTripTime !== undefined && stat.currentRoundTripTime > 0) {
          rtt = stat.currentRoundTripTime * 1000
        }
        // Fallback to average RTT from totalRoundTripTime / responsesReceived
        else if (stat.totalRoundTripTime !== undefined && stat.responsesReceived > 0) {
          rtt = (stat.totalRoundTripTime / stat.responsesReceived) * 1000
        }
      }
    }

    // Get packet loss and jitter from inbound-rtp stats (audio)
    if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
      currentPacketsReceived = stat.packetsReceived || 0
      currentPacketsLost = stat.packetsLost || 0
      jitter = stat.jitter ? stat.jitter * 1000 : 0
      bytesReceived = stat.bytesReceived || 0
    }

    // Get bytes sent from outbound-rtp stats
    if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
      bytesSent = stat.bytesSent || 0
    }
  })

  // Calculate delta packet loss (recent packet loss, not cumulative)
  if (previousStats && (currentTimestamp - previousStats.timestamp) > 0) {
    const deltaReceived = currentPacketsReceived - previousStats.packetsReceived
    const deltaLost = currentPacketsLost - previousStats.packetsLost
    const deltaTotal = deltaReceived + deltaLost

    if (deltaTotal > 0) {
      // Recent packet loss percentage
      packetLoss = (deltaLost / deltaTotal) * 100
    }
  } else {
    // First measurement or no previous data - use cumulative as fallback
    const totalPackets = currentPacketsReceived + currentPacketsLost
    if (totalPackets > 0) {
      packetLoss = (currentPacketsLost / totalPackets) * 100
    }
  }

  // Calculate quality score based on thresholds
  // Lower RTT, packet loss, and jitter = higher quality
  let quality: 'excellent' | 'good' | 'fair' | 'poor' = 'excellent'
  if (rtt > 300 || packetLoss > 5 || jitter > 50) {
    quality = 'poor'
  } else if (rtt > 200 || packetLoss > 2 || jitter > 30) {
    quality = 'fair'
  } else if (rtt > 100 || packetLoss > 1 || jitter > 15) {
    quality = 'good'
  }

  return {
    quality: {
      peerId,
      rtt: Math.round(rtt),
      packetLoss: Math.round(packetLoss * 100) / 100,
      jitter: Math.round(jitter * 100) / 100,
      bytesReceived,
      bytesSent,
      quality,
      connectionState
    },
    newPreviousStats: {
      packetsReceived: currentPacketsReceived,
      packetsLost: currentPacketsLost,
      timestamp: currentTimestamp
    }
  }
}
