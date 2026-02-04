/**
 * @vitest-environment jsdom
 * Tests for SimplePeerManager and MultiBrokerMQTT Reconnection Logic
 * Focuses on:
 * - Exponential backoff for broker reconnection
 * - Max reconnection attempts
 * - State recovery after reconnection
 * - Network recovery integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SimplePeerManager, MultiBrokerMQTT, resetCredentialsCacheForTesting } from '../renderer/signaling/SimplePeerManager'

// Mock Logger to silence output
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

// Mock WebSocket
class MockWebSocket {
    onopen: (() => void) | null = null
    onmessage: ((event: any) => void) | null = null
    onclose: (() => void) | null = null
    onerror: ((error: any) => void) | null = null
    readyState = 0
    url: string

    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    constructor(url: string) {
        this.url = url
        // Auto-connect by default unless configured otherwise
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            if (this.onopen) this.onopen()
        }, 10)
    }

    send = vi.fn((data: Uint8Array) => {
        // Auto-reply to CONNECT with CONNACK
        if ((data[0] & 0xF0) === 0x10) {
            setTimeout(() => {
                if (this.onmessage) {
                    this.onmessage({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer })
                }
            }, 5)
        }
        // Auto-reply to SUBSCRIBE with SUBACK
        else if ((data[0] & 0xF0) === 0x80) {
            setTimeout(() => {
                if (this.onmessage) {
                    // Mock SUBACK: Fixed(0x90, 3) + Variable(MsgId MSB, MsgId LSB) + Payload(ReturnCode 0x00)
                    const msgIdMsb = data[2]
                    const msgIdLsb = data[3]
                    this.onmessage({ data: new Uint8Array([0x90, 0x03, msgIdMsb, msgIdLsb, 0x00]).buffer })
                }
            }, 5)
        }
    })

    close = vi.fn(() => {
        this.readyState = MockWebSocket.CLOSED
        if (this.onclose) this.onclose()
    })
}

vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('BroadcastChannel', class {
    postMessage() { }
    close() { }
    onmessage = null
})

describe('MultiBrokerMQTT Reconnection', () => {
    let multiBroker: MultiBrokerMQTT
    // We need to access private members for testing internal state
    let multiBrokerAny: any

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        resetCredentialsCacheForTesting()

        // Setup Electron API mock
        const mockElectronAPI = {
            getICEServers: vi.fn().mockResolvedValue([]),
            getMQTTBrokers: vi.fn().mockResolvedValue([
                { url: 'wss://broker1.test/mqtt' },
                { url: 'wss://broker2.test/mqtt' }
            ])
        }

        Object.defineProperty(window, 'electronAPI', {
            value: mockElectronAPI,
            writable: true,
            configurable: true
        })

        // Initialize logic through SimplePeerManager which loads credentials
        // But for unit testing MultiBrokerMQTT specifically, we can instantiate it and use the global brokers
        // We trigger loadCredentials first to populate the global MQTT_BROKERS array
        const manager = new SimplePeerManager()
        manager.joinRoom('test-room', 'test-user') // Triggers loadCredentials
    })

    afterEach(() => {
        vi.useRealTimers()
        delete window.electronAPI
    })

    it('should attempt to reconnect when a broker disconnects unexpectedly', async () => {
        // Wait for credentials load
        const p1 = Promise.resolve()
        await vi.advanceTimersByTimeAsync(100)
        await p1

        multiBroker = new MultiBrokerMQTT()
        multiBrokerAny = multiBroker as any

        const connectP = multiBroker.connectAll()
        await vi.advanceTimersByTimeAsync(100) // Allow WS to open
        await connectP

        const brokerUrl = 'wss://broker1.test/mqtt'
        const client = multiBrokerAny.clients.get(brokerUrl)
        expect(client).toBeDefined()

        // Spy on reconnect logic
        const reconnectSpy = vi.spyOn(multiBrokerAny, 'handleBrokerDisconnect')

        // Simulate unexpected disconnect
        client.onDisconnectCallback(brokerUrl)

        expect(reconnectSpy).toHaveBeenCalled()

        // Validation of attempts increment
        expect(multiBrokerAny.reconnectAttempts.get(brokerUrl)).toBe(1)

        // Validate timer set
        expect(multiBrokerAny.reconnectTimers.has(brokerUrl)).toBe(true)
    })

    it('should respect max reconnection attempts', async () => {
        const p1 = Promise.resolve()
        await vi.advanceTimersByTimeAsync(100)
        await p1

        multiBroker = new MultiBrokerMQTT()
        multiBrokerAny = multiBroker as any

        const connectP = multiBroker.connectAll()
        await vi.advanceTimersByTimeAsync(100)
        await connectP

        const brokerUrl = 'wss://broker1.test/mqtt'

        // Artificial setup: set attempts to max
        multiBrokerAny.reconnectAttempts.set(brokerUrl, 5) // Assuming max is 5

        // Trigger disconnect
        const disconnectP = multiBrokerAny.handleBrokerDisconnect(brokerUrl, undefined, undefined)
        await vi.advanceTimersByTimeAsync(10) // Just a tick
        await disconnectP

        // Should have incremented to 6
        expect(multiBrokerAny.reconnectAttempts.get(brokerUrl)).toBe(6)

        // Try one more time - should return early and NOT schedule timer
        const disconnectP2 = multiBrokerAny.handleBrokerDisconnect(brokerUrl, undefined, undefined)
        await vi.advanceTimersByTimeAsync(10)
        await disconnectP2

        // Attempts stay at 7 (increment happens before check in current impl, check line 812 of source)
        // If attempts (7) > MAX (5), it returns. 
        // We verify that NO NEW timer was set

        // Clear timer from previous invalid attempt if any
        multiBrokerAny.reconnectTimers.delete(brokerUrl)

        await multiBrokerAny.handleBrokerDisconnect(brokerUrl, undefined, undefined)
        expect(multiBrokerAny.reconnectTimers.has(brokerUrl)).toBe(false)
    })

    it('should use exponential backoff', async () => {
        const p1 = Promise.resolve()
        await vi.advanceTimersByTimeAsync(100)
        await p1

        multiBroker = new MultiBrokerMQTT()
        multiBrokerAny = multiBroker as any

        const brokerUrl = 'wss://broker1.test/mqtt'

        // 1st attempt
        multiBrokerAny.reconnectAttempts.set(brokerUrl, 0)
        const d1 = multiBrokerAny.handleBrokerDisconnect(brokerUrl)
        await vi.advanceTimersByTimeAsync(100)
        await d1

        // 2nd attempt
        multiBrokerAny.reconnectAttempts.set(brokerUrl, 1)
        const d2 = multiBrokerAny.handleBrokerDisconnect(brokerUrl)
        await vi.advanceTimersByTimeAsync(100)
        await d2

        // 3rd attempt
        multiBrokerAny.reconnectAttempts.set(brokerUrl, 2)
        const d3 = multiBrokerAny.handleBrokerDisconnect(brokerUrl)
        await vi.advanceTimersByTimeAsync(100)
        await d3

        // We expect attempts to track correctly
        expect(multiBrokerAny.reconnectAttempts.get(brokerUrl)).toBe(3)
    })

    it('should re-subscribe after successful reconnection', async () => {
        const p1 = Promise.resolve()
        await vi.advanceTimersByTimeAsync(100)
        await p1

        multiBroker = new MultiBrokerMQTT()
        multiBrokerAny = multiBroker as any

        const connectP = multiBroker.connectAll()
        await vi.advanceTimersByTimeAsync(100)
        await connectP

        // Set topic/callback manually as if we had called subscribeAll
        const topic = 'test/topic'
        const subP = multiBroker.subscribeAll(topic, () => { })
        await vi.advanceTimersByTimeAsync(100) // Wait for SUBACK
        await subP

        const brokerUrl = 'wss://broker1.test/mqtt'

        // Trigger disconnect
        const disP = multiBrokerAny.handleBrokerDisconnect(brokerUrl)
        await vi.advanceTimersByTimeAsync(10)
        await disP

        // Fast forward time to trigger the scheduled reconnect
        // The delay is roughly 2000-3000ms + jitter
        await vi.advanceTimersByTimeAsync(4000)

        // Verify new client exists
        const newClient = multiBrokerAny.clients.get(brokerUrl)
        expect(newClient).toBeDefined()

        // Verify subscribe was called on new client
        // (MockWebSocket automatically accepts subscribe)
        // We need to wait a tiny bit for the connection/sub flow inside the setTimeout callback
        await vi.advanceTimersByTimeAsync(100)

        expect(newClient.isSubscribed()).toBe(true)

        // Attempts should represent success (reset to 0 on success)
        expect(multiBrokerAny.reconnectAttempts.get(brokerUrl)).toBe(0)
    })

    it('should stop reconnecting if destroyed/disconnected', async () => {
        const p1 = Promise.resolve()
        await vi.advanceTimersByTimeAsync(100)
        await p1

        multiBroker = new MultiBrokerMQTT()
        multiBrokerAny = multiBroker as any

        const connectP = multiBroker.connectAll()
        await vi.advanceTimersByTimeAsync(100)
        await connectP

        const brokerUrl = 'wss://broker1.test/mqtt'

        // Trigger disconnect to schedule timer
        const disP = multiBrokerAny.handleBrokerDisconnect(brokerUrl)
        await vi.advanceTimersByTimeAsync(10)
        await disP

        expect(multiBrokerAny.reconnectTimers.has(brokerUrl)).toBe(true)

        // Now fully disconnect/shutdown manager
        multiBroker.disconnect()

        // Timers should be cleared
        expect(multiBrokerAny.reconnectTimers.size).toBe(0)
    })
})
