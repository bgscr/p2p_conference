import {
  attemptManagedNetworkReconnect,
  performNetworkReconnectFlowWithAdapter,
  type NetworkReconnectAttemptAdapter,
  type NetworkReconnectState
} from './networkReconnect'

interface AttemptSimplePeerManagerReconnectOptions {
  state: NetworkReconnectState
  getRoomId: () => string | null
  maxAttempts: number
  baseDelay: number
  performReconnectAttempt: () => Promise<boolean>
  onReconnectSuccess: () => void
  onReconnectFailure: (error: Error) => void
}

interface BuildSimplePeerManagerReconnectFlowAdapterOptions {
  mqtt: NetworkReconnectAttemptAdapter['mqtt']
  topic: string
  peers: NetworkReconnectAttemptAdapter['peers']
  onSignalMessage: (data: unknown) => void
  onRestartPeerDiscovery: () => void
  onAttemptIceRestart: (peerId: string) => void
}

interface RestartPeerDiscoveryAdapterOptions {
  setAnnounceStartTime: (value: number) => void
  broadcastAnnounce: () => void
  startAnnounceInterval: () => void
  now?: () => number
}

export function restartPeerDiscoveryWithAdapter(options: RestartPeerDiscoveryAdapterOptions): void {
  const {
    setAnnounceStartTime,
    broadcastAnnounce,
    startAnnounceInterval,
    now = () => Date.now()
  } = options

  setAnnounceStartTime(now())
  broadcastAnnounce()
  startAnnounceInterval()
}

export function buildSimplePeerManagerReconnectFlowAdapter(
  options: BuildSimplePeerManagerReconnectFlowAdapterOptions
): NetworkReconnectAttemptAdapter {
  const {
    mqtt,
    topic,
    peers,
    onSignalMessage,
    onRestartPeerDiscovery,
    onAttemptIceRestart
  } = options

  return {
    mqtt,
    topic,
    peers,
    onSignalMessage,
    restartPeerDiscovery: onRestartPeerDiscovery,
    attemptIceRestart: onAttemptIceRestart
  }
}

export async function performSimplePeerManagerReconnectAttempt(
  options: BuildSimplePeerManagerReconnectFlowAdapterOptions
): Promise<boolean> {
  return performNetworkReconnectFlowWithAdapter(
    buildSimplePeerManagerReconnectFlowAdapter(options)
  )
}

export async function attemptSimplePeerManagerReconnect(
  options: AttemptSimplePeerManagerReconnectOptions
): Promise<void> {
  const {
    state,
    getRoomId,
    maxAttempts,
    baseDelay,
    performReconnectAttempt,
    onReconnectSuccess,
    onReconnectFailure
  } = options

  await attemptManagedNetworkReconnect({
    state,
    getRoomId,
    maxAttempts,
    baseDelay,
    performReconnect: performReconnectAttempt,
    requestRetry: () => {
      void attemptSimplePeerManagerReconnect(options)
    },
    onReconnectSuccess,
    onReconnectFailure
  })
}
