import { SignalingLog } from '../../utils/Logger'

export interface BrokerConfig {
  url: string
  username?: string
  password?: string
}

interface SessionCredentialsPayload {
  iceServers?: RTCIceServer[]
  mqttBrokers?: BrokerConfig[]
  source?: string
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

const DEFAULT_MQTT_BROKERS: BrokerConfig[] = [
  { url: 'wss://broker.emqx.io:8084/mqtt' },
  { url: 'wss://broker-cn.emqx.io:8084/mqtt' },
  { url: 'wss://test.mosquitto.org:8081/mqtt' }
]

let iceServers: RTCIceServer[] = [...DEFAULT_ICE_SERVERS]
const mqttBrokers: BrokerConfig[] = [...DEFAULT_MQTT_BROKERS]

let credentialsLoaded = false
let credentialsLoadPromise: Promise<void> | null = null

function replaceMqttBrokers(nextBrokers: BrokerConfig[]) {
  mqttBrokers.length = 0
  nextBrokers.forEach((broker) => {
    mqttBrokers.push({
      url: broker.url,
      username: broker.username,
      password: broker.password
    })
  })
}

export function getIceServers(): RTCIceServer[] {
  return iceServers
}

export function getMqttBrokers(): BrokerConfig[] {
  return mqttBrokers
}

export function resetCredentialsCacheForTesting() {
  credentialsLoaded = false
  credentialsLoadPromise = null
  iceServers = [...DEFAULT_ICE_SERVERS]
  replaceMqttBrokers(DEFAULT_MQTT_BROKERS)
}

function hasSessionCredentialApi(
  api: Window['electronAPI'] | undefined
): api is Window['electronAPI'] & { getSessionCredentials: () => Promise<SessionCredentialsPayload> } {
  return Boolean(api && typeof api.getSessionCredentials === 'function')
}

function hasLegacyCredentialApi(
  api: Window['electronAPI'] | undefined
): api is Window['electronAPI'] & {
  getICEServers: () => Promise<RTCIceServer[] | null | undefined>
  getMQTTBrokers: () => Promise<BrokerConfig[] | null | undefined>
} {
  return Boolean(
    api &&
    typeof api.getICEServers === 'function' &&
    typeof api.getMQTTBrokers === 'function'
  )
}

function applySessionCredentials(sessionCredentials: SessionCredentialsPayload): void {
  const nextIceServers = Array.isArray(sessionCredentials.iceServers)
    ? sessionCredentials.iceServers
    : []
  const nextMqttBrokers = Array.isArray(sessionCredentials.mqttBrokers)
    ? sessionCredentials.mqttBrokers
    : []

  if (nextIceServers.length === 0 || nextMqttBrokers.length === 0) {
    throw new Error('Session credentials payload is missing required ICE/MQTT configuration')
  }

  iceServers = nextIceServers
  replaceMqttBrokers(nextMqttBrokers)

  SignalingLog.info('Credentials loaded (session credentials)', {
    iceCount: nextIceServers.length,
    brokerCount: nextMqttBrokers.length,
    source: sessionCredentials.source
  })
}

async function applyLegacyCredentials(api: Window['electronAPI'] & {
  getICEServers: () => Promise<RTCIceServer[] | null | undefined>
  getMQTTBrokers: () => Promise<BrokerConfig[] | null | undefined>
}): Promise<void> {
  const fallbackIceServers = await api.getICEServers()
  if (fallbackIceServers && fallbackIceServers.length > 0) {
    iceServers = fallbackIceServers
    SignalingLog.info('ICE servers loaded', { count: fallbackIceServers.length })
  }

  const fallbackMqttBrokers = await api.getMQTTBrokers()
  if (fallbackMqttBrokers && fallbackMqttBrokers.length > 0) {
    replaceMqttBrokers(fallbackMqttBrokers)
    SignalingLog.info('MQTT brokers loaded', { count: fallbackMqttBrokers.length })
  }
}

export async function loadCredentials(): Promise<void> {
  if (credentialsLoadPromise) {
    return credentialsLoadPromise
  }

  if (credentialsLoaded) {
    return
  }

  credentialsLoadPromise = (async () => {
    const electronApi = typeof window !== 'undefined' ? window.electronAPI : undefined
    const enforceSessionCredentials = hasSessionCredentialApi(electronApi)

    try {
      if (electronApi) {
        SignalingLog.info('Loading credentials from main process...')

        if (enforceSessionCredentials) {
          const sessionCredentials = await electronApi.getSessionCredentials()
          applySessionCredentials(sessionCredentials)
        } else if (hasLegacyCredentialApi(electronApi)) {
          await applyLegacyCredentials(electronApi)
        } else {
          SignalingLog.warn('Credential APIs are unavailable in preload bridge, using renderer fallback defaults')
        }

        credentialsLoaded = true
        SignalingLog.info('Credentials loaded successfully')
      } else {
        SignalingLog.warn('Not in Electron environment, using fallback STUN servers only')
      }
    } catch (err) {
      SignalingLog.error('Failed to load credentials', { error: String(err) })
      if (enforceSessionCredentials) {
        throw err instanceof Error ? err : new Error(String(err))
      }
    } finally {
      credentialsLoadPromise = null
    }
  })()

  return credentialsLoadPromise
}
