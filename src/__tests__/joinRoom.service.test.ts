import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mqttMocks = vi.hoisted(() => ({
  setOnReconnect: vi.fn(),
  connectAll: vi.fn(),
  subscribeAll: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(),
  getConnectedCount: vi.fn()
}))

vi.mock('../renderer/utils/Logger', () => ({
  SignalingLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

vi.mock('../renderer/signaling/services/mqttTransport', () => ({
  MultiBrokerMQTT: class {
    setOnReconnect = mqttMocks.setOnReconnect
    connectAll = mqttMocks.connectAll
    subscribeAll = mqttMocks.subscribeAll
    disconnect = mqttMocks.disconnect
    isConnected = mqttMocks.isConnected
    getConnectedCount = mqttMocks.getConnectedCount
  }
}))

import type { JoinRoomWorkflowAdapter } from '../renderer/signaling/services/joinRoom'
import {
  connectRoomMqttWithHandling,
  detectPeerPlatform,
  executeJoinRoomWorkflowWithAdapter,
  prepareJoinRoomAttempt,
  setupRoomBroadcastChannel,
  startJoinPresenceLoops
} from '../renderer/signaling/services/joinRoom'

function createAdapter(): JoinRoomWorkflowAdapter {
  return {
    roomId: null,
    userName: '',
    announceStartTime: 0,
    topic: '',
    localPlatform: 'win',
    broadcastChannel: null,
    mqtt: null,
    sessionId: 11,
    updateSignalingState: vi.fn(),
    handleSignalingMessage: vi.fn(),
    onError: vi.fn(),
    broadcastAnnounce: vi.fn(),
    getHealthyPeerCount: vi.fn().mockReturnValue(0),
    startAnnounceInterval: vi.fn(),
    startHeartbeat: vi.fn()
  }
}

describe('joinRoom service workflow', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()

    mqttMocks.setOnReconnect.mockReset()
    mqttMocks.connectAll.mockReset().mockResolvedValue(['wss://broker.example.com'])
    mqttMocks.subscribeAll.mockReset().mockResolvedValue(1)
    mqttMocks.disconnect.mockReset()
    mqttMocks.isConnected.mockReset().mockReturnValue(true)
    mqttMocks.getConnectedCount.mockReset().mockReturnValue(1)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('detects peer platforms from user agent strings', () => {
    expect(detectPeerPlatform('Mozilla/5.0 Windows NT')).toBe('win')
    expect(detectPeerPlatform('Mozilla/5.0 Mac OS X')).toBe('mac')
    expect(detectPeerPlatform('Mozilla/5.0 Linux')).toBe('linux')
    expect(detectPeerPlatform('Unknown Platform')).toBe('win')
  })

  it('prepares join attempt by leaving active room first', async () => {
    const leaveRoom = vi.fn()
    const wait = vi.fn().mockResolvedValue(undefined)

    const result = await prepareJoinRoomAttempt({
      hasActiveRoom: true,
      leaveRoom,
      waitMs: 250,
      wait
    })

    expect(result).toBe(true)
    expect(leaveRoom).toHaveBeenCalledTimes(1)
    expect(wait).toHaveBeenCalledWith(250)
  })

  it('executes adapter workflow for successful MQTT + presence startup', async () => {
    vi.useFakeTimers()

    const close = vi.fn()
    const BroadcastChannelMock = vi.fn(class {
      onmessage: ((event: MessageEvent) => void) | null = null
      close = close
    })
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock as unknown as typeof BroadcastChannel)

    const adapter = createAdapter()
    const loadCredentials = vi.fn().mockResolvedValue(undefined)
    const resetControlState = vi.fn()

    await executeJoinRoomWorkflowWithAdapter({
      roomId: 'room-1',
      userName: 'Alice',
      selfId: 'self-1',
      currentSession: 11,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      loadCredentials,
      resetControlState,
      adapter
    })

    expect(loadCredentials).toHaveBeenCalledTimes(1)
    expect(resetControlState).toHaveBeenCalledTimes(1)
    expect(BroadcastChannelMock).toHaveBeenCalledWith('p2p-room-1')
    expect(mqttMocks.connectAll).toHaveBeenCalledTimes(1)
    expect(mqttMocks.subscribeAll).toHaveBeenCalledTimes(1)
    expect(adapter.roomId).toBe('room-1')
    expect(adapter.userName).toBe('Alice')
    expect(adapter.topic).toBe('p2p-conf/room-1')
    expect(adapter.localPlatform).toBe('win')
    expect(adapter.updateSignalingState).toHaveBeenCalledWith('connecting')
    expect(adapter.updateSignalingState).toHaveBeenCalledWith('connected')
    expect(adapter.startAnnounceInterval).toHaveBeenCalledTimes(1)
    expect(adapter.startHeartbeat).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(350)
    expect(adapter.broadcastAnnounce).toHaveBeenCalledTimes(1)
  })

  it('falls back to broadcast-only mode when MQTT connection fails', async () => {
    vi.useFakeTimers()
    mqttMocks.connectAll.mockRejectedValueOnce(new Error('mqtt-failure'))
    mqttMocks.isConnected.mockReturnValue(false)
    mqttMocks.getConnectedCount.mockReturnValue(0)

    const BroadcastChannelMock = vi.fn(class {
      onmessage: ((event: MessageEvent) => void) | null = null
      close = vi.fn()
    })
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock as unknown as typeof BroadcastChannel)

    const adapter = createAdapter()

    await executeJoinRoomWorkflowWithAdapter({
      roomId: 'room-fallback',
      userName: 'Bob',
      selfId: 'self-2',
      currentSession: 11,
      userAgent: 'Mozilla/5.0 (Linux)',
      loadCredentials: vi.fn().mockResolvedValue(undefined),
      resetControlState: vi.fn(),
      adapter
    })

    expect(adapter.onError).toHaveBeenCalledWith(expect.any(Error), 'mqtt-connection')
    expect(adapter.mqtt).toBeNull()
    expect(adapter.updateSignalingState).toHaveBeenCalledWith('connecting')
    expect(adapter.updateSignalingState).toHaveBeenCalledWith('connected')
    expect(adapter.updateSignalingState).not.toHaveBeenCalledWith('failed')
    expect(mqttMocks.disconnect).toHaveBeenCalledTimes(1)
    expect(adapter.startAnnounceInterval).toHaveBeenCalledTimes(1)
    expect(adapter.startHeartbeat).toHaveBeenCalledTimes(1)
  })

  it('returns null and disconnects when MQTT subscribe count is zero', async () => {
    mqttMocks.subscribeAll.mockResolvedValueOnce(0)

    const mqtt = await connectRoomMqttWithHandling({
      topic: 'p2p-conf/room-1',
      currentSession: 11,
      getSessionId: () => 11,
      onReconnect: vi.fn(),
      onSignalMessage: vi.fn(),
      onMqttConnectionError: vi.fn()
    })

    expect(mqtt).toBeNull()
    expect(mqttMocks.disconnect).toHaveBeenCalledTimes(1)
  })

  it('wires BroadcastChannel handler and ignores stale-session messages', () => {
    const onSignalMessage = vi.fn()
    let handler: ((event: MessageEvent) => void) | null = null

    const BroadcastChannelMock = vi.fn(class {
      close = vi.fn()
      set onmessage(value: ((event: MessageEvent) => void) | null) {
        handler = value
      }
      get onmessage() {
        return handler
      }
    })

    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock as unknown as typeof BroadcastChannel)

    const channel = setupRoomBroadcastChannel({
      roomId: 'room-xyz',
      currentSession: 42,
      getSessionId: () => 41,
      onSignalMessage
    })

    expect(channel).not.toBeNull()
    expect(BroadcastChannelMock).toHaveBeenCalledWith('p2p-room-xyz')
    const capturedHandler = handler as unknown as ((event: MessageEvent) => void) | null
    capturedHandler?.({ data: { type: 'announce' } } as MessageEvent)
    expect(onSignalMessage).not.toHaveBeenCalled()
  })

  it('starts presence loops and skips delayed announce for stale session', () => {
    vi.useFakeTimers()
    const broadcastAnnounce = vi.fn()
    const startAnnounceInterval = vi.fn()
    const startHeartbeat = vi.fn()

    startJoinPresenceLoops({
      currentSession: 7,
      getSessionId: () => 8,
      broadcastAnnounce,
      startAnnounceInterval,
      startHeartbeat,
      initialDelayMs: 50
    })

    vi.advanceTimersByTime(60)

    expect(startAnnounceInterval).toHaveBeenCalledTimes(1)
    expect(startHeartbeat).toHaveBeenCalledTimes(1)
    expect(broadcastAnnounce).not.toHaveBeenCalled()
  })

  it('propagates credential loading errors before signaling setup', async () => {
    const adapter = createAdapter()
    const loadCredentials = vi.fn().mockRejectedValue(new Error('secure-credentials-unavailable'))
    const resetControlState = vi.fn()

    await expect(executeJoinRoomWorkflowWithAdapter({
      roomId: 'room-secure-fail',
      userName: 'Carol',
      selfId: 'self-3',
      currentSession: 11,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      loadCredentials,
      resetControlState,
      adapter
    })).rejects.toThrow('secure-credentials-unavailable')

    expect(adapter.updateSignalingState).toHaveBeenCalledWith('connecting')
    expect(adapter.updateSignalingState).toHaveBeenCalledWith('failed')
    expect(resetControlState).not.toHaveBeenCalled()
    expect(mqttMocks.connectAll).not.toHaveBeenCalled()
    expect(adapter.topic).toBe('')
    expect(adapter.roomId).toBeNull()
  })
})
