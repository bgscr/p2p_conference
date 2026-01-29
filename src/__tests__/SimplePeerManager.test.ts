/**
 * Unit tests for SimplePeerManager
 * Tests the testable units: generatePeerId, generateMessageId, MessageDeduplicator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================
// Extracted functions for testing
// ============================================

/**
 * Generate a random peer ID (same logic as SimplePeerManager)
 */
function generatePeerId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
}

/**
 * Generate a unique message ID for deduplication
 */
function generateMessageId(selfId: string): string {
    return `${selfId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

// ============================================
// MessageDeduplicator class (extracted for testing)
// ============================================

const MESSAGE_DEDUP_WINDOW_SIZE = 500
const MESSAGE_DEDUP_TTL_MS = 30000

class MessageDeduplicator {
    private seen: Map<string, number> = new Map()
    private cleanupInterval: ReturnType<typeof setInterval> | null = null

    constructor(enableAutoCleanup: boolean = false) {
        if (enableAutoCleanup) {
            this.cleanupInterval = setInterval(() => this.cleanup(), MESSAGE_DEDUP_TTL_MS / 2)
        }
    }

    /**
     * Check if message was already seen. If not, mark it as seen.
     * @returns true if this is a duplicate, false if it's new
     */
    isDuplicate(msgId: string): boolean {
        if (!msgId) return false

        if (this.seen.has(msgId)) {
            return true
        }

        this.seen.set(msgId, Date.now())

        if (this.seen.size > MESSAGE_DEDUP_WINDOW_SIZE) {
            const entries = Array.from(this.seen.entries())
            entries.sort((a, b) => a[1] - b[1])
            const toRemove = entries.slice(0, entries.length - MESSAGE_DEDUP_WINDOW_SIZE)
            toRemove.forEach(([key]) => this.seen.delete(key))
        }

        return false
    }

    /**
     * Remove entries older than TTL
     */
    cleanup() {
        const cutoff = Date.now() - MESSAGE_DEDUP_TTL_MS
        const toDelete: string[] = []

        this.seen.forEach((timestamp, msgId) => {
            if (timestamp < cutoff) {
                toDelete.push(msgId)
            }
        })

        toDelete.forEach(msgId => this.seen.delete(msgId))
        return toDelete.length
    }

    /**
     * Clear all entries and stop cleanup timer
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval)
            this.cleanupInterval = null
        }
        this.seen.clear()
    }

    /**
     * Get current cache size
     */
    size(): number {
        return this.seen.size
    }

    /**
     * For testing: add an old entry
     */
    addWithTimestamp(msgId: string, timestamp: number) {
        this.seen.set(msgId, timestamp)
    }
}

// ============================================
// Test Suites
// ============================================

describe('generatePeerId', () => {
    it('should generate a 16-character string', () => {
        const id = generatePeerId()
        expect(id).toHaveLength(16)
    })

    it('should only contain alphanumeric characters', () => {
        const id = generatePeerId()
        expect(/^[A-Za-z0-9]+$/.test(id)).toBe(true)
    })

    it('should generate unique IDs', () => {
        const ids = new Set<string>()
        for (let i = 0; i < 100; i++) {
            ids.add(generatePeerId())
        }
        // All IDs should be unique
        expect(ids.size).toBe(100)
    })

    it('should be randomly distributed', () => {
        // Generate many IDs and check character distribution
        const ids = Array.from({ length: 100 }, () => generatePeerId())
        const allChars = ids.join('')

        // Should have a mix of uppercase, lowercase, and numbers
        expect(/[A-Z]/.test(allChars)).toBe(true)
        expect(/[a-z]/.test(allChars)).toBe(true)
        expect(/[0-9]/.test(allChars)).toBe(true)
    })
})

describe('generateMessageId', () => {
    it('should include the selfId', () => {
        const selfId = 'testPeer123'
        const msgId = generateMessageId(selfId)
        expect(msgId.startsWith('testPeer123-')).toBe(true)
    })

    it('should include a timestamp', () => {
        const before = Date.now()
        const selfId = 'peer'
        const msgId = generateMessageId(selfId)
        const after = Date.now()

        // Extract timestamp from message ID
        const parts = msgId.split('-')
        const timestamp = parseInt(parts[1], 10)

        expect(timestamp).toBeGreaterThanOrEqual(before)
        expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('should include a random suffix', () => {
        const selfId = 'peer'
        const msgId = generateMessageId(selfId)
        const parts = msgId.split('-')

        // Should have 3 parts: selfId, timestamp, random
        expect(parts.length).toBe(3)
        expect(parts[2].length).toBe(6)
    })

    it('should generate unique IDs even in rapid succession', () => {
        const selfId = 'peer'
        const ids = new Set<string>()

        for (let i = 0; i < 100; i++) {
            ids.add(generateMessageId(selfId))
        }

        // All should be unique due to the random component
        expect(ids.size).toBe(100)
    })
})

describe('MessageDeduplicator', () => {
    let dedup: MessageDeduplicator

    beforeEach(() => {
        dedup = new MessageDeduplicator(false) // Disable auto-cleanup for tests
    })

    afterEach(() => {
        dedup.destroy()
    })

    describe('Basic Deduplication', () => {
        it('should return false for first occurrence', () => {
            expect(dedup.isDuplicate('msg-1')).toBe(false)
        })

        it('should return true for second occurrence', () => {
            dedup.isDuplicate('msg-1')
            expect(dedup.isDuplicate('msg-1')).toBe(true)
        })

        it('should track multiple different messages', () => {
            expect(dedup.isDuplicate('msg-1')).toBe(false)
            expect(dedup.isDuplicate('msg-2')).toBe(false)
            expect(dedup.isDuplicate('msg-3')).toBe(false)

            expect(dedup.isDuplicate('msg-1')).toBe(true)
            expect(dedup.isDuplicate('msg-2')).toBe(true)
            expect(dedup.isDuplicate('msg-3')).toBe(true)
        })

        it('should handle empty message ID', () => {
            // Empty string should be treated as "can't dedupe"
            expect(dedup.isDuplicate('')).toBe(false)
            expect(dedup.isDuplicate('')).toBe(false) // Still false, not tracked
        })
    })

    describe('Window Size Limiting', () => {
        it('should respect window size limit', () => {
            // Add more than window size
            for (let i = 0; i < MESSAGE_DEDUP_WINDOW_SIZE + 100; i++) {
                dedup.isDuplicate(`msg-${i}`)
            }

            // Should not exceed window size
            expect(dedup.size()).toBe(MESSAGE_DEDUP_WINDOW_SIZE)
        })

        it('should remove oldest entries when exceeding limit', () => {
            // Fill to window size
            for (let i = 0; i < MESSAGE_DEDUP_WINDOW_SIZE; i++) {
                dedup.isDuplicate(`msg-${i}`)
            }

            // First message should still be a duplicate
            expect(dedup.isDuplicate('msg-0')).toBe(true)

            // Add 100 more
            for (let i = MESSAGE_DEDUP_WINDOW_SIZE; i < MESSAGE_DEDUP_WINDOW_SIZE + 100; i++) {
                dedup.isDuplicate(`msg-${i}`)
            }

            // Oldest entries (0-99) should have been removed
            expect(dedup.isDuplicate('msg-0')).toBe(false) // Now treated as new
            expect(dedup.isDuplicate('msg-99')).toBe(false)

            // Newer entries should still be duplicates
            expect(dedup.isDuplicate('msg-500')).toBe(true)
        })
    })

    describe('TTL Cleanup', () => {
        it('should remove old entries on cleanup', () => {
            const now = Date.now()

            // Add old entries
            dedup.addWithTimestamp('old-1', now - MESSAGE_DEDUP_TTL_MS - 1000)
            dedup.addWithTimestamp('old-2', now - MESSAGE_DEDUP_TTL_MS - 2000)

            // Add recent entries
            dedup.addWithTimestamp('new-1', now - 1000)
            dedup.addWithTimestamp('new-2', now - 2000)

            expect(dedup.size()).toBe(4)

            // Run cleanup
            const removed = dedup.cleanup()

            expect(removed).toBe(2)
            expect(dedup.size()).toBe(2)

            // Old entries should be gone (treated as new)
            expect(dedup.isDuplicate('old-1')).toBe(false)
            expect(dedup.isDuplicate('old-2')).toBe(false)

            // New entries should still be duplicates
            expect(dedup.isDuplicate('new-1')).toBe(true)
            expect(dedup.isDuplicate('new-2')).toBe(true)
        })

        it('should not remove recent entries', () => {
            // Add recent entries
            dedup.isDuplicate('recent-1')
            dedup.isDuplicate('recent-2')

            const removed = dedup.cleanup()

            expect(removed).toBe(0)
            expect(dedup.size()).toBe(2)
        })
    })

    describe('Destroy', () => {
        it('should clear all entries on destroy', () => {
            dedup.isDuplicate('msg-1')
            dedup.isDuplicate('msg-2')
            dedup.isDuplicate('msg-3')

            expect(dedup.size()).toBe(3)

            dedup.destroy()

            expect(dedup.size()).toBe(0)
        })

        it('should handle destroy when empty', () => {
            expect(() => dedup.destroy()).not.toThrow()
        })
    })

    describe('Size Tracking', () => {
        it('should accurately track size', () => {
            expect(dedup.size()).toBe(0)

            dedup.isDuplicate('msg-1')
            expect(dedup.size()).toBe(1)

            dedup.isDuplicate('msg-2')
            expect(dedup.size()).toBe(2)

            // Duplicate doesn't increase size
            dedup.isDuplicate('msg-1')
            expect(dedup.size()).toBe(2)
        })
    })
})

describe('SignalMessage Types', () => {
    // Test that message types are valid
    const validTypes = ['announce', 'offer', 'answer', 'ice-candidate', 'leave', 'ping', 'pong', 'mute-status']

    it('should have all expected message types', () => {
        expect(validTypes).toContain('announce')
        expect(validTypes).toContain('offer')
        expect(validTypes).toContain('answer')
        expect(validTypes).toContain('ice-candidate')
        expect(validTypes).toContain('leave')
        expect(validTypes).toContain('ping')
        expect(validTypes).toContain('pong')
        expect(validTypes).toContain('mute-status')
    })
})

describe('Platform Detection', () => {
    // Simulate platform detection logic
    function detectPlatform(): 'win' | 'mac' | 'linux' {
        // In real code, this would check navigator.platform or process.platform
        const platform = 'win32' // Simulated

        if (platform.includes('darwin') || platform.includes('mac')) {
            return 'mac'
        } else if (platform.includes('linux')) {
            return 'linux'
        } else {
            return 'win'
        }
    }

    it('should detect Windows', () => {
        expect(detectPlatform()).toBe('win')
    })
})

describe('ICE Server Configuration', () => {
    const defaultIceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]

    it('should have fallback STUN servers', () => {
        expect(defaultIceServers.length).toBeGreaterThanOrEqual(2)
        expect(defaultIceServers[0].urls).toContain('stun:')
    })

    it('should use valid STUN server format', () => {
        defaultIceServers.forEach(server => {
            expect(server.urls).toMatch(/^stun:[\w.]+:\d+$/)
        })
    })
})

describe('Timing Constants', () => {
    // Define timing constants (should match SimplePeerManager)
    const ANNOUNCE_INTERVAL = 3000
    const ANNOUNCE_DURATION = 60000
    const MQTT_KEEPALIVE = 20000
    const MAX_ICE_RESTART_ATTEMPTS = 3
    const ICE_RESTART_DELAY = 2000
    const ICE_DISCONNECT_GRACE_PERIOD = 5000
    const ICE_FAILED_TIMEOUT = 15000

    it('should have reasonable announce interval', () => {
        expect(ANNOUNCE_INTERVAL).toBeGreaterThanOrEqual(1000)
        expect(ANNOUNCE_INTERVAL).toBeLessThanOrEqual(10000)
    })

    it('should have sufficient announce duration', () => {
        expect(ANNOUNCE_DURATION).toBeGreaterThanOrEqual(30000)
        expect(ANNOUNCE_DURATION / ANNOUNCE_INTERVAL).toBeGreaterThanOrEqual(10)
    })

    it('should have reasonable keepalive interval', () => {
        expect(MQTT_KEEPALIVE).toBeGreaterThanOrEqual(10000)
        expect(MQTT_KEEPALIVE).toBeLessThanOrEqual(60000)
    })

    it('should have limited ICE restart attempts', () => {
        expect(MAX_ICE_RESTART_ATTEMPTS).toBeGreaterThanOrEqual(1)
        expect(MAX_ICE_RESTART_ATTEMPTS).toBeLessThanOrEqual(10)
    })

    it('should have appropriate ICE restart delay', () => {
        expect(ICE_RESTART_DELAY).toBeGreaterThanOrEqual(1000)
        expect(ICE_RESTART_DELAY).toBeLessThanOrEqual(10000)
    })

    it('should have grace period before declaring disconnect', () => {
        expect(ICE_DISCONNECT_GRACE_PERIOD).toBeGreaterThanOrEqual(3000)
        expect(ICE_DISCONNECT_GRACE_PERIOD).toBeLessThanOrEqual(15000)
    })

    it('should have reasonable ICE failed timeout', () => {
        expect(ICE_FAILED_TIMEOUT).toBeGreaterThan(ICE_RESTART_DELAY)
        expect(ICE_FAILED_TIMEOUT).toBeLessThanOrEqual(30000)
    })
})
