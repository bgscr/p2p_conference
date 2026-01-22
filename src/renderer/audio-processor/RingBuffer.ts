/**
 * RingBuffer - Circular buffer for audio frame adaptation
 * RNNoise requires 480 samples, but Web Audio processes 128 samples at a time
 */

export class RingBuffer {
  private buffer: Float32Array
  private writeIndex: number = 0
  private readIndex: number = 0
  private availableSamples: number = 0
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Float32Array(capacity)
  }

  /**
   * Write samples to the buffer
   */
  write(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.writeIndex] = samples[i]
      this.writeIndex = (this.writeIndex + 1) % this.capacity
      
      if (this.availableSamples < this.capacity) {
        this.availableSamples++
      } else {
        // Overwriting old data - move read index
        this.readIndex = (this.readIndex + 1) % this.capacity
      }
    }
  }

  /**
   * Read samples from the buffer
   * @returns Float32Array of requested size, or null if not enough samples
   */
  read(count: number): Float32Array | null {
    if (this.availableSamples < count) {
      return null
    }

    const result = new Float32Array(count)
    
    for (let i = 0; i < count; i++) {
      result[i] = this.buffer[this.readIndex]
      this.readIndex = (this.readIndex + 1) % this.capacity
    }
    
    this.availableSamples -= count
    return result
  }

  /**
   * Peek at samples without removing them
   */
  peek(count: number): Float32Array | null {
    if (this.availableSamples < count) {
      return null
    }

    const result = new Float32Array(count)
    let tempIndex = this.readIndex
    
    for (let i = 0; i < count; i++) {
      result[i] = this.buffer[tempIndex]
      tempIndex = (tempIndex + 1) % this.capacity
    }
    
    return result
  }

  /**
   * Get number of available samples
   */
  getAvailableSamples(): number {
    return this.availableSamples
  }

  /**
   * Get buffer capacity
   */
  getCapacity(): number {
    return this.capacity
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.writeIndex = 0
    this.readIndex = 0
    this.availableSamples = 0
    this.buffer.fill(0)
  }
}
