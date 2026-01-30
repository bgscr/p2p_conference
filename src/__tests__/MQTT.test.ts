/**
 * MQTT Infrastructure Tests
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    MQTTClient,
    MessageDeduplicator,
    resetCredentialsCacheForTesting
} from '../renderer/signaling/SimplePeerManager'

// --- Mocks ---
vi.mock('../renderer/utils/Logger', () => ({
    SignalingLog: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    },
    PeerLog: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

// Mock WebSocket with controllable behavior
class MockWebSocket {
    onopen: (() => void) | null = null
    onmessage: ((event: any) => void) | null = null
    onclose: (() => void) | null = null
    onerror: ((error: any) => void) | null = null
    readyState = 0
    url: string
    sentData: Uint8Array[] = []

    static instances: MockWebSocket[] = []

    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    constructor(url: string) {
        this.url = url
        MockWebSocket.instances.push(this)
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            this.onopen?.()
        }, 10)
    }

    send = vi.fn((data: Uint8Array) => {
        this.sentData.push(data)
    })

    close = vi.fn(() => {
        this.readyState = MockWebSocket.CLOSED
        this.onclose?.()
    })

    // Helper to simulate receiving data
    simulateMessage(data: Uint8Array) {
        this.onmessage?.({ data: data.buffer })
    }
}

vi.stubGlobal('WebSocket', MockWebSocket)

describe('MQTT Infrastructure', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        resetCredentialsCacheForTesting()
        MockWebSocket.instances = []
    })

    afterEach(() => {
        vi.runOnlyPendingTimers()
        vi.useRealTimers()
    })

    describe('MessageDeduplicator', () => {
        it('detects duplicate messages', () => {
            const dedup = new MessageDeduplicator()
            const msgId = 'msg-123'

            expect(dedup.isDuplicate(msgId)).toBe(false)
            expect(dedup.isDuplicate(msgId)).toBe(true)
        })

        it('cleans up old messages after TTL', () => {
            const dedup = new MessageDeduplicator()
            dedup.isDuplicate('msg-1')

            // Advance time past TTL (30s)
            vi.advanceTimersByTime(31000)
                ; (dedup as any).cleanup()

            // Should be new again
            expect(dedup.isDuplicate('msg-1')).toBe(false)
        })

        it('reports size correctly', () => {
            const dedup = new MessageDeduplicator()
            dedup.isDuplicate('msg-1')
            dedup.isDuplicate('msg-2')
            expect(dedup.size()).toBe(2)
            dedup.destroy()
            expect(dedup.size()).toBe(0)
        })
    })

    describe('MQTTClient', () => {
        let client: MQTTClient

        beforeEach(() => {
            client = new MQTTClient('wss://test.broker/mqtt', 'user', 'pass')
        })

        it('connects and sends CONNECT packet', async () => {
            const connectPromise = client.connect()
            await vi.advanceTimersByTimeAsync(20) // Allow WS open

            // Get the mock WS instance
            // We can't access private client.ws easily, but we can verify behavior
            const ws = MockWebSocket.instances[0]
            expect(ws).toBeDefined()

            // Verify CONNECT packet sent
            expect(ws.send).toHaveBeenCalled()
            const type = ws.sentData[0][0] >> 4
            expect(type).toBe(1) // CONNECT type

            // Simulate CONNACK
            ws.simulateMessage(new Uint8Array([0x20, 0x02, 0x00, 0x00]))

            await connectPromise
            expect(client.isConnected()).toBe(true)
        })

        it('handles KeepAlive PINGREQ/PINGRESP', async () => {
            const connectPromise = client.connect()
            await vi.advanceTimersByTimeAsync(20)
            const ws = MockWebSocket.instances[0]
            ws.simulateMessage(new Uint8Array([0x20, 0x02, 0x00, 0x00])) // CONNACK
            await connectPromise

            // Advance time to trigger KeepAlive (MQTT_KEEPALIVE = 20000)
            ws.sentData = [] // clear buffer
            await vi.advanceTimersByTimeAsync(20000)

            // Should have sent PINGREQ (0xC0, 0x00)
            expect(ws.send).toHaveBeenCalled()
            expect(ws.sentData[0]).toEqual(new Uint8Array([0xC0, 0x00]))

            // Simulate PINGRESP
            ws.simulateMessage(new Uint8Array([0xD0, 0x00]))
        })

        it('handles fragmented packets', async () => {
            const connectPromise = client.connect()
            await vi.advanceTimersByTimeAsync(20)
            const ws = MockWebSocket.instances[0]
            ws.simulateMessage(new Uint8Array([0x20, 0x02, 0x00, 0x00])) // CONNACK
            await connectPromise

            // Construct simple PUBLISH packet manually
            // Topic: 'a' (len 1) -> 0x00 0x01 0x61
            // Payload: 'b' -> 0x62
            // Header: 30 (PUBLISH), RemLen: 4 (2 topic len + 1 topic + 1 payload)

            const packet = new Uint8Array([0x30, 0x04, 0x00, 0x01, 0x61, 0x62])

            // Send in two chunks
            const chunk1 = packet.slice(0, 3)
            const chunk2 = packet.slice(3)

            let receivedMessage = ''

            // Setup subscription logic first
            const subPromise = client.subscribe('a', (msg) => { receivedMessage = msg })
            await vi.advanceTimersByTimeAsync(10)

            // Simulate SUBACK for packet ID 1 (default start)
            ws.simulateMessage(new Uint8Array([0x90, 0x03, 0x00, 0x01, 0x00]))

            await subPromise

            // Send chunks
            ws.simulateMessage(chunk1)
            ws.simulateMessage(chunk2)

            expect(receivedMessage).toBe('b')
        })
    })

    // MultiBrokerMQTT is hard to test in isolation without full mocks because it depends 
    // on internal module state (MQTT_BROKERS).
    // But we covered it implicitly in network.test.ts. 
    // We can skip explicit MultiBrokerMQTT tests here if we are confident, 
    // or rely on what we have.
})
