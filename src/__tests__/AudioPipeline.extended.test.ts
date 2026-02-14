/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AudioPipeline,
  getAudioPipeline,
  resetAudioPipeline
} from '../renderer/audio-processor/AudioPipeline'

vi.mock('../renderer/utils/Logger', () => ({
  AudioLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

class MockAudioContext {
  sampleRate = 48000
  state: 'running' | 'closed' = 'running'
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }

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

  close = vi.fn().mockImplementation(async () => {
    this.state = 'closed'
  })
}

class MockAudioWorkletNode {
  port = {
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }

  constructor() {
    setTimeout(() => {
      this.port.onmessage?.({ data: { type: 'ready' } } as MessageEvent)
    }, 0)
  }

  connect = vi.fn()
  disconnect = vi.fn()
}

async function createInitializedPipeline(): Promise<AudioPipeline> {
  const pipeline = new AudioPipeline()
  await pipeline.initialize()
  return pipeline
}

describe('AudioPipeline - extended consolidated contracts', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetAudioPipeline()
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)
    vi.stubGlobal('MediaStream', class {
      getTracks = vi.fn().mockReturnValue([])
      getAudioTracks = vi.fn().mockReturnValue([])
      getVideoTracks = vi.fn().mockReturnValue([])
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await resetAudioPipeline()
  })

  it('exposes connected output stream after input stream is connected', async () => {
    const pipeline = await createInitializedPipeline()
    const outputStream = await pipeline.connectInputStream(new MediaStream())

    expect(outputStream).toBeDefined()
    expect(pipeline.getOutputStream()).toBe(outputStream)
  })

  it('rejects initialization when AudioContext construction fails', async () => {
    vi.stubGlobal('AudioContext', class {
      constructor() {
        throw new Error('AudioContext failed')
      }
    })

    const pipeline = new AudioPipeline()
    await expect(pipeline.initialize()).rejects.toThrow('AudioContext failed')
  })

  it('keeps singleton identity until explicit reset', async () => {
    const first = getAudioPipeline()
    const second = getAudioPipeline()

    expect(first).toBe(second)

    await resetAudioPipeline()

    const third = getAudioPipeline()
    expect(third).not.toBe(first)
  })

  it.each([
    { gain: -1, expected: 0 },
    { gain: 3, expected: 2 },
    { gain: 1.25, expected: 1.25 }
  ])('clamps gain value $gain to $expected', async ({ gain, expected }) => {
    const pipeline = await createInitializedPipeline()
    pipeline.setGain(gain)

    expect((pipeline as any).gainNode.gain.value).toBe(expected)
  })
})
