import { describe, it, expect } from 'vitest'
import { SimplePeerManager } from '../renderer/signaling/SimplePeerManager'

describe('SimplePeerManager (node env)', () => {
  it('initializes without window globals', () => {
    const manager = new SimplePeerManager()
    expect(manager.getNetworkStatus().isOnline).toBe(true)
  })
})
