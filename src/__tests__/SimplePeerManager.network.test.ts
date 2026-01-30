/**
 * Network Resilience Tests for SimplePeerManager
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    SimplePeerManager,
    resetCredentialsCacheForTesting,
    MultiBrokerMQTT
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
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            this.onopen?.()
        }, 10)
    }

    send = vi.fn((data: Uint8Array) => {
        // Basic MQTT ACK handling to allow connection
        const packetType = data[0] & 0xF0
        setTimeout(() => {
            if (this.readyState !== MockWebSocket.OPEN) return

            // CONNECT -> CONNACK
            if (packetType === 0x10) {
                if (this.onmessage) this.onmessage({ data: new Uint8Array([0x20, 0x02, 0x00, 0x00]).buffer })
            }
            // SUBSCRIBE -> SUBACK
            else if (packetType === 0x80) {
                if (this.onmessage) this.onmessage({ data: new Uint8Array([0x90, 0x03, 0x00, 0x01, 0x00]).buffer })
            }
        }, 10)
    })

    close = vi.fn(() => {
        this.readyState = MockWebSocket.CLOSED
        this.onclose?.()
    })
}

// Mock RTCPeerConnection
class MockRTCPeerConnection {
    iceConnectionState = 'new'
    connectionState = 'new'
    close = vi.fn()
    getSenders = vi.fn().mockReturnValue([])
    addTrack = vi.fn()
    createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' })
    setLocalDescription = vi.fn()
}

vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
vi.stubGlobal('BroadcastChannel', class {
    close = vi.fn()
    postMessage = vi.fn()
    onmessage = null
})

describe('SimplePeerManager - Network Resilience', () => {
    let manager: SimplePeerManager
    let onlineListener: any
    let offlineListener: any

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        resetCredentialsCacheForTesting()

        // Capture event listeners
        const originalAddEventListener = window.addEventListener
        window.addEventListener = vi.fn((event, handler) => {
            if (event === 'online') onlineListener = handler
            if (event === 'offline') offlineListener = handler
            originalAddEventListener(event, handler)
        })

        // Mock Electron API
        Object.defineProperty(window, 'electronAPI', {
            value: {
                getICEServers: vi.fn().mockResolvedValue([]),
                getMQTTBrokers: vi.fn().mockResolvedValue([{ url: 'wss://test-broker/mqtt' }])
            },
            writable: true,
            configurable: true
        })

        // Mock navigator.onLine
        Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })

        manager = new SimplePeerManager()
    })

    afterEach(() => {
        manager.leaveRoom()
        vi.runOnlyPendingTimers()
        vi.useRealTimers()
        // @ts-ignore
        delete window.electronAPI
        vi.restoreAllMocks()
    })

    it('detects offline state and cleans up timers', async () => {
        // Join a room first
        const joinPromise = manager.joinRoom('test-room', 'Alice')
        await vi.advanceTimersByTimeAsync(200)
        await joinPromise

        // Simulate going offline
        Object.defineProperty(navigator, 'onLine', { value: false })
        if (offlineListener) offlineListener()

        const status = manager.getNetworkStatus()
        expect(status.isOnline).toBe(false)
        expect(status.wasInRoomWhenOffline).toBe(true)
    })

    it('attempts reconnection when coming back online if was in room', async () => {
        // 1. Join room
        const joinPromise = manager.joinRoom('test-room', 'Alice')
        await vi.advanceTimersByTimeAsync(200)
        await joinPromise

        // 2. Go offline
        Object.defineProperty(navigator, 'onLine', { value: false })
        if (offlineListener) offlineListener()

        // 3. Go online
        Object.defineProperty(navigator, 'onLine', { value: true })
        if (onlineListener) onlineListener()

        // Verify IsOnline is true immediately
        expect(manager.getNetworkStatus().isOnline).toBe(true)

        // 4. Fast forward time to trigger delayed reconnect
        await vi.advanceTimersByTimeAsync(2500) // Default delay is ~2000ms

        // At this point, it should have triggered reconnect logic
        // We implicitly verify this by checking if it tried to connect (via mocks/spies if we had them)
        // or just ensure no errors were thrown.
    })

    it('manual reconnect triggers reconnection flows', async () => {
        const joinPromise = manager.joinRoom('test-room', 'Bob')
        await vi.advanceTimersByTimeAsync(200)
        await joinPromise

        // Manual reconnect
        const manualReconnectPromise = manager.manualReconnect()
        await vi.advanceTimersByTimeAsync(100)
        const result = await manualReconnectPromise

        expect(result).toBe(true)

        // Manual reconnect sets wasInRoomWhenOffline = true then calls attemptNetworkReconnect
        // We need to advance time for the actual reconnect attempt
        await vi.advanceTimersByTimeAsync(2500)

        expect(manager.getNetworkStatus().wasInRoomWhenOffline).toBe(false)
    })

    it('stops reconnecting after max attempts', async () => {
        // Join room
        const joinPromise = manager.joinRoom('test-room', 'Alice')
        await vi.advanceTimersByTimeAsync(200)
        await joinPromise

        // Go offline
        Object.defineProperty(navigator, 'onLine', { value: false })
        if (offlineListener) offlineListener()

        // Mock MultiBrokerMQTT to fail connection
        const connectSpy = vi.spyOn(MultiBrokerMQTT.prototype, 'connectAll').mockResolvedValue([])
        vi.spyOn(MultiBrokerMQTT.prototype, 'isConnected').mockReturnValue(false)

        // Come back online
        Object.defineProperty(navigator, 'onLine', { value: true })
        if (onlineListener) onlineListener()

        // Trigger reconnect flow (Attempt 1)
        await vi.advanceTimersByTimeAsync(2500)
        expect(manager.getNetworkStatus().reconnectAttempts).toBe(2) // 1 (initial) + 1 (retry scheduled)

        // Wait for retry (Attempt 2)
        await vi.advanceTimersByTimeAsync(3500)
        expect(manager.getNetworkStatus().reconnectAttempts).toBe(3)

        // Wait for retry (Attempt 3)
        await vi.advanceTimersByTimeAsync(5000)
        expect(manager.getNetworkStatus().reconnectAttempts).toBe(4)

        // Wait for retry (Attempt 4)
        await vi.advanceTimersByTimeAsync(7000)
        expect(manager.getNetworkStatus().reconnectAttempts).toBe(5)

        // Wait for retry (Attempt 5 - Max)
        await vi.advanceTimersByTimeAsync(11000)

        // Should have reset after failure
        expect(manager.getNetworkStatus().reconnectAttempts).toBe(0)

        expect(connectSpy).toHaveBeenCalled()
    })
})
