/**
 * NoiseProcessor - AudioWorklet for RNNoise-based noise suppression
 * 
 * This processor runs in a dedicated audio thread for real-time processing.
 * It uses a ring buffer to adapt between Web Audio's 128-sample frames
 * and RNNoise's required 480-sample frames (10ms @ 48kHz).
 * 
 * Note: In production, rnnoise.wasm must be loaded via WebAssembly
 */

// Frame sizes
const WEBAUDIO_FRAME_SIZE = 128;   // Web Audio default
const RNNOISE_FRAME_SIZE = 480;    // RNNoise requirement (10ms @ 48kHz)
const BUFFER_SIZE = RNNOISE_FRAME_SIZE * 4; // Ring buffer capacity

/**
 * Simple ring buffer implementation for AudioWorklet
 */
class RingBuffer {
  constructor(capacity) {
    this.buffer = new Float32Array(capacity);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
    this.capacity = capacity;
  }

  write(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.writeIndex] = samples[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      if (this.available < this.capacity) {
        this.available++;
      } else {
        this.readIndex = (this.readIndex + 1) % this.capacity;
      }
    }
  }

  read(count) {
    if (this.available < count) return null;
    
    const result = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = this.buffer[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.capacity;
    }
    this.available -= count;
    return result;
  }

  getAvailable() {
    return this.available;
  }
}

/**
 * Noise Suppressor AudioWorklet Processor
 */
class NoiseSuppressorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.inputBuffer = new RingBuffer(BUFFER_SIZE);
    this.outputBuffer = new RingBuffer(BUFFER_SIZE);
    this.enabled = true;
    this.rnnoiseContext = null;
    this.rnnoiseReady = false;

    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'setEnabled') {
        this.enabled = event.data.enabled;
        console.log('[NoiseProcessor] Enabled:', this.enabled);
      }
    };

    // Initialize RNNoise
    this.initRNNoise();
  }

  /**
   * Initialize RNNoise WASM module
   * Note: This is a placeholder - actual WASM loading needs to be implemented
   */
  async initRNNoise() {
    try {
      // In production, load rnnoise.wasm here
      // For now, we'll use a simple noise gate as fallback
      console.log('[NoiseProcessor] RNNoise initialization (placeholder mode)');
      
      // Placeholder: RNNoise would be loaded here
      // const wasmModule = await WebAssembly.instantiateStreaming(
      //   fetch('/audio-processor/rnnoise.wasm'),
      //   {}
      // );
      // this.rnnoiseContext = wasmModule.instance.exports;
      
      this.rnnoiseReady = false; // Set to true when WASM is loaded
    } catch (err) {
      console.error('[NoiseProcessor] Failed to load RNNoise:', err);
      this.rnnoiseReady = false;
    }
  }

  /**
   * Process audio frames
   * Called for each 128-sample block
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // Handle no input
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];

    // If noise suppression is disabled, pass through
    if (!this.enabled) {
      outputChannel.set(inputChannel);
      return true;
    }

    // Write input to buffer
    this.inputBuffer.write(inputChannel);

    // Process when we have enough samples for RNNoise
    while (this.inputBuffer.getAvailable() >= RNNOISE_FRAME_SIZE) {
      const frame = this.inputBuffer.read(RNNOISE_FRAME_SIZE);
      
      if (frame) {
        let processedFrame;
        
        if (this.rnnoiseReady && this.rnnoiseContext) {
          // Process with RNNoise
          processedFrame = this.processWithRNNoise(frame);
        } else {
          // Fallback: simple noise gate
          processedFrame = this.simpleNoiseGate(frame);
        }
        
        this.outputBuffer.write(processedFrame);
      }
    }

    // Read processed samples to output
    const processed = this.outputBuffer.read(WEBAUDIO_FRAME_SIZE);
    
    if (processed) {
      outputChannel.set(processed);
    } else {
      // Not enough processed samples yet, output silence
      outputChannel.fill(0);
    }

    return true;
  }

  /**
   * Process frame with RNNoise
   * Placeholder for actual WASM integration
   */
  processWithRNNoise(frame) {
    // This would call rnnoise_process_frame() from WASM
    // For now, return the frame as-is
    return frame;
  }

  /**
   * Simple noise gate as fallback
   * Removes audio below a threshold
   */
  simpleNoiseGate(frame) {
    const threshold = 0.01; // Adjust based on testing
    const result = new Float32Array(frame.length);
    
    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i];
      // Simple gate: silence samples below threshold
      result[i] = Math.abs(sample) > threshold ? sample : sample * 0.1;
    }
    
    return result;
  }
}

// Register the processor
registerProcessor('noise-suppressor', NoiseSuppressorProcessor);
