/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for SoundManager
 * Tests sound effects functionality for join/leave/error sounds
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { soundManager } from '../renderer/audio-processor/SoundManager'

// ============================================
// Mock AudioContext for testing
// ============================================

const mockSetValueAtTime = vi.fn()
const mockLinearRampToValueAtTime = vi.fn()
const mockConnect = vi.fn().mockReturnThis()
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockClose = vi.fn().mockResolvedValue(undefined)

class MockOscillatorNode {
    type: string = 'sine'
    frequency = {
        setValueAtTime: mockSetValueAtTime,
    }
    connect = mockConnect
    start = mockStart
    stop = mockStop
}

class MockGainNode {
    gain = {
        setValueAtTime: mockSetValueAtTime,
        linearRampToValueAtTime: mockLinearRampToValueAtTime,
    }
    connect = mockConnect
}

class MockAudioContext {
    currentTime = 0
    destination = {}
    state = 'running'

    createOscillator = vi.fn(() => new MockOscillatorNode())
    createGain = vi.fn(() => new MockGainNode())
    close = mockClose
}

// Setup global mocks
vi.stubGlobal('AudioContext', MockAudioContext)

// ============================================
// Test Suites
// ============================================

describe('SoundManager', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        soundManager.setEnabled(true)
    })

    afterEach(() => {
        soundManager.destroy()
    })

    describe('Enable/Disable', () => {
        it('should be enabled by default', () => {
            // Might depend on test order if not reset, but we enabled it in beforeEach
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
            soundManager.playJoin()
            expect(mockStart).toHaveBeenCalled()
        })

        it('should play leave sound when enabled', () => {
            soundManager.playLeave()
            expect(mockStart).toHaveBeenCalled()
        })

        it('should play connected sound when enabled', () => {
            soundManager.playConnected()
            expect(mockStart).toHaveBeenCalled()
        })

        it('should play error sound when enabled', () => {
            soundManager.playError()
            expect(mockStart).toHaveBeenCalled()
        })

        it('should play click sound when enabled', () => {
            soundManager.playClick()
            expect(mockStart).toHaveBeenCalled()
        })
    })

    describe('Sound Methods - Disabled', () => {
        beforeEach(() => {
            soundManager.setEnabled(false)
        })

        it('should not play join sound when disabled', () => {
            soundManager.playJoin()
            expect(mockStart).not.toHaveBeenCalled()
        })

        it('should not play leave sound when disabled', () => {
            soundManager.playLeave()
            expect(mockStart).not.toHaveBeenCalled()
        })
    })
})

