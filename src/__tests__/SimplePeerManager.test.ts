/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SimplePeerManager, generatePeerId } from '../renderer/signaling/SimplePeerManager'

// Mock Logger
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

// Smart Mock WebSocket for MQTT
class MockWebSocket {
    static instances: MockWebSocket[] = []

    onopen: (() => void) | null = null
    onmessage: ((event: any) => void) | null = null
    onclose: (() => void) | null = null
    onerror: ((error: any) => void) | null = null

    // Standard WebSocket properties
    readyState = 0 // CONNECTING
    binaryType = 'arraybuffer'
    url: string
    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    constructor(url: string) {
        this.url = url
        MockWebSocket.instances.push(this)

        // Simulate async connection
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            if (this.onopen) this.onopen()
        }, 10)
    }

    send = vi.fn((data: Uint8Array) => {
        // Parse MQTT Packet Type
        const type = data[0] & 0xF0

        // Simulate network delay for response
        setTimeout(() => {
            if (this.readyState !== MockWebSocket.OPEN) return

            if (type === 0x10) { // CONNECT
                // Send CONACK: 0x20 0x02 0x00 0x00
                this.triggerMessage(new Uint8Array([0x20, 0x02, 0x00, 0x00]))
            } else if (type === 0x80) { // SUBSCRIBE (0x82 is 0x80 masked)
                // Extract Message ID (bytes 2 and 3)
                const msgIdMsb = data[2]
                const msgIdLsb = data[3]
                // SUBACK: 0x90 0x03 msgIdMsb msgIdLsb 0x00
                this.triggerMessage(new Uint8Array([0x90, 0x03, msgIdMsb, msgIdLsb, 0x00]))
            }
        }, 10)
    })

    close = vi.fn(() => {
        this.readyState = MockWebSocket.CLOSED
        setTimeout(() => {
            if (this.onclose) this.onclose()
        }, 1)
    })

    // Helper to simulate receiving a message
    public triggerMessage(data: Uint8Array) {
        if (this.onmessage) {
            this.onmessage({ data: data.buffer }) // WebSocket receives ArrayBuffer
        }
    }
}

// Mock RTCPeerConnection
class MockRTCPeerConnection {
    createDataChannel = vi.fn()
    setLocalDescription = vi.fn()
    setRemoteDescription = vi.fn()
    addTrack = vi.fn()
    close = vi.fn()
    getSenders = vi.fn().mockReturnValue([])
    createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' })
    createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' })
    addEventListener = vi.fn()
    removeEventListener = vi.fn()
    connectionState = 'new'
    iceConnectionState = 'new'
    signalingState = 'stable'
    static generateCertificate = vi.fn()
}

// Setup globals
vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
vi.stubGlobal('BroadcastChannel', class {
    onmessage = null
    postMessage = vi.fn()
    close = vi.fn()
})

describe('SimplePeerManager', () => {
    let manager: SimplePeerManager

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        MockWebSocket.instances = []

        // Mock electronAPI
        const mockElectronAPI = {
            getICEServers: vi.fn().mockResolvedValue([]),
            getMQTTBrokers: vi.fn().mockResolvedValue([{ url: 'wss://test-broker/mqtt' }])
        }

        Object.defineProperty(window, 'electronAPI', {
            value: mockElectronAPI,
            writable: true,
            configurable: true
        })

        manager = new SimplePeerManager()
    })

    afterEach(() => {
        manager.leaveRoom()
        vi.runOnlyPendingTimers()
        vi.useRealTimers()
        // Clean up window properties
        // @ts-ignore
        delete window.electronAPI
    })

    describe('generatePeerId', () => {
        it('should generate valid peer ID', () => {
            const id = generatePeerId()
            expect(id).toHaveLength(16)
        })
    })

    describe('joinRoom', () => {
        it('should join room and connect to MQTT', async () => {
            const joinPromise = manager.joinRoom('test-room', 'Alice')

            // Allow loadCredentials logic to proceed (Promise microtasks)
            await Promise.resolve()
            await Promise.resolve()

            // Advance time for WebSocket open (10ms) and CONNACK (10ms + overhead)
            await vi.advanceTimersByTimeAsync(100)

            await joinPromise

            expect(manager.getSignalingState()).toBe('connected')
            expect(MockWebSocket.instances.length).toBeGreaterThan(0)
            expect(MockWebSocket.instances[0].url).toBe('wss://test-broker/mqtt')
        })

        it('should handle MQTT connection failure', async () => {
            // Restore WebSocket to be mocked differently for this test
            const originalWebSocket = global.WebSocket

            // Override WebSocket directly on global
            // We use a class expression to create a specific broken WebSocket
            vi.stubGlobal('WebSocket', class extends MockWebSocket {
                constructor(url: string) {
                    super(url)
                    // Disable automatic open to simulate timeout
                    this.onopen = null
                }
            })

            const joinPromise = manager.joinRoom('test-room', 'Alice')

            // Allow initial sync startup code
            await Promise.resolve()

            // Advance time past MQTT_CONNECT_TIMEOUT (8000ms)
            // We need to advance enough to trigger the timeout in SimplePeerManager
            await vi.advanceTimersByTimeAsync(10000)

            await joinPromise

            // Should fall back to connected state (using BroadcastChannel)
            expect(manager.getSignalingState()).toBe('connected')

            // Restore WebSocket
            vi.stubGlobal('WebSocket', originalWebSocket)
        })
    })

    describe('Cleanup', () => {
        it('should disconnect cleanly', async () => {
            const joinPromise = manager.joinRoom('test-room', 'Alice')
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(100)
            await joinPromise

            expect(manager.getSignalingState()).toBe('connected')

            manager.leaveRoom()

            expect(manager.getSignalingState()).toBe('idle')
            // Verify all sockets closed
            MockWebSocket.instances.forEach(ws => expect(ws.close).toHaveBeenCalled())
        })
    })
})
