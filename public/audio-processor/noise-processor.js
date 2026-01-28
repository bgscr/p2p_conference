/**
 * RNNoise AudioWorklet Processor
 * 
 * Implements real-time AI noise suppression using the RNNoise library compiled to WASM.
 * 
 * Compatible with @jitsi/rnnoise-wasm v0.2.x exports:
 * - e = _malloc
 * - f = _free
 * - g = _rnnoise_init
 * - h = _rnnoise_create
 * - i = _rnnoise_destroy
 * - j = _rnnoise_process_frame
 * 
 * Key technical details:
 * - RNNoise requires 480 samples per frame (10ms @ 48kHz)
 * - Web Audio processes 128 samples per quantum
 * - Ring buffer bridges this frame size mismatch
 * - WASM module is transferred from main thread
 */

// ==================== Constants ====================
const RNNOISE_FRAME_SIZE = 480;  // RNNoise requires exactly 480 samples (10ms @ 48kHz)
const WEBAUDIO_FRAME_SIZE = 128; // Web Audio default render quantum
const BUFFER_SIZE = RNNOISE_FRAME_SIZE * 4; // Ring buffer capacity (enough for latency headroom)
const SAMPLE_SCALE = 32768; // RNNoise expects int16 range, Web Audio uses float32 [-1, 1]

// ==================== Ring Buffer ====================
/**
 * Simple ring buffer for frame size adaptation
 */
class RingBuffer {
  constructor(capacity) {
    this.buffer = new Float32Array(capacity);
    this.capacity = capacity;
    this.writePtr = 0;
    this.readPtr = 0;
    this.available = 0;
  }

  write(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.writePtr] = samples[i];
      this.writePtr = (this.writePtr + 1) % this.capacity;
      
      if (this.available < this.capacity) {
        this.available++;
      } else {
        // Overflow: advance read pointer (discard oldest)
        this.readPtr = (this.readPtr + 1) % this.capacity;
      }
    }
  }

  read(count) {
    if (this.available < count) {
      return null;
    }

    const result = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = this.buffer[this.readPtr];
      this.readPtr = (this.readPtr + 1) % this.capacity;
    }
    this.available -= count;
    return result;
  }

  getAvailable() {
    return this.available;
  }

  clear() {
    this.writePtr = 0;
    this.readPtr = 0;
    this.available = 0;
    this.buffer.fill(0);
  }
}

// ==================== Noise Suppressor Processor ====================
/**
 * AudioWorkletProcessor that applies RNNoise noise suppression
 */
class NoiseSuppressorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // Processing state
    this.enabled = true;
    this.wasmReady = false;
    this.wasmExports = null;
    this.wasmMemory = null;
    this.denoiseState = 0;

    // WASM memory pointers (will be allocated once)
    this.inputPtr = 0;
    this.outputPtr = 0;

    // Buffers for frame size adaptation
    this.inputBuffer = new RingBuffer(BUFFER_SIZE);
    this.outputBuffer = new RingBuffer(BUFFER_SIZE);

    // Initial output silence to handle latency
    this.initializing = true;
    this.initFrameCount = 0;

    // Performance tracking
    this.framesProcessed = 0;
    this.totalProcessingTime = 0;

    // Message handling
    this.port.onmessage = this.handleMessage.bind(this);

    console.log('[NoiseProcessor] Initialized, waiting for WASM module...');
  }

  handleMessage(event) {
    const { type, data } = event.data;

    switch (type) {
      case 'init':
        this.initializeWasm(data.wasmModule, data.wasmMemory);
        break;

      case 'setEnabled':
        this.enabled = data.enabled;
        console.log('[NoiseProcessor] Noise suppression:', this.enabled ? 'enabled' : 'disabled');
        break;

      case 'getStats':
        this.sendStats();
        break;

      case 'destroy':
        this.cleanup();
        break;

      default:
        console.warn('[NoiseProcessor] Unknown message type:', type);
    }
  }

  /**
   * Initialize the WASM module
   * Compatible with @jitsi/rnnoise-wasm exports
   */
  async initializeWasm(wasmModule, wasmMemory) {
    try {
      console.log('[NoiseProcessor] Initializing WASM module...');

      this.wasmMemory = wasmMemory;

      // Create Emscripten-compatible imports
      // @jitsi/rnnoise-wasm expects these import names
      const imports = {
        env: {
          // 'a' = emscripten_resize_heap - attempts to grow memory
          a: () => {
            console.warn('[NoiseProcessor] Memory resize requested but not supported');
            return 0; // Return 0 to indicate failure (memory won't grow)
          },
          // 'b' = emscripten_memcpy_big - copies large memory blocks
          b: (dest, src, num) => {
            try {
              const heap = new Uint8Array(this.wasmMemory.buffer);
              heap.copyWithin(dest, src, src + num);
            } catch (e) {
              console.error('[NoiseProcessor] memcpy_big error:', e);
            }
          },
          memory: wasmMemory
        }
      };

      // Instantiate the WASM module
      console.log('[NoiseProcessor] Instantiating WASM...');
      const instance = await WebAssembly.instantiate(wasmModule, imports);
      this.wasmExports = instance.exports;

      console.log('[NoiseProcessor] WASM exports:', Object.keys(this.wasmExports));

      // Call constructors if available (Emscripten runtime init)
      // Export 'd' = ___wasm_call_ctors
      if (this.wasmExports.d) {
        this.wasmExports.d();
        console.log('[NoiseProcessor] Called WASM constructors');
      }

      // Get RNNoise API functions
      // @jitsi/rnnoise-wasm v0.2.x export names:
      const malloc = this.wasmExports.e || this.wasmExports._malloc;
      const rnnoiseCreate = this.wasmExports.h || this.wasmExports._rnnoise_create;
      
      if (!malloc) {
        throw new Error('malloc not found in WASM exports (expected export "e" or "_malloc")');
      }
      if (!rnnoiseCreate) {
        throw new Error('rnnoise_create not found in WASM exports (expected export "h" or "_rnnoise_create")');
      }

      // Allocate memory for input/output frames ONCE
      // Each frame is 480 floats = 480 * 4 = 1920 bytes
      this.inputPtr = malloc(RNNOISE_FRAME_SIZE * 4);
      this.outputPtr = malloc(RNNOISE_FRAME_SIZE * 4);

      if (!this.inputPtr || !this.outputPtr) {
        throw new Error('Failed to allocate WASM memory for audio frames');
      }

      console.log('[NoiseProcessor] Memory allocated - Input ptr:', this.inputPtr, 'Output ptr:', this.outputPtr);

      // Create RNNoise denoiser state
      // Pass 0 (null) for default model
      this.denoiseState = rnnoiseCreate(0);

      if (!this.denoiseState) {
        throw new Error('Failed to create RNNoise denoiser state');
      }

      this.wasmReady = true;
      console.log('[NoiseProcessor] RNNoise WASM initialized successfully');
      console.log('[NoiseProcessor] Denoiser state handle:', this.denoiseState);

      // Notify main thread
      this.port.postMessage({ type: 'ready' });

    } catch (error) {
      console.error('[NoiseProcessor] WASM initialization failed:', error);
      this.wasmReady = false;
      this.port.postMessage({ type: 'error', error: error.message });
    }
  }

  /**
   * Process audio - called for each 128-sample render quantum
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // Handle missing input/output
    if (!input || !input[0] || !output || !output[0]) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];

    // If disabled or WASM not ready, pass through unchanged
    if (!this.enabled || !this.wasmReady) {
      outputChannel.set(inputChannel);
      return true;
    }

    // Add input samples to buffer
    this.inputBuffer.write(inputChannel);

    // Process complete frames when available
    while (this.inputBuffer.getAvailable() >= RNNOISE_FRAME_SIZE) {
      const inputFrame = this.inputBuffer.read(RNNOISE_FRAME_SIZE);
      
      if (inputFrame) {
        const processedFrame = this.processRnnoiseFrame(inputFrame);
        this.outputBuffer.write(processedFrame);
      }
    }

    // Read processed samples to output
    const processedSamples = this.outputBuffer.read(WEBAUDIO_FRAME_SIZE);
    
    if (processedSamples) {
      outputChannel.set(processedSamples);
      
      // Mark initialization complete after first successful output
      if (this.initializing) {
        this.initFrameCount++;
        if (this.initFrameCount > 10) {
          this.initializing = false;
          console.log('[NoiseProcessor] First audio frames processed successfully');
        }
      }
    } else {
      // Not enough processed samples yet (initial latency)
      // Output silence to maintain timing
      outputChannel.fill(0);
    }

    return true;
  }

  /**
   * Process a single 480-sample frame through RNNoise
   */
  processRnnoiseFrame(inputFrame) {
    const startTime = currentTime;

    try {
      // Get HEAP view (refresh in case memory grew, though unlikely)
      const HEAPF32 = new Float32Array(this.wasmMemory.buffer);

      // Calculate heap indices (divide by 4 for Float32 indexing)
      const inputIndex = this.inputPtr / 4;
      const outputIndex = this.outputPtr / 4;

      // Copy input to WASM memory, scaling from [-1,1] to int16 range
      // RNNoise expects data in roughly int16 range for proper processing
      for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
        HEAPF32[inputIndex + i] = inputFrame[i] * SAMPLE_SCALE;
      }

      // Get process function
      // @jitsi/rnnoise-wasm: export 'j' = rnnoise_process_frame
      const processFrame = this.wasmExports.j || this.wasmExports._rnnoise_process_frame;
      
      if (!processFrame) {
        console.error('[NoiseProcessor] rnnoise_process_frame not found');
        return inputFrame;
      }

      // Process frame through RNNoise
      // Returns voice activity probability (0.0-1.0), useful for VAD
      const vadProb = processFrame(
        this.denoiseState,
        this.outputPtr,  // Output buffer pointer
        this.inputPtr    // Input buffer pointer
      );

      // Copy output from WASM memory, scaling back to [-1,1]
      const outputFrame = new Float32Array(RNNOISE_FRAME_SIZE);
      for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
        let sample = HEAPF32[outputIndex + i] / SAMPLE_SCALE;
        // Clamp to prevent any overflow
        outputFrame[i] = Math.max(-1, Math.min(1, sample));
      }

      // Track performance
      this.framesProcessed++;
      this.totalProcessingTime += (currentTime - startTime);

      return outputFrame;

    } catch (error) {
      console.error('[NoiseProcessor] Frame processing error:', error);
      // On error, return input unchanged
      return inputFrame;
    }
  }

  /**
   * Send performance statistics to main thread
   */
  sendStats() {
    const avgTime = this.framesProcessed > 0 
      ? (this.totalProcessingTime / this.framesProcessed * 1000).toFixed(3) 
      : '0.000';
    
    // CPU usage: processing time / frame duration (10ms)
    const cpuUsage = this.framesProcessed > 0
      ? ((this.totalProcessingTime / this.framesProcessed) / 0.01 * 100).toFixed(1)
      : '0.0';

    this.port.postMessage({
      type: 'stats',
      data: {
        framesProcessed: this.framesProcessed,
        avgProcessingTime: avgTime + 'ms',
        cpuUsage: cpuUsage + '%',
        wasmReady: this.wasmReady,
        enabled: this.enabled,
        inputBufferLevel: this.inputBuffer.getAvailable(),
        outputBufferLevel: this.outputBuffer.getAvailable()
      }
    });
  }

  /**
   * Cleanup WASM resources
   */
  cleanup() {
    console.log('[NoiseProcessor] Cleaning up...');

    // Get free and destroy functions
    // @jitsi/rnnoise-wasm: export 'f' = free, export 'i' = rnnoise_destroy
    const free = this.wasmExports?.f || this.wasmExports?._free;
    const destroy = this.wasmExports?.i || this.wasmExports?._rnnoise_destroy;

    // Destroy RNNoise state first
    if (destroy && this.denoiseState) {
      try {
        destroy(this.denoiseState);
        console.log('[NoiseProcessor] Destroyed denoiser state');
      } catch (e) {
        console.error('[NoiseProcessor] Error destroying denoiser:', e);
      }
    }

    // Free allocated memory
    if (free) {
      try {
        if (this.inputPtr) {
          free(this.inputPtr);
          console.log('[NoiseProcessor] Freed input buffer');
        }
        if (this.outputPtr) {
          free(this.outputPtr);
          console.log('[NoiseProcessor] Freed output buffer');
        }
      } catch (e) {
        console.error('[NoiseProcessor] Error freeing memory:', e);
      }
    }

    this.denoiseState = 0;
    this.inputPtr = 0;
    this.outputPtr = 0;
    this.wasmReady = false;

    // Clear buffers
    this.inputBuffer.clear();
    this.outputBuffer.clear();

    console.log('[NoiseProcessor] Cleanup complete');
  }
}

// Register the processor
registerProcessor('noise-suppressor', NoiseSuppressorProcessor);
