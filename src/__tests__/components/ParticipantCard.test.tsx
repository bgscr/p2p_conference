/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
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
        // Mock AudioContext
        global.AudioContext = vi.fn().mockImplementation(() => ({
            createAnalyser: () => ({
                connect: vi.fn(),
                frequencyBinCount: 128,
                getByteFrequencyData: vi.fn(),
                disconnect: vi.fn()
            }),
            createMediaStreamSource: () => ({
                connect: vi.fn()
            }),
            createGain: () => ({
                gain: { value: 1 },
                connect: vi.fn(),
                disconnect: vi.fn()
            })
        })) as any

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

    it.skip('sets audio element source for remote participant', () => {
        const mockStream = {
            id: 'stream1',
            getTracks: vi.fn().mockReturnValue([]),
            getAudioTracks: vi.fn().mockReturnValue([{ id: 't1', enabled: true, kind: 'audio' }])
        } as any

        // We need to spy on Audio element creation or property access
        // Since React creates the element, we can query it
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
        // Note: srcObject is not a standard HTML attribute, so difficult to test via DOM
        // But we can check if it rendered the hidden audio element
        const audio = document.querySelector('audio')
        expect(audio).toBeInTheDocument()
    })
})
