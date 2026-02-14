import { describe, expect, it, vi } from 'vitest'
import {
  registerBeforeUnloadHandler,
  registerNetworkMonitoring
} from '../renderer/signaling/services/browserLifecycle'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}))

describe('browserLifecycle service', () => {
  it('registers online/offline listeners when target is available', () => {
    const addEventListener = vi.fn()
    const target = { addEventListener }
    const onOnline = vi.fn()
    const onOffline = vi.fn()

    const registered = registerNetworkMonitoring({
      target,
      onOnline,
      onOffline,
      getIsOnline: () => true
    })

    expect(registered).toBe(true)
    expect(addEventListener).toHaveBeenCalledWith('online', onOnline)
    expect(addEventListener).toHaveBeenCalledWith('offline', onOffline)
  })

  it('returns false when network monitoring target is unavailable', () => {
    const registered = registerNetworkMonitoring({
      target: null,
      onOnline: vi.fn(),
      onOffline: vi.fn(),
      getIsOnline: () => false
    })

    expect(registered).toBe(false)
  })

  it('registers beforeunload handler when target is available', () => {
    const addEventListener = vi.fn()
    const target = { addEventListener }
    const onBeforeUnload = vi.fn()

    const registered = registerBeforeUnloadHandler({
      target,
      onBeforeUnload
    })

    expect(registered).toBe(true)
    expect(addEventListener).toHaveBeenCalledWith('beforeunload', onBeforeUnload)
  })

  it('returns false when beforeunload target is unavailable', () => {
    const registered = registerBeforeUnloadHandler({
      target: undefined,
      onBeforeUnload: vi.fn()
    })

    expect(registered).toBe(false)
  })
})
