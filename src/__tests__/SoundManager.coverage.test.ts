/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for SoundManager
 * Targets uncovered lines: 105, 136, 169, 199
 *
 * Line 105: catch block in playLeave() when audio context operations throw
 * Line 136: catch block in playConnected() when audio context operations throw
 * Line 169: catch block in playError() when audio context operations throw
 * Line 199: catch block in playClick() when audio context operations throw
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
  logger: {
    createModuleLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

describe('SoundManager Coverage - catch blocks in play methods', () => {
  let SoundManagerModule: typeof import('../renderer/audio-processor/SoundManager')

  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset module so we get a fresh singleton each time
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should catch errors in playLeave (line 105)', async () => {
    // Mock AudioContext that throws when createOscillator is called
    vi.stubGlobal('AudioContext', class {
      currentTime = 0
      destination = {}
      state = 'running'
      createOscillator = vi.fn(() => { throw new Error('Oscillator error') })
      createGain = vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn()
        },
        connect: vi.fn()
      }))
      close = vi.fn()
    })

    SoundManagerModule = await import('../renderer/audio-processor/SoundManager')
    const sm = SoundManagerModule.soundManager

    sm.setEnabled(true)
    // Should not throw - error is caught internally
    expect(() => sm.playLeave()).not.toThrow()

    sm.destroy()
  })

  it('should catch errors in playConnected (line 136)', async () => {
    vi.stubGlobal('AudioContext', class {
      currentTime = 0
      destination = {}
      state = 'running'
      createOscillator = vi.fn(() => { throw new Error('Oscillator error') })
      createGain = vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn()
        },
        connect: vi.fn()
      }))
      close = vi.fn()
    })

    SoundManagerModule = await import('../renderer/audio-processor/SoundManager')
    const sm = SoundManagerModule.soundManager

    sm.setEnabled(true)
    // Should not throw - error is caught internally
    expect(() => sm.playConnected()).not.toThrow()

    sm.destroy()
  })

  it('should catch errors in playError (line 169)', async () => {
    vi.stubGlobal('AudioContext', class {
      currentTime = 0
      destination = {}
      state = 'running'
      createOscillator = vi.fn(() => { throw new Error('Oscillator error') })
      createGain = vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn()
        },
        connect: vi.fn()
      }))
      close = vi.fn()
    })

    SoundManagerModule = await import('../renderer/audio-processor/SoundManager')
    const sm = SoundManagerModule.soundManager

    sm.setEnabled(true)
    // Should not throw - error is caught internally
    expect(() => sm.playError()).not.toThrow()

    sm.destroy()
  })

  it('should catch errors in playClick (line 199)', async () => {
    vi.stubGlobal('AudioContext', class {
      currentTime = 0
      destination = {}
      state = 'running'
      createOscillator = vi.fn(() => { throw new Error('Oscillator error') })
      createGain = vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn()
        },
        connect: vi.fn()
      }))
      close = vi.fn()
    })

    SoundManagerModule = await import('../renderer/audio-processor/SoundManager')
    const sm = SoundManagerModule.soundManager

    sm.setEnabled(true)
    // Should not throw - error is caught internally
    expect(() => sm.playClick()).not.toThrow()

    sm.destroy()
  })
})
