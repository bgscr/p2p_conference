/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for connection quality statistics functionality
 * Tests the getConnectionStats method in SimplePeerManager
 */

import { describe, it, expect } from 'vitest'

// ============================================
// Mock RTCStatsReport data types
// ============================================

interface MockTransportStats {
  type: 'transport'
  id: string
  selectedCandidatePairId: string
}

interface MockCandidatePairStats {
  type: 'candidate-pair'
  id: string
  state: 'succeeded' | 'failed' | 'frozen' | 'waiting' | 'in-progress'
  nominated: boolean
  currentRoundTripTime?: number
  totalRoundTripTime?: number
  responsesReceived?: number
}

interface MockInboundRtpStats {
  type: 'inbound-rtp'
  kind: 'audio' | 'video'
  packetsReceived: number
  packetsLost: number
  jitter: number
  bytesReceived: number
}

interface MockOutboundRtpStats {
  type: 'outbound-rtp'
  kind: 'audio' | 'video'
  bytesSent: number
}

type MockStat = MockTransportStats | MockCandidatePairStats | MockInboundRtpStats | MockOutboundRtpStats

// ============================================
// ConnectionStatsCalculator - Extracted logic for testing
// ============================================

interface ConnectionQuality {
  peerId: string
  rtt: number
  packetLoss: number
  jitter: number
  bytesReceived: number
  bytesSent: number
  quality: 'excellent' | 'good' | 'fair' | 'poor'
  connectionState: string
}

interface PreviousStats {
  packetsReceived: number
  packetsLost: number
  timestamp: number
}

/**
 * Calculate connection quality from WebRTC stats
 * This is the logic extracted from SimplePeerManager for testing
 */
