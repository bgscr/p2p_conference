import { vi } from 'vitest'
import '@testing-library/jest-dom'

if (typeof window !== 'undefined') {
    console.log('Running setup.ts in jsdom/window env')
    // Mock MediaStream
    Object.defineProperty(window, 'MediaStream', {
        writable: true,
        configurable: true,
        value: class MockMediaStream {
            getTracks() { return [] }
            getVideoTracks() { return [] }
            getAudioTracks() { return [] }
            addTrack() { }
            removeTrack() { }
            clone() { return this }
        },
    })

    // Mock AudioContext
    Object.defineProperty(window, 'AudioContext', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation(() => ({
            createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
            createAnalyser: vi.fn(() => ({
                connect: vi.fn(),
                disconnect: vi.fn(),
                getByteFrequencyData: vi.fn()
            })),
            createOscillator: vi.fn(() => ({
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn()
            })),
            close: vi.fn(),
        })),
    })
}
