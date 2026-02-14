import { SignalingLog } from '../../utils/Logger'
import { MultiBrokerMQTT } from './mqttTransport'

export type PeerPlatform = 'win' | 'mac' | 'linux'

export interface JoinRoomRuntimeState {
  topic: string
  announceStartTime: number
  localPlatform: PeerPlatform
}

interface SetupRoomBroadcastChannelOptions {
  roomId: string
  currentSession: number
  getSessionId: () => number
  onSignalMessage: (data: unknown) => void
}

interface ConnectRoomMqttOptions {
  topic: string
  currentSession: number
  getSessionId: () => number
  onReconnect: () => void
  onSignalMessage: (data: unknown) => void
}

interface ConnectRoomMqttWithHandlingOptions extends ConnectRoomMqttOptions {
  onMqttConnectionError?: (error: Error) => void
}

interface ReplaceRoomBroadcastChannelOptions {
  existingChannel: BroadcastChannel | null
  roomId: string
  currentSession: number
  getSessionId: () => number
  onSignalMessage: (data: unknown) => void
}

interface PrepareJoinRoomAttemptOptions {
  hasActiveRoom: boolean
  leaveRoom: () => void
  waitMs?: number
  wait?: (ms: number) => Promise<void>
}

interface HandleMqttUnavailableJoinOptions {
  updateSignalingState: (state: 'connected') => void
}

interface StartJoinPresenceLoopsOptions {
  currentSession: number
  getSessionId: () => number
  broadcastAnnounce: () => void
  startAnnounceInterval: () => void
  startHeartbeat: () => void
  initialDelayMs?: number
}

interface ExecuteJoinRoomWorkflowOptions {
  roomId: string
  userName: string
  selfId: string
  currentSession: number
  userAgent: string
  loadCredentials: () => Promise<void>
  resetControlState: () => void
  applyJoinRuntime: (runtime: JoinRoomRuntimeState) => void
  currentBroadcastChannel: BroadcastChannel | null
  setBroadcastChannel: (channel: BroadcastChannel | null) => void
  getSessionId: () => number
  onSignalMessage: (data: unknown) => void
  onMqttReconnect: () => void
  onMqttConnectionError: (error: Error) => void
  setMqtt: (mqtt: MultiBrokerMQTT | null) => void
  updateSignalingState: (state: 'connecting' | 'connected' | 'failed') => void
  onMqttUnavailable: () => void
  startPresenceLoops: (currentSession: number) => void
  getMqttStatus: () => {
    connected: boolean
    brokerCount: number
  }
}

export interface JoinRoomWorkflowAdapter {
  roomId: string | null
  userName: string
  announceStartTime: number
  topic: string
  localPlatform: PeerPlatform
  broadcastChannel: BroadcastChannel | null
  mqtt: MultiBrokerMQTT | null
  sessionId: number
  updateSignalingState: (state: 'connecting' | 'connected' | 'failed') => void
  handleSignalingMessage: (data: unknown) => void
  onError: (error: Error, context: string) => void
  broadcastAnnounce: () => void
  getHealthyPeerCount: () => number
  startAnnounceInterval: () => void
  startHeartbeat: () => void
}

interface ExecuteJoinRoomWorkflowWithAdapterOptions {
  roomId: string
  userName: string
  selfId: string
  currentSession: number
  userAgent: string
  loadCredentials: () => Promise<void>
  resetControlState: () => void
  adapter: JoinRoomWorkflowAdapter
}

export interface ConnectRoomMqttResult {
  mqtt: MultiBrokerMQTT
  connectedBrokers: string[]
  subscribeCount: number
}

export function createJoinRoomRuntimeState(
  roomId: string,
  userAgent: string,
  now: () => number = () => Date.now()
): JoinRoomRuntimeState {
  return {
    topic: `p2p-conf/${roomId}`,
    announceStartTime: now(),
    localPlatform: detectPeerPlatform(userAgent)
  }
}

export function detectPeerPlatform(userAgent: string): PeerPlatform {
  const normalized = userAgent.toLowerCase()
  if (normalized.includes('win')) {
    return 'win'
  }
  if (normalized.includes('mac')) {
    return 'mac'
  }
  if (normalized.includes('linux')) {
    return 'linux'
  }
  return 'win'
}