function calculateConnectionStats(
  peerId: string,
  connectionState: string,
  stats: MockStat[],
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
  stats.forEach((stat) => {
    if (stat.type === 'transport' && 'selectedCandidatePairId' in stat) {
      selectedCandidatePairId = stat.selectedCandidatePairId
    }
  })

  stats.forEach((stat) => {
    // Get round-trip time from the selected/nominated candidate-pair
    if (stat.type === 'candidate-pair') {
      const candidateStat = stat as MockCandidatePairStats
      // Check if this is the nominated/selected pair
      const isSelected = selectedCandidatePairId 
        ? stat.id === selectedCandidatePairId
        : (candidateStat.nominated === true || candidateStat.state === 'succeeded')
      
      if (isSelected) {
        // Prefer currentRoundTripTime (instant measurement)
        if (candidateStat.currentRoundTripTime !== undefined && candidateStat.currentRoundTripTime > 0) {
          rtt = candidateStat.currentRoundTripTime * 1000
        } 
        // Fallback to average RTT from totalRoundTripTime / responsesReceived
        else if (candidateStat.totalRoundTripTime !== undefined && candidateStat.responsesReceived && candidateStat.responsesReceived > 0) {
          rtt = (candidateStat.totalRoundTripTime / candidateStat.responsesReceived) * 1000
        }
      }
    }

    // Get packet loss and jitter from inbound-rtp stats (audio)
    if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
      const rtpStat = stat as MockInboundRtpStats
      currentPacketsReceived = rtpStat.packetsReceived || 0
      currentPacketsLost = rtpStat.packetsLost || 0
      jitter = rtpStat.jitter ? rtpStat.jitter * 1000 : 0
      bytesReceived = rtpStat.bytesReceived || 0
    }

    // Get bytes sent from outbound-rtp stats
    if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
      bytesSent = (stat as MockOutboundRtpStats).bytesSent || 0
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

// ============================================
// Test Suites
// ============================================

describe('Connection Stats Calculator', () => {
  
  describe('RTT (Round Trip Time) Calculation', () => {
    
    it('should extract RTT from currentRoundTripTime when available', () => {
      const stats: MockStat[] = [
        {
          type: 'transport',
          id: 'transport-1',
          selectedCandidatePairId: 'pair-1'
        },
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05 // 50ms
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 0,
          jitter: 0.01,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.rtt).toBe(50)
    })

    it('should fallback to totalRoundTripTime / responsesReceived when currentRoundTripTime is unavailable', () => {
      const stats: MockStat[] = [
        {
          type: 'transport',
          id: 'transport-1',
          selectedCandidatePairId: 'pair-1'
        },
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: undefined,
          totalRoundTripTime: 1.0, // 1 second total
          responsesReceived: 10 // 10 responses
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 0,
          jitter: 0.01,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      // 1.0 / 10 = 0.1 seconds = 100ms
      expect(result.quality.rtt).toBe(100)
    })

    it('should select the correct candidate pair using selectedCandidatePairId', () => {
      const stats: MockStat[] = [
        {
          type: 'transport',
          id: 'transport-1',
          selectedCandidatePairId: 'pair-2' // pair-2 is selected, not pair-1
        },
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: false,
          currentRoundTripTime: 0.3 // 300ms - wrong one
        },
        {
          type: 'candidate-pair',
          id: 'pair-2',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.02 // 20ms - correct one
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 0,
          jitter: 0.01,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.rtt).toBe(20) // Should use pair-2's RTT
    })

    it('should fallback to nominated/succeeded check when no selectedCandidatePairId', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'waiting',
          nominated: false,
          currentRoundTripTime: 0.5 // Should not use this
        },
        {
          type: 'candidate-pair',
          id: 'pair-2',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.03 // 30ms - should use this
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 0,
          jitter: 0.01,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.rtt).toBe(30)
    })
  })

  describe('Packet Loss Calculation', () => {
    
    it('should calculate cumulative packet loss on first measurement', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 900,
          packetsLost: 100, // 10% total loss
          jitter: 0.01,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.packetLoss).toBe(10) // 100 / 1000 = 10%
    })

    it('should calculate delta packet loss when previous stats exist', () => {
      const now = Date.now()
      const previousStats: PreviousStats = {
        packetsReceived: 1000,
        packetsLost: 50,
        timestamp: now - 2000 // 2 seconds ago
      }

      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1100, // +100 received
          packetsLost: 60, // +10 lost (10 out of 110 new packets = ~9.09%)
          jitter: 0.01,
          bytesReceived: 55000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, previousStats, now)
      
      // Delta: 100 received + 10 lost = 110 total, 10/110 = 9.09%
      expect(result.quality.packetLoss).toBeCloseTo(9.09, 1)
    })

    it('should show improving packet loss when recent packets have no loss', () => {
      const now = Date.now()
      const previousStats: PreviousStats = {
        packetsReceived: 1000,
        packetsLost: 100, // Was 10% cumulative
        timestamp: now - 2000
      }

      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1200, // +200 received
          packetsLost: 100, // +0 lost (no new losses!)
          jitter: 0.01,
          bytesReceived: 60000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, previousStats, now)
      
      // Delta: 200 received + 0 lost = 200 total, 0/200 = 0%
      expect(result.quality.packetLoss).toBe(0)
    })

    it('should show worsening packet loss when recent packets have high loss', () => {
      const now = Date.now()
      const previousStats: PreviousStats = {
        packetsReceived: 1000,
        packetsLost: 10, // Was 1% cumulative
        timestamp: now - 2000
      }

      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1050, // +50 received
          packetsLost: 60, // +50 lost (50% recent loss!)
          jitter: 0.01,
          bytesReceived: 52500
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, previousStats, now)
      
      // Delta: 50 received + 50 lost = 100 total, 50/100 = 50%
      expect(result.quality.packetLoss).toBe(50)
    })
  })

  describe('Quality Score Calculation', () => {
    
    it('should rate as "excellent" when all metrics are good', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05 // 50ms - excellent
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 5, // 0.5% - excellent
          jitter: 0.005, // 5ms - excellent
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.quality).toBe('excellent')
    })

    it('should rate as "good" when RTT is moderate', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.15 // 150ms - good (not excellent)
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 5, // 0.5% - excellent
          jitter: 0.005, // 5ms - excellent
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.quality).toBe('good')
    })

    it('should rate as "fair" when RTT is high', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.25 // 250ms - fair
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 5,
          jitter: 0.005,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.quality).toBe('fair')
    })

    it('should rate as "poor" when RTT is very high', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.4 // 400ms - poor
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 5,
          jitter: 0.005,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.quality).toBe('poor')
    })

    it('should rate as "poor" when packet loss is high', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05 // 50ms - excellent
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 900,
          packetsLost: 100, // 10% - poor
          jitter: 0.005,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.quality).toBe('poor')
    })

    it('should rate as "poor" when jitter is high', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05 // 50ms - excellent
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 5,
          jitter: 0.1, // 100ms jitter - poor
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.quality).toBe('poor')
    })
  })

  describe('Connection State Handling', () => {
    
    it('should return default "fair" quality for connecting peers', () => {
      const stats: MockStat[] = [] // Empty stats during connection

      const result = calculateConnectionStats('peer-1', 'connecting', stats, null, Date.now())
      
      expect(result.quality.quality).toBe('fair')
      expect(result.quality.rtt).toBe(0)
      expect(result.quality.packetLoss).toBe(0)
      expect(result.quality.connectionState).toBe('connecting')
    })

    it('should return default "fair" quality for new connections', () => {
      const stats: MockStat[] = []

      const result = calculateConnectionStats('peer-1', 'new', stats, null, Date.now())
      
      expect(result.quality.quality).toBe('fair')
      expect(result.quality.connectionState).toBe('new')
    })
  })

  describe('Stats Update Over Time (Simulated)', () => {
    
    it('should track stats changes across multiple updates', () => {
      const peerId = 'peer-1'
      let prevStats: PreviousStats | null = null
      
      // Simulate first stats update (t=0)
      const stats1: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 100,
          packetsLost: 5,
          jitter: 0.01,
          bytesReceived: 5000
        }
      ]
      
      let result = calculateConnectionStats(peerId, 'connected', stats1, prevStats, 1000)
      expect(result.quality.packetLoss).toBeCloseTo(4.76, 1) // 5/105 鈮?4.76%
      prevStats = result.newPreviousStats

      // Simulate second stats update (t=2s) - good network
      const stats2: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.04 // RTT improved
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 200, // +100 received
          packetsLost: 5, // +0 lost
          jitter: 0.008,
          bytesReceived: 10000
        }
      ]

      result = calculateConnectionStats(peerId, 'connected', stats2, prevStats, 3000)
      expect(result.quality.packetLoss).toBe(0) // No new losses
      expect(result.quality.quality).toBe('excellent')
      prevStats = result.newPreviousStats

      // Simulate third stats update (t=4s) - network degradation
      const stats3: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.25 // RTT increased to 250ms
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 280, // +80 received
          packetsLost: 25, // +20 lost
          jitter: 0.04, // 40ms jitter
          bytesReceived: 14000
        }
      ]

      result = calculateConnectionStats(peerId, 'connected', stats3, prevStats, 5000)
      // Delta: 80 received + 20 lost = 100 total, 20/100 = 20%
      expect(result.quality.packetLoss).toBe(20)
      expect(result.quality.quality).toBe('poor') // Due to packet loss > 5%
      expect(result.quality.rtt).toBe(250)
    })
  })

  describe('Edge Cases', () => {
    
    it('should handle empty stats gracefully', () => {
      const stats: MockStat[] = []
      
      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.rtt).toBe(0)
      expect(result.quality.packetLoss).toBe(0)
      expect(result.quality.jitter).toBe(0)
      expect(result.quality.quality).toBe('excellent') // No bad metrics = excellent
    })

    it('should handle zero packets received', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 0,
          packetsLost: 0,
          jitter: 0,
          bytesReceived: 0
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.packetLoss).toBe(0) // Avoid division by zero
    })

    it('should ignore video stats', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.05
        },
        {
          type: 'inbound-rtp',
          kind: 'video', // Should be ignored
          packetsReceived: 500,
          packetsLost: 250, // 50% loss - but ignored
          jitter: 0.1,
          bytesReceived: 1000000
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 10, // 1% loss
          jitter: 0.01,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.packetLoss).toBeCloseTo(0.99, 1) // 10/1010 鈮?0.99%, Should use audio stats only
    })

    it('should handle missing currentRoundTripTime and totalRoundTripTime', () => {
      const stats: MockStat[] = [
        {
          type: 'candidate-pair',
          id: 'pair-1',
          state: 'succeeded',
          nominated: true,
          // No RTT fields at all
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsReceived: 1000,
          packetsLost: 0,
          jitter: 0.01,
          bytesReceived: 50000
        }
      ]

      const result = calculateConnectionStats('peer-1', 'connected', stats, null, Date.now())
      
      expect(result.quality.rtt).toBe(0) // Should be 0 when unavailable
    })
  })
})

