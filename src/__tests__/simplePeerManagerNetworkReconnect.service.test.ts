import { beforeEach, describe, expect, it, vi } from 'vitest'

const reconnectServiceMocks = vi.hoisted(() => ({
  attemptManagedNetworkReconnect: vi.fn(),
  performNetworkReconnectFlowWithAdapter: vi.fn()
}))

vi.mock('../renderer/signaling/services/networkReconnect', () => ({
  attemptManagedNetworkReconnect: reconnectServiceMocks.attemptManagedNetworkReconnect,
  performNetworkReconnectFlowWithAdapter: reconnectServiceMocks.performNetworkReconnectFlowWithAdapter
}))

import {
  attemptSimplePeerManagerReconnect,
  buildSimplePeerManagerReconnectFlowAdapter,
  performSimplePeerManagerReconnectAttempt,
  restartPeerDiscoveryWithAdapter
} from '../renderer/signaling/services/simplePeerManagerNetworkReconnect'

describe('simplePeerManagerNetworkReconnect service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    reconnectServiceMocks.attemptManagedNetworkReconnect.mockReset()
    reconnectServiceMocks.performNetworkReconnectFlowWithAdapter.mockReset()
  })

  it('restarts peer discovery by updating announce time and restarting announce loop', () => {
    const setAnnounceStartTime = vi.fn()
    const broadcastAnnounce = vi.fn()
    const startAnnounceInterval = vi.fn()

    restartPeerDiscoveryWithAdapter({
      setAnnounceStartTime,
      broadcastAnnounce,
      startAnnounceInterval,
      now: () => 1234
    })

    expect(setAnnounceStartTime).toHaveBeenCalledWith(1234)
    expect(broadcastAnnounce).toHaveBeenCalledTimes(1)
    expect(startAnnounceInterval).toHaveBeenCalledTimes(1)
  })

  it('builds reconnect-flow adapter mapping callback names', () => {
    const mqtt = { isConnected: vi.fn(), connectAll: vi.fn(), subscribeAll: vi.fn() }
    const peers = new Map<string, any>()
    const onSignalMessage = vi.fn()
    const onRestartPeerDiscovery = vi.fn()
    const onAttemptIceRestart = vi.fn()

    const adapter = buildSimplePeerManagerReconnectFlowAdapter({
      mqtt,
      topic: 'p2p-conf/room-1',
      peers,
      onSignalMessage,
      onRestartPeerDiscovery,
      onAttemptIceRestart
    })

    expect(adapter).toEqual({
      mqtt,
      topic: 'p2p-conf/room-1',
      peers,
      onSignalMessage,
      restartPeerDiscovery: onRestartPeerDiscovery,
      attemptIceRestart: onAttemptIceRestart
    })
  })

  it('delegates reconnect attempt to performNetworkReconnectFlowWithAdapter', async () => {
    reconnectServiceMocks.performNetworkReconnectFlowWithAdapter.mockResolvedValueOnce(true)
    const mqtt = { isConnected: vi.fn(), connectAll: vi.fn(), subscribeAll: vi.fn() }
    const peers = new Map<string, any>()

    const result = await performSimplePeerManagerReconnectAttempt({
      mqtt,
      topic: 'p2p-conf/room-1',
      peers,
      onSignalMessage: vi.fn(),
      onRestartPeerDiscovery: vi.fn(),
      onAttemptIceRestart: vi.fn()
    })

    expect(result).toBe(true)
    expect(reconnectServiceMocks.performNetworkReconnectFlowWithAdapter).toHaveBeenCalledWith({
      mqtt,
      topic: 'p2p-conf/room-1',
      peers,
      onSignalMessage: expect.any(Function),
      restartPeerDiscovery: expect.any(Function),
      attemptIceRestart: expect.any(Function)
    })
  })

  it('delegates managed reconnect and reuses same options for request-retry recursion', async () => {
    let callCount = 0
    reconnectServiceMocks.attemptManagedNetworkReconnect.mockImplementation(async (options: any) => {
      callCount += 1
      if (callCount === 1) {
        options.requestRetry()
      }
    })

    const state = {
      isOnline: true,
      networkReconnectTimer: null,
      wasInRoomWhenOffline: true,
      networkReconnectAttempts: 1
    }

    await attemptSimplePeerManagerReconnect({
      state: state as any,
      getRoomId: () => 'room-1',
      maxAttempts: 5,
      baseDelay: 2000,
      performReconnectAttempt: vi.fn().mockResolvedValue(true),
      onReconnectSuccess: vi.fn(),
      onReconnectFailure: vi.fn()
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(reconnectServiceMocks.attemptManagedNetworkReconnect).toHaveBeenCalledTimes(2)
    const firstCall = reconnectServiceMocks.attemptManagedNetworkReconnect.mock.calls[0][0]
    expect(firstCall.state).toBe(state)
    expect(firstCall.getRoomId()).toBe('room-1')
    expect(firstCall.maxAttempts).toBe(5)
    expect(firstCall.baseDelay).toBe(2000)
    expect(typeof firstCall.requestRetry).toBe('function')
  })
})
