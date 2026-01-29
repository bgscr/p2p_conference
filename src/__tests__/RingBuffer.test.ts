/**
 * Unit tests for RingBuffer class
 * Tests circular buffer functionality for audio frame adaptation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { RingBuffer } from '../renderer/audio-processor/RingBuffer'

describe('RingBuffer', () => {
    let buffer: RingBuffer

    beforeEach(() => {
        buffer = new RingBuffer(10)
    })

    describe('Constructor and Initial State', () => {
        it('should create a buffer with specified capacity', () => {
            expect(buffer.getCapacity()).toBe(10)
        })

        it('should start with zero available samples', () => {
            expect(buffer.getAvailableSamples()).toBe(0)
        })

        it('should create buffer with different capacities', () => {
            const smallBuffer = new RingBuffer(5)
            const largeBuffer = new RingBuffer(1000)

            expect(smallBuffer.getCapacity()).toBe(5)
            expect(largeBuffer.getCapacity()).toBe(1000)
        })
    })

    describe('Write Operations', () => {
        it('should write samples and increase available count', () => {
            const samples = new Float32Array([1.0, 2.0, 3.0])
            buffer.write(samples)

            expect(buffer.getAvailableSamples()).toBe(3)
        })

        it('should accumulate samples from multiple writes', () => {
            buffer.write(new Float32Array([1.0, 2.0]))
            buffer.write(new Float32Array([3.0, 4.0, 5.0]))

            expect(buffer.getAvailableSamples()).toBe(5)
        })

        it('should handle writing exactly to capacity', () => {
            const samples = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
            buffer.write(samples)

            expect(buffer.getAvailableSamples()).toBe(10)
        })

        it('should handle buffer overflow by overwriting old data', () => {
            // Write more than capacity
            const samples = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
            buffer.write(samples)

            // Buffer capacity is 10, so available should be capped at 10
            expect(buffer.getAvailableSamples()).toBe(10)
        })
    })

    describe('Read Operations', () => {
        it('should read samples correctly', () => {
            const input = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0])
            buffer.write(input)

            const output = buffer.read(3)

            expect(output).not.toBeNull()
            expect(output!.length).toBe(3)
            expect(output![0]).toBe(1.0)
            expect(output![1]).toBe(2.0)
            expect(output![2]).toBe(3.0)
        })

        it('should reduce available samples after read', () => {
            buffer.write(new Float32Array([1, 2, 3, 4, 5]))
            buffer.read(2)

            expect(buffer.getAvailableSamples()).toBe(3)
        })

        it('should return null when not enough samples available', () => {
            buffer.write(new Float32Array([1, 2, 3]))

            const result = buffer.read(5)

            expect(result).toBeNull()
            expect(buffer.getAvailableSamples()).toBe(3) // Should not change
        })

        it('should return null when buffer is empty', () => {
            const result = buffer.read(1)

            expect(result).toBeNull()
        })

        it('should allow reading all available samples', () => {
            buffer.write(new Float32Array([1, 2, 3, 4, 5]))

            const result = buffer.read(5)

            expect(result).not.toBeNull()
            expect(result!.length).toBe(5)
            expect(buffer.getAvailableSamples()).toBe(0)
        })

        it('should allow sequential reads', () => {
            buffer.write(new Float32Array([1, 2, 3, 4, 5, 6]))

            const first = buffer.read(2)
            const second = buffer.read(2)
            const third = buffer.read(2)

            expect(first![0]).toBe(1)
            expect(first![1]).toBe(2)
            expect(second![0]).toBe(3)
            expect(second![1]).toBe(4)
            expect(third![0]).toBe(5)
            expect(third![1]).toBe(6)
            expect(buffer.getAvailableSamples()).toBe(0)
        })
    })

    describe('Peek Operations', () => {
        it('should peek at samples without removing them', () => {
            buffer.write(new Float32Array([1, 2, 3, 4, 5]))

            const peeked = buffer.peek(3)

            expect(peeked).not.toBeNull()
            expect(peeked![0]).toBe(1)
            expect(peeked![1]).toBe(2)
            expect(peeked![2]).toBe(3)
            expect(buffer.getAvailableSamples()).toBe(5) // Should not change
        })

        it('should allow peeking multiple times with same result', () => {
            buffer.write(new Float32Array([1, 2, 3]))

            const peek1 = buffer.peek(2)
            const peek2 = buffer.peek(2)

            expect(peek1![0]).toBe(peek2![0])
            expect(peek1![1]).toBe(peek2![1])
        })

        it('should return null when peeking more than available', () => {
            buffer.write(new Float32Array([1, 2]))

            const result = buffer.peek(5)

            expect(result).toBeNull()
        })

        it('should return null when peeking empty buffer', () => {
            const result = buffer.peek(1)

            expect(result).toBeNull()
        })
    })

    describe('Clear Operation', () => {
        it('should reset buffer to empty state', () => {
            buffer.write(new Float32Array([1, 2, 3, 4, 5]))
            expect(buffer.getAvailableSamples()).toBe(5)

            buffer.clear()

            expect(buffer.getAvailableSamples()).toBe(0)
            expect(buffer.getCapacity()).toBe(10) // Capacity unchanged
        })

        it('should allow writing after clear', () => {
            buffer.write(new Float32Array([1, 2, 3]))
            buffer.clear()
            buffer.write(new Float32Array([4, 5]))

            const result = buffer.read(2)

            expect(result![0]).toBe(4)
            expect(result![1]).toBe(5)
        })
    })

    describe('Circular Buffer Wraparound', () => {
        it('should correctly wrap around on write', () => {
            // Fill buffer
            buffer.write(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))

            // Read some data
            buffer.read(5) // Read 1-5

            // Write more data (should wrap around)
            buffer.write(new Float32Array([11, 12, 13, 14, 15]))

            expect(buffer.getAvailableSamples()).toBe(10) // 6-15

            const result = buffer.read(10)
            expect(result![0]).toBe(6)
            expect(result![9]).toBe(15)
        })

        it('should correctly wrap around on read', () => {
            // Write some data
            buffer.write(new Float32Array([1, 2, 3, 4, 5]))
            // Read it
            buffer.read(5)

            // Write more data (this wraps the write index)
            buffer.write(new Float32Array([6, 7, 8, 9, 10, 11, 12, 13]))

            // Read across the wraparound
            const result = buffer.read(8)

            expect(result![0]).toBe(6)
            expect(result![7]).toBe(13)
        })
    })

    describe('Edge Cases', () => {
        it('should handle zero-length write', () => {
            buffer.write(new Float32Array([]))

            expect(buffer.getAvailableSamples()).toBe(0)
        })

        it('should handle reading zero samples', () => {
            buffer.write(new Float32Array([1, 2, 3]))

            const result = buffer.read(0)

            expect(result).not.toBeNull()
            expect(result!.length).toBe(0)
        })

        it('should handle peeking zero samples', () => {
            buffer.write(new Float32Array([1, 2, 3]))

            const result = buffer.peek(0)

            expect(result).not.toBeNull()
            expect(result!.length).toBe(0)
        })

        it('should handle fractional audio values', () => {
            const samples = new Float32Array([0.123456, -0.987654, 0.5])
            buffer.write(samples)

            const result = buffer.read(3)

            expect(result![0]).toBeCloseTo(0.123456, 5)
            expect(result![1]).toBeCloseTo(-0.987654, 5)
            expect(result![2]).toBeCloseTo(0.5, 5)
        })

        it('should maintain data integrity with RNNoise-style usage (128 write, 480 read)', () => {
            // RNNoise frame size is 480, Web Audio block size is 128
            const rnnoiseBuffer = new RingBuffer(960) // Double RNNoise frame size

            // Write 4 blocks of 128 samples (512 total)
            for (let i = 0; i < 4; i++) {
                const block = new Float32Array(128)
                for (let j = 0; j < 128; j++) {
                    block[j] = i * 128 + j
                }
                rnnoiseBuffer.write(block)
            }

            expect(rnnoiseBuffer.getAvailableSamples()).toBe(512)

            // Read 480 samples (RNNoise frame)
            const frame = rnnoiseBuffer.read(480)

            expect(frame).not.toBeNull()
            expect(frame!.length).toBe(480)
            expect(frame![0]).toBe(0)
            expect(frame![127]).toBe(127)
            expect(frame![128]).toBe(128) // From second block
            expect(frame![479]).toBe(479)

            expect(rnnoiseBuffer.getAvailableSamples()).toBe(32) // 512 - 480
        })
    })
})