export function setupRoomBroadcastChannel(options: SetupRoomBroadcastChannelOptions): BroadcastChannel | null {
  const {
    roomId,
    currentSession,
    getSessionId,
    onSignalMessage
  } = options

  try {
    const broadcastChannel = new BroadcastChannel(`p2p-${roomId}`)
    broadcastChannel.onmessage = (event) => {
      if (getSessionId() !== currentSession) {
        SignalingLog.debug('Ignoring BroadcastChannel message from previous session')
        return
      }
      onSignalMessage(event.data)
    }
    SignalingLog.debug('BroadcastChannel connected')
    return broadcastChannel
  } catch {
    SignalingLog.warn('BroadcastChannel not available')
    return null
  }
}

export function replaceRoomBroadcastChannel(options: ReplaceRoomBroadcastChannelOptions): BroadcastChannel | null {
  const {
    existingChannel,
    roomId,
    currentSession,
    getSessionId,
    onSignalMessage
  } = options

  if (existingChannel) {
    try {
      existingChannel.close()
    } catch {
      // Ignore close errors from stale channels.
    }
  }

  return setupRoomBroadcastChannel({
    roomId,
    currentSession,
    getSessionId,
    onSignalMessage
  })
}

export async function prepareJoinRoomAttempt(options: PrepareJoinRoomAttemptOptions): Promise<boolean> {
  const {
    hasActiveRoom,
    leaveRoom,
    waitMs = 100,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = options

  if (!hasActiveRoom) {
    return true
  }

  SignalingLog.info('Cleaning up previous room before joining new one')
  leaveRoom()
  await wait(waitMs)
  return true
}

export async function connectRoomMqtt(options: ConnectRoomMqttOptions): Promise<ConnectRoomMqttResult> {
  const {
    topic,
    currentSession,
    getSessionId,
    onReconnect,
    onSignalMessage
  } = options

  SignalingLog.info('Starting multi-broker MQTT connection')
  const mqtt = new MultiBrokerMQTT()

  mqtt.setOnReconnect((_brokerUrl) => {
    onReconnect()
  })

  try {
    const connectedBrokers = await mqtt.connectAll()
    if (connectedBrokers.length === 0) {
      throw new Error('No MQTT brokers could be connected')
    }

    SignalingLog.info('MQTT brokers connected', {
      count: connectedBrokers.length,
      brokers: connectedBrokers
    })

    const subscribeCount = await mqtt.subscribeAll(topic, (message) => {
      if (getSessionId() !== currentSession) {
        SignalingLog.debug('Ignoring MQTT message from previous session')
        return
      }

      try {
        const data = JSON.parse(message)
        onSignalMessage(data)
      } catch (err) {
        SignalingLog.debug('Invalid MQTT message', {
          error: String(err),
          length: message.length,
          preview: message.substring(0, 50)
        })
      }
    })

    return {
      mqtt,
      connectedBrokers,
      subscribeCount
    }
  } catch (err) {
    mqtt.disconnect()
    throw err
  }
}

export async function connectRoomMqttWithHandling(options: ConnectRoomMqttWithHandlingOptions): Promise<MultiBrokerMQTT | null> {
  const {
    onMqttConnectionError,
    ...connectOptions
  } = options

  try {
    const mqttResult = await connectRoomMqtt(connectOptions)
    if (mqttResult.subscribeCount > 0) {
      SignalingLog.info('Subscribed to topic', {
        topic: connectOptions.topic,
        brokerCount: mqttResult.subscribeCount
      })
      return mqttResult.mqtt
    }

    SignalingLog.warn('MQTT subscription failed on all brokers')
    mqttResult.mqtt.disconnect()
    return null
  } catch (err) {
    SignalingLog.error('MQTT connection failed', { error: String(err) })
    onMqttConnectionError?.(err as Error)
    return null
  }
}

export function handleMqttUnavailableJoin(options: HandleMqttUnavailableJoinOptions): void {
  const { updateSignalingState } = options

  SignalingLog.warn('MQTT unavailable - remote connections will NOT work. Only same-device testing via BroadcastChannel is possible.')
  updateSignalingState('connected')
  SignalingLog.info('BroadcastChannel is active for same-device communication only', {
    note: 'To connect with remote peers, ensure at least one MQTT broker is reachable'
  })
}

export function startJoinPresenceLoops(options: StartJoinPresenceLoopsOptions): void {
  const {
    currentSession,
    getSessionId,
    broadcastAnnounce,
    startAnnounceInterval,
    startHeartbeat,
    initialDelayMs = 300
  } = options

  setTimeout(() => {
    if (getSessionId() === currentSession) {
      broadcastAnnounce()
    }
  }, initialDelayMs)

  startAnnounceInterval()
  startHeartbeat()
}

export async function executeJoinRoomWorkflow(options: ExecuteJoinRoomWorkflowOptions): Promise<void> {
  const {
    roomId,
    userName,
    selfId,
    currentSession,
    userAgent,
    loadCredentials,
    resetControlState,
    applyJoinRuntime,
    currentBroadcastChannel,
    setBroadcastChannel,
    getSessionId,
    onSignalMessage,
    onMqttReconnect,
    onMqttConnectionError,
    setMqtt,
    updateSignalingState,
    onMqttUnavailable,
    startPresenceLoops,
    getMqttStatus
  } = options

  updateSignalingState('connecting')

  try {
    await loadCredentials()

    const joinRuntimeState = createJoinRoomRuntimeState(roomId, userAgent)
    applyJoinRuntime(joinRuntimeState)
    resetControlState()

    SignalingLog.info('Joining room', {
      roomId,
      userName,
      selfId,
      topic: joinRuntimeState.topic,
      sessionId: currentSession
    })

    const broadcastChannel = replaceRoomBroadcastChannel({
      existingChannel: currentBroadcastChannel,
      roomId,
      currentSession,
      getSessionId,
      onSignalMessage
    })
    setBroadcastChannel(broadcastChannel)

    const mqtt = await connectRoomMqttWithHandling({
      topic: joinRuntimeState.topic,
      currentSession,
      getSessionId,
      onReconnect: onMqttReconnect,
      onSignalMessage,
      onMqttConnectionError
    })
    setMqtt(mqtt)

    if (mqtt) {
      updateSignalingState('connected')
    }

    if (!mqtt?.isConnected()) {
      onMqttUnavailable()
    }

    startPresenceLoops(currentSession)

    const mqttStatus = getMqttStatus()
    SignalingLog.info('Successfully joined room', {
      roomId,
      mqttConnected: mqttStatus.connected,
      mqttBrokerCount: mqttStatus.brokerCount,
      sessionId: currentSession
    })
  } catch (error) {
    updateSignalingState('failed')
    throw error
  }
}

export async function executeJoinRoomWorkflowWithAdapter(
  options: ExecuteJoinRoomWorkflowWithAdapterOptions
): Promise<void> {
  const {
    roomId,
    userName,
    selfId,
    currentSession,
    userAgent,
    loadCredentials,
    resetControlState,
    adapter
  } = options

  await executeJoinRoomWorkflow({
    roomId,
    userName,
    selfId,
    currentSession,
    userAgent,
    loadCredentials,
    resetControlState,
    applyJoinRuntime: (runtime) => {
      adapter.roomId = roomId
      adapter.userName = userName
      adapter.announceStartTime = runtime.announceStartTime
      adapter.topic = runtime.topic
      adapter.localPlatform = runtime.localPlatform
    },
    currentBroadcastChannel: adapter.broadcastChannel,
    setBroadcastChannel: (channel) => {
      adapter.broadcastChannel = channel
    },
    getSessionId: () => adapter.sessionId,
    onSignalMessage: (data) => {
      adapter.handleSignalingMessage(data)
    },
    onMqttReconnect: () => {
      adapter.announceStartTime = Date.now()
      adapter.broadcastAnnounce()
      if (adapter.getHealthyPeerCount() === 0) {
        adapter.startAnnounceInterval()
      }
    },
    onMqttConnectionError: (error) => {
      adapter.onError(error, 'mqtt-connection')
    },
    setMqtt: (mqtt) => {
      adapter.mqtt = mqtt
    },
    updateSignalingState: (state) => {
      adapter.updateSignalingState(state)
    },
    onMqttUnavailable: () => {
      handleMqttUnavailableJoin({
        updateSignalingState: (state) => {
          adapter.updateSignalingState(state)
        }
      })
    },
    startPresenceLoops: (session) => {
      startJoinPresenceLoops({
        currentSession: session,
        getSessionId: () => adapter.sessionId,
        broadcastAnnounce: () => adapter.broadcastAnnounce(),
        startAnnounceInterval: () => adapter.startAnnounceInterval(),
        startHeartbeat: () => adapter.startHeartbeat()
      })
    },
    getMqttStatus: () => ({
      connected: adapter.mqtt?.isConnected() || false,
      brokerCount: adapter.mqtt?.getConnectedCount() || 0
    })
  })
}
