
/**
 * MQTT Protocol and Multi-Broker Tests
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MQTTClient, MultiBrokerMQTT } from '../renderer/signaling/SimplePeerManager'

// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
    SignalingLog: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

// Enhanced Mock WebSocket for binary protocol testing
class MockWebSocket {
    static instances: MockWebSocket[] = []

    onopen: (() => void) | null = null
    onmessage: ((event: any) => void) | null = null
    onclose: (() => void) | null = null
    onerror: ((error: any) => void) | null = null
    readyState = 0
    binaryType = 'arraybuffer'
    url: string

    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    public sentPackets: Uint8Array[] = []

    constructor(url: string) {
        this.url = url
        MockWebSocket.instances.push(this)
        // Auto-open after a tiny delay
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            if (this.onopen) this.onopen()
        }, 10)
    }

    send(data: Uint8Array) {
        this.sentPackets.push(data)
    }

    close() {
        this.readyState = MockWebSocket.CLOSED
        if (this.onclose) this.onclose()
    }

    // Helper to simulate incoming data
    receive(data: Uint8Array | number[]) {
        if (this.onmessage) {
            this.onmessage({ data: new Uint8Array(data).buffer })
        }
    }
}

vi.stubGlobal('WebSocket', MockWebSocket)

describe('MQTTClient', () => {
    let client: MQTTClient
    let ws: MockWebSocket

    beforeEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
        MockWebSocket.instances = []
        client = new MQTTClient('wss://test.broker/mqtt', 'user', 'pass')
    })

    it('should connect and send CONNECT packet', async () => {
        const connectPromise = client.connect()

        // Wait for WS to open (10ms + buffer)
        await new Promise(r => setTimeout(r, 60))

        // Get the socket
        ws = MockWebSocket.instances[0]
        expect(ws).toBeDefined()

        // Check CONNECT packet sent
        await new Promise(r => setTimeout(r, 40))
        expect(ws.sentPackets.length).toBeGreaterThan(0)
        expect(ws.sentPackets[0][0]).toBe(0x10)

        // Respond with CONNACK
        ws.receive([0x20, 0x02, 0x00, 0x00])

        await connectPromise
        expect(client.isConnected()).toBe(true)
    })

    it('should handle connection timeout', async () => {
        // Override WS to never open
        const OriginalWS = global.WebSocket
        vi.stubGlobal('WebSocket', class {
            constructor() { } // No open logic
            close() { }
        })

        // Use fake timers strictly for this long timeout test
        vi.useFakeTimers()
        const p = client.connect()

        vi.advanceTimersByTime(10000)

        await expect(p).rejects.toThrow('MQTT connection timeout')

        vi.useRealTimers()
        vi.stubGlobal('WebSocket', OriginalWS)
    })

    it('should publish message correctly', async () => {
        // Connect phase
        const p = client.connect()
        await new Promise(r => setTimeout(r, 60))
        ws = MockWebSocket.instances[0]
        ws.receive([0x20, 0x02, 0x00, 0x00]) // CONNACK
        await p

        ws.sentPackets = [] // clear buffer

        const success = client.publish('test/topic', 'hello world')
        expect(success).toBe(true)

        await new Promise(r => setTimeout(r, 40))

        // PUBLISH packet
        expect(ws.sentPackets.length).toBe(1)
        expect(ws.sentPackets[0][0]).toBe(0x30)
    })

    it('should subscribe and handle incoming messages', async () => {
        // Connect phase
        const p = client.connect()
        await new Promise(r => setTimeout(r, 60))
        ws = MockWebSocket.instances[0]
        ws.receive([0x20, 0x02, 0x00, 0x00]) // CONNACK
        await p
        ws.sentPackets = [] // clear buffer

        const onMessage = vi.fn()
        const subPromise = client.subscribe('test/topic', onMessage)

        await new Promise(r => setTimeout(r, 40))

        // Check SUBSCRIBE packet
        expect(ws.sentPackets.length).toBe(1)
        expect(ws.sentPackets[0][0]).toBe(0x82) // SUBSCRIBE

        // Respond with SUBACK
        // Packet ID at index 2,3
        const subPacket = ws.sentPackets[0]
        ws.receive([0x90, 0x03, subPacket[2], subPacket[3], 0x00])

        const success = await subPromise
        expect(success).toBe(true)
        expect(client.isSubscribed()).toBe(true)

        // Simulate Incoming PUBLISH
        const topic = 't'
        const msg = 'A'
        const topicBytes = new TextEncoder().encode(topic)
        const msgBytes = new TextEncoder().encode(msg)

        const packet = new Uint8Array(100)
        let idx = 0
        packet[idx++] = 0x30 // PUBLISH
        packet[idx++] = 2 + topicBytes.length + msgBytes.length // RemLen

        packet[idx++] = 0 // Topic Len MSB
        packet[idx++] = topicBytes.length // Topic Len LSB
        packet.set(topicBytes, idx)
        idx += topicBytes.length

        packet.set(msgBytes, idx)
        idx += msgBytes.length

        ws.receive(packet.slice(0, idx))

        expect(client.getMessageCount()).toBe(1)
        expect(onMessage).toHaveBeenCalledWith(msg)
    })
})

describe('MultiBrokerMQTT', () => {
    let multiBroker: MultiBrokerMQTT

    beforeEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
        MockWebSocket.instances = []
        multiBroker = new MultiBrokerMQTT()
    })

    it('should connect to all brokers', async () => {
        const p = multiBroker.connectAll()

        // Wait for sockets to be created method
        await new Promise(r => setTimeout(r, 100))

        // We expect some sockets
        expect(MockWebSocket.instances.length).toBeGreaterThan(0)

        // Manually approve all connections
        MockWebSocket.instances.forEach(ws => {
            if (ws.sentPackets.some(pkt => (pkt[0] & 0xF0) === 0x10)) {
                ws.receive([0x20, 0x02, 0x00, 0x00]) // CONNACK
            }
        })

        const res = await p
        expect(res.length).toBe(MockWebSocket.instances.length)
    })

    it('should deduplicate messages across brokers', async () => {
        const p = multiBroker.connectAll()
        await new Promise(r => setTimeout(r, 100))
        MockWebSocket.instances.forEach(ws => ws.receive([0x20, 0x02, 0x00, 0x00]))
        await p

        // Setup subscription
        const onMessage = vi.fn()
        // Method is subscribeAll, not subscribe
        const subP = multiBroker.subscribeAll('room', onMessage)

        await new Promise(r => setTimeout(r, 50))
        // Validate SUB packets and ack them
        MockWebSocket.instances.forEach(ws => {
            // Find Subscribe packet (0x82)
            const subPkt = ws.sentPackets.find(pkt => pkt[0] === 0x82)
            if (subPkt) {
                ws.receive([0x90, 0x03, subPkt[2], subPkt[3], 0x00])
            }
        })

        await subP

        // Send same message to all brokers
        const msgId = 'unique-123'
        const payloadObj = { msgId, data: 'test-data', sender: 'me' }
        const payloadStr = JSON.stringify(payloadObj)
        const payloadBytes = new TextEncoder().encode(payloadStr)
        const topicBytes = new TextEncoder().encode('room')

        // Construct PUBLISH packet
        // Fixed Header (0x30) + RemLen
        // RemLen = 2 (topic len) + topic + payload
        const remLen = 2 + topicBytes.length + payloadBytes.length
        // Simplified packet construction (assuming small length and no extra logic needed for this test)
        const packet = new Uint8Array(2 + remLen + 10) // + buffer
        let idx = 0
        packet[idx++] = 0x30

        // Encode RemLen properly if needed, but for small test message:
        packet[idx++] = remLen

        // Topic
        packet[idx++] = 0
        packet[idx++] = topicBytes.length
        packet.set(topicBytes, idx)
        idx += topicBytes.length

        // Payload
        packet.set(payloadBytes, idx)

        // Send to Client 1
        MockWebSocket.instances[0].receive(packet)

        // Send to Client 2 (if exists)
        if (MockWebSocket.instances.length > 1) {
            MockWebSocket.instances[1].receive(packet)
        }

        // Should only be received once
        expect(onMessage).toHaveBeenCalledTimes(1)
        expect(JSON.parse(onMessage.mock.calls[0][0])).toEqual(payloadObj)
    })
})
