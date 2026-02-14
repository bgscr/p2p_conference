import { SignalingLog } from '../../utils/Logger'

export interface NetworkReconnectState {
  isOnline: boolean
  networkReconnectTimer: NodeJS.Timeout | null
  wasInRoomWhenOffline: boolean
  networkReconnectAttempts: number
}

export interface NetworkReconnectStatus {
  isOnline: boolean
  wasInRoomWhenOffline: boolean
  reconnectAttempts: number
}

interface SetNetworkOnlineOptions {
  state: NetworkReconnectState
  roomId: string | null
  userName: string
  onNetworkStatusChange?: (isOnline: boolean) => void
  requestReconnect: () => void
}

interface SetNetworkOfflineOptions {
  state: NetworkReconnectState
  roomId: string | null
  onNetworkStatusChange?: (isOnline: boolean) => void
}

interface ScheduleNetworkReconnectOptions {
  state: NetworkReconnectState
  getRoomId: () => string | null
  maxAttempts: number
  baseDelay: number
  onMaxAttemptsReached: () => void
  performReconnect: () => Promise<boolean>
  requestRetry: () => void
  onReconnectSuccess?: () => void
}

interface AttemptManagedNetworkReconnectOptions {
  state: NetworkReconnectState
  getRoomId: () => string | null
  maxAttempts: number
  baseDelay: number
  performReconnect: () => Promise<boolean>
  requestRetry: () => void
  onReconnectSuccess: () => void
  onReconnectFailure: (error: Error) => void
}

interface TriggerManualReconnectOptions {
  roomId: string | null
  setAttempts: (attempts: number) => void
  setWasInRoomWhenOffline: (value: boolean) => void
  attemptReconnect: () => Promise<void>
}

interface NetworkReconnectMqttLike {
  isConnected: () => boolean
  connectAll: () => Promise<string[]>
  subscribeAll: (topic: string, handler: (message: string) => void) => Promise<number>
}

export interface ReconnectPeerState {
  pc: {
    iceConnectionState: RTCIceConnectionState
  }
  iceRestartAttempts: number
}

interface PerformNetworkReconnectFlowOptions {
  mqtt: NetworkReconnectMqttLike | null
  topic: string
  peers: Map<string, ReconnectPeerState>
  onSignalMessage: (data: unknown) => void
  restartPeerDiscovery: () => void
  attemptIceRestart: (peerId: string) => void
}

export interface NetworkReconnectAttemptAdapter {
  mqtt: NetworkReconnectMqttLike | null
  topic: string
  peers: Map<string, ReconnectPeerState>
  onSignalMessage: (data: unknown) => void
  restartPeerDiscovery: () => void
  attemptIceRestart: (peerId: string) => void
}

export function createNetworkReconnectState(initialOnline: boolean): NetworkReconnectState {
  return {
    isOnline: initialOnline,
    networkReconnectTimer: null,
    wasInRoomWhenOffline: false,
    networkReconnectAttempts: 0
  }
}

export function clearNetworkReconnectTimer(state: NetworkReconnectState): void {
  if (state.networkReconnectTimer) {
    clearTimeout(state.networkReconnectTimer)
    state.networkReconnectTimer = null
  }
}

export function setNetworkOnline(options: SetNetworkOnlineOptions): void {
  const {
    state,
    roomId,
    userName,
    onNetworkStatusChange,
    requestReconnect
  } = options

  SignalingLog.info('Network: Browser went online')
  state.isOnline = true
  onNetworkStatusChange?.(true)

  if (state.wasInRoomWhenOffline && roomId) {
    SignalingLog.info('Network restored - attempting to reconnect to room', {
      roomId,
      userName
    })
    requestReconnect()
  }
}

export function setNetworkOffline(options: SetNetworkOfflineOptions): void {
  const {
    state,
    roomId,
    onNetworkStatusChange
  } = options

  SignalingLog.warn('Network: Browser went offline')
  state.isOnline = false
  onNetworkStatusChange?.(false)

  if (roomId) {
    state.wasInRoomWhenOffline = true
    SignalingLog.info('Was in room when network dropped', { roomId })
  }

  clearNetworkReconnectTimer(state)
}

