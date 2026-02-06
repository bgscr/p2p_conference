/**
 * @vitest-environment jsdom
 */
/**
 * Tests for the extracted connectionStats module
 * Imports directly from the module to ensure coverage
 */

import { describe, it, expect } from 'vitest'
import { calculateConnectionStats, type PreviousStats } from '../renderer/signaling/connectionStats'

function makeStatsReport(stats: any[]) {
  return { forEach: (cb: (stat: any) => void) => stats.forEach(cb) }
}

describe('connectionStats module', () => {
  describe('non-connected states', () => {
    it('should return fair quality for connecting state', () => {
      const result = calculateConnectionStats('p1', 'connecting', makeStatsReport([]), null, 1000)
      expect(result.quality.quality).toBe('fair')
      expect(result.quality.rtt).toBe(0)
      expect(result.quality.connectionState).toBe('connecting')
    })

    it('should preserve previous stats when not connected', () => {
      const prev: PreviousStats = { packetsReceived: 100, packetsLost: 5, timestamp: 500 }
      const result = calculateConnectionStats('p1', 'new', makeStatsReport([]), prev, 1000)
      expect(result.newPreviousStats).toEqual(prev)
    })

    it('should create default previous stats when null and not connected', () => {
      const result = calculateConnectionStats('p1', 'failed', makeStatsReport([]), null, 2000)
      expect(result.newPreviousStats).toEqual({ packetsReceived: 0, packetsLost: 0, timestamp: 2000 })
    })
  })

  describe('connected - RTT', () => {
    it('should use currentRoundTripTime from selected candidate pair', () => {
      const stats = makeStatsReport([
        { type: 'transport', id: 't1', selectedCandidatePairId: 'cp1' },
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 0, jitter: 0.01, bytesReceived: 5000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.rtt).toBe(50)
    })

    it('should fallback to totalRoundTripTime / responsesReceived', () => {
      const stats = makeStatsReport([
        { type: 'transport', id: 't1', selectedCandidatePairId: 'cp1' },
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, totalRoundTripTime: 2.0, responsesReceived: 10 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 0, jitter: 0, bytesReceived: 5000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.rtt).toBe(200)
    })

    it('should use nominated/succeeded fallback when no transport selectedCandidatePairId', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.03 },
        { type: 'candidate-pair', id: 'cp2', state: 'waiting', nominated: false, currentRoundTripTime: 0.5 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 0, jitter: 0, bytesReceived: 5000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.rtt).toBe(30)
    })

    it('should skip candidate pairs with currentRoundTripTime of 0', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 0, jitter: 0, bytesReceived: 5000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.rtt).toBe(0)
    })
  })

  describe('connected - packet loss', () => {
    it('should calculate cumulative packet loss on first measurement', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 900, packetsLost: 100, jitter: 0.01, bytesReceived: 50000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.packetLoss).toBe(10)
    })

    it('should calculate delta packet loss with previous stats', () => {
      const prev: PreviousStats = { packetsReceived: 1000, packetsLost: 50, timestamp: 500 }
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1100, packetsLost: 60, jitter: 0.01, bytesReceived: 55000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, prev, 1000)
      // delta: 100 received + 10 lost = 110 total, 10/110 ≈ 9.09%
      expect(result.quality.packetLoss).toBeCloseTo(9.09, 1)
    })

    it('should handle zero delta total packets', () => {
      const prev: PreviousStats = { packetsReceived: 100, packetsLost: 5, timestamp: 500 }
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 5, jitter: 0, bytesReceived: 5000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, prev, 1000)
      expect(result.quality.packetLoss).toBe(0) // no delta
    })

    it('should handle zero total packets on first measurement', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 0, packetsLost: 0, jitter: 0, bytesReceived: 0 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.packetLoss).toBe(0)
    })
  })

  describe('connected - bytes and outbound', () => {
    it('should capture bytesSent from outbound-rtp', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 0, jitter: 0.01, bytesReceived: 5000 },
        { type: 'outbound-rtp', kind: 'audio', bytesSent: 3000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.bytesSent).toBe(3000)
      expect(result.quality.bytesReceived).toBe(5000)
    })

    it('should ignore video stats', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'video', packetsReceived: 500, packetsLost: 250, jitter: 0.1, bytesReceived: 1000000 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 10, jitter: 0.01, bytesReceived: 50000 },
        { type: 'outbound-rtp', kind: 'video', bytesSent: 999999 },
        { type: 'outbound-rtp', kind: 'audio', bytesSent: 3000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.bytesReceived).toBe(50000)
      expect(result.quality.bytesSent).toBe(3000)
    })
  })

  describe('quality scoring', () => {
    it('should rate excellent when all metrics are good', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 5, jitter: 0.005, bytesReceived: 50000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.quality).toBe('excellent')
    })

    it('should rate good when RTT > 100', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.15 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 5, jitter: 0.005, bytesReceived: 50000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.quality).toBe('good')
    })

    it('should rate fair when RTT > 200', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.25 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 5, jitter: 0.005, bytesReceived: 50000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.quality).toBe('fair')
    })

    it('should rate poor when RTT > 300', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.4 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 5, jitter: 0.005, bytesReceived: 50000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.quality).toBe('poor')
    })

    it('should rate poor when jitter > 50', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 5, jitter: 0.06, bytesReceived: 50000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.quality).toBe('poor')
    })

    it('should rate fair when jitter > 30', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 5, jitter: 0.035, bytesReceived: 50000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.quality).toBe('fair')
    })

    it('should rate good when jitter > 15', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 5, jitter: 0.02, bytesReceived: 50000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 1000)
      expect(result.quality.quality).toBe('good')
    })
  })

  describe('newPreviousStats output', () => {
    it('should return updated previous stats for connected state', () => {
      const stats = makeStatsReport([
        { type: 'candidate-pair', id: 'cp1', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 500, packetsLost: 10, jitter: 0.01, bytesReceived: 25000 },
      ])
      const result = calculateConnectionStats('p1', 'connected', stats, null, 3000)
      expect(result.newPreviousStats).toEqual({
        packetsReceived: 500,
        packetsLost: 10,
        timestamp: 3000,
      })
    })
  })

  describe('empty stats', () => {
    it('should handle empty stats report gracefully', () => {
      const result = calculateConnectionStats('p1', 'connected', makeStatsReport([]), null, 1000)
      expect(result.quality.rtt).toBe(0)
      expect(result.quality.packetLoss).toBe(0)
      expect(result.quality.jitter).toBe(0)
      expect(result.quality.quality).toBe('excellent')
    })
  })
})
