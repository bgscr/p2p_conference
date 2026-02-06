/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage tests for AudioPipeline
 * Targets uncovered lines: 340, 412, 470-471
 *
 * Line 340: getStats() successfully receives a 'stats' message and resolves with data
 * Line 412: destroy() catches error from audioContext.close()
 * Lines 470-471: resetAudioPipeline() when a singleton instance exists
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AudioPipeline, getAudioPipeline, resetAudioPipeline } from '../renderer/audio-processor/AudioPipeline'

// Mock Logger
vi.mock('../renderer/utils/Logger', () => ({
  AudioLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Base Mock AudioContext
class MockAudioContext {
  sampleRate = 48000
  state: string = 'running'
  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined)
  }
  createMediaStreamSource = vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn()
  })
  createMediaStreamDestination = vi.fn().mockReturnValue({
    stream: new MediaStream(),
    connect: vi.fn(),
    disconnect: vi.fn()
  })
  createGain = vi.fn().mockReturnValue({
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn()
  })
  createAnalyser = vi.fn().mockReturnValue({
    fftSize: 256,
    smoothingTimeConstant: 0.8,
    connect: vi.fn(),
    disconnect: vi.fn(),
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn()
  })
  close = vi.fn().mockResolvedValue(undefined)
  resume = vi.fn().mockResolvedValue(undefined)
}

describe('AudioPipeline Coverage - Line 340: getStats success path', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    await resetAudioPipeline()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should resolve with stats data when worklet responds with stats message', async () => {
    // Worklet that responds to getStats with a stats message via addEventListener
    let addedEventHandler: ((e: MessageEvent) => void) | null = null

    class StatsWorkletNode {
      port = {
        postMessage: vi.fn().mockImplementation((msg: { type: string }) => {
          if (msg.type === 'getStats' && addedEventHandler) {
            // Simulate the worklet responding with stats after a small delay
            setTimeout(() => {
              addedEventHandler!({
                data: { type: 'stats', data: { cpu: 5, framesProcessed: 1000 } }
              } as MessageEvent)
            }, 50)
          }
        }),
        onmessage: null as ((e: MessageEvent) => void) | null,
        addEventListener: vi.fn().mockImplementation((_event: string, handler: (e: MessageEvent) => void) => {
          addedEventHandler = handler
        }),
        removeEventListener: vi.fn()
      }
      constructor() {
        // Simulate worklet ready after a short delay
        setTimeout(() => {
          if (this.port.onmessage) {
            this.port.onmessage({ data: { type: 'ready' } } as MessageEvent)
          }
        }, 10)
      }
      connect = vi.fn()
      disconnect = vi.fn()
    }

    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('AudioWorkletNode', StatsWorkletNode)
    vi.stubGlobal('MediaStream', class { getTracks = () => [] })

    const pipeline = new AudioPipeline()
    await pipeline.initialize()

    // Connect to set up the worklet node
    const connectP = pipeline.connectInputStream(new MediaStream())
    await vi.advanceTimersByTimeAsync(100) // let 'ready' message fire
    await connectP

    // Now request stats
    const statsPromise = pipeline.getStats()

    // Advance timers to let the stats response fire (50ms delay)
    await vi.advanceTimersByTimeAsync(100)

    const result = await statsPromise
    expect(result).toEqual({ cpu: 5, framesProcessed: 1000 })
  })
})

describe('AudioPipeline Coverage - Line 412: destroy() audioContext.close() error', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetAudioPipeline()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should catch and log warning when audioContext.close() throws', async () => {
    class FailCloseAudioContext extends MockAudioContext {
      close = vi.fn().mockRejectedValue(new Error('Close failed'))
    }

    vi.stubGlobal('AudioContext', FailCloseAudioContext)
    vi.stubGlobal('MediaStream', class { getTracks = () => [] })

    const pipeline = new AudioPipeline()
    await pipeline.initialize()

    // destroy should not throw even though close() rejects
    await expect(pipeline.destroy()).resolves.toBeUndefined()

    const { AudioLog } = await import('../renderer/utils/Logger')
    expect(AudioLog.warn).toHaveBeenCalledWith(
      'Error closing AudioContext',
      expect.objectContaining({ error: expect.any(Error) })
    )
  })
})

describe('AudioPipeline Coverage - Lines 470-471: resetAudioPipeline with existing instance', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Make sure we start clean
    await resetAudioPipeline()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should destroy existing singleton instance and set it to null', async () => {
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('MediaStream', class { getTracks = () => [] })

    // Create the singleton instance by calling getAudioPipeline
    const instance = getAudioPipeline()
    await instance.initialize()
    expect(instance.isReady()).toBe(true)

    // Now reset - this should call destroy() on the instance and null it out
    await resetAudioPipeline()

    // Getting the pipeline again should give a new instance
    const newInstance = getAudioPipeline()
    expect(newInstance).not.toBe(instance)
    expect(newInstance.isReady()).toBe(false)

    // Clean up
    await resetAudioPipeline()
  })
})
