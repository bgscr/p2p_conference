/**
 * Credentials Manager
 *
 * Security model:
 * - Development: can fall back to public infrastructure.
 * - Production: requires secure credentials from env or endpoint.
 */

export interface ICEServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface MQTTBrokerConfig {
  url: string
  username?: string
  password?: string
}

export interface SessionCredentials {
  iceServers: ICEServerConfig[]
  mqttBrokers: MQTTBrokerConfig[]
  source: 'endpoint' | 'env' | 'fallback'
  fetchedAt: number
  expiresAt?: number
}

export interface CredentialRuntimeSnapshot {
  hasCachedSession: boolean
  source: SessionCredentials['source'] | null
  fetchedAt: number | null
  expiresAt: number | null
  expiresInMs: number | null
  cacheStatus: 'missing' | 'fresh' | 'stale' | 'expired'
  inFlight: boolean
  cacheSkewMs: number
  lastFetchAttemptAt: number | null
  lastFetchSuccessAt: number | null
  lastFetchError: string | null
}

interface CredentialRuntimeOptions {
  isProduction: boolean
  enforceSecureProduction: boolean
  cacheSkewMs: number
}

interface CredentialEndpointResponse {
  iceServers?: ICEServerConfig[]
  mqttBrokers?: MQTTBrokerConfig[]
  expiresAt?: number | string
  ttlSeconds?: number
}

const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun.cloudflare.com:3478'
]

const PUBLIC_MQTT_BROKERS: MQTTBrokerConfig[] = [
  { url: 'wss://broker.emqx.io:8084/mqtt' },
  { url: 'wss://broker-cn.emqx.io:8084/mqtt' },
  { url: 'wss://test.mosquitto.org:8081/mqtt' }
]

const DEFAULT_OPTIONS: CredentialRuntimeOptions = {
  isProduction: process.env.NODE_ENV === 'production',
  enforceSecureProduction: true,
  cacheSkewMs: 60_000
}

let runtimeOptions: CredentialRuntimeOptions = { ...DEFAULT_OPTIONS }
let cachedSession: SessionCredentials | null = null
let inFlightSessionPromise: Promise<SessionCredentials> | null = null
let lastFetchAttemptAt: number | null = null
let lastFetchSuccessAt: number | null = null
let lastFetchError: string | null = null

function parseUrlList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 10_000_000_000) return value // already ms
    if (value > 0) return value * 1000 // seconds
    return undefined
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

function normalizeIceServers(candidate: unknown): ICEServerConfig[] {
  if (!Array.isArray(candidate)) return []
  return candidate
    .filter((entry): entry is ICEServerConfig => {
      if (!entry || typeof entry !== 'object') return false
      const urls = (entry as ICEServerConfig).urls
      if (typeof urls === 'string') return urls.length > 0
      if (Array.isArray(urls)) return urls.length > 0 && urls.every(url => typeof url === 'string' && url.length > 0)
      return false
    })
    .map(entry => ({
      urls: entry.urls,
      username: entry.username,
      credential: entry.credential
    }))
}

function normalizeMqttBrokers(candidate: unknown): MQTTBrokerConfig[] {
  if (!Array.isArray(candidate)) return []
  return candidate
    .filter((entry): entry is MQTTBrokerConfig => {
      if (!entry || typeof entry !== 'object') return false
      return typeof (entry as MQTTBrokerConfig).url === 'string' && (entry as MQTTBrokerConfig).url.length > 0
    })
    .map(entry => ({
      url: entry.url,
      username: entry.username,
      password: entry.password
    }))
}

function buildBaseIceServers(): ICEServerConfig[] {
  return STUN_SERVERS.map(url => ({ urls: url }))
}

function buildBaseMqttBrokers(): MQTTBrokerConfig[] {
  return [...PUBLIC_MQTT_BROKERS]
}

