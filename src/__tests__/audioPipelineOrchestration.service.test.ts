import { describe, expect, it, vi } from 'vitest'
import {
  prepareInputSwitchPipeline,
  prepareJoinPipelineStream,
  type AudioPipelineAdapter
} from '../renderer/services/audioPipelineOrchestration'

interface TrackLike {
  id: string
  kind: 'audio' | 'video'
}

interface StreamLike {
  getAudioTracks: () => TrackLike[]
  getVideoTracks: () => TrackLike[]
}

function createStream(audioCount: number, videoCount: number): StreamLike {
  const audioTracks = Array.from({ length: audioCount }, (_, index) => ({
    id: `audio-${index}`,
    kind: 'audio' as const
  }))
  const videoTracks = Array.from({ length: videoCount }, (_, index) => ({
    id: `video-${index}`,
    kind: 'video' as const
  }))

  return {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks
  }
}

describe('audioPipelineOrchestration service', () => {
  it('builds a combined stream for join when pipeline succeeds', async () => {
    const rawStream = createStream(1, 1) as unknown as MediaStream
    const processedStream = createStream(1, 0) as unknown as MediaStream
    const createMediaStream = vi.fn((tracks: MediaStreamTrack[]) => ({
      getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
      getVideoTracks: () => tracks.filter(t => t.kind === 'video')
    } as unknown as MediaStream))

    const pipeline: AudioPipelineAdapter = {
      setNoiseSuppression: vi.fn(),
      connectInputStream: vi.fn().mockResolvedValue(processedStream),
      getNoiseSuppressionStatus: vi.fn().mockReturnValue({
        enabled: true,
        active: true,
        wasmReady: true
      })
    }

    const result = await prepareJoinPipelineStream({
      rawStream,
      noiseSuppressionEnabled: true,
      pipeline,
      createMediaStream
    })

    expect(pipeline.setNoiseSuppression).toHaveBeenCalledWith(true)
    expect(pipeline.connectInputStream).toHaveBeenCalledWith(rawStream)
    expect(createMediaStream).toHaveBeenCalledTimes(1)
    expect(result.usedPipeline).toBe(true)
    expect(result.stream.getAudioTracks()).toHaveLength(1)
    expect(result.stream.getVideoTracks()).toHaveLength(1)
    expect(result.status).toEqual({ enabled: true, active: true, wasmReady: true })
  })

  it('falls back to raw stream for join when pipeline throws', async () => {
    const rawStream = createStream(1, 1) as unknown as MediaStream
    const pipeline: AudioPipelineAdapter = {
      setNoiseSuppression: vi.fn(),
      connectInputStream: vi.fn().mockRejectedValue(new Error('pipeline-failed'))
    }

    const result = await prepareJoinPipelineStream({
      rawStream,
      noiseSuppressionEnabled: false,
      pipeline
    })

    expect(result.usedPipeline).toBe(false)
    expect(result.stream).toBe(rawStream)
    expect(String(result.error)).toContain('pipeline-failed')
  })

  it('falls back to raw stream and raw track when processed stream has no audio track', async () => {
    const rawStream = createStream(1, 0) as unknown as MediaStream
    const processedStream = createStream(0, 0) as unknown as MediaStream
    const pipeline: AudioPipelineAdapter = {
      setNoiseSuppression: vi.fn(),
      connectInputStream: vi.fn().mockResolvedValue(processedStream)
    }

    const result = await prepareInputSwitchPipeline({
      rawStream,
      pipeline
    })

    expect(result.usedPipeline).toBe(false)
    expect(result.stream).toBe(rawStream)
    expect(result.track?.id).toBe('audio-0')
    expect(String(result.error)).toContain('no audio track')
  })

  it('uses processed track for input switch when available', async () => {
    const rawStream = createStream(1, 0) as unknown as MediaStream
    const processedStream = createStream(1, 0) as unknown as MediaStream
    const pipeline: AudioPipelineAdapter = {
      setNoiseSuppression: vi.fn(),
      connectInputStream: vi.fn().mockResolvedValue(processedStream)
    }

    const result = await prepareInputSwitchPipeline({
      rawStream,
      pipeline
    })

    expect(result.usedPipeline).toBe(true)
    expect(result.stream).toBe(processedStream)
    expect(result.track?.id).toBe('audio-0')
  })
})
