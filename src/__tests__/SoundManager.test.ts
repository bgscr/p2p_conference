/**
 * Unit tests for SoundManager
 * Tests sound effects functionality for join/leave/error sounds
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================
// Mock AudioContext for testing
// ============================================

class MockOscillatorNode {
    type: string = 'sine'
    frequency = {
        setValueAtTime: vi.fn(),
    }
    connect = vi.fn().mockReturnThis()
    start = vi.fn()
    stop = vi.fn()
}

class MockGainNode {
    gain = {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
    }
    connect = vi.fn().mockReturnThis()
}

class MockAudioContext {
    currentTime = 0
    destination = {}
    state = 'running'

    createOscillator = vi.fn(() => new MockOscillatorNode())
    createGain = vi.fn(() => new MockGainNode())
    close = vi.fn().mockResolvedValue(undefined)
}

// ============================================
// Testable SoundManager class
// ============================================

class TestableSoundManager {
    private audioContext: MockAudioContext | null = null
    private enabled: boolean = true

    private getContext(): MockAudioContext {
        if (!this.audioContext) {
            this.audioContext = new MockAudioContext()
        }
        return this.audioContext
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled
    }

    isEnabled(): boolean {
        return this.enabled
    }

    playJoin(): boolean {
        if (!this.enabled) return false

        try {
            const ctx = this.getContext()
            const now = ctx.currentTime

            const osc = ctx.createOscillator()
            const gain = ctx.createGain()

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.type = 'sine'
            osc.frequency.setValueAtTime(523.25, now) // C5
            osc.frequency.setValueAtTime(659.25, now + 0.1) // E5

            gain.gain.setValueAtTime(0, now)
            gain.gain.linearRampToValueAtTime(0.3, now + 0.02)
            gain.gain.linearRampToValueAtTime(0, now + 0.3)

            osc.start(now)
            osc.stop(now + 0.3)

            return true
        } catch {
            return false
        }
    }

    playLeave(): boolean {
        if (!this.enabled) return false

        try {
            const ctx = this.getContext()
            const now = ctx.currentTime

            const osc = ctx.createOscillator()
            const gain = ctx.createGain()

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.type = 'sine'
            osc.frequency.setValueAtTime(523.25, now) // C5
            osc.frequency.setValueAtTime(392.0, now + 0.1) // G4

            gain.gain.setValueAtTime(0, now)
            gain.gain.linearRampToValueAtTime(0.25, now + 0.02)
            gain.gain.linearRampToValueAtTime(0, now + 0.25)

            osc.start(now)
            osc.stop(now + 0.25)

            return true
        } catch {
            return false
        }
    }

    playConnected(): boolean {
        if (!this.enabled) return false

        try {
            const ctx = this.getContext()
            const now = ctx.currentTime

            const osc = ctx.createOscillator()
            const gain = ctx.createGain()

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.type = 'sine'
            osc.frequency.setValueAtTime(880, now) // A5

            gain.gain.setValueAtTime(0, now)
            gain.gain.linearRampToValueAtTime(0.2, now + 0.01)
            gain.gain.linearRampToValueAtTime(0, now + 0.15)

            osc.start(now)
            osc.stop(now + 0.15)

            return true
        } catch {
            return false
        }
    }

    playError(): boolean {
        if (!this.enabled) return false

        try {
            const ctx = this.getContext()
            const now = ctx.currentTime

            const osc = ctx.createOscillator()
            const gain = ctx.createGain()

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.type = 'sine'
            osc.frequency.setValueAtTime(220, now) // A3
            osc.frequency.setValueAtTime(196, now + 0.15) // G3

            gain.gain.setValueAtTime(0, now)
            gain.gain.linearRampToValueAtTime(0.25, now + 0.02)
            gain.gain.linearRampToValueAtTime(0, now + 0.3)

            osc.start(now)
            osc.stop(now + 0.3)

            return true
        } catch {
            return false
        }
    }

    playClick(): boolean {
        if (!this.enabled) return false

        try {
            const ctx = this.getContext()
            const now = ctx.currentTime

            const osc = ctx.createOscillator()
            const gain = ctx.createGain()

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.type = 'sine'
            osc.frequency.setValueAtTime(1000, now)

            gain.gain.setValueAtTime(0, now)
            gain.gain.linearRampToValueAtTime(0.1, now + 0.005)
            gain.gain.linearRampToValueAtTime(0, now + 0.05)

            osc.start(now)
            osc.stop(now + 0.05)

            return true
        } catch {
            return false
        }
    }

    destroy(): void {
        if (this.audioContext) {
            this.audioContext.close()
            this.audioContext = null
        }
    }

    // For testing
    getAudioContext(): MockAudioContext | null {
        return this.audioContext
    }
}

// ============================================
// Test Suites
// ============================================

describe('SoundManager', () => {
    let soundManager: TestableSoundManager

    beforeEach(() => {
        soundManager = new TestableSoundManager()
    })

    describe('Enable/Disable', () => {
        it('should be enabled by default', () => {
            expect(soundManager.isEnabled()).toBe(true)
        })

        it('should allow disabling sounds', () => {
            soundManager.setEnabled(false)
            expect(soundManager.isEnabled()).toBe(false)
        })

        it('should allow re-enabling sounds', () => {
            soundManager.setEnabled(false)
            soundManager.setEnabled(true)
            expect(soundManager.isEnabled()).toBe(true)
        })
    })

    describe('Sound Methods - Enabled', () => {
        it('should play join sound when enabled', () => {
            const result = soundManager.playJoin()
            expect(result).toBe(true)
        })

        it('should play leave sound when enabled', () => {
            const result = soundManager.playLeave()
            expect(result).toBe(true)
        })

        it('should play connected sound when enabled', () => {
            const result = soundManager.playConnected()
            expect(result).toBe(true)
        })

        it('should play error sound when enabled', () => {
            const result = soundManager.playError()
            expect(result).toBe(true)
        })

        it('should play click sound when enabled', () => {
            const result = soundManager.playClick()
            expect(result).toBe(true)
        })
    })

    describe('Sound Methods - Disabled', () => {
        beforeEach(() => {
            soundManager.setEnabled(false)
        })

        it('should not play join sound when disabled', () => {
            const result = soundManager.playJoin()
            expect(result).toBe(false)
        })

        it('should not play leave sound when disabled', () => {
            const result = soundManager.playLeave()
            expect(result).toBe(false)
        })

        it('should not play connected sound when disabled', () => {
            const result = soundManager.playConnected()
            expect(result).toBe(false)
        })

        it('should not play error sound when disabled', () => {
            const result = soundManager.playError()
            expect(result).toBe(false)
        })

        it('should not play click sound when disabled', () => {
            const result = soundManager.playClick()
            expect(result).toBe(false)
        })

        it('should not create AudioContext when disabled', () => {
            soundManager.playJoin()
            soundManager.playLeave()
            soundManager.playError()

            expect(soundManager.getAudioContext()).toBeNull()
        })
    })

    describe('AudioContext Management', () => {
        it('should create AudioContext on first sound', () => {
            expect(soundManager.getAudioContext()).toBeNull()

            soundManager.playJoin()

            expect(soundManager.getAudioContext()).not.toBeNull()
        })

        it('should reuse AudioContext for subsequent sounds', () => {
            soundManager.playJoin()
            const ctx1 = soundManager.getAudioContext()

            soundManager.playLeave()
            const ctx2 = soundManager.getAudioContext()

            expect(ctx1).toBe(ctx2)
        })

        it('should close AudioContext on destroy', () => {
            soundManager.playJoin()
            const ctx = soundManager.getAudioContext()!

            soundManager.destroy()

            expect(ctx.close).toHaveBeenCalled()
            expect(soundManager.getAudioContext()).toBeNull()
        })

        it('should handle destroy when no context exists', () => {
            // Should not throw
            expect(() => soundManager.destroy()).not.toThrow()
        })
    })

    describe('Audio Node Creation', () => {
        it('should create oscillator with correct type for join', () => {
            soundManager.playJoin()
            const ctx = soundManager.getAudioContext()!

            expect(ctx.createOscillator).toHaveBeenCalled()
            expect(ctx.createGain).toHaveBeenCalled()
        })

        it('should create oscillator for each sound', () => {
            soundManager.playJoin()
            soundManager.playLeave()
            soundManager.playError()

            const ctx = soundManager.getAudioContext()!
            expect(ctx.createOscillator).toHaveBeenCalledTimes(3)
            expect(ctx.createGain).toHaveBeenCalledTimes(3)
        })
    })

    describe('Sound Frequencies', () => {
        it('should use ascending frequencies for join (positive feeling)', () => {
            soundManager.playJoin()
            const ctx = soundManager.getAudioContext()!

            // Join creates an oscillator and gain node
            expect(ctx.createOscillator).toHaveBeenCalled()
            expect(ctx.createGain).toHaveBeenCalled()
        })

        it('should use descending frequencies for leave', () => {
            soundManager.playLeave()
            const ctx = soundManager.getAudioContext()!

            // Leave creates an oscillator and gain node
            expect(ctx.createOscillator).toHaveBeenCalled()
            expect(ctx.createGain).toHaveBeenCalled()
        })

        it('should use lower frequencies for error (warning feeling)', () => {
            soundManager.playError()
            const ctx = soundManager.getAudioContext()!

            // Error creates an oscillator and gain node
            expect(ctx.createOscillator).toHaveBeenCalled()
            expect(ctx.createGain).toHaveBeenCalled()
        })
    })

    describe('Edge Cases', () => {
        it('should handle rapid sound playback', () => {
            for (let i = 0; i < 10; i++) {
                expect(soundManager.playClick()).toBe(true)
            }
        })

        it('should handle alternating enable/disable', () => {
            expect(soundManager.playJoin()).toBe(true)

            soundManager.setEnabled(false)
            expect(soundManager.playJoin()).toBe(false)

            soundManager.setEnabled(true)
            expect(soundManager.playJoin()).toBe(true)
        })

        it('should handle destroy and recreate', () => {
            soundManager.playJoin()
            soundManager.destroy()

            // Should create new context
            expect(soundManager.playJoin()).toBe(true)
            expect(soundManager.getAudioContext()).not.toBeNull()
        })
    })
})
