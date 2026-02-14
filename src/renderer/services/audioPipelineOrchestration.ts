export interface AudioPipelineAdapter {
  setNoiseSuppression: (enabled: boolean) => void
  connectInputStream: (stream: MediaStream) => Promise<MediaStream>
  getNoiseSuppressionStatus?: () => {
    enabled: boolean
    active: boolean
    wasmReady: boolean
  }
}

export interface JoinPipelineResult {
  stream: MediaStream
  usedPipeline: boolean
  status?: {
    enabled: boolean
    active: boolean
    wasmReady: boolean
  }
  error?: unknown
}

export interface InputSwitchPipelineResult {
  stream: MediaStream
  track: MediaStreamTrack | null
  usedPipeline: boolean
  error?: unknown
}

interface JoinPipelineOptions {
  rawStream: MediaStream
  noiseSuppressionEnabled: boolean
  pipeline: AudioPipelineAdapter
  createMediaStream?: (tracks: MediaStreamTrack[]) => MediaStream
}

interface InputSwitchPipelineOptions {
  rawStream: MediaStream
  pipeline: AudioPipelineAdapter
}

export async function prepareJoinPipelineStream(options: JoinPipelineOptions): Promise<JoinPipelineResult> {
  const {
    rawStream,
    noiseSuppressionEnabled,
    pipeline,
    createMediaStream = (tracks) => new MediaStream(tracks)
  } = options

  try {
    pipeline.setNoiseSuppression(noiseSuppressionEnabled)
    const processedStream = await pipeline.connectInputStream(rawStream)
    const processedAudioTracks = processedStream.getAudioTracks()

    if (processedAudioTracks.length === 0) {
      throw new Error('Processed stream has no audio tracks')
    }

    return {
      stream: createMediaStream([
        ...processedAudioTracks,
        ...rawStream.getVideoTracks()
      ]),
      usedPipeline: true,
      status: pipeline.getNoiseSuppressionStatus?.()
    }
  } catch (error) {
    return {
      stream: rawStream,
      usedPipeline: false,
      error
    }
  }
}

export async function prepareInputSwitchPipeline(options: InputSwitchPipelineOptions): Promise<InputSwitchPipelineResult> {
  const { rawStream, pipeline } = options

  try {
    const processedStream = await pipeline.connectInputStream(rawStream)
    const processedAudioTrack = processedStream.getAudioTracks()[0]
    if (processedAudioTrack) {
      return {
        stream: processedStream,
        track: processedAudioTrack,
        usedPipeline: true
      }
    }

    return {
      stream: rawStream,
      track: rawStream.getAudioTracks()[0] ?? null,
      usedPipeline: false,
      error: new Error('Processed stream has no audio track')
    }
  } catch (error) {
    return {
      stream: rawStream,
      track: rawStream.getAudioTracks()[0] ?? null,
      usedPipeline: false,
      error
    }
  }
}