function buildEnvCredentialSession(): SessionCredentials | null {
  const now = Date.now()

  const turnUrls = parseUrlList(process.env.TURN_URLS)
  const turnUsername = process.env.TURN_USERNAME?.trim()
  const turnCredential = process.env.TURN_CREDENTIAL?.trim()

  const mqttPrivateUrl = process.env.MQTT_PRIVATE_URL?.trim()
  const mqttPrivateUsername = process.env.MQTT_PRIVATE_USERNAME?.trim()
  const mqttPrivatePassword = process.env.MQTT_PRIVATE_PASSWORD?.trim()

  const iceServers = buildBaseIceServers()
  const mqttBrokers = buildBaseMqttBrokers()

  let hasSecureMaterial = false

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential
    })
    hasSecureMaterial = true
  }

  if (mqttPrivateUrl && mqttPrivateUsername && mqttPrivatePassword) {
    mqttBrokers.unshift({
      url: mqttPrivateUrl,
      username: mqttPrivateUsername,
      password: mqttPrivatePassword
    })
    hasSecureMaterial = true
  }

  if (!hasSecureMaterial) {
    return null
  }

  const expiresAt = normalizeEpochMs(process.env.CREDENTIALS_EXPIRES_AT)
  return {
    iceServers,
    mqttBrokers,
    source: 'env',
    fetchedAt: now,
    expiresAt
  }
}

function buildFallbackSession(): SessionCredentials {
  return {
    iceServers: buildBaseIceServers(),
    mqttBrokers: buildBaseMqttBrokers(),
    source: 'fallback',
    fetchedAt: Date.now()
  }
}

function hasSecureCredentialMaterial(session: SessionCredentials): boolean {
  const hasTurnCredential = session.iceServers.some(server =>
    (server.urls.toString().startsWith('turn:') || server.urls.toString().includes('turn:')) &&
    Boolean(server.username && server.credential)
  )

  const hasPrivateMqttCredential = session.mqttBrokers.some(broker =>
    Boolean(broker.username && broker.password)
  )

  return hasTurnCredential || hasPrivateMqttCredential || session.source === 'endpoint'
}

function validateProductionSession(session: SessionCredentials): void {
  if (!runtimeOptions.isProduction || !runtimeOptions.enforceSecureProduction) {
    return
  }

  if (!hasSecureCredentialMaterial(session)) {
    throw new Error(
      'Secure credentials are required in production. Configure TURN/MQTT env credentials or set P2P_CREDENTIALS_URL.'
    )
  }
}

