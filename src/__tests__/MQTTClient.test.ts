/**
 * @vitest-environment jsdom
 * Unit tests for MQTTClient class
 * Tests low-level MQTT protocol handling, buffer parsing, and connection lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MQTTClient } from '../renderer/signaling/SimplePeerManager'

// Mock generic WebSocket
class MockWebSocket {
    onopen: (() => void) | null = null
    onmessage: ((event: any) => void) | null = null
    onclose: (() => void) | null = null
    onerror: ((error: any) => void) | null = null
    readyState = 0
    binaryType = 'blob'
    url: string

    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    constructor(url: string) {
        this.url = url
        // Simulate async connection
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            this.onopen?.()
        }, 10)
    }

    send = vi.fn((data: any) => {
        // Auto-reply to CONNECT (0x10) with CONNACK (0x20, 0x02, 0x00, 0x00)
        // This is required because MQTTClient.connect() waits for a response
        const arr = new Uint8Array(data)
        if ((arr[0] & 0xF0) === 0x10) {
            setTimeout(() => {
                this.onmessage?.({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer })
            }, 5)
        }
    })
    close = vi.fn(() => {
        this.readyState = MockWebSocket.CLOSED
        this.onclose?.()
    })
}

// Stub WebSocket globally
vi.stubGlobal('WebSocket', MockWebSocket)

describe('MQTTClient', () => {
    let client: MQTTClient
    const brokerUrl = 'wss://test-broker.com/mqtt'

    beforeEach(() => {
        vi.useFakeTimers()
        client = new MQTTClient(brokerUrl, 'user', 'pass')
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    describe('Buffer Handling & Packet Parsing', () => {
        it('should parse a simple packet correctly', async () => {
            // Access private methods by casting to any
            const clientAny = client as any

            // Simulate connection first so we can process messages
            const connectPromise = client.connect()
            vi.advanceTimersByTime(100)
            await connectPromise

            // Create a CONNACK packet (0x20, length 2, flags 0, code 0)
            const packet = new Uint8Array([0x20, 0x02, 0x00, 0x00])

            // We need to spy on handlePacket to verify it was called
            const handleSpy = vi.spyOn(clientAny, 'handlePacket')

            // Simulate receiving data
            clientAny.ws.onmessage({ data: packet.buffer })

            expect(handleSpy).toHaveBeenCalled()
            expect(handleSpy.mock.calls[0][0]).toEqual(packet)
        })

        it('should handle fragmented packets', async () => {
            const clientAny = client as any
            const connectPromise = client.connect()
            vi.advanceTimersByTime(100)
            await connectPromise

            const handleSpy = vi.spyOn(clientAny, 'handlePacket')

            // Split a PUBLISH packet into two chunks
            // Topic: "t" (len 1), Payload: "p"
            // Header: 0x30 (PUBLISH), Remaining Length: 4 (2 for topic len + 1 for topic + 1 for payload)
            // Topic Len: 0x00 0x01
            // Topic: 't' (0x74)
            // Payload: 'p' (0x70)
            const chunk1 = new Uint8Array([0x30, 0x04, 0x00]) // Incomplete
            const chunk2 = new Uint8Array([0x01, 0x74, 0x70]) // Remainder

            clientAny.ws.onmessage({ data: chunk1.buffer })
            expect(handleSpy).not.toHaveBeenCalled() // Should wait for more data

            clientAny.ws.onmessage({ data: chunk2.buffer })
            expect(handleSpy).toHaveBeenCalled()

            const expectedPacket = new Uint8Array([0x30, 0x04, 0x00, 0x01, 0x74, 0x70])
            expect(handleSpy.mock.calls[0][0]).toEqual(expectedPacket)
        })

        it('should handle coalesced packets (multiple in one message)', async () => {
            const clientAny = client as any
            const connectPromise = client.connect()
            vi.advanceTimersByTime(100)
            await connectPromise

            const handleSpy = vi.spyOn(clientAny, 'handlePacket')

            // Two CONNACK packets back-to-back
            const packet1 = [0x20, 0x02, 0x00, 0x00]
            const packet2 = [0x20, 0x02, 0x00, 0x00]
            const coalesced = new Uint8Array([...packet1, ...packet2])

            clientAny.ws.onmessage({ data: coalesced.buffer })

            expect(handleSpy).toHaveBeenCalledTimes(2)
        })

        it('should parse variable byte integer (remaining length) correctly', async () => {
            const clientAny = client as any
            const connectPromise = client.connect()
            vi.advanceTimersByTime(100)
            await connectPromise

            const handleSpy = vi.spyOn(clientAny, 'handlePacket')

            // Construct a packet with a large payload to test variable length encoding
            // 128 bytes = 0x80 0x01 in variable length encoding

            const header = [0x30, 0x80, 0x01] // PUBLISH, length 128
            const payload = new Array(128).fill(0xAA)
            const packet = new Uint8Array([...header, ...payload])

            clientAny.ws.onmessage({ data: packet.buffer })

            expect(handleSpy).toHaveBeenCalled()
            expect((handleSpy.mock.calls[0][0] as Uint8Array).length).toBe(3 + 128)
        })
    })

    describe('Connection Lifecycle', () => {
        it('should send CONNECT packet on open', async () => {
            const clientAny = client as any
            // const sendSpy = vi.spyOn(MockWebSocket.prototype, 'send') // Removed

            const connectPromise = client.connect()
            vi.advanceTimersByTime(100)
            await connectPromise

            expect(clientAny.ws.send).toHaveBeenCalled()
            // First packet should be CONNECT (0x10)
            const sentData = clientAny.ws.send.mock.calls[0][0] as Uint8Array
            expect(sentData[0] & 0xF0).toBe(0x10)
        })

        it('should send PINGREQ for keepalive', async () => {
            const clientAny = client as any
            const connectPromise = client.connect()
            vi.advanceTimersByTime(100)
            await connectPromise

            // Clear previous calls (connect packet)
            const ws = clientAny.ws
            ws.send.mockClear()

            // Advance time by keepalive interval (20s)
            vi.advanceTimersByTime(21000)

            expect(ws.send).toHaveBeenCalled()
            const sentData = ws.send.mock.calls[0][0] as Uint8Array
            expect(sentData).toEqual(new Uint8Array([0xC0, 0x00])) // PINGREQ
        })

        it('should reject if connection times out', async () => {
            // Override WebSocket to NOT open
            vi.stubGlobal('WebSocket', class HangingWebSocket {
                binaryType = 'blob'
                close = vi.fn()
                send = vi.fn()
            })

            const connectPromise = client.connect()

            // Advance past timeout (5s)
            vi.advanceTimersByTime(10000)

            await expect(connectPromise).rejects.toThrow()
        })
    })
})
