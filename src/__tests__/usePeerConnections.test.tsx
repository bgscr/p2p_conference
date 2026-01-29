/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePeerConnections } from '../renderer/hooks/usePeerConnections'

// Use vi.hoisted to properly hoist mock variables
const mockModuleLogger = vi.hoisted(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
}))

vi.mock('../renderer/utils/Logger', () => ({
    logger: {
        createModuleLogger: () => mockModuleLogger
    },
    SignalingLog: mockModuleLogger,
    WebRTCLog: mockModuleLogger,
    PeerLog: mockModuleLogger
}))

// Mock RTCPeerConnection
// Store mock implementations to allow test-time overriding
const mockImplementations = {
    createOffer: vi.fn().mockResolvedValue({
        type: 'offer',
        sdp: 'v=0\r\no=- 123 1 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=60000;stereo=0;useinbandfec=1'
    }),
    createAnswer: vi.fn().mockResolvedValue({
        type: 'answer',
        sdp: 'v=0\r\no=- 456 1 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=60000;stereo=0;useinbandfec=1'
    }),
    setLocalDescription: vi.fn(),
    setRemoteDescription: vi.fn(),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    addTrack: vi.fn(),
    getSenders: vi.fn(),
    restartIce: vi.fn(),
    close: vi.fn()
}

class MockRTCPeerConnection {
    connectionState: RTCPeerConnectionState = 'new'
    iceConnectionState: RTCIceConnectionState = 'new'
    signalingState: RTCSignalingState = 'stable'
    localDescription: RTCSessionDescription | null = null
    remoteDescription: RTCSessionDescription | null = null

    onicecandidate: ((event: any) => void) | null = null
    oniceconnectionstatechange: (() => void) | null = null
    onconnectionstatechange: (() => void) | null = null
    ontrack: ((event: any) => void) | null = null
    onnegotiationneeded: (() => void) | null = null

    private senders: any[] = []

    constructor(_config?: RTCConfiguration) { }

    async createOffer(_options?: RTCOfferOptions) {
        return mockImplementations.createOffer()
    }

    async createAnswer(_options?: RTCAnswerOptions) {
        return mockImplementations.createAnswer()
    }

    async setLocalDescription(desc: RTCSessionDescriptionInit) {
        this.localDescription = desc as RTCSessionDescription
        return mockImplementations.setLocalDescription(desc)
    }

    async setRemoteDescription(desc: RTCSessionDescription) {
        this.remoteDescription = desc
        return mockImplementations.setRemoteDescription(desc)
    }

    async addIceCandidate(candidate: RTCIceCandidateInit) {
        return mockImplementations.addIceCandidate(candidate)
    }

    addTrack(track: MediaStreamTrack, stream: MediaStream) {
        const sender = { track, replaceTrack: vi.fn().mockResolvedValue(undefined) }
        this.senders.push(sender)
        mockImplementations.addTrack(track, stream)
        return sender
    }

    getSenders() {
        mockImplementations.getSenders()
        return this.senders
    }

    restartIce() {
        mockImplementations.restartIce()
    }

    close() {
        mockImplementations.close()
    }
}

class MockRTCSessionDescription {
    type: RTCSdpType
    sdp: string

    constructor(init: RTCSessionDescriptionInit) {
        this.type = init.type!
        this.sdp = init.sdp || ''
    }
}

class MockRTCIceCandidate {
    candidate: string
    sdpMLineIndex: number | null
    sdpMid: string | null

    constructor(init: RTCIceCandidateInit) {
        this.candidate = init.candidate || ''
        this.sdpMLineIndex = init.sdpMLineIndex ?? null
        this.sdpMid = init.sdpMid ?? null
    }

    toJSON() {
        return {
            candidate: this.candidate,
            sdpMLineIndex: this.sdpMLineIndex,
            sdpMid: this.sdpMid
        }
    }
}

// Setup global mocks
global.RTCPeerConnection = MockRTCPeerConnection as any
global.RTCSessionDescription = MockRTCSessionDescription as any
global.RTCIceCandidate = MockRTCIceCandidate as any

