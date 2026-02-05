
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePeerConnections } from '../renderer/hooks/usePeerConnections';

// Mock MockRTCPeerConnection
class MockRTCPeerConnection {
    onicecandidate: any;
    onconnectionstatechange: any;
    oniceconnectionstatechange: any;
    ontrack: any;
    onnegotiationneeded: any;
    connectionState: string = 'new';
    iceConnectionState: string = 'new';
    localDescription: any;
    remoteDescription: any;

    createOffer = vi.fn().mockResolvedValue({ sdp: 'v=0\r\n...', type: 'offer' });
    createAnswer = vi.fn().mockResolvedValue({ sdp: 'v=0\r\n...', type: 'answer' });
    setLocalDescription = vi.fn().mockImplementation((desc) => {
        this.localDescription = desc;
        return Promise.resolve();
    });
    setRemoteDescription = vi.fn().mockImplementation((desc) => {
        this.remoteDescription = desc;
        return Promise.resolve();
    });
    addIceCandidate = vi.fn().mockResolvedValue(undefined);
    addTrack = vi.fn();
    getSenders = vi.fn().mockReturnValue([]);
    close = vi.fn();
    restartIce = vi.fn();

    constructor(_config: any) { }
}

global.RTCPeerConnection = MockRTCPeerConnection as any;
class MockRTCSessionDescription {
    type?: RTCSdpType;
    sdp?: string;
    constructor(init: RTCSessionDescriptionInit) {
        Object.assign(this, init);
    }
}

class MockRTCIceCandidate {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    constructor(init: RTCIceCandidateInit) {
        Object.assign(this, init);
    }
}

global.RTCSessionDescription = MockRTCSessionDescription as any;
global.RTCIceCandidate = MockRTCIceCandidate as any;

describe('usePeerConnections', () => {
    const mockOnIceCandidate = vi.fn();
    const mockOnConnectionStateChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with empty state', () => {
        const { result } = renderHook(() => usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange));
        expect(result.current.peerConnections).toBeInstanceOf(Map);
        expect(result.current.peerConnections.size).toBe(0);
    });

    it('should create offer and setup connection', async () => {
        const { result } = renderHook(() => usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange));

        let offer;
        await act(async () => {
            offer = await result.current.createOffer('peer-1');
        });

        expect(offer).toBeDefined();
        expect(result.current.peerConnections.has('peer-1')).toBe(true);
        expect(result.current.peerConnections.get('peer-1')?.isInitiator).toBe(true);
    });

    it('should handle incoming offer', async () => {
        const { result } = renderHook(() => usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange));

        await act(async () => {
            await result.current.handleOffer('peer-2', { type: 'offer', sdp: 'test' });
        });

        expect(result.current.peerConnections.has('peer-2')).toBe(true);
        expect(result.current.peerConnections.get('peer-2')?.isInitiator).toBe(false);
    });

    it('should close connection', async () => {
        const { result } = renderHook(() => usePeerConnections(mockOnIceCandidate, mockOnConnectionStateChange));

        await act(async () => {
            await result.current.createOffer('peer-1');
        });

        expect(result.current.peerConnections.has('peer-1')).toBe(true);

        act(() => {
            result.current.closePeerConnection('peer-1');
        });

        expect(result.current.peerConnections.has('peer-1')).toBe(false);
    });
});
