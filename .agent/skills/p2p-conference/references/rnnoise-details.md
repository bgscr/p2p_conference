# RNNoise Implementation Details

Complete guide to implementing RNNoise for real-time noise suppression in web applications.

## Overview

RNNoise (Recurrent Neural Network Noise Suppression) is a lightweight noise suppression library that combines traditional signal processing with machine learning. It's specifically designed for real-time speech processing with minimal CPU overhead.

**Key characteristics:**
- Extremely efficient: <1% CPU on modern processors
- Low latency: <10ms processing delay
- Works at 48kHz sample rate
- Optimized for speech frequencies (human voice)
- Open source (BSD license)

## How RNNoise Works

### Architecture

RNNoise uses a hybrid approach:

1. **Frequency Analysis:** Splits audio into 22 frequency bands using FFT
2. **Feature Extraction:** Computes spectral features for each band
3. **Neural Network:** GRU (Gated Recurrent Unit) predicts gain for each band
4. **Gain Application:** Multiplies each frequency band by predicted gain
5. **Reconstruction:** Inverse FFT to reconstruct time-domain audio

**Not a pure ML model:**
- Traditional DSP for frequency decomposition
- ML only predicts gain values
- This makes it incredibly fast and lightweight

### Processing Flow

```
Input Audio (PCM)
    ↓
Frame Buffering (480 samples @ 48kHz = 10ms)
    ↓
FFT → Frequency Bands
    ↓
Feature Extraction
    ↓
GRU Neural Network → Gain Predictions
    ↓
Apply Gains to Bands
    ↓
Inverse FFT
    ↓
Output Audio (Noise Suppressed)
```

## Obtaining RNNoise WASM

### Pre-built WASM

**Option 1: Use pre-compiled version**

