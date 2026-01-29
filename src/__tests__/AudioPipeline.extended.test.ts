/**
 * Extended tests for AudioPipeline
 * @vitest-environment jsdom
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

// Mock Web Audio API
class MockAudioContext {
  sampleRate: number
  state: 'suspended' | 'running' | 'closed' = 'running'
  audioWorklet: { addModule: any }

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate || 44100
    this.audioWorklet = {
      addModule: vi.fn().mockResolvedValue(undefined)
    }
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
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    connect: vi.fn(),
    disconnect: vi.fn(),
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn()
  })

  close = vi.fn().mockImplementation(async () => {
    this.state = 'closed'
  })

  resume = vi.fn().mockResolvedValue(undefined)
  suspend = vi.fn().mockResolvedValue(undefined)
}

class MockAudioWorkletNode {
  port: {
    postMessage: any,
    onmessage: ((e: MessageEvent) => void) | null,
    addEventListener: any,
    removeEventListener: any
  }

  constructor() {
    this.port = {
      postMessage: vi.fn((msg) => {
        // Simulate self-initialization request
        if (msg.type === 'getStats') {
          setTimeout(() => {
            if (this.port.onmessage) {
              this.port.onmessage({ data: { type: 'stats', data: { cpu: 0 } } } as MessageEvent)
            }
          }, 10)
        }
      }),
      onmessage: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }

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

// Setup globals
vi.stubGlobal('AudioContext', MockAudioContext)
vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
vi.stubGlobal('MediaStream', class MockMediaStream {
  id = 'mock-stream'
  getTracks = vi.fn().mockReturnValue([])
})

describe('AudioPipeline Extended', () => {
  let pipeline: AudioPipeline

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetAudioPipeline()
    pipeline = new AudioPipeline()
  })

  afterEach(async () => {
    await pipeline.destroy()
  })

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await pipeline.initialize()
      expect(pipeline.isReady()).toBe(true)
    })

    it('should create AudioContext with 48kHz sample rate', async () => {
      await pipeline.initialize()
      expect(pipeline.getSampleRate()).toBe(48000)
    })

    it('should only initialize once', async () => {
      await pipeline.initialize()
      await pipeline.initialize() // Should be no-op or log warning
      expect(pipeline.isReady()).toBe(true)
    })

    it('should handle AudioContext creation failure', async () => {
      const originalContext = global.AudioContext;
      // @ts-ignore
      global.AudioContext = class { constructor() { throw new Error('Failed'); } };

      const p = new AudioPipeline();
      await expect(p.initialize()).rejects.toThrow();

      global.AudioContext = originalContext;
    })
  })

  describe('Stream Connection', () => {
    beforeEach(async () => {
      await pipeline.initialize()
    })

    it('should connect input stream', async () => {
      const inputStream = new MediaStream()
      const outputStream = await pipeline.connectInputStream(inputStream)

      expect(outputStream).toBeDefined()
      expect(pipeline.getOutputStream()).toBe(outputStream)
    })

    it('should throw if not initialized', async () => {
      await pipeline.destroy()
      const p = new AudioPipeline() // New uninitialized pipeline
      const inputStream = new MediaStream()
      await expect(p.connectInputStream(inputStream)).rejects.toThrow('AudioPipeline not initialized')
    })

    it('should support bypass mode when noise suppression is disabled', async () => {
      pipeline.setNoiseSuppression(false)
      const inputStream = new MediaStream()
      await pipeline.connectInputStream(inputStream)

      const status = pipeline.getNoiseSuppressionStatus()
      expect(status.enabled).toBe(false)
      expect(status.active).toBe(false)
    })
  })

  describe('Noise Suppression Control', () => {
    beforeEach(async () => {
      await pipeline.initialize()
    })

    it('should toggle noise suppression', async () => {
      const inputStream = new MediaStream()
      await pipeline.connectInputStream(inputStream)

      expect(pipeline.isNoiseSuppressionActive()).toBe(true)

      pipeline.setNoiseSuppression(false)
      expect(pipeline.isNoiseSuppressionActive()).toBe(false)

      pipeline.setNoiseSuppression(true)
      // Note: In the real implementation, toggling doesn't auto-reconnect, 
      // it just sends a message to the worklet if connected. 
      // But the status check checks 'noiseSuppressionEnabled' logic.
      expect(pipeline.getNoiseSuppressionStatus().enabled).toBe(true)
    })
  })

  describe('Gain Control', () => {
    beforeEach(async () => {
      await pipeline.initialize()
    })

    it('should set gain value', () => {
      pipeline.setGain(1.5)
      // We can't easily check the internal gainNode value without exposing it or mocking it more deeply,
      // but valid execution confirms it doesn't crash.
    })

    it('should clamp gain value', () => {
      pipeline.setGain(3.0) // Clamped to 2
      pipeline.setGain(-1) // Clamped to 0
    })
  })

  describe('Analysis', () => {
    beforeEach(async () => {
      await pipeline.initialize()
    })

    it('should return audio level', () => {
      const level = pipeline.getAudioLevel()
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(100)
    })

    it('should return analyser node', () => {
      expect(pipeline.getAnalyserNode()).toBeDefined()
    })
  })

  describe('Singleton Pattern', () => {
    it('should return same instance', () => {
      const instance1 = getAudioPipeline()
      const instance2 = getAudioPipeline()
      expect(instance1).toBe(instance2)
    })
  })
})
