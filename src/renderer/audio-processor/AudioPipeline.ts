/**
 * AudioPipeline
 * 
 * Manages the complete audio processing chain including:
 * - Audio context management (48kHz for RNNoise compatibility)
 * - WASM module loading and transfer to AudioWorklet
 * - RNNoise noise suppression
 * - Gain control and visualization
 * 
 * Architecture:
 * Microphone → [Browser AEC/AGC] → AudioContext → RNNoise AudioWorklet → WebRTC
 */

import { AudioLog } from '../utils/Logger';

// WASM file path (relative to index.html - works with both dev server and file:// protocol)
const RNNOISE_WASM_PATH = './audio-processor/rnnoise.wasm';
const PROCESSOR_PATH = './audio-processor/noise-processor.js';

export class AudioPipeline {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;

  // WASM module storage
  private wasmModule: WebAssembly.Module | null = null;
  private wasmMemory: WebAssembly.Memory | null = null;

  // State
  private isInitialized: boolean = false;
  private isWasmReady: boolean = false;
  private noiseSuppressionEnabled: boolean = true;

  /**
   * Initialize the audio pipeline
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      AudioLog.debug('Already initialized');
      return;
    }

    AudioLog.info('Initializing AudioPipeline...');

    try {
      // Create audio context at 48kHz (required by RNNoise)
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'interactive'
      });

      AudioLog.info('AudioContext created', { sampleRate: this.audioContext.sampleRate });

      if (this.audioContext.sampleRate !== 48000) {
        AudioLog.warn('Sample rate is not 48kHz! RNNoise may not work correctly.', {
          actualRate: this.audioContext.sampleRate
        });
      }

      // Load WASM module first
      await this.loadWasmModule();

      // Load AudioWorklet processor
      try {
        AudioLog.debug('Loading AudioWorklet module...', { path: PROCESSOR_PATH });
        await this.audioContext.audioWorklet.addModule(PROCESSOR_PATH);
        AudioLog.info('AudioWorklet module loaded successfully');
      } catch (workletError) {
        AudioLog.warn('Failed to load AudioWorklet - noise suppression will be unavailable', {
          error: workletError
        });
      }

      // Create destination node for WebRTC output
      this.destinationNode = this.audioContext.createMediaStreamDestination();

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0;

      // Create analyser for visualization
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;

      this.isInitialized = true;
      AudioLog.info('AudioPipeline initialization complete', {
        wasmReady: this.isWasmReady,
        sampleRate: this.audioContext.sampleRate
      });

    } catch (err) {
      AudioLog.error('AudioPipeline initialization failed', { error: err });
      throw err;
    }
  }

  /**
   * Load the RNNoise WASM module
   */
  private async loadWasmModule(): Promise<void> {
    try {
      AudioLog.info('Loading RNNoise WASM module...', { path: RNNOISE_WASM_PATH });

      // Fetch the WASM binary
      const response = await fetch(RNNOISE_WASM_PATH);

      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
      }

      const wasmBinary = await response.arrayBuffer();
      AudioLog.info('WASM binary loaded', { size: wasmBinary.byteLength });

      // Create shared memory for WASM
      // RNNoise needs at least 256 pages (16MB) for its internal allocations
      this.wasmMemory = new WebAssembly.Memory({
        initial: 256,  // 16MB initial
        maximum: 512,  // 32MB max
        shared: false  // Shared memory requires special headers, keep false for compatibility
      });

      // Compile the WASM module
      this.wasmModule = await WebAssembly.compile(wasmBinary);
      AudioLog.info('WASM module compiled successfully');

      this.isWasmReady = true;

    } catch (error) {
      AudioLog.error('Failed to load WASM module', { error });
      this.isWasmReady = false;
      // Don't throw - allow fallback to bypass mode
    }
  }

  /**
   * Connect an input stream through the processing pipeline
   * @returns Processed MediaStream for WebRTC
   */
  async connectInputStream(inputStream: MediaStream): Promise<MediaStream> {
    if (!this.audioContext || !this.destinationNode || !this.gainNode) {
      throw new Error('AudioPipeline not initialized');
    }

    // Disconnect any existing connections
    this.disconnect();

    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
      AudioLog.info('AudioContext resumed from suspended state');
    }

    // Create source from input stream
    this.sourceNode = this.audioContext.createMediaStreamSource(inputStream);

    // Determine if we should use noise suppression
    const useNoiseSuppression =
      this.noiseSuppressionEnabled &&
      this.isWasmReady &&
      this.wasmModule &&
      this.wasmMemory &&
      this.audioContext.audioWorklet;

    AudioLog.debug('Noise suppression decision', {
      enabled: this.noiseSuppressionEnabled,
      wasmReady: this.isWasmReady,
      willUse: useNoiseSuppression
    });

    if (useNoiseSuppression) {
      try {
        // Create noise suppression worklet node
        this.workletNode = new AudioWorkletNode(this.audioContext, 'noise-suppressor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: 'explicit',
          processorOptions: {
            sampleRate: this.audioContext.sampleRate
          }
        });

        // Set up message handler for worklet communication
        this.workletNode.port.onmessage = this.handleWorkletMessage.bind(this);

        // Initialize WASM in the worklet
        await this.initializeWorkletWasm();

        // Connect: source → worklet → gain → analyser → destination
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.gainNode);
        this.gainNode.connect(this.analyserNode!);
        this.analyserNode!.connect(this.destinationNode);

        AudioLog.info('Connected with RNNoise AI noise suppression');

      } catch (err) {
        AudioLog.warn('Failed to enable noise suppression, falling back to bypass', { error: err });
        this.connectBypass();
      }
    } else {
      this.connectBypass();
    }

    return this.destinationNode.stream;
  }

  /**
   * Connect in bypass mode (no noise suppression)
   */
  private connectBypass(): void {
    if (!this.sourceNode || !this.gainNode || !this.analyserNode || !this.destinationNode) {
      return;
    }

    // Direct connection: source → gain → analyser → destination
    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);
    this.analyserNode.connect(this.destinationNode);

    AudioLog.info('Connected in bypass mode (no AI noise suppression)', {
      wasmReady: this.isWasmReady,
      nsEnabled: this.noiseSuppressionEnabled
    });
  }

  /**
   * Initialize WASM in the AudioWorklet
   */
  private async initializeWorkletWasm(): Promise<void> {
    if (!this.workletNode || !this.wasmModule || !this.wasmMemory) {
      throw new Error('Worklet or WASM not ready');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WASM initialization timeout'));
      }, 5000);

      // Listen for ready/error messages
      const originalHandler = this.workletNode!.port.onmessage;
      this.workletNode!.port.onmessage = (event) => {
        if (event.data.type === 'ready') {
          clearTimeout(timeout);
          this.workletNode!.port.onmessage = originalHandler;
          AudioLog.info('Worklet WASM initialized successfully');
          resolve();
        } else if (event.data.type === 'error') {
          clearTimeout(timeout);
          this.workletNode!.port.onmessage = originalHandler;
          AudioLog.error('Worklet WASM initialization failed', { error: event.data.error });
          reject(new Error(event.data.error));
        }

        // Also call original handler
        if (originalHandler) {
          originalHandler.call(this.workletNode!.port, event);
        }
      };

      // Send WASM module to worklet
      AudioLog.debug('Sending WASM module to worklet...');
      this.workletNode!.port.postMessage({
        type: 'init',
        data: {
          wasmModule: this.wasmModule,
          wasmMemory: this.wasmMemory
        }
      });
    });
  }

  /**
   * Handle messages from the AudioWorklet
   */
  private handleWorkletMessage(event: MessageEvent): void {
    const { type, data } = event.data;

    switch (type) {
      case 'ready':
        AudioLog.debug('Worklet reports ready');
        break;

      case 'error':
        AudioLog.error('Worklet error', { data });
        break;

      case 'stats':
        AudioLog.debug('Worklet stats', { data });
        break;

      default:
        // Unknown message type
        break;
    }
  }

  /**
   * Get audio level for visualization (0-100)
   */
  getAudioLevel(): number {
    if (!this.analyserNode) return 0;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);

    // Calculate RMS-like average
    const average = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;

    // Scale to 0-100 with some compression for better visual feedback
    return Math.min(100, Math.pow(average / 128, 0.7) * 100);
  }

  /**
   * Set noise suppression enabled/disabled
   */
  setNoiseSuppression(enabled: boolean): void {
    this.noiseSuppressionEnabled = enabled;

    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setEnabled',
        data: { enabled }
      });
      AudioLog.info('Noise suppression toggled', { enabled });
    }
  }

  /**
   * Check if RNNoise AI noise suppression is active
   */
  isNoiseSuppressionActive(): boolean {
    return this.isWasmReady && this.noiseSuppressionEnabled && this.workletNode !== null;
  }

  /**
   * Get noise suppression status
   */
  getNoiseSuppressionStatus(): { enabled: boolean; active: boolean; wasmReady: boolean } {
    return {
      enabled: this.noiseSuppressionEnabled,
      active: this.isNoiseSuppressionActive(),
      wasmReady: this.isWasmReady
    };
  }

  /**
   * Request performance statistics from the worklet
   */
  async getStats(): Promise<any> {
    if (!this.workletNode) {
      return { error: 'Worklet not available' };
    }

    // Store reference to avoid null check issues in closure
    const workletNode = this.workletNode;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ error: 'Stats request timeout' });
      }, 1000);

      const handler = (event: MessageEvent) => {
        if (event.data.type === 'stats') {
          clearTimeout(timeout);
          workletNode.port.removeEventListener('message', handler);
          resolve(event.data.data);
        }
      };

      workletNode.port.addEventListener('message', handler);
      workletNode.port.postMessage({ type: 'getStats' });
    });
  }

  /**
   * Set output gain (volume)
   */
  setGain(value: number): void {
    if (this.gainNode) {
      // Clamp value between 0 and 2 (200%)
      this.gainNode.gain.value = Math.max(0, Math.min(2, value));
    }
  }

  /**
   * Disconnect audio nodes
   */
  disconnect(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.sourceNode = null;
    }

    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
        this.workletNode.port.postMessage({ type: 'destroy' });
      } catch {
        // Ignore disconnect errors
      }
      this.workletNode = null;
    }

    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    AudioLog.debug('Pipeline disconnected');
  }

  /**
   * Cleanup and destroy the pipeline
   */
  async destroy(): Promise<void> {
    this.disconnect();

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch (e) {
        AudioLog.warn('Error closing AudioContext', { error: e });
      }
      this.audioContext = null;
    }

    this.destinationNode = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.wasmModule = null;
    this.wasmMemory = null;
    this.isInitialized = false;
    this.isWasmReady = false;

    AudioLog.info('AudioPipeline destroyed');
  }

  /**
   * Get processed output stream
   */
  getOutputStream(): MediaStream | null {
    return this.destinationNode?.stream || null;
  }

  /**
   * Get audio context sample rate
   */
  getSampleRate(): number {
    return this.audioContext?.sampleRate || 48000;
  }

  /**
   * Check if pipeline is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Singleton instance
let pipelineInstance: AudioPipeline | null = null;

export function getAudioPipeline(): AudioPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new AudioPipeline();
  }
  return pipelineInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export async function resetAudioPipeline(): Promise<void> {
  if (pipelineInstance) {
    await pipelineInstance.destroy();
    pipelineInstance = null;
  }
}
