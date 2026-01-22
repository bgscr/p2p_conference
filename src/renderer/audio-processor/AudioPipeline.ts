/**
 * AudioPipeline
 * Manages the audio processing chain including RNNoise noise suppression
 */

export class AudioPipeline {
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private destinationNode: MediaStreamAudioDestinationNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private gainNode: GainNode | null = null
  private analyserNode: AnalyserNode | null = null
  
  private isInitialized: boolean = false
  private noiseSuppressionEnabled: boolean = true

  /**
   * Initialize the audio pipeline
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('[AudioPipeline] Already initialized')
      return
    }

    try {
      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: 48000, // RNNoise works best at 48kHz
        latencyHint: 'interactive'
      })

      // Load AudioWorklet processor
      // Note: In production, ensure noise-processor.js is in public folder
      try {
        await this.audioContext.audioWorklet.addModule('/audio-processor/noise-processor.js')
        console.log('[AudioPipeline] AudioWorklet loaded successfully')
      } catch (workletError) {
        console.warn('[AudioPipeline] AudioWorklet not available, using bypass mode:', workletError)
        // Continue without noise suppression - it will be handled by browser
      }

      // Create destination node for WebRTC
      this.destinationNode = this.audioContext.createMediaStreamDestination()

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain()
      this.gainNode.gain.value = 1.0

      // Create analyser for visualization
      this.analyserNode = this.audioContext.createAnalyser()
      this.analyserNode.fftSize = 256

      this.isInitialized = true
      console.log('[AudioPipeline] Initialized successfully')
    } catch (err) {
      console.error('[AudioPipeline] Failed to initialize:', err)
      throw err
    }
  }

  /**
   * Connect an input stream through the processing pipeline
   * @returns Processed MediaStream for WebRTC
   */
  async connectInputStream(inputStream: MediaStream): Promise<MediaStream> {
    if (!this.audioContext || !this.destinationNode || !this.gainNode) {
      throw new Error('AudioPipeline not initialized')
    }

    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

    // Create source from input stream
    this.sourceNode = this.audioContext.createMediaStreamSource(inputStream)

    // Build processing chain
    if (this.noiseSuppressionEnabled && this.audioContext.audioWorklet) {
      try {
        // Create noise suppression worklet node
        this.workletNode = new AudioWorkletNode(this.audioContext, 'noise-suppressor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: {
            sampleRate: this.audioContext.sampleRate
          }
        })

        // Connect: source -> worklet -> gain -> analyser -> destination
        this.sourceNode.connect(this.workletNode)
        this.workletNode.connect(this.gainNode)
        this.gainNode.connect(this.analyserNode!)
        this.analyserNode!.connect(this.destinationNode)

        console.log('[AudioPipeline] Connected with noise suppression')
      } catch (err) {
        console.warn('[AudioPipeline] Worklet connection failed, using bypass:', err)
        // Fallback: direct connection
        this.sourceNode.connect(this.gainNode)
        this.gainNode.connect(this.analyserNode!)
        this.analyserNode!.connect(this.destinationNode)
      }
    } else {
      // Bypass mode: direct connection
      this.sourceNode.connect(this.gainNode)
      this.gainNode.connect(this.analyserNode!)
      this.analyserNode!.connect(this.destinationNode)
      console.log('[AudioPipeline] Connected in bypass mode')
    }

    return this.destinationNode.stream
  }

  /**
   * Get audio level for visualization (0-100)
   */
  getAudioLevel(): number {
    if (!this.analyserNode) return 0

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount)
    this.analyserNode.getByteFrequencyData(dataArray)

    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
    return Math.min(100, (average / 128) * 100)
  }

  /**
   * Set noise suppression enabled/disabled
   */
  setNoiseSuppression(enabled: boolean): void {
    this.noiseSuppressionEnabled = enabled
    
    if (this.workletNode) {
      this.workletNode.port.postMessage({ 
        type: 'setEnabled', 
        enabled 
      })
    }

    console.log('[AudioPipeline] Noise suppression:', enabled ? 'enabled' : 'disabled')
  }

  /**
   * Set output gain (volume)
   */
  setGain(value: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(2, value))
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.gainNode) {
      this.gainNode.disconnect()
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect()
    }

    console.log('[AudioPipeline] Disconnected')
  }

  /**
   * Cleanup and destroy
   */
  async destroy(): Promise<void> {
    this.disconnect()

    if (this.audioContext) {
      await this.audioContext.close()
      this.audioContext = null
    }

    this.destinationNode = null
    this.gainNode = null
    this.analyserNode = null
    this.isInitialized = false

    console.log('[AudioPipeline] Destroyed')
  }

  /**
   * Get processed output stream
   */
  getOutputStream(): MediaStream | null {
    return this.destinationNode?.stream || null
  }

  /**
   * Get audio context sample rate
   */
  getSampleRate(): number {
    return this.audioContext?.sampleRate || 48000
  }
}

// Singleton instance
let pipelineInstance: AudioPipeline | null = null

export function getAudioPipeline(): AudioPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new AudioPipeline()
  }
  return pipelineInstance
}
