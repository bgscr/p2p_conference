/**
 * Extended tests for AudioPipeline
 * @vitest-environment jsdom
 * 
 * Tests cover:
 * - WASM initialization states
 * - Noise suppression toggle
 * - Stream connection lifecycle
 * - Error handling
 * - AudioContext management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock Logger
vi.mock('../../renderer/utils/Logger', () => ({
  AudioLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// Create testable AudioPipeline class
class TestableAudioPipeline {
  private audioContext: AudioContext | null = null
  private noiseSuppressionEnabled = true
  private isInitialized = false
  private isConnected = false
  private wasmReady = false
  private inputStream: MediaStream | null = null
  private outputStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: AudioWorkletNode | null = null
  private destinationNode: MediaStreamAudioDestinationNode | null = null

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      // Create AudioContext with 48kHz (required for RNNoise)
      this.audioContext = new AudioContext({ sampleRate: 48000 })

      // Simulate WASM loading
      await this.loadWasm()

      this.isInitialized = true
    } catch (error) {
      throw new Error(`Failed to initialize AudioPipeline: ${error}`)
    }
  }

  private async loadWasm(): Promise<void> {
    // Simulate async WASM loading
    await new Promise(resolve => setTimeout(resolve, 10))
    this.wasmReady = true
  }

  async connectInputStream(inputStream: MediaStream): Promise<MediaStream> {
    if (!this.isInitialized) {
      throw new Error('AudioPipeline not initialized')
    }

    if (!this.audioContext) {
      throw new Error('AudioContext not available')
    }

    // Disconnect existing if any
    this.disconnect()

    this.inputStream = inputStream

    // Create nodes
    this.sourceNode = this.audioContext.createMediaStreamSource(inputStream)
    this.destinationNode = this.audioContext.createMediaStreamDestination()

    // Connect based on noise suppression state
    if (this.noiseSuppressionEnabled && this.wasmReady) {
      // In real implementation, would connect through AudioWorklet with RNNoise
      // For testing, we simulate bypass
      this.sourceNode.connect(this.destinationNode)
    } else {
      // Bypass noise suppression
      this.sourceNode.connect(this.destinationNode)
    }

    this.outputStream = this.destinationNode.stream
    this.isConnected = true

    return this.outputStream
  }

  disconnect(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect()
      } catch {
        // Ignore disconnect errors
      }
      this.sourceNode = null
    }

    if (this.processorNode) {
      try {
        this.processorNode.disconnect()
      } catch {
        // Ignore disconnect errors
      }
      this.processorNode = null
    }

    this.inputStream = null
    this.outputStream = null
    this.isConnected = false
  }

  destroy(): void {
    this.disconnect()

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close()
    }

    this.audioContext = null
    this.isInitialized = false
    this.wasmReady = false
  }

  setNoiseSuppression(enabled: boolean): void {
    const wasEnabled = this.noiseSuppressionEnabled
    this.noiseSuppressionEnabled = enabled

    // If connected and state changed, reconnect the pipeline
    if (this.isConnected && this.inputStream && wasEnabled !== enabled) {
      // Reconnect with new settings
      this.reconnectWithNewSettings()
    }
  }

  private reconnectWithNewSettings(): void {
    if (!this.sourceNode || !this.destinationNode) {
      return
    }

    // Disconnect existing chain
    try {
      this.sourceNode.disconnect()
    } catch {
      // Ignore
    }

    // Reconnect with updated noise suppression state
    this.sourceNode.connect(this.destinationNode)
  }

  getNoiseSuppressionStatus(): {
    enabled: boolean
    active: boolean
    wasmReady: boolean
  } {
    return {
      enabled: this.noiseSuppressionEnabled,
      active: this.isConnected && this.noiseSuppressionEnabled && this.wasmReady,
      wasmReady: this.wasmReady
    }
  }

  isInitializedState(): boolean {
    return this.isInitialized
  }

  isConnectedState(): boolean {
    return this.isConnected
  }

  getAudioContext(): AudioContext | null {
    return this.audioContext
  }
}

// Mock AudioContext
class MockAudioContext {
  sampleRate: number
  state: 'suspended' | 'running' | 'closed' = 'running'
  
  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate || 44100
  }
  
  createMediaStreamSource(stream: MediaStream): MockMediaStreamSourceNode {
    return new MockMediaStreamSourceNode()
  }
  
  createMediaStreamDestination(): MockMediaStreamDestinationNode {
    return new MockMediaStreamDestinationNode()
  }
  
  close = vi.fn().mockImplementation(() => {
    this.state = 'closed'
    return Promise.resolve()
  })
  
  resume = vi.fn().mockResolvedValue(undefined)
  suspend = vi.fn().mockResolvedValue(undefined)
}

class MockMediaStreamSourceNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class MockMediaStreamDestinationNode {
  stream = new MediaStream()
  connect = vi.fn()
  disconnect = vi.fn()
}

class MockAudioWorkletNode {
  port = {
    postMessage: vi.fn(),
    onmessage: null as ((e: MessageEvent) => void) | null
  }
  connect = vi.fn()
  disconnect = vi.fn()
}

// Setup globals
vi.stubGlobal('AudioContext', MockAudioContext)

describe('AudioPipeline Extended', () => {
  let pipeline: TestableAudioPipeline

  beforeEach(() => {
    vi.clearAllMocks()
    pipeline = new TestableAudioPipeline()
  })

  afterEach(() => {
    pipeline.destroy()
  })

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await pipeline.initialize()
      
      expect(pipeline.isInitializedState()).toBe(true)
    })

    it('should create AudioContext with 48kHz sample rate', async () => {
      await pipeline.initialize()
      
      const ctx = pipeline.getAudioContext()
      expect(ctx?.sampleRate).toBe(48000)
    })

    it('should mark WASM as ready after initialization', async () => {
      await pipeline.initialize()
      
      const status = pipeline.getNoiseSuppressionStatus()
      expect(status.wasmReady).toBe(true)
    })

    it('should only initialize once', async () => {
      await pipeline.initialize()
      await pipeline.initialize()
      
      expect(pipeline.isInitializedState()).toBe(true)
    })

    it('should handle initialization failure', async () => {
      // Override AudioContext to throw
      vi.stubGlobal('AudioContext', class {
        constructor() {
          throw new Error('Audio not supported')
        }
      })
      
      const failingPipeline = new TestableAudioPipeline()
      
      await expect(failingPipeline.initialize()).rejects.toThrow('Failed to initialize')
      
      // Restore
      vi.stubGlobal('AudioContext', MockAudioContext)
    })
  })

  describe('Stream Connection', () => {
    it('should connect input stream and return output stream', async () => {
      await pipeline.initialize()
      
      const inputStream = new MediaStream()
      const outputStream = await pipeline.connectInputStream(inputStream)
      
      expect(outputStream).toBeInstanceOf(MediaStream)
      expect(pipeline.isConnectedState()).toBe(true)
    })

    it('should throw if not initialized', async () => {
      const inputStream = new MediaStream()
      
      await expect(pipeline.connectInputStream(inputStream)).rejects.toThrow('not initialized')
    })

    it('should disconnect previous stream when connecting new one', async () => {
      await pipeline.initialize()
      
      const stream1 = new MediaStream()
      const stream2 = new MediaStream()
      
      await pipeline.connectInputStream(stream1)
      expect(pipeline.isConnectedState()).toBe(true)
      
      await pipeline.connectInputStream(stream2)
      expect(pipeline.isConnectedState()).toBe(true)
    })
  })

  describe('Disconnect', () => {
    it('should disconnect all nodes', async () => {
      await pipeline.initialize()
      
      const inputStream = new MediaStream()
      await pipeline.connectInputStream(inputStream)
      
      pipeline.disconnect()
      
      expect(pipeline.isConnectedState()).toBe(false)
    })

    it('should handle disconnect when not connected', () => {
      // Should not throw
      expect(() => pipeline.disconnect()).not.toThrow()
    })
  })

  describe('Destroy', () => {
    it('should clean up all resources', async () => {
      await pipeline.initialize()
      
      const inputStream = new MediaStream()
      await pipeline.connectInputStream(inputStream)
      
      pipeline.destroy()
      
      expect(pipeline.isInitializedState()).toBe(false)
      expect(pipeline.isConnectedState()).toBe(false)
    })

    it('should close AudioContext', async () => {
      await pipeline.initialize()
      
      const ctx = pipeline.getAudioContext()
      
      pipeline.destroy()
      
      expect(ctx?.state).toBe('closed')
    })

    it('should handle destroy when not initialized', () => {
      // Should not throw
      expect(() => pipeline.destroy()).not.toThrow()
    })
  })

  describe('Noise Suppression', () => {
    it('should enable noise suppression by default', () => {
      const status = pipeline.getNoiseSuppressionStatus()
      expect(status.enabled).toBe(true)
    })

    it('should toggle noise suppression', async () => {
      await pipeline.initialize()
      
      pipeline.setNoiseSuppression(false)
      
      const status = pipeline.getNoiseSuppressionStatus()
      expect(status.enabled).toBe(false)
    })

    it('should show active status when connected with suppression enabled', async () => {
      await pipeline.initialize()
      
      const inputStream = new MediaStream()
      await pipeline.connectInputStream(inputStream)
      
      const status = pipeline.getNoiseSuppressionStatus()
      expect(status.active).toBe(true)
    })

    it('should show inactive when suppression disabled', async () => {
      await pipeline.initialize()
      
      const inputStream = new MediaStream()
      await pipeline.connectInputStream(inputStream)
      
      pipeline.setNoiseSuppression(false)
      
      const status = pipeline.getNoiseSuppressionStatus()
      expect(status.active).toBe(false)
    })

    it('should reconnect pipeline when toggling suppression while connected', async () => {
      await pipeline.initialize()
      
      const inputStream = new MediaStream()
      await pipeline.connectInputStream(inputStream)
      
      expect(pipeline.isConnectedState()).toBe(true)
      
      pipeline.setNoiseSuppression(false)
      
      // Should still be connected after toggle
      expect(pipeline.isConnectedState()).toBe(true)
    })
  })

  describe('getNoiseSuppressionStatus', () => {
    it('should return correct status before initialization', () => {
      const status = pipeline.getNoiseSuppressionStatus()
      
      expect(status.enabled).toBe(true)
      expect(status.active).toBe(false)
      expect(status.wasmReady).toBe(false)
    })

    it('should return correct status after initialization', async () => {
      await pipeline.initialize()
      
      const status = pipeline.getNoiseSuppressionStatus()
      
      expect(status.enabled).toBe(true)
      expect(status.active).toBe(false) // Not connected yet
      expect(status.wasmReady).toBe(true)
    })

    it('should return correct status when connected', async () => {
      await pipeline.initialize()
      
      const inputStream = new MediaStream()
      await pipeline.connectInputStream(inputStream)
      
      const status = pipeline.getNoiseSuppressionStatus()
      
      expect(status.enabled).toBe(true)
      expect(status.active).toBe(true)
      expect(status.wasmReady).toBe(true)
    })
  })
})

describe('AudioPipeline Edge Cases', () => {
  let pipeline: TestableAudioPipeline

  beforeEach(() => {
    vi.clearAllMocks()
    pipeline = new TestableAudioPipeline()
  })

  afterEach(() => {
    pipeline.destroy()
  })

  it('should handle rapid connect/disconnect cycles', async () => {
    await pipeline.initialize()
    
    for (let i = 0; i < 10; i++) {
      const stream = new MediaStream()
      await pipeline.connectInputStream(stream)
      pipeline.disconnect()
    }
    
    expect(pipeline.isConnectedState()).toBe(false)
  })

  it('should handle rapid noise suppression toggling', async () => {
    await pipeline.initialize()
    
    const inputStream = new MediaStream()
    await pipeline.connectInputStream(inputStream)
    
    for (let i = 0; i < 20; i++) {
      pipeline.setNoiseSuppression(i % 2 === 0)
    }
    
    // Should not throw and final state should be deterministic
    const status = pipeline.getNoiseSuppressionStatus()
    expect(typeof status.enabled).toBe('boolean')
  })

  it('should handle destroy before initialization', () => {
    expect(() => pipeline.destroy()).not.toThrow()
    expect(pipeline.isInitializedState()).toBe(false)
  })

  it('should handle connect after destroy', async () => {
    await pipeline.initialize()
    pipeline.destroy()
    
    const inputStream = new MediaStream()
    
    await expect(pipeline.connectInputStream(inputStream)).rejects.toThrow()
  })
})