export async function scheduleNetworkReconnectAttempt(options: ScheduleNetworkReconnectOptions): Promise<void> {
  const {
    state,
    getRoomId,
    maxAttempts,
    baseDelay,
    onMaxAttemptsReached,
    performReconnect,
    requestRetry,
    onReconnectSuccess
  } = options

  if (!getRoomId() || !state.isOnline) {
    return
  }

  clearNetworkReconnectTimer(state)

  state.networkReconnectAttempts++

  if (state.networkReconnectAttempts > maxAttempts) {
    SignalingLog.error('Network reconnect: Max attempts reached', {
      attempts: state.networkReconnectAttempts
    })
    state.networkReconnectAttempts = 0
    state.wasInRoomWhenOffline = false
    onMaxAttemptsReached()
    return
  }

  const delay = baseDelay * Math.pow(1.5, state.networkReconnectAttempts - 1)
  SignalingLog.info('Network reconnect: Scheduling attempt', {
    attempt: state.networkReconnectAttempts,
    maxAttempts,
    delayMs: Math.round(delay)
  })

  state.networkReconnectTimer = setTimeout(async () => {
    if (!state.isOnline || !getRoomId()) {
      SignalingLog.warn('Network reconnect: Aborted - offline or no room')
      return
    }

    try {
      const reconnected = await performReconnect()
      if (reconnected) {
        state.networkReconnectAttempts = 0
        state.wasInRoomWhenOffline = false
        onReconnectSuccess?.()
      } else {
        SignalingLog.warn('Network reconnect: MQTT not connected, retrying')
        requestRetry()
      }
    } catch (err) {
      SignalingLog.error('Network reconnect: Failed', { error: String(err) })
      requestRetry()
    }
  }, delay)
}

export async function performNetworkReconnectFlow(options: PerformNetworkReconnectFlowOptions): Promise<boolean> {
  const {
    mqtt,
    topic,
    peers,
    onSignalMessage,
    restartPeerDiscovery,
    attemptIceRestart
  } = options

  if (mqtt && !mqtt.isConnected()) {
    SignalingLog.info('Network reconnect: Reconnecting MQTT brokers')
    const connectedBrokers = await mqtt.connectAll()

    if (connectedBrokers.length > 0) {
      await mqtt.subscribeAll(topic, (message) => {
        try {
          const data = JSON.parse(message)
          onSignalMessage(data)
        } catch {
          SignalingLog.debug('Invalid MQTT message during reconnect')
        }
      })
    }
  }

  restartPeerDiscovery()

  peers.forEach((peer, peerId) => {
    const state = peer.pc.iceConnectionState
    if (state === 'disconnected' || state === 'failed') {
      SignalingLog.info('Network reconnect: Triggering ICE restart for peer', { peerId, state })
      peer.iceRestartAttempts = 0
      attemptIceRestart(peerId)
    }
  })

  if (mqtt?.isConnected()) {
    SignalingLog.info('Network reconnect: Successfully reconnected', {
      mqttConnected: true,
      peerCount: peers.size
    })
    return true
  }

  return false
}

export async function performNetworkReconnectFlowWithAdapter(
  adapter: NetworkReconnectAttemptAdapter
): Promise<boolean> {
  return performNetworkReconnectFlow({
    mqtt: adapter.mqtt,
    topic: adapter.topic,
    peers: adapter.peers,
    onSignalMessage: adapter.onSignalMessage,
    restartPeerDiscovery: adapter.restartPeerDiscovery,
    attemptIceRestart: adapter.attemptIceRestart
  })
}

export async function attemptManagedNetworkReconnect(
  options: AttemptManagedNetworkReconnectOptions
): Promise<void> {
  const {
    state,
    getRoomId,
    maxAttempts,
    baseDelay,
    performReconnect,
    requestRetry,
    onReconnectSuccess,
    onReconnectFailure
  } = options

  await scheduleNetworkReconnectAttempt({
    state,
    getRoomId,
    maxAttempts,
    baseDelay,
    onMaxAttemptsReached: () => {
      onReconnectFailure(new Error('Failed to reconnect after network restoration'))
    },
    performReconnect,
    requestRetry,
    onReconnectSuccess
  })
}

export async function triggerManualReconnect(
  options: TriggerManualReconnectOptions
): Promise<boolean> {
  const {
    roomId,
    setAttempts,
    setWasInRoomWhenOffline,
    attemptReconnect
  } = options

  if (!roomId) {
    SignalingLog.warn('Manual reconnect: No room to reconnect to')
    return false
  }

  SignalingLog.info('Manual reconnect: Triggered by user')
  setAttempts(0)
  setWasInRoomWhenOffline(true)
  await attemptReconnect()
  return true
}

export function getNetworkStatusSnapshot(state: NetworkReconnectState): NetworkReconnectStatus {
  return {
    isOnline: state.isOnline,
    wasInRoomWhenOffline: state.wasInRoomWhenOffline,
    reconnectAttempts: state.networkReconnectAttempts
  }
}

export function resetNetworkReconnectState(state: NetworkReconnectState): void {
  clearNetworkReconnectTimer(state)
  state.wasInRoomWhenOffline = false
  state.networkReconnectAttempts = 0
}
