/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ParticipantCard } from '../../renderer/components/ParticipantCard'

// Mock AudioMeter since it uses Canvas
vi.mock('../../renderer/components/AudioMeter', () => ({
    AudioMeter: () => <div data-testid="audio-meter" />
}))

// Mock useI18n
vi.mock('../../renderer/hooks/useI18n', () => ({
    useI18n: () => ({ t: (key: string) => key })
}))

// Mock Logger
vi.mock('../../renderer/utils/Logger', () => ({
    AudioLog: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

describe('ParticipantCard', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Mock AudioContext with proper class-like constructor
        class MockAudioContext {
            createAnalyser() {
                return {
                    fftSize: 256,
                    frequencyBinCount: 128,
                    connect: vi.fn(),
                    disconnect: vi.fn(),
                    getByteFrequencyData: vi.fn((arr: Uint8Array) => {
                        // Fill with some data to simulate audio
                        arr.fill(50)
                    })
                }
            }
            createMediaStreamSource() {
                return {
                    connect: vi.fn()
                }
            }
            createGain() {
                return {
                    gain: { value: 1 },
                    connect: vi.fn(),
                    disconnect: vi.fn()
                }
            }
        }
        global.AudioContext = MockAudioContext as any

        // Mock HTMLMediaElement.prototype.play
        HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
            // Mock setSinkId (experimental API)
            ; (HTMLMediaElement.prototype as any).setSinkId = vi.fn().mockResolvedValue(undefined)

        // Mock srcObject
        Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
            get: vi.fn(),
            set: vi.fn(),
            configurable: true
        })

        // Mock requestAnimationFrame
        global.requestAnimationFrame = vi.fn()
        global.cancelAnimationFrame = vi.fn()
    })

    it('renders participant name and initials', () => {
        render(
            <ParticipantCard
                name="John Doe"
                peerId="p1"
                isMicMuted={false}
                isSpeakerMuted={false}
                isLocal={false}
                audioLevel={0}
                connectionState="connected"
            />
        )
        expect(screen.getByText('John Doe')).toBeInTheDocument()
        expect(screen.getByText('JD')).toBeInTheDocument()
    })

    it('shows mic muted indicator', () => {
        render(
            <ParticipantCard
                name="John Doe"
                peerId="p1"
                isMicMuted={true}
                isSpeakerMuted={false}
                isLocal={false}
                audioLevel={0}
                connectionState="connected"
            />
        )
        expect(screen.getByTitle('room.micMuted')).toBeInTheDocument()
    })

    it('shows speaker muted indicator', () => {
        render(
            <ParticipantCard
                name="John Doe"
                peerId="p1"
                isMicMuted={false}
                isSpeakerMuted={true}
                isLocal={false}
                audioLevel={0}
                connectionState="connected"
            />
        )
        expect(screen.getByTitle('room.speakerMuted')).toBeInTheDocument()
    })

    it('sets audio element source for remote participant', () => {
        const mockTrack = { id: 't1', enabled: true, kind: 'audio', muted: false, readyState: 'live' }
        const mockStream = {
            id: 'stream1',
            getTracks: vi.fn().mockReturnValue([mockTrack]),
            getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
            getVideoTracks: vi.fn().mockReturnValue([])
        } as any

        // Track srcObject assignments
        let capturedSrcObject: any = null
        Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
            get: vi.fn(() => capturedSrcObject),
            set: vi.fn((val) => { capturedSrcObject = val }),
            configurable: true
        })

        render(
            <ParticipantCard
                name="Bob"
                peerId="p2"
                isMicMuted={false}
                isSpeakerMuted={false}
                isLocal={false}
                audioLevel={0}
                connectionState="connected"
                stream={mockStream}
            />
        )

        // Check if audio element exists
        const audio = document.querySelector('audio')
        expect(audio).toBeInTheDocument()

        // Verify srcObject was set to our mock stream
        expect(capturedSrcObject).toBe(mockStream)

        // Verify play was called
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    })
})
