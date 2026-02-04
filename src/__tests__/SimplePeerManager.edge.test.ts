/**
 * Edge Case Tests for SimplePeerManager
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    SimplePeerManager,
    resetCredentialsCacheForTesting,
    MultiBrokerMQTT
} from '../renderer/signaling/SimplePeerManager'

// --- Mocks ---
import { SignalingLog } from '../renderer/utils/Logger'

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

    send = vi.fn()
    close = vi.fn()
}

// Mock BroadcastChannel
class MockBroadcastChannel {
    name: string
    onmessage: ((event: MessageEvent) => void) | null = null
    close = vi.fn()
    postMessage = vi.fn()

    constructor(name: string) {
        this.name = name
    }
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
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)

describe('SimplePeerManager - Edge Cases', () => {
    let manager: SimplePeerManager

    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        resetCredentialsCacheForTesting()

        // Mock Electron API default behavior
        Object.defineProperty(window, 'electronAPI', {
            value: {
                getICEServers: vi.fn().mockResolvedValue([]),
                getMQTTBrokers: vi.fn().mockResolvedValue([{ url: 'wss://test-broker/mqtt' }])
            },
            writable: true,
            configurable: true
        })

        // Mock MultiBrokerMQTT default behavior to succeed without real WebSockets
        vi.spyOn(MultiBrokerMQTT.prototype, 'connectAll').mockResolvedValue(['wss://test-broker/mqtt'])
        vi.spyOn(MultiBrokerMQTT.prototype, 'subscribeAll').mockResolvedValue(1)
        vi.spyOn(MultiBrokerMQTT.prototype, 'publish').mockReturnValue(1)
        vi.spyOn(MultiBrokerMQTT.prototype, 'disconnect').mockReturnValue(undefined)
        vi.spyOn(MultiBrokerMQTT.prototype, 'isConnected').mockReturnValue(true)

        manager = new SimplePeerManager()
    })

    afterEach(() => {
        manager.leaveRoom()
        vi.runOnlyPendingTimers()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('logs error when loadCredentials fails but proceeds with join', async () => {
        Object.defineProperty(window, 'electronAPI', {
            value: {
                getICEServers: vi.fn().mockRejectedValue(new Error('Auth failed')),
                getMQTTBrokers: vi.fn().mockResolvedValue([])
            },
            writable: true
        })

        const onErrorSpy = vi.fn()
        manager.setCallbacks({ onError: onErrorSpy })

        resetCredentialsCacheForTesting()

        // Attempt join
        const joinPromise = manager.joinRoom('fail-room', 'Bob')
        await vi.advanceTimersByTimeAsync(200)
        await joinPromise

        expect(onErrorSpy).not.toHaveBeenCalled()
        expect(SignalingLog.error).toHaveBeenCalledWith(
            expect.stringContaining('Failed to load credentials'),
            expect.anything()
        )
        expect(manager.getSignalingState()).toBe('connected')
    })

    it('falls back to BroadcastChannel if MQTT fails', async () => {
        // Mock MQTT failure
        vi.spyOn(MultiBrokerMQTT.prototype, 'connectAll').mockResolvedValue([])
        vi.spyOn(MultiBrokerMQTT.prototype, 'isConnected').mockReturnValue(false)

        const joinPromise = manager.joinRoom('bc-room', 'Dave')
        await vi.advanceTimersByTimeAsync(100)
        await joinPromise

        expect(manager.getSignalingState()).toBe('connected')

        const bc = (manager as any).broadcastChannel
        expect(bc).toBeDefined()

        const msg = {
            v: 1,
            type: 'announce',
            from: 'peer-bc-' + Date.now(),
            userName: 'PC',
            sessionId: (manager as any).sessionId,
            msgId: 'msg-bc-1',
            data: {}
        }

        // We expect SimplePeerManager to reply either with 'announce' (if smaller id) or 'offer' (if larger id)
        // It sends reply via broadcast() which uses bc.postMessage() if available

        if (bc.onmessage) {
            bc.onmessage({ data: msg } as MessageEvent)
        }

        // Wait for async handling
        await vi.advanceTimersByTimeAsync(10)

        expect(bc.postMessage).toHaveBeenCalled()
    })

    it('broadcasts mute status when peers exist', async () => {
        await manager.joinRoom('mute-room', 'Eve')
        await vi.advanceTimersByTimeAsync(100)

        // Inject dummy peer so broadcast happens
        const mockPeerPC = new MockRTCPeerConnection()
        const peer: any = {
            pc: mockPeerPC,
            muteStatus: { micMuted: false, speakerMuted: false },
            isConnected: true
        };
        (manager as any).peers.set('other-peer', peer as any)

        manager.broadcastMuteStatus(true, false)

        expect(MultiBrokerMQTT.prototype.publish).toHaveBeenCalledWith(
            expect.stringContaining('p2p-conf/mute-room'),
            expect.stringContaining('"type":"mute-status"')
        )
    })

    it('skips replacing tracks if already present', async () => {
        await manager.joinRoom('stream-room', 'Frank')
        await vi.advanceTimersByTimeAsync(100)

        // Add a peer manually
        const mockPeerPC = new MockRTCPeerConnection()
        // Mock existing audio sender
        const track1 = { kind: 'audio', id: 'a1', label: 'mic1' }
        const sender = { track: track1, replaceTrack: vi.fn() }
        mockPeerPC.getSenders.mockReturnValue([sender])

        const peer: any = {
            pc: mockPeerPC,
            muteStatus: { micMuted: false, speakerMuted: false },
            isConnected: true
        };
        (manager as any).peers.set('other-peer', peer as any)

        const stream1 = {
            id: 's1',
            getTracks: () => [track1],
            getAudioTracks: () => [track1]
        } as any

        // Set stream that matches existing track
        manager.setLocalStream(stream1)

        // Should find existing track and return early
        const { SignalingLog } = await import('../renderer/utils/Logger')
        expect(SignalingLog.debug).toHaveBeenCalledWith(
            expect.stringContaining('Track already being sent'),
            expect.anything()
        )

        expect(mockPeerPC.addTrack).not.toHaveBeenCalled()
    })
})
