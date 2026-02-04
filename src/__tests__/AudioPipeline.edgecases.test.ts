/**
 * @vitest-environment jsdom
 * Edge case tests for AudioPipeline
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AudioPipeline, resetAudioPipeline } from '../renderer/audio-processor/AudioPipeline'

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
    state = 'running'
    audioWorklet = {
        addModule: vi.fn().mockResolvedValue(undefined)
    }
    createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() })
    createMediaStreamDestination = vi.fn().mockReturnValue({ stream: new MediaStream(), connect: vi.fn(), disconnect: vi.fn() })
    createGain = vi.fn().mockReturnValue({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
    createAnalyser = vi.fn().mockReturnValue({ fftSize: 256, smoothingTimeConstant: 0.8, connect: vi.fn(), disconnect: vi.fn(), frequencyBinCount: 128, getByteFrequencyData: vi.fn() })
    close = vi.fn()
    resume = vi.fn()
}

// We will stub globals inside tests to vary behavior

describe('AudioPipeline Edge Cases', () => {
    beforeEach(async () => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        await resetAudioPipeline()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('should handle WASM initialization timeout', async () => {
        // Mock Worklet that NEVER sends 'ready'
        class HangingWorkletNode {
            port = {
                postMessage: vi.fn(),
                onmessage: null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }
        }

        vi.stubGlobal('AudioContext', MockAudioContext)
        vi.stubGlobal('AudioWorkletNode', HangingWorkletNode)
        vi.stubGlobal('MediaStream', class { getTracks = () => [] })

        const pipeline = new AudioPipeline()
        await pipeline.initialize()

        // Determine if we should use noise suppression (needs to be enabled)
        // connectInputStream calls initializeWorkletWasm internally if conditions met
        const inputStream = new MediaStream()

        const connectPromise = pipeline.connectInputStream(inputStream)

        // Fast forward past timeout (10s)
        await vi.advanceTimersByTimeAsync(11000)

        // It should catch the timeout error and fall back to bypass
        // check that it didn't crash
        await expect(connectPromise).resolves.toBeDefined()

        // Verify fallback to bypass (bypass logs info)
        const { AudioLog } = await import('../renderer/utils/Logger')
        expect(AudioLog.warn).toHaveBeenCalledWith(
            expect.stringContaining('Failed to enable noise suppression'),
            expect.anything()
        )
    })

    it('should handle WASM initialization error', async () => {
        // Mock Worklet that sends 'error'
        class ErrorWorkletNode {
            port = {
                postMessage: vi.fn(),
                onmessage: null as ((e: MessageEvent) => void) | null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }
            constructor() {
                setTimeout(() => {
                    if (this.port.onmessage) {
                        this.port.onmessage!({ data: { type: 'error', error: 'WASM crashed' } } as MessageEvent)
                    }
                }, 10)
            }
            connect = vi.fn()
            disconnect = vi.fn()
        }

        vi.stubGlobal('AudioContext', MockAudioContext)
        vi.stubGlobal('AudioWorkletNode', ErrorWorkletNode)
        vi.stubGlobal('MediaStream', class { getTracks = () => [] })

        const pipeline = new AudioPipeline()
        await pipeline.initialize()

        const connectPromise = pipeline.connectInputStream(new MediaStream())
        await vi.advanceTimersByTimeAsync(100)
        await connectPromise

        const { AudioLog } = await import('../renderer/utils/Logger')
        expect(AudioLog.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to enable noise suppression'), expect.anything())
    })

    it('should handle getStats timeout', async () => {
        // Mock Worklet that ignores stats requests
        class SilentWorkletNode {
            port = {
                postMessage: vi.fn(),
                onmessage: null as ((e: MessageEvent) => void) | null,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }
            constructor() {
                setTimeout(() => {
                    if (this.port.onmessage) {
                        this.port.onmessage!({ data: { type: 'ready' } } as MessageEvent)
                    }
                }, 10)
            }
            connect = vi.fn()
            disconnect = vi.fn()
        }

        vi.stubGlobal('AudioContext', MockAudioContext)
        vi.stubGlobal('AudioWorkletNode', SilentWorkletNode)
        vi.stubGlobal('MediaStream', class { getTracks = () => [] })

        const pipeline = new AudioPipeline()
        await pipeline.initialize()

        const connectP = pipeline.connectInputStream(new MediaStream())
        await vi.advanceTimersByTimeAsync(100) // Wait for ready
        await connectP

        const statsPromise = pipeline.getStats()

        // Advance past timeout (1s)
        await vi.advanceTimersByTimeAsync(1100)

        const result = await statsPromise
        expect(result).toEqual({ error: 'Stats request timeout' })
    })

    it('should handle Worklet loading failure', async () => {
        class FailLoadContext extends MockAudioContext {
            constructor() {
                super()
                this.audioWorklet = {
                    addModule: vi.fn().mockRejectedValue(new Error('Network error'))
                }
            }
        }

        vi.stubGlobal('AudioContext', FailLoadContext)
        vi.stubGlobal('MediaStream', class { getTracks = () => [] })

        const pipeline = new AudioPipeline()
        await pipeline.initialize()

        expect(pipeline.isReady()).toBe(true)
        // But wasmReady should be false
        expect(pipeline.getNoiseSuppressionStatus().wasmReady).toBe(false)

        // Connecting should work but go to bypass immediately
        const stream = await pipeline.connectInputStream(new MediaStream())
        expect(stream).toBeDefined()

        // Verify warning logged
        const { AudioLog } = await import('../renderer/utils/Logger')
        expect(AudioLog.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load AudioWorklet'), expect.anything())
    })
})
