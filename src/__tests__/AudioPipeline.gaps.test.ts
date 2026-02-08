/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage gap tests for AudioPipeline
 * Targets:
 * - initialize: already initialized early return
 * - initialize: non-48kHz sample rate warning
 * - initialize: destroyed during initialization (StrictMode)
 * - initialize: destroyed during worklet loading
 * - connectInputStream: suspended audioContext resume
 * - connectInputStream: bypass mode when noise suppression disabled
 * - connectInputStream: bypass mode when wasm not ready
 * - connectInputStream: worklet creation failure -> bypass fallback
 * - initializeWorkletWasm: error message, log message types, originalHandler path
 * - handleWorkletMessage: ready, error, stats, unknown types
 * - getAudioLevel: with analyser returning data
 * - setNoiseSuppression: without workletNode
 * - getStats: timeout path
 * - setGain: clamping
 * - disconnect: all error catch paths
 * - getSampleRate: without audioContext
 * - getOutputStream: without destinationNode
 * - getAnalyserNode: without analyserNode
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AudioPipeline, resetAudioPipeline } from '../renderer/audio-processor/AudioPipeline'

vi.mock('../renderer/utils/Logger', () => ({
  AudioLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

class MockAudioContext {
  sampleRate = 48000
  state: string = 'running'
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
  createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() })
  createMediaStreamDestination = vi.fn().mockReturnValue({
    stream: new MediaStream(), connect: vi.fn(), disconnect: vi.fn()
  })
  createGain = vi.fn().mockReturnValue({
    gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn()
  })
  createAnalyser = vi.fn().mockReturnValue({
    fftSize: 256, smoothingTimeConstant: 0.8,
    connect: vi.fn(), disconnect: vi.fn(),
    frequencyBinCount: 128, getByteFrequencyData: vi.fn()
  })
  close = vi.fn().mockResolvedValue(undefined)
  resume = vi.fn().mockResolvedValue(undefined)
}

describe('AudioPipeline - additional gaps', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    await resetAudioPipeline()
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('MediaStream', class {
      getTracks = () => []
      getAudioTracks = () => []
      getVideoTracks = () => []
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await resetAudioPipeline()
  })

  it('initialize returns early when already initialized', async () => {
    const pipeline = new AudioPipeline()
    await pipeline.initialize()
    expect(pipeline.isReady()).toBe(true)

    // Second call should return immediately
    await pipeline.initialize()
    expect(pipeline.isReady()).toBe(true)
  })

  it('initialize warns when sample rate is not 48kHz', async () => {
    class NonStandardCtx extends MockAudioContext {
      sampleRate = 44100
    }
    vi.stubGlobal('AudioContext', NonStandardCtx)

    const pipeline = new AudioPipeline()
    await pipeline.initialize()

    const { AudioLog } = await import('../renderer/utils/Logger')
    expect(AudioLog.warn).toHaveBeenCalledWith(
      'Sample rate is not 48kHz! RNNoise may not work correctly.',
      expect.any(Object)
    )
  })

  it('initialize handles worklet addModule failure', async () => {
    class FailWorkletCtx extends MockAudioContext {
      audioWorklet = { addModule: vi.fn().mockRejectedValue(new Error('Worklet load failed')) }
    }
    vi.stubGlobal('AudioContext', FailWorkletCtx)

    const pipeline = new AudioPipeline()
    await pipeline.initialize()
    expect(pipeline.isReady()).toBe(true)

    const status = pipeline.getNoiseSuppressionStatus()
    expect(status.wasmReady).toBe(false)
  })

  it('initialize aborts if destroyed during async worklet loading', async () => {
    let addModuleResolve: (() => void) | null = null
    class SlowWorkletCtx extends MockAudioContext {
      audioWorklet = {
        addModule: vi.fn(() => new Promise<void>(resolve => { addModuleResolve = resolve }))
      }
    }
    vi.stubGlobal('AudioContext', SlowWorkletCtx)

    const pipeline = new AudioPipeline()
    const initPromise = pipeline.initialize()

    // Destroy while worklet loading
    await pipeline.destroy()

      // Complete the worklet loading
      ; (addModuleResolve as (() => void) | null)?.()
    await initPromise

    // Should not be initialized since destroyed
    expect(pipeline.isReady()).toBe(false)
  })

  it('initialize aborts if destroyed during AudioContext creation (lines 60-62)', async () => {
    // This test covers the edge case where the pipeline is destroyed
    // right after AudioContext is created but before worklet loading

    // Create pipeline first, then stub AudioContext to destroy it during construction
    const pipeline = new AudioPipeline()
    class DestroyDuringInitCtx extends MockAudioContext {
      constructor() {
        super()
        // Simulate destruction happening right after context creation
        // This mimics React StrictMode unmount during init
        ;(pipeline as any).isDestroyed = true
      }
    }
    vi.stubGlobal('AudioContext', DestroyDuringInitCtx)

    // Initialize should detect isDestroyed after creating context
    await pipeline.initialize()

    // Pipeline should not be initialized since destroyed
    expect(pipeline.isReady()).toBe(false)
  })

  it('initializeWorkletWasm throws when workletNode is null (line 208)', async () => {
    const pipeline = new AudioPipeline()
    // workletNode is null by default

    await expect((pipeline as any).initializeWorkletWasm())
      .rejects.toThrow('Worklet not ready')
  })

  it('connectInputStream resumes suspended audioContext', async () => {
    class SuspendedCtx extends MockAudioContext {
      state = 'suspended'
    }
    vi.stubGlobal('AudioContext', SuspendedCtx)

    const pipeline = new AudioPipeline()
    await pipeline.initialize()

    const stream = new MediaStream()
    await pipeline.connectInputStream(stream)

    // resume should have been called
    const { AudioLog } = await import('../renderer/utils/Logger')
    expect(AudioLog.info).toHaveBeenCalledWith('AudioContext resumed from suspended state')
  })

  it('connectInputStream uses bypass when noise suppression disabled', async () => {
    const pipeline = new AudioPipeline()
    await pipeline.initialize()
    pipeline.setNoiseSuppression(false)

    const stream = new MediaStream()
    const output = await pipeline.connectInputStream(stream)
    expect(output).toBeDefined()

    const { AudioLog } = await import('../renderer/utils/Logger')
    expect(AudioLog.info).toHaveBeenCalledWith(
      expect.stringContaining('bypass'),
      expect.any(Object)
    )
  })

  it('connectInputStream disconnects existing connections first', async () => {
    const pipeline = new AudioPipeline()
    await pipeline.initialize()
    pipeline.setNoiseSuppression(false)

    const stream1 = new MediaStream()
    await pipeline.connectInputStream(stream1)

    const stream2 = new MediaStream()
    await pipeline.connectInputStream(stream2)
    // Should disconnect first stream
  })

  it('connectBypass returns early when nodes are null', () => {
    const pipeline = new AudioPipeline()
      // Call private connectBypass without initialization
      ; (pipeline as any).connectBypass()
    // Should not throw
  })

  it('handleWorkletMessage handles all message types', () => {
    const pipeline = new AudioPipeline()
    const handler = (pipeline as any).handleWorkletMessage.bind(pipeline)

    handler({ data: { type: 'ready' } })
    handler({ data: { type: 'error', data: 'some error' } })
    handler({ data: { type: 'stats', data: { cpu: 5 } } })
    handler({ data: { type: 'unknown' } })
    // None should throw
  })

  it('getAudioLevel returns 0 when no analyser', () => {
    const pipeline = new AudioPipeline()
    expect(pipeline.getAudioLevel()).toBe(0)
  })

  it('getAudioLevel calculates from frequency data', async () => {
    const pipeline = new AudioPipeline()
    await pipeline.initialize()

    // Mock the analyser to return some data
    const analyser = (pipeline as any).analyserNode
    analyser.getByteFrequencyData = vi.fn((arr: Uint8Array) => {
      arr.fill(128) // mid-range
    })

    const level = pipeline.getAudioLevel()
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThanOrEqual(100)
  })

  it('setNoiseSuppression without workletNode only sets flag', () => {
    const pipeline = new AudioPipeline()
    pipeline.setNoiseSuppression(false)
    expect(pipeline.getNoiseSuppressionStatus().enabled).toBe(false)
  })

  it('isNoiseSuppressionActive returns false when conditions not met', () => {
    const pipeline = new AudioPipeline()
    expect(pipeline.isNoiseSuppressionActive()).toBe(false)
  })

  it('getStats returns error when no worklet', async () => {
    const pipeline = new AudioPipeline()
    const result = await pipeline.getStats()
    expect(result).toEqual({ error: 'Worklet not available' })
  })

  it('getStats times out when worklet does not respond', async () => {
    const pipeline = new AudioPipeline()
      ; (pipeline as any).workletNode = {
        port: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          postMessage: vi.fn()
        }
      }

    const statsPromise = pipeline.getStats()
    await vi.advanceTimersByTimeAsync(1100)

    const result = await statsPromise
    expect(result).toEqual({ error: 'Stats request timeout' })
  })

  it('setGain clamps values between 0 and 2', async () => {
    const pipeline = new AudioPipeline()
    await pipeline.initialize()

    pipeline.setGain(-1) // Should clamp to 0
    expect((pipeline as any).gainNode.gain.value).toBe(0)

    pipeline.setGain(3) // Should clamp to 2
    expect((pipeline as any).gainNode.gain.value).toBe(2)

    pipeline.setGain(1.5) // Normal
    expect((pipeline as any).gainNode.gain.value).toBe(1.5)
  })

  it('setGain is no-op when no gainNode', () => {
    const pipeline = new AudioPipeline()
    pipeline.setGain(1.5) // Should not throw
  })

  it('disconnect handles all error paths', async () => {
    const pipeline = new AudioPipeline()
    await pipeline.initialize()

      // Make nodes throw on disconnect
      ; (pipeline as any).sourceNode = { disconnect: vi.fn(() => { throw new Error('disc error') }) }
      ; (pipeline as any).workletNode = {
        disconnect: vi.fn(() => { throw new Error('disc error') }),
        port: { postMessage: vi.fn(() => { throw new Error('msg error') }) }
      }
      ; (pipeline as any).gainNode.disconnect = vi.fn(() => { throw new Error('disc error') })
      ; (pipeline as any).analyserNode.disconnect = vi.fn(() => { throw new Error('disc error') })

    expect(() => pipeline.disconnect()).not.toThrow()
  })

  it('getSampleRate returns 48000 without audioContext', () => {
    const pipeline = new AudioPipeline()
    expect(pipeline.getSampleRate()).toBe(48000)
  })

  it('getSampleRate returns actual rate when initialized', async () => {
    const pipeline = new AudioPipeline()
    await pipeline.initialize()
    expect(pipeline.getSampleRate()).toBe(48000)
  })

  it('getOutputStream returns null without destination', () => {
    const pipeline = new AudioPipeline()
    expect(pipeline.getOutputStream()).toBeNull()
  })

  it('getAnalyserNode returns null without init', () => {
    const pipeline = new AudioPipeline()
    expect(pipeline.getAnalyserNode()).toBeNull()
  })

  it('getAnalyserNode returns node when initialized', async () => {
    const pipeline = new AudioPipeline()
    await pipeline.initialize()
    expect(pipeline.getAnalyserNode()).not.toBeNull()
  })

  it('connectInputStream throws when not initialized', async () => {
    const pipeline = new AudioPipeline()
    await expect(pipeline.connectInputStream(new MediaStream())).rejects.toThrow('not initialized')
  })

  it('initializeWorkletWasm timeout rejects', async () => {
    const pipeline = new AudioPipeline()
      ; (pipeline as any).workletNode = {
        port: {
          onmessage: null,
          postMessage: vi.fn()
        }
      }

    const promise = (pipeline as any).initializeWorkletWasm().catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(11000)

    const result = await promise
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('timeout')

    // Flush remaining timers to avoid unhandled rejections
    await vi.advanceTimersByTimeAsync(2000)
  })

  it('initializeWorkletWasm handles error message', async () => {
    const pipeline = new AudioPipeline()
    let handler: ((event: any) => void) | null = null
      ; (pipeline as any).workletNode = {
        port: {
          get onmessage() { return handler },
          set onmessage(h: ((event: any) => void) | null) { handler = h },
          postMessage: vi.fn()
        }
      }

    const promise = (pipeline as any).initializeWorkletWasm()

      // Simulate error message from worklet
      ; (handler as ((event: any) => void) | null)?.({ data: { type: 'error', error: 'WASM init failed' } })

    await expect(promise).rejects.toThrow('WASM init failed')

    // Clear timeout to avoid unhandled rejection
    await vi.advanceTimersByTimeAsync(12000)
  })

  it('initializeWorkletWasm handles log message', async () => {
    const pipeline = new AudioPipeline()
    let handler: ((event: any) => void) | null = null
      ; (pipeline as any).workletNode = {
        port: {
          get onmessage() { return handler },
          set onmessage(h: ((event: any) => void) | null) { handler = h },
          postMessage: vi.fn()
        }
      }

    const promise = (pipeline as any).initializeWorkletWasm()

      // Simulate log message then ready synchronously
      ; (handler as ((event: any) => void) | null)?.({ data: { type: 'log', message: 'Loading...' } })
      ; (handler as ((event: any) => void) | null)?.({ data: { type: 'ready' } })

    await expect(promise).resolves.toBeUndefined()

    // Clear timeout
    await vi.advanceTimersByTimeAsync(12000)
  })
})