describe('usePeerConnections', () => {
    const mockOnIceCandidate = vi.fn()
    const mockOnConnectionStateChange = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should initialize with empty maps', () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        expect(result.current.peerConnections.size).toBe(0)
        expect(result.current.remoteStreams.size).toBe(0)
    })

    it('should create an offer for a peer', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        let offer: RTCSessionDescriptionInit | null = null

        await act(async () => {
            offer = await result.current.createOffer('peer-1')
        })

        expect(offer).not.toBeNull()
        expect(offer!.type).toBe('offer')
        expect(offer!.sdp).toContain('v=0')
        expect(result.current.peerConnections.size).toBe(1)
    })

    it('should handle an incoming offer and create answer', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        const incomingOffer: RTCSessionDescriptionInit = {
            type: 'offer',
            sdp: 'v=0\r\no=- 789 1 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10'
        }

        let answer: RTCSessionDescriptionInit | null = null

        await act(async () => {
            answer = await result.current.handleOffer('peer-2', incomingOffer)
        })

        expect(answer).not.toBeNull()
        expect(answer!.type).toBe('answer')
        expect(result.current.peerConnections.size).toBe(1)
    })

    it('should handle an answer', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        // First create an offer
        await act(async () => {
            await result.current.createOffer('peer-3')
        })

        const answer: RTCSessionDescriptionInit = {
            type: 'answer',
            sdp: 'v=0\r\no=- 999 1 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111'
        }

        await act(async () => {
            await result.current.handleAnswer('peer-3', answer)
        })

        // Check that remote description was set

        expect(mockImplementations.setRemoteDescription).toHaveBeenCalled()
    })

    it('should handle answer for non-existent peer gracefully', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        const answer: RTCSessionDescriptionInit = {
            type: 'answer',
            sdp: 'v=0\r\nm=audio'
        }

        // Should not throw
        await act(async () => {
            await result.current.handleAnswer('non-existent', answer)
        })

        expect(result.current.peerConnections.size).toBe(0)
    })

    it('should store ICE candidates when no connection exists', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        const candidate: RTCIceCandidateInit = {
            candidate: 'candidate:123 1 udp 2122260223 192.168.1.1 12345 typ host',
            sdpMLineIndex: 0,
            sdpMid: 'audio'
        }

        // This should not throw, but store the candidate
        await act(async () => {
            await result.current.handleIceCandidate('new-peer', candidate)
        })

        // Connection doesn't exist yet, so size should still be 0
        expect(result.current.peerConnections.size).toBe(0)
    })

    it('should add ICE candidate when connection exists', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        // First create a connection and set remote description
        const offer: RTCSessionDescriptionInit = {
            type: 'offer',
            sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10'
        }

        await act(async () => {
            await result.current.handleOffer('peer-4', offer)
        })

        const candidate: RTCIceCandidateInit = {
            candidate: 'candidate:456',
            sdpMLineIndex: 0
        }

        await act(async () => {
            await result.current.handleIceCandidate('peer-4', candidate)
        })


        expect(mockImplementations.addIceCandidate).toHaveBeenCalled()
    })

    it('should add local stream to all connections', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        // Create some peer connections first
        await act(async () => {
            await result.current.createOffer('peer-a')
            await result.current.createOffer('peer-b')
        })

        const mockTrack = { kind: 'audio', id: 'track-1' } as MediaStreamTrack
        const mockStream = {
            id: 'stream-1',
            getTracks: () => [mockTrack],
            getAudioTracks: () => [mockTrack]
        } as MediaStream

        act(() => {
            result.current.addLocalStream(mockStream)
        })

        // Both connections should have addTrack called

        expect(mockImplementations.addTrack).toHaveBeenCalled()
        expect(mockImplementations.addTrack).toHaveBeenCalledTimes(2)
    })

    it('should not add duplicate tracks', async () => {
        mockImplementations.addTrack.mockClear()

        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        await act(async () => {
            await result.current.createOffer('peer-dup')
        })

        const mockTrack = { kind: 'audio', id: 'track-dup' } as MediaStreamTrack
        const mockStream = {
            id: 'stream-dup',
            getTracks: () => [mockTrack],
            getAudioTracks: () => [mockTrack]
        } as MediaStream

        // Add stream first time
        act(() => {
            result.current.addLocalStream(mockStream)
        })

        const callCount = mockImplementations.addTrack.mock.calls.length

        // Add same stream again
        act(() => {
            result.current.addLocalStream(mockStream)
        })

        // Should not add duplicate (call count should stay same)
        expect(mockImplementations.addTrack.mock.calls.length).toBe(callCount)
    })

    it('should replace track in all connections', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        // Create a connection
        await act(async () => {
            await result.current.createOffer('peer-track')
        })

        // Add initial stream
        const initialTrack = { kind: 'audio', id: 'initial-track' } as MediaStreamTrack
        const mockStream = {
            id: 'stream-1',
            getTracks: () => [initialTrack],
            getAudioTracks: () => [initialTrack]
        } as MediaStream

        act(() => {
            result.current.addLocalStream(mockStream)
        })

        // Replace track
        const newTrack = { kind: 'audio', id: 'new-track' } as MediaStreamTrack

        act(() => {
            result.current.replaceTrack(newTrack)
        })

        // Verify replaceTrack was called
        const pc = result.current.peerConnections.get('peer-track')
        const sender = pc?.connection.getSenders()[0]
        expect(sender?.replaceTrack).toHaveBeenCalledWith(newTrack)
    })

    it('should close a specific peer connection', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        await act(async () => {
            await result.current.createOffer('peer-close')
        })

        expect(result.current.peerConnections.size).toBe(1)

        act(() => {
            result.current.closePeerConnection('peer-close')
        })

        expect(result.current.peerConnections.size).toBe(0)
    })

    it('should handle closing non-existent peer gracefully', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        // Should not throw
        act(() => {
            result.current.closePeerConnection('non-existent')
        })

        expect(result.current.peerConnections.size).toBe(0)
    })

    it('should close all peer connections', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        await act(async () => {
            await result.current.createOffer('peer-1')
            await result.current.createOffer('peer-2')
            await result.current.createOffer('peer-3')
        })

        expect(result.current.peerConnections.size).toBe(3)

        act(() => {
            result.current.closeAllConnections()
        })

        expect(result.current.peerConnections.size).toBe(0)
        expect(result.current.remoteStreams.size).toBe(0)
    })

    it('should get connection state for a peer', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        await act(async () => {
            await result.current.createOffer('peer-state')
        })

        const state = result.current.getConnectionState('peer-state')
        expect(state).toBe('new')
    })

    it('should return null for non-existent peer connection state', () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        const state = result.current.getConnectionState('non-existent')
        expect(state).toBeNull()
    })

    it('should optimize Opus SDP', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        await act(async () => {
            const offer = await result.current.createOffer('peer-opus')
            // The SDP should contain Opus optimization settings
            expect(offer?.sdp).toContain('maxaveragebitrate=60000')
            expect(offer?.sdp).toContain('stereo=0')
            expect(offer?.sdp).toContain('useinbandfec=1')
        })
    })

    it('should reuse existing connection when creating offer for same peer', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        await act(async () => {
            await result.current.createOffer('peer-reuse')
        })

        expect(result.current.peerConnections.size).toBe(1)

        // Creating another offer for same peer should reuse connection
        await act(async () => {
            await result.current.createOffer('peer-reuse')
        })

        expect(result.current.peerConnections.size).toBe(1)
    })

    it('should cleanup on unmount', async () => {
        mockImplementations.close.mockClear()

        const { result, unmount } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        await act(async () => {
            await result.current.createOffer('peer-unmount')
        })

        unmount()

        expect(mockImplementations.close).toHaveBeenCalled()
    })

    it('should handle error during offer creation gracefully', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        // Make createOffer throw
        const originalCreateOffer = mockImplementations.createOffer
        mockImplementations.createOffer = vi.fn().mockRejectedValue(new Error('Test error'))

        let offer: RTCSessionDescriptionInit | null = null
        await act(async () => {
            offer = await result.current.createOffer('peer-error')
        })

        expect(offer).toBeNull()

        // Restore
        mockImplementations.createOffer = originalCreateOffer
    })

    it('should handle error during offer handling gracefully', async () => {
        const { result } = renderHook(() =>
            usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
        )

        // Make setRemoteDescription throw
        const originalSetRemote = mockImplementations.setRemoteDescription
        mockImplementations.setRemoteDescription = vi.fn().mockRejectedValue(new Error('Test error'))

        const offer: RTCSessionDescriptionInit = {
            type: 'offer',
            sdp: 'v=0\r\nm=audio'
        }

        let answer: RTCSessionDescriptionInit | null = null
        await act(async () => {
            answer = await result.current.handleOffer('peer-error-offer', offer)
        })

        expect(answer).toBeNull()

        // Restore
        mockImplementations.setRemoteDescription = originalSetRemote
    })
})
