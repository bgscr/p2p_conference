/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for SoundManager
 * Targets:
 * - Error catch paths in play methods (line 70)
 * - Test actual SoundManager from source
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { soundManager } from '../renderer/audio-processor/SoundManager'

// Mock the Logger
vi.mock('../renderer/utils/Logger', () => ({
    logger: {
        createModuleLogger: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        })
    },
    SoundLog: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }
}))

describe('SoundManager - actual source coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        soundManager.destroy()
    })

    describe('error handling in play methods (line 70)', () => {
        it('playJoin catches error when createOscillator throws', () => {
            // Mock AudioContext to have createOscillator throw
            const mockOscillator = {
                connect: vi.fn(() => { throw new Error('Connection failed') }),
                start: vi.fn(),
                stop: vi.fn(),
                type: 'sine',
                frequency: { setValueAtTime: vi.fn() }
            }

            const mockGain = {
                connect: vi.fn(),
                gain: {
                    value: 1,
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn()
                }
            }

            global.AudioContext = class {
                currentTime = 0
                destination = {}
                createOscillator = () => mockOscillator
                createGain = () => mockGain
                close = vi.fn()
            } as any

            soundManager.setEnabled(true)

            // Should not throw - error should be caught
            expect(() => soundManager.playJoin()).not.toThrow()
        })

        it('playJoin catches error when AudioContext creation fails', () => {
            const originalAudioContext = global.AudioContext
            global.AudioContext = class {
                constructor() {
                    throw new Error('AudioContext not supported')
                }
            } as any

            soundManager.destroy() // Reset internal audioContext
            soundManager.setEnabled(true)

            // Should not throw - error should be caught
            expect(() => soundManager.playJoin()).not.toThrow()

            global.AudioContext = originalAudioContext
        })

        it('playLeave catches error when oscillator.start throws', () => {
            const mockOscillator = {
                connect: vi.fn(),
                start: vi.fn(() => { throw new Error('Start failed') }),
                stop: vi.fn(),
                type: 'sine',
                frequency: { setValueAtTime: vi.fn() }
            }

            const mockGain = {
                connect: vi.fn(),
                gain: {
                    value: 1,
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn()
                }
            }

            global.AudioContext = class {
                currentTime = 0
                destination = {}
                createOscillator = () => mockOscillator
                createGain = () => mockGain
                close = vi.fn()
            } as any

            soundManager.destroy()
            soundManager.setEnabled(true)

            expect(() => soundManager.playLeave()).not.toThrow()
        })

        it('playConnected catches error when gain.connect throws', () => {
            const mockOscillator = {
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                type: 'sine' as const,
                frequency: { setValueAtTime: vi.fn() }
            }

            const mockGain = {
                connect: vi.fn(() => { throw new Error('Gain connect failed') }),
                gain: {
                    value: 1,
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn()
                }
            }

            global.AudioContext = class {
                currentTime = 0
                destination = {}
                createOscillator = () => mockOscillator
                createGain = () => mockGain
                close = vi.fn()
            } as any

            soundManager.destroy()
            soundManager.setEnabled(true)

            expect(() => soundManager.playConnected()).not.toThrow()
        })

        it('playError catches error when frequency.setValueAtTime throws', () => {
            const mockOscillator = {
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                type: 'sine' as const,
                frequency: {
                    setValueAtTime: vi.fn(() => { throw new Error('Frequency set failed') })
                }
            }

            const mockGain = {
                connect: vi.fn(),
                gain: {
                    value: 1,
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn()
                }
            }

            global.AudioContext = class {
                currentTime = 0
                destination = {}
                createOscillator = () => mockOscillator
                createGain = () => mockGain
                close = vi.fn()
            } as any

            soundManager.destroy()
            soundManager.setEnabled(true)

            expect(() => soundManager.playError()).not.toThrow()
        })

        it('playClick catches error when gain.gain.setValueAtTime throws', () => {
            const mockOscillator = {
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                type: 'sine' as const,
                frequency: { setValueAtTime: vi.fn() }
            }

            const mockGain = {
                connect: vi.fn(),
                gain: {
                    value: 1,
                    setValueAtTime: vi.fn(() => { throw new Error('Gain setValueAtTime failed') }),
                    linearRampToValueAtTime: vi.fn()
                }
            }

            global.AudioContext = class {
                currentTime = 0
                destination = {}
                createOscillator = () => mockOscillator
                createGain = () => mockGain
                close = vi.fn()
            } as any

            soundManager.destroy()
            soundManager.setEnabled(true)

            expect(() => soundManager.playClick()).not.toThrow()
        })
    })

    describe('enabled/disabled state', () => {
        it('returns early when disabled (no audio methods called)', () => {
            const mockOscillator = {
                connect: vi.fn(),
                start: vi.fn(),
                stop: vi.fn(),
                type: 'sine',
                frequency: { setValueAtTime: vi.fn() }
            }

            const mockGain = {
                connect: vi.fn(),
                gain: {
                    value: 1,
                    setValueAtTime: vi.fn(),
                    linearRampToValueAtTime: vi.fn()
                }
            }

            global.AudioContext = class {
                currentTime = 0
                destination = {}
                createOscillator = () => mockOscillator
                createGain = () => mockGain
                close = vi.fn()
            } as any

            soundManager.setEnabled(false)

            soundManager.playJoin()
            soundManager.playLeave()
            soundManager.playConnected()
            soundManager.playError()
            soundManager.playClick()

            // None of the audio methods should have been called (no context created)
            expect(mockOscillator.start).not.toHaveBeenCalled()
        })

        it('isEnabled returns current state', () => {
            soundManager.setEnabled(true)
            expect(soundManager.isEnabled()).toBe(true)

            soundManager.setEnabled(false)
            expect(soundManager.isEnabled()).toBe(false)
        })
    })

    describe('destroy', () => {
        it('closes audio context on destroy', () => {
            const closeSpy = vi.fn()

            global.AudioContext = class {
                currentTime = 0
                destination = {}
                createOscillator = () => ({
                    connect: vi.fn(),
                    start: vi.fn(),
                    stop: vi.fn(),
                    type: 'sine',
                    frequency: { setValueAtTime: vi.fn() }
                })
                createGain = () => ({
                    connect: vi.fn(),
                    gain: {
                        value: 1,
                        setValueAtTime: vi.fn(),
                        linearRampToValueAtTime: vi.fn()
                    }
                })
                close = closeSpy
            } as any

            soundManager.setEnabled(true)
            soundManager.playJoin() // This creates the AudioContext

            soundManager.destroy()
            expect(closeSpy).toHaveBeenCalled()
        })

        it('handles destroy when not initialized', () => {
            // Should not throw
            expect(() => soundManager.destroy()).not.toThrow()
        })
    })
})
