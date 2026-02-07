/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage gap tests for connectionStats.ts
 * Targets all branches:
 * - Non-connected state default
 * - Connected with no previous stats (first measurement)
 * - Connected with previous stats and delta calculation
 * - Quality thresholds: excellent, good, fair, poor
 * - selectedCandidatePairId matching vs fallback (nominated/state)
 * - totalRoundTripTime fallback
 * - Zero deltaTotal edge case
 * - Zero totalPackets edge case
 */

import { describe, it, expect } from 'vitest'
import { calculateConnectionStats } from '../renderer/signaling/connectionStats'

function makeStatsReport(entries: any[]) {
  return {
    forEach: (cb: (stat: any) => void) => entries.forEach(cb)
  }
}

describe('calculateConnectionStats - additional branches', () => {
  it('returns default values for non-connected state', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connecting' as any,
      makeStatsReport([]),
      null,
      Date.now()
    )

    expect(result.quality.quality).toBe('fair')
    expect(result.quality.rtt).toBe(0)
    expect(result.quality.packetLoss).toBe(0)
    expect(result.quality.connectionState).toBe('connecting')
  })

  it('preserves existing previousStats for non-connected state', () => {
    const prev = { packetsReceived: 100, packetsLost: 5, timestamp: 1000 }
    const result = calculateConnectionStats(
      'peer-1', 'disconnected' as any,
      makeStatsReport([]),
      prev,
      2000
    )

    expect(result.newPreviousStats).toBe(prev)
  })

  it('creates new previousStats when none provided for non-connected state', () => {
    const now = Date.now()
    const result = calculateConnectionStats(
      'peer-1', 'new' as any,
      makeStatsReport([]),
      null,
      now
    )

    expect(result.newPreviousStats.packetsReceived).toBe(0)
    expect(result.newPreviousStats.packetsLost).toBe(0)
    expect(result.newPreviousStats.timestamp).toBe(now)
  })

  it('calculates excellent quality with low RTT', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 0, jitter: 0.001, bytesReceived: 50000 },
        { type: 'outbound-rtp', kind: 'audio', bytesSent: 48000 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.quality).toBe('excellent')
    expect(result.quality.rtt).toBe(50)
    expect(result.quality.bytesReceived).toBe(50000)
    expect(result.quality.bytesSent).toBe(48000)
  })

  it('calculates good quality (RTT 100-200ms)', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.15 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 5, jitter: 0.005, bytesReceived: 50000 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.quality).toBe('good')
  })

  it('calculates fair quality (RTT 200-300ms)', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.25 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 10, jitter: 0.01, bytesReceived: 50000 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.quality).toBe('fair')
  })

  it('calculates poor quality (RTT > 300ms)', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.5 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 100, jitter: 0.1, bytesReceived: 50000 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.quality).toBe('poor')
  })

  it('uses selectedCandidatePairId for RTT when transport has it', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'transport', selectedCandidatePairId: 'pair-1' },
        { type: 'candidate-pair', id: 'pair-1', currentRoundTripTime: 0.08 },
        { type: 'candidate-pair', id: 'pair-2', nominated: true, currentRoundTripTime: 0.5 }, // Should NOT be used
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 0, jitter: 0, bytesReceived: 0 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.rtt).toBe(80) // From pair-1, not pair-2
  })

  it('uses state=succeeded fallback when no nominated and no selectedCandidatePairId', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', id: 'pair-1', state: 'succeeded', currentRoundTripTime: 0.06 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 0, jitter: 0, bytesReceived: 0 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.rtt).toBe(60)
  })

  it('uses totalRoundTripTime fallback when currentRoundTripTime is 0', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0, totalRoundTripTime: 0.5, responsesReceived: 5 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 0, jitter: 0, bytesReceived: 0 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.rtt).toBe(100) // (0.5 / 5) * 1000
  })

  it('uses totalRoundTripTime fallback when currentRoundTripTime is undefined', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, totalRoundTripTime: 1.0, responsesReceived: 10 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 0, jitter: 0, bytesReceived: 0 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.rtt).toBe(100)
  })

  it('calculates delta packet loss with previous stats', () => {
    const prevStats = { packetsReceived: 500, packetsLost: 10, timestamp: 1000 }

    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 20, jitter: 0.005, bytesReceived: 0 },
      ]),
      prevStats,
      2000
    )

    // deltaReceived = 1000 - 500 = 500
    // deltaLost = 20 - 10 = 10
    // deltaTotal = 510
    // packetLoss = (10 / 510) * 100 ≈ 1.96%
    expect(result.quality.packetLoss).toBeCloseTo(1.96, 1)
  })

  it('handles zero deltaTotal (no new packets)', () => {
    const prevStats = { packetsReceived: 1000, packetsLost: 10, timestamp: 1000 }

    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 10, jitter: 0, bytesReceived: 0 },
      ]),
      prevStats,
      2000
    )

    expect(result.quality.packetLoss).toBe(0)
  })

  it('calculates cumulative packet loss without previous stats', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 90, packetsLost: 10, jitter: 0, bytesReceived: 0 },
      ]),
      null,
      Date.now()
    )

    // totalPackets = 100, packetLoss = (10/100) * 100 = 10%
    expect(result.quality.packetLoss).toBe(10)
  })

  it('handles zero total packets in first measurement', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 0, packetsLost: 0, jitter: 0, bytesReceived: 0 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.packetLoss).toBe(0)
  })

  it('ignores non-audio inbound-rtp stats', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'video', packetsReceived: 999, packetsLost: 999, jitter: 999 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 100, packetsLost: 0, jitter: 0, bytesReceived: 5000 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.packetLoss).toBe(0) // Not affected by video stats
    expect(result.quality.bytesReceived).toBe(5000)
  })

  it('poor quality from high jitter alone', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.01 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 1000, packetsLost: 0, jitter: 0.1, bytesReceived: 0 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.quality).toBe('poor')
    expect(result.quality.jitter).toBe(100)
  })

  it('poor quality from high packet loss alone', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.01 },
        { type: 'inbound-rtp', kind: 'audio', packetsReceived: 90, packetsLost: 10, jitter: 0, bytesReceived: 0 },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.quality).toBe('poor') // 10% > 5%
  })

  it('handles missing inbound-rtp fields gracefully', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([
        { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
        { type: 'inbound-rtp', kind: 'audio' },
      ]),
      null,
      Date.now()
    )

    expect(result.quality.packetLoss).toBe(0)
    expect(result.quality.jitter).toBe(0)
    expect(result.quality.bytesReceived).toBe(0)
  })

  it('handles no stats entries at all', () => {
    const result = calculateConnectionStats(
      'peer-1', 'connected',
      makeStatsReport([]),
      null,
      Date.now()
    )

    expect(result.quality.quality).toBe('excellent') // Low everything = excellent
    expect(result.quality.rtt).toBe(0)
  })
})
