/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'

describe('JSDOM Capabilities', () => {
    it('should have MediaStream', () => {
        expect(globalThis.MediaStream).toBeDefined()
        expect(new MediaStream()).toBeInstanceOf(MediaStream)
    })
})
