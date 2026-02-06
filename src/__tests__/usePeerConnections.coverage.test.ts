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

// Track all created MockRTCPeerConnection instances
let createdPeerConnections: MockRTCPeerConnection[] = []

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

    constructor(_config?: RTCConfiguration) {
        createdPeerConnections.push(this)
    }

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

describe('usePeerConnections - coverage gaps', () => {
    const mockOnIceCandidate = vi.fn()
    const mockOnConnectionStateChange = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
        createdPeerConnections = []
    })

    describe('handleIceCandidate - pending candidates when no remoteDescription', () => {
        it('should store ICE candidate when connection exists but has no remote description', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Create a connection via createOffer (no remoteDescription set)
            await act(async () => {
                await result.current.createOffer('peer-no-remote')
            })

            // Verify the connection exists
            expect(result.current.peerConnections.has('peer-no-remote')).toBe(true)

            // The peer connection created via createOffer has localDescription but no remoteDescription
            const candidate: RTCIceCandidateInit = {
                candidate: 'candidate:123 1 udp 2122260223 192.168.1.1 12345 typ host',
                sdpMLineIndex: 0,
                sdpMid: 'audio'
            }

            await act(async () => {
                await result.current.handleIceCandidate('peer-no-remote', candidate)
            })

            // addIceCandidate should NOT have been called since there's no remoteDescription
            expect(mockImplementations.addIceCandidate).not.toHaveBeenCalled()
            // The candidate should be stored as pending (we verify by later adding remote desc)
            expect(mockModuleLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Storing ICE candidate for peer-no-remote (no remote description)'),
            )
        })

        it('should add pending candidates after setting remote description via handleAnswer', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Create an offer to establish connection
            await act(async () => {
                await result.current.createOffer('peer-pending')
            })

            // Send an ICE candidate while no remoteDescription
            const candidate: RTCIceCandidateInit = {
                candidate: 'candidate:999 1 udp 12345 10.0.0.1 5000 typ host',
                sdpMLineIndex: 0,
                sdpMid: 'audio'
            }

            await act(async () => {
                await result.current.handleIceCandidate('peer-pending', candidate)
            })

            // addIceCandidate should not have been called yet
            expect(mockImplementations.addIceCandidate).not.toHaveBeenCalled()

            // Now handle the answer which sets remoteDescription and flushes pending candidates
            const answer: RTCSessionDescriptionInit = {
                type: 'answer',
                sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111'
            }

            await act(async () => {
                await result.current.handleAnswer('peer-pending', answer)
            })

            // Now addIceCandidate should have been called for the pending candidate
            expect(mockImplementations.addIceCandidate).toHaveBeenCalled()
        })
    })

    describe('handleIceCandidate - addIceCandidate error handling', () => {
        it('should log error when addIceCandidate throws', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Create connection via handleOffer so remoteDescription is set
            const offer: RTCSessionDescriptionInit = {
                type: 'offer',
                sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10'
            }

            await act(async () => {
                await result.current.handleOffer('peer-ice-err', offer)
            })

            // Make addIceCandidate reject
            const testError = new Error('ICE candidate failed')
            mockImplementations.addIceCandidate.mockRejectedValueOnce(testError)

            const candidate: RTCIceCandidateInit = {
                candidate: 'candidate:bad',
                sdpMLineIndex: 0
            }

            await act(async () => {
                await result.current.handleIceCandidate('peer-ice-err', candidate)
            })

            // Should have logged the error
            expect(mockModuleLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to add ICE candidate for peer-ice-err'),
                testError
            )
        })
    })

    describe('replaceTrack - error handling', () => {
        it('should log error when replaceTrack rejects', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Create a connection
            await act(async () => {
                await result.current.createOffer('peer-replace-err')
            })

            // Add a local stream with an audio track
            const initialTrack = { kind: 'audio', id: 'track-init' } as MediaStreamTrack
            const mockStream = {
                id: 'stream-err',
                getTracks: () => [initialTrack],
                getAudioTracks: () => [initialTrack]
            } as MediaStream

            act(() => {
                result.current.addLocalStream(mockStream)
            })

            // Get the sender and make its replaceTrack reject
            const pc = result.current.peerConnections.get('peer-replace-err')
            const sender = pc?.connection.getSenders()[0]
            expect(sender).toBeDefined()

            const replaceError = new Error('Replace track failed')
            sender!.replaceTrack = vi.fn().mockRejectedValue(replaceError)

            const newTrack = { kind: 'audio', id: 'new-track-err' } as MediaStreamTrack

            // Call replaceTrack - the error is caught inside .catch()
            act(() => {
                result.current.replaceTrack(newTrack)
            })

            // Wait for the promise rejection to be handled
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 10))
            })

            expect(mockModuleLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to replace track for peer-replace-err'),
                replaceError
            )
        })

        it('should skip peers with no audio sender', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Create a connection but do NOT add any local stream (so no senders)
            await act(async () => {
                await result.current.createOffer('peer-no-sender')
            })

            const newTrack = { kind: 'audio', id: 'track-skip' } as MediaStreamTrack

            // Should not throw
            act(() => {
                result.current.replaceTrack(newTrack)
            })

            // No error should be logged since there's no sender to replace
            expect(mockModuleLogger.error).not.toHaveBeenCalled()
        })
    })

    describe('addLocalStream - duplicate track handling', () => {
        it('should not add a track that is already present in senders', async () => {
            mockImplementations.addTrack.mockClear()

            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-dup-track')
            })

            const mockTrack = { kind: 'audio', id: 'dup-track' } as MediaStreamTrack
            const mockStream = {
                id: 'stream-dup',
                getTracks: () => [mockTrack],
                getAudioTracks: () => [mockTrack]
            } as MediaStream

            // First addLocalStream call
            act(() => {
                result.current.addLocalStream(mockStream)
            })

            const callsAfterFirst = mockImplementations.addTrack.mock.calls.length
            expect(callsAfterFirst).toBe(1)

            // Second addLocalStream call with same track
            act(() => {
                result.current.addLocalStream(mockStream)
            })

            // Should not have added the track again because getSenders returns the existing sender
            expect(mockImplementations.addTrack.mock.calls.length).toBe(callsAfterFirst)
        })
    })

    describe('closePeerConnection - cleanup', () => {
        it('should remove peer from connections and remote streams', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Create offer to establish a connection
            await act(async () => {
                await result.current.createOffer('peer-cleanup')
            })

            expect(result.current.peerConnections.has('peer-cleanup')).toBe(true)

            // Simulate a remote stream by triggering ontrack on the mock connection
            const mockPC = createdPeerConnections[0]
            const mockRemoteTrack = { kind: 'audio', id: 'remote-track' } as MediaStreamTrack
            const mockRemoteStream = {
                id: 'remote-stream',
                getTracks: () => [mockRemoteTrack],
                getAudioTracks: () => [mockRemoteTrack]
            } as unknown as MediaStream

            await act(async () => {
                mockPC.ontrack?.({
                    track: mockRemoteTrack,
                    streams: [mockRemoteStream]
                })
            })

            expect(result.current.remoteStreams.has('peer-cleanup')).toBe(true)

            // Now close
            act(() => {
                result.current.closePeerConnection('peer-cleanup')
            })

            expect(result.current.peerConnections.has('peer-cleanup')).toBe(false)
            expect(result.current.remoteStreams.has('peer-cleanup')).toBe(false)
            expect(mockImplementations.close).toHaveBeenCalled()
        })
    })

    describe('getConnectionState', () => {
        it('should return connection state for existing peer', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-state')
            })

            const state = result.current.getConnectionState('peer-state')
            expect(state).toBe('new')
        })

        it('should return null for non-existing peer', () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            const state = result.current.getConnectionState('nonexistent')
            expect(state).toBeNull()
        })
    })

    describe('RTCPeerConnection event handlers', () => {
        it('should call onIceCandidate callback when ICE candidate event fires', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-ice-event')
            })

            const mockPC = createdPeerConnections[0]
            const mockCandidate = {
                type: 'host',
                toJSON: () => ({ candidate: 'candidate:abc', sdpMLineIndex: 0, sdpMid: 'audio' })
            }

            act(() => {
                mockPC.onicecandidate?.({ candidate: mockCandidate })
            })

            expect(mockOnIceCandidate).toHaveBeenCalledWith('peer-ice-event', {
                candidate: 'candidate:abc',
                sdpMLineIndex: 0,
                sdpMid: 'audio'
            })
        })

        it('should not call onIceCandidate when candidate is null (ICE gathering complete)', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-ice-null')
            })

            const mockPC = createdPeerConnections[0]

            act(() => {
                mockPC.onicecandidate?.({ candidate: null })
            })

            expect(mockOnIceCandidate).not.toHaveBeenCalled()
        })

        it('should restart ICE when iceConnectionState is failed', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-ice-fail')
            })

            const mockPC = createdPeerConnections[0]
            mockPC.iceConnectionState = 'failed' as RTCIceConnectionState

            act(() => {
                mockPC.oniceconnectionstatechange?.()
            })

            expect(mockImplementations.restartIce).toHaveBeenCalled()
        })

        it('should not restart ICE when iceConnectionState is not failed', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-ice-ok')
            })

            const mockPC = createdPeerConnections[0]
            mockPC.iceConnectionState = 'connected' as RTCIceConnectionState

            act(() => {
                mockPC.oniceconnectionstatechange?.()
            })

            expect(mockImplementations.restartIce).not.toHaveBeenCalled()
        })

        it('should update state and notify on connection state change', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-conn-state')
            })

            const mockPC = createdPeerConnections[0]
            mockPC.connectionState = 'connected' as RTCPeerConnectionState

            act(() => {
                mockPC.onconnectionstatechange?.()
            })

            expect(mockOnConnectionStateChange).toHaveBeenCalledWith('peer-conn-state', 'connected')
        })

        it('should handle disconnected connection state', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-disconnect')
            })

            const mockPC = createdPeerConnections[0]
            mockPC.connectionState = 'disconnected' as RTCPeerConnectionState

            act(() => {
                mockPC.onconnectionstatechange?.()
            })

            expect(mockOnConnectionStateChange).toHaveBeenCalledWith('peer-disconnect', 'disconnected')
            expect(mockModuleLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Connection disconnected for peer-disconnect')
            )
        })

        it('should handle failed connection state', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-fail-state')
            })

            const mockPC = createdPeerConnections[0]
            mockPC.connectionState = 'failed' as RTCPeerConnectionState

            act(() => {
                mockPC.onconnectionstatechange?.()
            })

            expect(mockOnConnectionStateChange).toHaveBeenCalledWith('peer-fail-state', 'failed')
            expect(mockModuleLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Connection failed for peer-fail-state')
            )
        })

        it('should handle ontrack event with stream in event.streams', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-track-event')
            })

            const mockPC = createdPeerConnections[0]
            const mockTrack = { kind: 'audio', id: 'remote-audio' } as MediaStreamTrack
            const mockStream = {
                id: 'remote-stream-1',
                getTracks: () => [mockTrack]
            } as unknown as MediaStream

            await act(async () => {
                mockPC.ontrack?.({
                    track: mockTrack,
                    streams: [mockStream]
                })
            })

            expect(result.current.remoteStreams.has('peer-track-event')).toBe(true)
            expect(result.current.remoteStreams.get('peer-track-event')).toBe(mockStream)
        })

        it('should create new MediaStream when ontrack event has no streams', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-track-no-stream')
            })

            const mockPC = createdPeerConnections[0]
            const mockTrack = { kind: 'audio', id: 'orphan-track' } as MediaStreamTrack

            await act(async () => {
                mockPC.ontrack?.({
                    track: mockTrack,
                    streams: [] // no streams
                })
            })

            expect(result.current.remoteStreams.has('peer-track-no-stream')).toBe(true)
        })

        it('should fire onnegotiationneeded without error', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            await act(async () => {
                await result.current.createOffer('peer-neg')
            })

            const mockPC = createdPeerConnections[0]

            // Should not throw
            act(() => {
                mockPC.onnegotiationneeded?.()
            })

            expect(mockModuleLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining('Negotiation needed for peer-neg')
            )
        })
    })

    describe('createPeerConnection with existing local stream', () => {
        it('should add local tracks to new peer connection when localStream exists', async () => {
            mockImplementations.addTrack.mockClear()

            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            const mockTrack = { kind: 'audio', id: 'local-audio' } as MediaStreamTrack
            const mockStream = {
                id: 'local-stream',
                getTracks: () => [mockTrack],
                getAudioTracks: () => [mockTrack]
            } as MediaStream

            // First set local stream (no connections exist yet)
            act(() => {
                result.current.addLocalStream(mockStream)
            })

            // Now create a new peer connection - it should auto-add the local tracks
            await act(async () => {
                await result.current.createOffer('peer-with-local')
            })

            // addTrack should have been called when the peer connection was created
            expect(mockImplementations.addTrack).toHaveBeenCalledWith(mockTrack, mockStream)
        })
    })

    describe('handleOffer with existing connection', () => {
        it('should reuse existing connection when handling offer for known peer', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // First create a connection
            await act(async () => {
                await result.current.createOffer('peer-reuse-offer')
            })

            const connectionsBeforeOffer = createdPeerConnections.length

            // Now handle an offer for the same peer - should reuse
            const offer: RTCSessionDescriptionInit = {
                type: 'offer',
                sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10'
            }

            await act(async () => {
                await result.current.handleOffer('peer-reuse-offer', offer)
            })

            // Should not have created a new connection
            expect(createdPeerConnections.length).toBe(connectionsBeforeOffer)
        })
    })

    describe('handleAnswer error handling', () => {
        it('should log error when setRemoteDescription rejects during handleAnswer', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Create a connection first
            await act(async () => {
                await result.current.createOffer('peer-answer-err')
            })

            // Make setRemoteDescription reject
            const answerError = new Error('Failed to set remote desc')
            mockImplementations.setRemoteDescription.mockRejectedValueOnce(answerError)

            const answer: RTCSessionDescriptionInit = {
                type: 'answer',
                sdp: 'v=0\r\nm=audio'
            }

            await act(async () => {
                await result.current.handleAnswer('peer-answer-err', answer)
            })

            expect(mockModuleLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to handle answer from peer-answer-err'),
                answerError
            )
        })
    })

    describe('addPendingCandidates error handling', () => {
        it('should log warning when a pending candidate fails to add', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Store an ICE candidate when no connection exists
            const candidate: RTCIceCandidateInit = {
                candidate: 'candidate:bad-pending',
                sdpMLineIndex: 0,
                sdpMid: 'audio'
            }

            await act(async () => {
                await result.current.handleIceCandidate('peer-bad-pending', candidate)
            })

            // Make addIceCandidate reject when pending candidates are flushed
            const pendingError = new Error('Pending candidate failed')
            mockImplementations.addIceCandidate.mockRejectedValueOnce(pendingError)

            // Now create the connection via handleOffer (which calls addPendingCandidates)
            const offer: RTCSessionDescriptionInit = {
                type: 'offer',
                sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10'
            }

            await act(async () => {
                await result.current.handleOffer('peer-bad-pending', offer)
            })

            expect(mockModuleLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Failed to add pending candidate for peer-bad-pending'),
                pendingError
            )
        })
    })

    describe('usePeerConnections without onConnectionStateChange', () => {
        it('should work when onConnectionStateChange callback is not provided', async () => {
            // Render without the optional callback
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate)
            )

            await act(async () => {
                await result.current.createOffer('peer-no-cb')
            })

            const mockPC = createdPeerConnections[0]
            mockPC.connectionState = 'connected' as RTCPeerConnectionState

            // Should not throw even though no onConnectionStateChange callback
            act(() => {
                mockPC.onconnectionstatechange?.()
            })

            // No error should occur
            expect(result.current.peerConnections.size).toBe(1)
        })
    })

    describe('multiple pending ICE candidates', () => {
        it('should store and flush multiple pending candidates for the same peer', async () => {
            const { result } = renderHook(() =>
                usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange)
            )

            // Store multiple ICE candidates when no connection exists
            const candidate1: RTCIceCandidateInit = {
                candidate: 'candidate:1',
                sdpMLineIndex: 0
            }
            const candidate2: RTCIceCandidateInit = {
                candidate: 'candidate:2',
                sdpMLineIndex: 0
            }

            await act(async () => {
                await result.current.handleIceCandidate('peer-multi', candidate1)
                await result.current.handleIceCandidate('peer-multi', candidate2)
            })

            // Neither should have called addIceCandidate
            expect(mockImplementations.addIceCandidate).not.toHaveBeenCalled()

            // Now handle offer which sets remote description and adds pending candidates
            const offer: RTCSessionDescriptionInit = {
                type: 'offer',
                sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fmtp:111 minptime=10'
            }

            await act(async () => {
                await result.current.handleOffer('peer-multi', offer)
            })

            // Both pending candidates should have been flushed
            expect(mockImplementations.addIceCandidate).toHaveBeenCalledTimes(2)
        })
    })
})
