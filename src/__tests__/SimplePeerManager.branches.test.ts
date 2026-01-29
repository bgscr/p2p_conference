/**
 * @vitest-environment jsdom
 * Targeted branch coverage tests for SimplePeerManager
 * Focuses on:
 * - BroadcastChannel error handling
 * - Complex stats calculation (deltas, candidate selection)
 * - Track replacement edge cases
 * - Announce interval logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SimplePeerManager, selfId } from '../renderer/signaling/SimplePeerManager'

// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
    SignalingLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    PeerLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// Mock BroadcastChannel
class MockBroadcastChannel {
    name: string
    onmessage: ((ev: MessageEvent) => any) | null = null
    constructor(name: string) { this.name = name }
    postMessage = vi.fn()
    close = vi.fn()
}

// Mock RTCPeerConnection and related stats
class MockRTCPeerConnection {
    connectionState = 'connected'
    iceConnectionState = 'connected'
    signalingState = 'stable'
    onicecandidate: any = null
    oniceconnectionstatechange: any = null
    onconnectionstatechange: any = null
    ontrack: any = null

    // Track this for replaceTrack testing
    senders: any[] = []

    constructor(_config: any) { }

    createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtcp-mux\r\na=fmtp:111 minptime=10;useinbandfec=1' })
    createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' })
    setLocalDescription = vi.fn().mockResolvedValue(undefined)
    setRemoteDescription = vi.fn().mockResolvedValue(undefined)
    addIceCandidate = vi.fn().mockResolvedValue(undefined)
    close = vi.fn()
    addTrack = vi.fn()

    getSenders() { return this.senders }

    getStats = vi.fn().mockResolvedValue(new Map())
}

vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
vi.stubGlobal('RTCSessionDescription', class { constructor(init: any) { Object.assign(this, init) } })
vi.stubGlobal('RTCIceCandidate', class { constructor(init: any) { Object.assign(this, init) } })
vi.stubGlobal('MediaStream', class {
    id = 'stream-id'
    getTracks = () => []
    getAudioTracks = () => []
})

describe('SimplePeerManager Branches & Edge Cases', () => {
    let manager: SimplePeerManager
    let managerAny: any

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(2024, 1, 1, 12, 0, 0))
        vi.clearAllMocks()
        manager = new SimplePeerManager()
        managerAny = manager as any

        // Setup basic state
        managerAny.roomId = 'test-room'
        managerAny.sessionId = 'test-session'
        managerAny.topic = 'test-topic'
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('Broadcast Handling', () => {
        it('should handle BroadcastChannel errors gracefully', () => {
            // Setup BroadcastChannel mock to throw
            const bc = new MockBroadcastChannel('test')
            bc.postMessage.mockImplementation(() => { throw new Error('Channel closed') })
            managerAny.broadcastChannel = bc

            // Setup MQTT to be disconnected so it tries BC
            managerAny.mqtt = { isConnected: () => false }

            // Should not throw
            expect(() => managerAny.broadcast({ type: 'ping' })).not.toThrow()
            expect(bc.postMessage).toHaveBeenCalled()
        })
    })

    describe('Signaling Filters', () => {
        it('should ignore messages from self or for others', () => {
            const handleSpy = vi.spyOn(managerAny, 'handleAnnounce')

            // From self
            managerAny.handleSignalingMessage({ type: 'announce', from: selfId })
            expect(handleSpy).not.toHaveBeenCalled()

            // For other
            managerAny.handleSignalingMessage({ type: 'announce', from: 'other', to: 'someone-else' })
            expect(handleSpy).not.toHaveBeenCalled()

            // Valid
            managerAny.handleSignalingMessage({ type: 'announce', from: 'peer1', to: selfId })
            expect(handleSpy).toHaveBeenCalled()
        })
    })

    describe('Stats Calculation', () => {
        it('should calculate packet loss using deltas', async () => {
            // Setup a peer
            const peerId = 'peer1'
            const pc = new MockRTCPeerConnection({})
            managerAny.peers.set(peerId, { pc, isConnected: true })

            // Mock Stats Reposnes

            // T0: Initial stats
            const stats0 = new Map()
            stats0.set('report1', {
                type: 'inbound-rtp', kind: 'audio',
                packetsReceived: 100, packetsLost: 0
            })
            pc.getStats.mockResolvedValueOnce(stats0)

            await manager.getConnectionStats()

            // Advance time
            vi.setSystemTime(new Date(2024, 1, 1, 12, 0, 1)) // +1s
            vi.advanceTimersByTime(1000)

            // T1: 100 packets received, 10 lost (10% loss in this interval)
            const stats1 = new Map()
            stats1.set('report1', {
                type: 'inbound-rtp', kind: 'audio',
                packetsReceived: 200, packetsLost: 10
            })
            pc.getStats.mockResolvedValueOnce(stats1)

            const result = await manager.getConnectionStats()
            const peerStats = result.get(peerId)

            expect(peerStats).toBeDefined()
            // Delta Received: 200 - 100 = 100
            // Delta Lost: 10 - 0 = 10
            // Total expected: 110
            // Loss Rate: 10/110 = 9.09%
            expect(peerStats?.packetLoss).toBeCloseTo(9.09, 1)
        })

        it('should fallback to cumulative loss if no previous stats', async () => {
            // In this case we cleared previous stats, so no delta check
            const peerId = 'peer1'
            const pc = new MockRTCPeerConnection({})
            managerAny.peers.set(peerId, { pc, isConnected: true })

            const stats = new Map()
            stats.set('report1', {
                type: 'inbound-rtp', kind: 'audio',
                packetsReceived: 90, packetsLost: 10 // 10% total
            })
            pc.getStats.mockResolvedValueOnce(stats)

            // Clear previous stats to force fallback path
            managerAny.previousStats.clear()

            const result = await manager.getConnectionStats()
            expect(result.get(peerId)?.packetLoss).toBe(10) // 10 / 100 * 100
        })

        it('should select correct candidate pair stats', async () => {
            const peerId = 'peer1'
            const pc = new MockRTCPeerConnection({})
            managerAny.peers.set(peerId, { pc, isConnected: true })

            const stats = new Map()
            // Transport selecting pair 'pair2'
            stats.set('trans', { type: 'transport', selectedCandidatePairId: 'pair2' })
            // Pair 1 (Not selected)
            stats.set('pair1', { id: 'pair1', type: 'candidate-pair', currentRoundTripTime: 0.1 })
            // Pair 2 (Selected)
            stats.set('pair2', { id: 'pair2', type: 'candidate-pair', currentRoundTripTime: 0.05 })

            pc.getStats.mockResolvedValueOnce(stats)

            const result = await manager.getConnectionStats()
            // Should use pair2 RTT (0.05s = 50ms)
            expect(result.get(peerId)?.rtt).toBe(50)
        })

        it('should fallback to nominated pair if selectedCandidatePairId missing', async () => {
            const peerId = 'peer1'
            const pc = new MockRTCPeerConnection({})
            managerAny.peers.set(peerId, { pc, isConnected: true })

            const stats = new Map()
            // Pair (Nominated) - using average RTT fallback
            stats.set('pair1', {
                type: 'candidate-pair',
                nominated: true,
                totalRoundTripTime: 1,
                responsesReceived: 10
            })

            pc.getStats.mockResolvedValueOnce(stats)

            const result = await manager.getConnectionStats()
            // Average: 1 / 10 = 0.1s = 100ms
            expect(result.get(peerId)?.rtt).toBe(100)
        })
    })

    describe('Track Replacement', () => {
        it('should fallback to addTrack if no appropriate sender found', async () => {
            const peerId = 'peer1'
            const pc = new MockRTCPeerConnection({})
            // No senders
            pc.senders = []

            managerAny.peers.set(peerId, { pc, isConnected: true })
            managerAny.localStream = { id: 'local' } // Needed for addTrack

            const newTrack = { id: 'track1', kind: 'audio', label: 'mic' }

            manager.replaceTrack(newTrack as any)

            expect(pc.addTrack).toHaveBeenCalledWith(newTrack, managerAny.localStream)
        })

        it('should reuse empty audio sender', async () => {
            const peerId = 'peer1'
            const pc = new MockRTCPeerConnection({})

            const replaceTrackMock = vi.fn().mockResolvedValue(undefined)

            // Sender with no track but audio capabilities
            const emptySender = {
                track: null,
                getParameters: () => ({ codecs: [{ mimeType: 'audio/opus' }] }),
                replaceTrack: replaceTrackMock
            }

            pc.senders = [emptySender]

            managerAny.peers.set(peerId, { pc, isConnected: true })

            const newTrack = { id: 'track1', kind: 'audio' }
            manager.replaceTrack(newTrack as any)

            expect(replaceTrackMock).toHaveBeenCalledWith(newTrack)
        })
    })

    describe('Announce Interval', () => {
        it('should stop announcing if duration elapsed and have healthy peers', async () => {
            // Mock healthy peer counting
            managerAny.getHealthyPeerCount = vi.fn().mockReturnValue(1)

            // Spy on timer clearing and broadcast
            const stopSpy = vi.spyOn(managerAny, 'stopAnnounceInterval')
            const broadcastSpy = vi.spyOn(managerAny, 'broadcastAnnounce')

            // Trigger interval setup
            managerAny.startAnnounceInterval()

            // Clear the initial calls
            stopSpy.mockClear()
            broadcastSpy.mockClear()

            // Advance time past ANNOUNCE_DURATION (60s)
            // We MUST update system time so Date.now() inside the interval returns the future time
            vi.setSystemTime(new Date(2024, 1, 1, 12, 1, 10))
            await vi.advanceTimersByTimeAsync(70000)

            // The interval should have fired, checked the condition, and called stop
            expect(stopSpy).toHaveBeenCalled()

            // Reset mock
            broadcastSpy.mockClear()

            // Advance more time - interval should be gone
            vi.setSystemTime(new Date(2024, 1, 1, 12, 1, 15))
            await vi.advanceTimersByTimeAsync(5000)

            expect(broadcastSpy).not.toHaveBeenCalled()
        })

        it('should continue announcing if no healthy peers', async () => {
            // Mock healthy peer counting - must return 0
            managerAny.getHealthyPeerCount = vi.fn().mockReturnValue(0)

            const broadcastSpy = vi.spyOn(managerAny, 'broadcastAnnounce')
            managerAny.startAnnounceInterval()
            broadcastSpy.mockClear() // Clear initial

            // Time passes but no peers found. 
            vi.setSystemTime(new Date(2024, 1, 1, 12, 1, 10))
            await vi.advanceTimersByTimeAsync(70000)

            // Should have broadcasted many times
            expect(broadcastSpy).toHaveBeenCalled()
            const count = broadcastSpy.mock.calls.length
            expect(count).toBeGreaterThan(0)

            // Advance another interval
            vi.setSystemTime(new Date(2024, 1, 1, 12, 1, 15))
            await vi.advanceTimersByTimeAsync(5000)

            // Should have broadcasted at least one more time
            expect(broadcastSpy.mock.calls.length).toBeGreaterThan(count)
        })
    })
})