Download from:
- [@sapphi-red/rnnoise](https://www.npmjs.com/package/@sapphi-red/rnnoise)
- [jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm)

```bash
npm install @sapphi-red/rnnoise
```

Files you need:
- `rnnoise.wasm` - Compiled WebAssembly module
- `rnnoise.js` - JavaScript wrapper

**Option 2: Build from source**

```bash
git clone https://github.com/xiph/rnnoise.git
cd rnnoise
./autogen.sh
./configure
make

# Compile to WASM using Emscripten
emcc -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="RNNoise" \
  -s EXPORTED_FUNCTIONS='["_rnnoise_create","_rnnoise_destroy","_rnnoise_process_frame","_malloc","_free"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -o rnnoise.js \
  src/rnnoise.c src/rnn.c src/kiss_fft.c
```

### WASM API Functions

```c
// Create RNNoise state
DenoiseState* rnnoise_create(RNNModel* model);

// Destroy state
void rnnoise_destroy(DenoiseState* st);

// Process one frame (480 samples)
float rnnoise_process_frame(DenoiseState* st, float* out, const float* in);
```

## AudioWorklet Implementation

### Complete Processor Code

```javascript
// noise-processor.js
// This file must be vanilla JavaScript (no ES6 imports)

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    
    // Constants
    this.FRAME_SIZE = 480 // RNNoise requires 480 samples (10ms @ 48kHz)
    this.SAMPLE_RATE = 48000
    
    // Buffers
    this.inputBuffer = new Float32Array(this.FRAME_SIZE)
    this.outputBuffer = new Float32Array(this.FRAME_SIZE)
    this.inputIndex = 0
    this.outputIndex = 0
    
    // WASM module (will be set via message)
    this.wasmModule = null
    this.denoiseState = null
    
    // Performance tracking
    this.processedFrames = 0
    this.totalProcessingTime = 0
    
    // Listen for initialization message
    this.port.onmessage = this.handleMessage.bind(this)
  }
  
  handleMessage(event) {
    if (event.data.type === 'init' && event.data.wasmModule) {
      this.initializeWasm(event.data.wasmModule)
      this.port.postMessage({ type: 'ready' })
    } else if (event.data.type === 'destroy') {
      this.cleanup()
    } else if (event.data.type === 'getStats') {
      this.sendStats()
    }
  }
  
  initializeWasm(wasmExports) {
    this.wasmModule = wasmExports
    
    // Create RNNoise denoiser state
    // Pass null for default model (embedded in WASM)
    this.denoiseState = this.wasmModule.rnnoise_create(0)
    
    if (!this.denoiseState) {
      throw new Error('Failed to create RNNoise state')
    }
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    
    // Return early if not initialized
    if (!this.wasmModule || !this.denoiseState) {
      // Pass through audio unprocessed
      if (input && input[0] && output && output[0]) {
        output[0].set(input[0])
      }
      return true
    }
    
    if (!input || !input[0] || !output || !output[0]) {
      return true
    }
    
    const inputChannel = input[0]
    const outputChannel = output[0]
    const blockSize = inputChannel.length // Typically 128 samples
    
    // Process each sample
    for (let i = 0; i < blockSize; i++) {
      // Accumulate input samples
      this.inputBuffer[this.inputIndex++] = inputChannel[i]
      
      // When we have a full frame, process it
      if (this.inputIndex >= this.FRAME_SIZE) {
        this.processFrame()
        this.inputIndex = 0
      }
      
      // Output processed samples
      outputChannel[i] = this.outputBuffer[this.outputIndex++]
      
      // Wrap output index
      if (this.outputIndex >= this.FRAME_SIZE) {
        this.outputIndex = 0
      }
    }
    
    return true // Keep processor alive
  }
  
  processFrame() {
    const startTime = performance.now()
    
    // Allocate memory in WASM heap
    const inputPtr = this.wasmModule._malloc(this.FRAME_SIZE * 4) // Float32 = 4 bytes
    const outputPtr = this.wasmModule._malloc(this.FRAME_SIZE * 4)
    
    try {
      // Copy input to WASM memory
      this.wasmModule.HEAPF32.set(
        this.inputBuffer,
        inputPtr / 4 // Divide by 4 for Float32 indexing
      )
      
      // Process frame
      // Returns probability of voice (0-1), but we ignore this value
      this.wasmModule._rnnoise_process_frame(
        this.denoiseState,
        outputPtr,
        inputPtr
      )
      
      // Copy processed audio back
      const processedData = this.wasmModule.HEAPF32.subarray(
        outputPtr / 4,
        outputPtr / 4 + this.FRAME_SIZE
      )
      this.outputBuffer.set(processedData)
      
      // Track performance
      this.processedFrames++
      this.totalProcessingTime += performance.now() - startTime
      
    } finally {
      // Always free memory
      this.wasmModule._free(inputPtr)
      this.wasmModule._free(outputPtr)
    }
  }
  
  sendStats() {
    const avgProcessingTime = this.totalProcessingTime / this.processedFrames
    this.port.postMessage({
      type: 'stats',
      framesProcessed: this.processedFrames,
      avgProcessingTime: avgProcessingTime.toFixed(3) + 'ms',
      cpuUsage: ((avgProcessingTime / 10) * 100).toFixed(1) + '%' // 10ms per frame
    })
  }
  
  cleanup() {
    if (this.wasmModule && this.denoiseState) {
      this.wasmModule._rnnoise_destroy(this.denoiseState)
      this.denoiseState = null
    }
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor)
```

### Loading and Initialization

```typescript
// AudioPipeline.ts
export class AudioPipeline {
  private audioContext: AudioContext
  private processorNode: AudioWorkletNode | null = null
  private wasmModule: any = null
  
  async initialize() {
    // Create AudioContext at 48kHz (required by RNNoise)
    this.audioContext = new AudioContext({ sampleRate: 48000 })
    
    if (this.audioContext.sampleRate !== 48000) {
      console.warn(`Sample rate is ${this.audioContext.sampleRate}, RNNoise expects 48000`)
    }
    
    // Load AudioWorklet processor
    try {
      await this.audioContext.audioWorklet.addModule('/audio-processor/noise-processor.js')
    } catch (error) {
      console.error('Failed to load AudioWorklet:', error)
      throw error
    }
    
    // Load WASM module
    this.wasmModule = await this.loadWasmModule()
    
    // Create processor node
    this.processorNode = new AudioWorkletNode(
      this.audioContext,
      'rnnoise-processor'
    )
    
    // Initialize WASM in processor
    this.processorNode.port.postMessage({
      type: 'init',
      wasmModule: this.wasmModule
    })
    
    // Wait for ready signal
    await new Promise((resolve) => {
      this.processorNode!.port.onmessage = (event) => {
        if (event.data.type === 'ready') {
          resolve(null)
        }
      }
    })
  }
  
  private async loadWasmModule() {
    // Fetch WASM binary
    const response = await fetch('/audio-processor/rnnoise.wasm')
    const wasmBinary = await response.arrayBuffer()
    
    // Instantiate WASM
    const result = await WebAssembly.instantiate(wasmBinary, {
      env: {
        memory: new WebAssembly.Memory({ initial: 256 }),
        // Add any required imports here
      }
    })
    
    return result.instance.exports
  }
  
  async getStats() {
    return new Promise((resolve) => {
      this.processorNode!.port.onmessage = (event) => {
        if (event.data.type === 'stats') {
          resolve(event.data)
        }
      }
      this.processorNode!.port.postMessage({ type: 'getStats' })
    })
  }
  
  destroy() {
    if (this.processorNode) {
      this.processorNode.port.postMessage({ type: 'destroy' })
      this.processorNode.disconnect()
      this.processorNode = null
    }
    
    if (this.audioContext) {
      this.audioContext.close()
    }
  }
}
```

## Critical Implementation Notes

### 1. Sample Rate Constraint

RNNoise MUST run at 48kHz. If AudioContext runs at different rate, you must resample:

```typescript
// Check sample rate
if (audioContext.sampleRate !== 48000) {
  console.warn('Resampling required')
  
  // Option 1: Force 48kHz when creating context
  const ctx = new AudioContext({ sampleRate: 48000 })
  
  // Option 2: Resample in AudioWorklet (complex, not recommended)
}
```

### 2. Frame Size Buffering

Web Audio processes 128-sample blocks, but RNNoise needs 480 samples:

```
Input:  [128] [128] [128] [128] ...
Buffer: [480 samples accumulated]
         ↓ Process
Output: [480 processed samples] → dispensed as [128] [128] [128] [128]
```

**Critical:** Must maintain separate input and output buffers to avoid deadlock.

### 3. Echo Cancellation Order

```
CORRECT: Mic → Browser AEC → Browser AGC → RNNoise → WebRTC
WRONG:   Mic → RNNoise → Browser AEC → Browser AGC → WebRTC
```

RNNoise is non-linear. If applied before AEC, it destroys the echo reference signal.

**Always enable browser AEC first:**

```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,  // CRITICAL: must be true
    autoGainControl: true,
    noiseSuppression: false  // Let RNNoise handle this
  }
})
```

### 4. Memory Management

Always free WASM memory:

```javascript
const ptr = wasmModule._malloc(480 * 4)
try {
  // Use memory
} finally {
  wasmModule._free(ptr) // Critical: prevent memory leak
}
```

### 5. Mono Audio Only

RNNoise processes mono audio. For stereo input:

```typescript
// Convert stereo to mono before processing
const merger = audioContext.createChannelMerger(1)
const splitter = audioContext.createChannelSplitter(2)

sourceNode.connect(splitter)
splitter.connect(merger, 0, 0) // Take left channel only
merger.connect(processorNode)
```

## Performance Optimization

### CPU Usage Monitoring

```typescript
// In AudioWorklet
let frameCount = 0
let totalTime = 0

processFrame() {
  const start = performance.now()
  
  // Process...
  
  totalTime += performance.now() - start
  frameCount++
  
  if (frameCount % 100 === 0) {
    const avgTime = totalTime / frameCount
    const cpuPercent = (avgTime / 10) * 100 // 10ms per frame
    
    this.port.postMessage({
      type: 'performance',
      avgProcessingTime: avgTime,
      cpuUsage: cpuPercent
    })
  }
}
```

### Adaptive Quality

Disable processing on low-end devices:

```typescript
const stats = await pipeline.getStats()

if (parseFloat(stats.cpuUsage) > 50) {
  console.warn('High CPU usage, disabling noise suppression')
  pipeline.disable()
  showUserNotification('Noise suppression disabled to preserve performance')
}
```

### Only Process Outgoing Audio

**Key optimization:** Only process the 1 outgoing stream, not N-1 incoming:

```typescript
// WRONG: Process all audio (high CPU)
remoteStreams.forEach(stream => {
  const processed = await pipeline.connectInputStream(stream)
  playAudio(processed)
})

// CORRECT: Only process local mic
const processedLocalStream = await pipeline.connectInputStream(micStream)
sendToWebRTC(processedLocalStream)

// Remote streams are already processed by sender
remoteStreams.forEach(stream => {
  playAudio(stream) // No processing needed
})
```

## Debugging

### Visualize Noise Suppression

```typescript
// Add analyzer before and after processing
const analyzerBefore = audioContext.createAnalyser()
const analyzerAfter = audioContext.createAnalyser()

sourceNode.connect(analyzerBefore)
analyzerBefore.connect(processorNode)
processorNode.connect(analyzerAfter)

// Draw waveforms
function drawComparison() {
  const dataBefore = new Uint8Array(analyzerBefore.frequencyBinCount)
  const dataAfter = new Uint8Array(analyzerAfter.frequencyBinCount)
  
  analyzerBefore.getByteTimeDomainData(dataBefore)
  analyzerAfter.getByteTimeDomainData(dataAfter)
  
  // Draw to canvas...
}
```

### Test with Noise Samples

```typescript
// Generate test noise
const oscillator = audioContext.createOscillator()
oscillator.type = 'sawtooth' // Simulate keyboard/fan noise
oscillator.frequency.setValueAtTime(120, audioContext.currentTime)
oscillator.connect(processorNode)
oscillator.start()

// Should be significantly reduced in output
```

### Console Logging

```javascript
// In AudioWorklet processor
if (this.processedFrames % 100 === 0) {
  console.log(`Processed ${this.processedFrames} frames, avg: ${avgTime}ms`)
}
```

## Common Issues

### Issue: Robotic/Metallic Sound

**Cause:** Over-aggressive noise suppression
**Solution:** RNNoise has no tunable parameters, but you can:

1. Ensure input level is appropriate (not too quiet)
2. Check sample rate is exactly 48kHz
3. Verify browser AEC is enabled (may conflict if disabled)

### Issue: High CPU Usage

**Cause:** Processing multiple streams or inefficient WASM
**Solution:**

```typescript
// Only process local mic (1 stream)
if (isLocalStream) {
  processWithRNNoise(stream)
} else {
  playDirectly(stream)
}
```

### Issue: Latency/Delay

**Cause:** Buffer size too large
**Solution:** RNNoise adds ~10ms latency (1 frame). Total latency:

```
Browser capture: ~10ms
RNNoise processing: ~10ms
WebRTC encoding: ~10-20ms
Network: varies
Total: ~30-50ms (acceptable for conversation)
```

If experiencing >100ms delay, issue is elsewhere (network, not RNNoise).

### Issue: WASM Not Loading

**Cause:** Incorrect path or CORS
**Solution:**

```typescript
// Ensure WASM is served with correct MIME type
// In Electron: place in public/ directory

// Verify WASM loaded
const response = await fetch('/audio-processor/rnnoise.wasm')
console.log('WASM size:', response.headers.get('content-length'))
console.log('MIME type:', response.headers.get('content-type')) // Should be 'application/wasm'
```

## Alternative: Pre-Built Solutions

If building from scratch is too complex:

### 1. @sapphi-red/rnnoise (NPM Package)

```bash
npm install @sapphi-red/rnnoise
```

```typescript
import RNNoise from '@sapphi-red/rnnoise'

const rnoise = await RNNoise.load()
const processor = rnoise.createProcessor()

// Process audio buffer
const denoised = processor.process(audioBuffer)
```

### 2. Jitsi RNNoise (Used in Jitsi Meet)

```bash
git clone https://github.com/jitsi/rnnoise-wasm
cd rnnoise-wasm
npm install
npm run build
```

Includes AudioWorklet implementation out-of-the-box.

### 3. Krisp.ai SDK

Commercial solution with superior quality (but requires API key and has costs):

```bash
npm install @krisp/ai-noise-cancellation
```

**Use if:**
- Need best-in-class quality
- Budget available for per-minute API costs
- Don't want to manage WASM complexity

## Quality Comparison

| Solution | Quality | CPU | Latency | Cost |
|----------|---------|-----|---------|------|
| RNNoise | Good | Very Low | ~10ms | Free |
| DeepFilterNet | Better | Medium | ~15ms | Free |
| Krisp.ai | Best | Low (cloud) | ~20ms | $$ |
| Browser Default | Poor | None | 0ms | Free |

For most P2P conference apps, RNNoise is the sweet spot: free, lightweight, and effective.

## Testing Methodology

**Record test samples:**

1. Record with fan/AC running (continuous noise)
2. Record with typing (intermittent noise)
3. Record with music playing (challenging case)
4. Record with multiple speakers (speech preservation)

**Evaluate:**

```typescript
// A/B test
const withRNNoise = await processWithRNNoise(recording)
const withoutRNNoise = recording

// Play both, compare subjectively
// Ensure speech is clear and noise is reduced
```

**Automated testing:**

```bash
# Use FFmpeg to compare spectrograms
ffmpeg -i input.wav -lavfi showspectrumpic=s=1280x720 input.png
ffmpeg -i output.wav -lavfi showspectrumpic=s=1280x720 output.png

# Visually compare - noise should be darker in output
```
