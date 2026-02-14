import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attemptManagedNetworkReconnect,
  createNetworkReconnectState,
  getNetworkStatusSnapshot,
  performNetworkReconnectFlow,
  performNetworkReconnectFlowWithAdapter,
  resetNetworkReconnectState,
  scheduleNetworkReconnectAttempt,
  setNetworkOffline,
  setNetworkOnline,
  triggerManualReconnect
} from '../renderer/signaling/services/networkReconnect'

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}))

describe('networkReconnect service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  it('tracks online/offline transitions and reconnect callback triggers', () => {
    const state = createNetworkReconnectState(true)
    const onNetworkStatusChange = vi.fn()
    const requestReconnect = vi.fn()

    setNetworkOffline({
      state,
      roomId: 'room-1',
      onNetworkStatusChange
    })

    expect(state.isOnline).toBe(false)
    expect(state.wasInRoomWhenOffline).toBe(true)
    expect(onNetworkStatusChange).toHaveBeenCalledWith(false)

    setNetworkOnline({
      state,
      roomId: 'room-1',
      userName: 'Alice',
      onNetworkStatusChange,
      requestReconnect
    })

    expect(state.isOnline).toBe(true)
    expect(onNetworkStatusChange).toHaveBeenCalledWith(true)
    expect(requestReconnect).toHaveBeenCalledTimes(1)
  })

  it('schedules reconnect, handles success path, and resets state', async () => {
    const state = createNetworkReconnectState(true)
    state.wasInRoomWhenOffline = true
    const onReconnectSuccess = vi.fn()

    await scheduleNetworkReconnectAttempt({
      state,
      getRoomId: () => 'room-1',
      maxAttempts: 3,
      baseDelay: 100,
      onMaxAttemptsReached: vi.fn(),
      performReconnect: vi.fn().mockResolvedValue(true),
      requestRetry: vi.fn(),
      onReconnectSuccess
    })

    expect(state.networkReconnectAttempts).toBe(1)
    await vi.runOnlyPendingTimersAsync()

    expect(state.networkReconnectAttempts).toBe(0)
    expect(state.wasInRoomWhenOffline).toBe(false)
    expect(onReconnectSuccess).toHaveBeenCalledTimes(1)
  })

  it('handles max-attempts and retry branches', async () => {
    const state = createNetworkReconnectState(true)
    const onMaxAttemptsReached = vi.fn()
    const requestRetry = vi.fn()

    state.networkReconnectAttempts = 2
    await scheduleNetworkReconnectAttempt({
      state,
      getRoomId: () => 'room-1',
      maxAttempts: 2,
      baseDelay: 50,
      onMaxAttemptsReached,
      performReconnect: vi.fn(),
      requestRetry
    })

    expect(onMaxAttemptsReached).toHaveBeenCalledTimes(1)
    expect(state.networkReconnectAttempts).toBe(0)
    expect(state.wasInRoomWhenOffline).toBe(false)

    const retryState = createNetworkReconnectState(true)
    await scheduleNetworkReconnectAttempt({
      state: retryState,
      getRoomId: () => 'room-2',
      maxAttempts: 3,
      baseDelay: 50,
      onMaxAttemptsReached: vi.fn(),
      performReconnect: vi.fn().mockResolvedValue(false),
      requestRetry
    })
    await vi.runOnlyPendingTimersAsync()
    expect(requestRetry).toHaveBeenCalledTimes(1)
  })

  it('reconnect flow restarts discovery, re-subscribes MQTT, and restarts ICE for unhealthy peers', async () => {
    const onSignalMessage = vi.fn()
    const restartPeerDiscovery = vi.fn()
    const attemptIceRestart = vi.fn()
    const subscribeAll = vi.fn().mockImplementation(async (_topic: string, handler: (message: string) => void) => {
      handler(JSON.stringify({ type: 'announce', from: 'peer-1' }))
      handler('invalid-json')
      return 1
    })

    const mqtt = {
      isConnected: vi.fn()
        .mockReturnValueOnce(false)
        .mockReturnValue(true),
      connectAll: vi.fn().mockResolvedValue(['wss://broker-1']),
      subscribeAll
    }

    const peers = new Map([
      ['peer-1', { pc: { iceConnectionState: 'connected' as RTCIceConnectionState }, iceRestartAttempts: 2 }],
      ['peer-2', { pc: { iceConnectionState: 'disconnected' as RTCIceConnectionState }, iceRestartAttempts: 3 }],
      ['peer-3', { pc: { iceConnectionState: 'failed' as RTCIceConnectionState }, iceRestartAttempts: 4 }]
    ])

    const result = await performNetworkReconnectFlow({
      mqtt,
      topic: 'p2p-conf/room-1',
      peers,
      onSignalMessage,
      restartPeerDiscovery,
      attemptIceRestart
    })

    expect(result).toBe(true)
    expect(mqtt.connectAll).toHaveBeenCalledTimes(1)
    expect(subscribeAll).toHaveBeenCalledTimes(1)
    expect(restartPeerDiscovery).toHaveBeenCalledTimes(1)
    expect(onSignalMessage).toHaveBeenCalledWith({ type: 'announce', from: 'peer-1' })
    expect(attemptIceRestart).toHaveBeenCalledWith('peer-2')
    expect(attemptIceRestart).toHaveBeenCalledWith('peer-3')
    expect((peers.get('peer-2') as any).iceRestartAttempts).toBe(0)
    expect((peers.get('peer-3') as any).iceRestartAttempts).toBe(0)
  })

  it('adapter and managed reconnect helpers delegate as expected', async () => {
    const onReconnectFailure = vi.fn()
    const performReconnect = vi.fn().mockResolvedValue(true)
    const onReconnectSuccess = vi.fn()

    const state = createNetworkReconnectState(true)
    await attemptManagedNetworkReconnect({
      state,
      getRoomId: () => 'room-1',
      maxAttempts: 0,
      baseDelay: 50,
      performReconnect,
      requestRetry: vi.fn(),
      onReconnectSuccess,
      onReconnectFailure
    })
    expect(onReconnectFailure).toHaveBeenCalledWith(expect.any(Error))

    const adapterResult = await performNetworkReconnectFlowWithAdapter({
      mqtt: null,
      topic: 'p2p-conf/room-2',
      peers: new Map(),
      onSignalMessage: vi.fn(),
      restartPeerDiscovery: vi.fn(),
      attemptIceRestart: vi.fn()
    })
    expect(adapterResult).toBe(false)
  })

  it('manual reconnect, snapshots, and reset state behave correctly', async () => {
    const setAttempts = vi.fn()
    const setWasInRoomWhenOffline = vi.fn()
    const attemptReconnect = vi.fn().mockResolvedValue(undefined)

    const noRoom = await triggerManualReconnect({
      roomId: null,
      setAttempts,
      setWasInRoomWhenOffline,
      attemptReconnect
    })
    expect(noRoom).toBe(false)
    expect(setAttempts).not.toHaveBeenCalled()

    const inRoom = await triggerManualReconnect({
      roomId: 'room-1',
      setAttempts,
      setWasInRoomWhenOffline,
      attemptReconnect
    })
    expect(inRoom).toBe(true)
    expect(setAttempts).toHaveBeenCalledWith(0)
    expect(setWasInRoomWhenOffline).toHaveBeenCalledWith(true)
    expect(attemptReconnect).toHaveBeenCalledTimes(1)

    const state = createNetworkReconnectState(false)
    state.wasInRoomWhenOffline = true
    state.networkReconnectAttempts = 2
    const snapshot = getNetworkStatusSnapshot(state)
    expect(snapshot).toEqual({
      isOnline: false,
      wasInRoomWhenOffline: true,
      reconnectAttempts: 2
    })

    resetNetworkReconnectState(state)
    expect(state.wasInRoomWhenOffline).toBe(false)
    expect(state.networkReconnectAttempts).toBe(0)
  })
})