async function fetchSessionCredentialsFromEndpoint(): Promise<SessionCredentials | null> {
  const endpoint = process.env.P2P_CREDENTIALS_URL?.trim()
  if (!endpoint) {
    return null
  }

  const headers: Record<string, string> = {}
  const bearerToken = process.env.P2P_CREDENTIALS_BEARER_TOKEN?.trim()
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`
  }

  const response = await fetch(endpoint, {
    method: 'GET',
    headers
  })

  if (!response.ok) {
    throw new Error(`Credentials endpoint request failed (${response.status})`)
  }

  const payload = await response.json() as CredentialEndpointResponse
  const now = Date.now()

  const iceServers = normalizeIceServers(payload.iceServers)
  const mqttBrokers = normalizeMqttBrokers(payload.mqttBrokers)

  if (iceServers.length === 0 || mqttBrokers.length === 0) {
    throw new Error('Credentials endpoint returned an invalid payload.')
  }

  const expiresAtFromPayload = normalizeEpochMs(payload.expiresAt)
  const expiresAtFromTtl = typeof payload.ttlSeconds === 'number' && payload.ttlSeconds > 0
    ? now + payload.ttlSeconds * 1000
    : undefined

  return {
    iceServers,
    mqttBrokers,
    source: 'endpoint',
    fetchedAt: now,
    expiresAt: expiresAtFromPayload ?? expiresAtFromTtl
  }
}

function shouldUseCachedSession(session: SessionCredentials): boolean {
  if (!session.expiresAt) return true
  return session.expiresAt - runtimeOptions.cacheSkewMs > Date.now()
}

function getCacheStatus(session: SessionCredentials | null, now: number): CredentialRuntimeSnapshot['cacheStatus'] {
  if (!session) return 'missing'
  if (!session.expiresAt) return 'fresh'
  if (session.expiresAt <= now) return 'expired'
  if (session.expiresAt - runtimeOptions.cacheSkewMs <= now) return 'stale'
  return 'fresh'
}

/**
 * Configures runtime behavior from electron/main during boot.
 */
export function configureCredentialRuntime(options: Partial<CredentialRuntimeOptions>): void {
  runtimeOptions = {
    ...runtimeOptions,
    ...options
  }
}

/**
 * Clears cache (primarily for tests).
 */
export function resetCredentialCacheForTesting(): void {
  cachedSession = null
  inFlightSessionPromise = null
  lastFetchAttemptAt = null
  lastFetchSuccessAt = null
  lastFetchError = null
  runtimeOptions = { ...DEFAULT_OPTIONS }
}

/**
 * Returns the full session credentials with caching and TTL-aware refresh.
 */
export async function getSessionCredentials(forceRefresh: boolean = false): Promise<SessionCredentials> {
  if (!forceRefresh && cachedSession && shouldUseCachedSession(cachedSession)) {
    return cachedSession
  }

  if (!forceRefresh && inFlightSessionPromise) {
    return inFlightSessionPromise
  }

  inFlightSessionPromise = (async () => {
    lastFetchAttemptAt = Date.now()
    let endpointFailure: string | null = null
    let resolvedSession: SessionCredentials | null = null

    try {
      resolvedSession = await fetchSessionCredentialsFromEndpoint()
    } catch (err) {
      endpointFailure = String(err)
      resolvedSession = null
    }

    if (!resolvedSession) {
      resolvedSession = buildEnvCredentialSession()
    }

    if (!resolvedSession) {
      resolvedSession = buildFallbackSession()
    }

    validateProductionSession(resolvedSession)
    cachedSession = resolvedSession
    lastFetchSuccessAt = Date.now()
    lastFetchError = endpointFailure
    return resolvedSession
  })()

  try {
    return await inFlightSessionPromise
  } catch (err) {
    lastFetchError = String(err)
    throw err
  } finally {
    inFlightSessionPromise = null
  }
}

/**
 * Returns redacted credential runtime state for health and diagnostics.
 */
export function getCredentialRuntimeSnapshot(now: number = Date.now()): CredentialRuntimeSnapshot {
  const expiresAt = cachedSession?.expiresAt ?? null
  return {
    hasCachedSession: Boolean(cachedSession),
    source: cachedSession?.source ?? null,
    fetchedAt: cachedSession?.fetchedAt ?? null,
    expiresAt,
    expiresInMs: expiresAt == null ? null : Math.max(expiresAt - now, 0),
    cacheStatus: getCacheStatus(cachedSession, now),
    inFlight: inFlightSessionPromise != null,
    cacheSkewMs: runtimeOptions.cacheSkewMs,
    lastFetchAttemptAt,
    lastFetchSuccessAt,
    lastFetchError
  }
}

/**
 * Backward-compatible sync API for existing renderer calls.
 */
export function getICEServers(): ICEServerConfig[] {
  if (cachedSession) {
    return cachedSession.iceServers
  }

  const envSession = buildEnvCredentialSession()
  if (envSession) {
    return envSession.iceServers
  }

  return buildFallbackSession().iceServers
}

/**
 * Backward-compatible sync API for existing renderer calls.
 */
export function getMQTTBrokers(): MQTTBrokerConfig[] {
  if (cachedSession) {
    return cachedSession.mqttBrokers
  }

  const envSession = buildEnvCredentialSession()
  if (envSession) {
    return envSession.mqttBrokers
  }

  return buildFallbackSession().mqttBrokers
}

/**
 * Validates startup credential posture.
 */
export function validateCredentialConfiguration(): { ok: boolean; message: string } {
  try {
    const validationErrors: string[] = []
    const hasEndpoint = hasText(process.env.P2P_CREDENTIALS_URL)
    const hasBearerToken = hasText(process.env.P2P_CREDENTIALS_BEARER_TOKEN)

    if (hasEndpoint) {
      let parsedEndpoint: URL | null = null
      try {
        parsedEndpoint = new URL(process.env.P2P_CREDENTIALS_URL!.trim())
      } catch {
        validationErrors.push('P2P_CREDENTIALS_URL must be a valid URL.')
      }

      if (parsedEndpoint && runtimeOptions.isProduction && runtimeOptions.enforceSecureProduction && parsedEndpoint.protocol !== 'https:') {
        validationErrors.push('P2P_CREDENTIALS_URL must use https in production secure mode.')
      }
    } else if (hasBearerToken) {
      validationErrors.push('P2P_CREDENTIALS_BEARER_TOKEN is set but P2P_CREDENTIALS_URL is missing.')
    }

    const turnUrlsSet = hasText(process.env.TURN_URLS)
    const turnUserSet = hasText(process.env.TURN_USERNAME)
    const turnCredentialSet = hasText(process.env.TURN_CREDENTIAL)
    const turnFieldsConfigured = [turnUrlsSet, turnUserSet, turnCredentialSet].filter(Boolean).length
    if (turnFieldsConfigured > 0 && turnFieldsConfigured < 3) {
      validationErrors.push('TURN credentials are incomplete. Set TURN_URLS, TURN_USERNAME, and TURN_CREDENTIAL together.')
    }
    if (turnUrlsSet && parseUrlList(process.env.TURN_URLS).length === 0) {
      validationErrors.push('TURN_URLS must contain at least one valid URL.')
    }

    const mqttUrlSet = hasText(process.env.MQTT_PRIVATE_URL)
    const mqttUserSet = hasText(process.env.MQTT_PRIVATE_USERNAME)
    const mqttPasswordSet = hasText(process.env.MQTT_PRIVATE_PASSWORD)
    const mqttFieldsConfigured = [mqttUrlSet, mqttUserSet, mqttPasswordSet].filter(Boolean).length
    if (mqttFieldsConfigured > 0 && mqttFieldsConfigured < 3) {
      validationErrors.push('Private MQTT credentials are incomplete. Set MQTT_PRIVATE_URL, MQTT_PRIVATE_USERNAME, and MQTT_PRIVATE_PASSWORD together.')
    }
    if (mqttUrlSet) {
      try {
        const parsedMqttUrl = new URL(process.env.MQTT_PRIVATE_URL!.trim())
        if (runtimeOptions.isProduction && runtimeOptions.enforceSecureProduction && parsedMqttUrl.protocol !== 'wss:') {
          validationErrors.push('MQTT_PRIVATE_URL must use wss in production secure mode.')
        }
      } catch {
        validationErrors.push('MQTT_PRIVATE_URL must be a valid URL.')
      }
    }

    if (hasText(process.env.CREDENTIALS_EXPIRES_AT) && normalizeEpochMs(process.env.CREDENTIALS_EXPIRES_AT) == null) {
      validationErrors.push('CREDENTIALS_EXPIRES_AT must be a valid unix epoch (seconds/ms) or ISO datetime.')
    }

    const envSession = buildEnvCredentialSession()
    if (runtimeOptions.isProduction && runtimeOptions.enforceSecureProduction) {
      if (!process.env.P2P_CREDENTIALS_URL && !envSession) {
        validationErrors.push('Production requires secure credentials. Set P2P_CREDENTIALS_URL or TURN/MQTT credential env vars.')
      }
    }

    if (validationErrors.length > 0) {
      return {
        ok: false,
        message: validationErrors.join(' ')
      }
    }

    return { ok: true, message: 'Credential configuration is valid.' }
  } catch (err) {
    return { ok: false, message: String(err) }
  }
}

/**
 * Generate time-limited TURN credentials using Coturn REST API style auth.
 */
export function generateTURNCredentials(
  sharedSecret: string,
  username: string,
  ttl: number = 86400
): { username: string; credential: string } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto')

  const timestamp = Math.floor(Date.now() / 1000) + ttl
  const turnUsername = `${timestamp}:${username}`

  const hmac = crypto.createHmac('sha1', sharedSecret)
  hmac.update(turnUsername)
  const credential = hmac.digest('base64')

  return { username: turnUsername, credential }
}
