import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

async function importCredentialsModule() {
  vi.resetModules()
  return await import('../credentials')
}

describe('Credentials Manager', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.P2P_CREDENTIALS_URL
    delete process.env.P2P_CREDENTIALS_BEARER_TOKEN
    delete process.env.CREDENTIALS_EXPIRES_AT
    delete process.env.TURN_URLS
    delete process.env.TURN_USERNAME
    delete process.env.TURN_CREDENTIAL
    delete process.env.MQTT_PRIVATE_URL
    delete process.env.MQTT_PRIVATE_USERNAME
    delete process.env.MQTT_PRIVATE_PASSWORD
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('returns fallback STUN/public MQTT in non-production when no secure credentials are configured', async () => {
    const credentials = await importCredentialsModule()
    credentials.configureCredentialRuntime({
      isProduction: false,
      enforceSecureProduction: true
    })

    const session = await credentials.getSessionCredentials()
    expect(session.source).toBe('fallback')
    expect(session.iceServers.some(server => String(server.urls).includes('stun'))).toBe(true)
    expect(session.mqttBrokers.length).toBeGreaterThan(0)
  })

  it('returns env-based secure credentials when TURN and MQTT private vars are provided', async () => {
    process.env.TURN_URLS = 'turn:turn.example.com:3478'
    process.env.TURN_USERNAME = 'turn-user'
    process.env.TURN_CREDENTIAL = 'turn-secret'
    process.env.MQTT_PRIVATE_URL = 'wss://mqtt.example.com/mqtt'
    process.env.MQTT_PRIVATE_USERNAME = 'mqtt-user'
    process.env.MQTT_PRIVATE_PASSWORD = 'mqtt-secret'

    const credentials = await importCredentialsModule()
    const session = await credentials.getSessionCredentials()

    expect(session.source).toBe('env')
    expect(session.iceServers.some(server => server.username === 'turn-user')).toBe(true)
    expect(session.mqttBrokers.some(broker => broker.url.includes('mqtt.example.com'))).toBe(true)
  })

  it('fails closed in production when only fallback credentials are available', async () => {
    const credentials = await importCredentialsModule()
    credentials.configureCredentialRuntime({
      isProduction: true,
      enforceSecureProduction: true
    })

    await expect(credentials.getSessionCredentials()).rejects.toThrow(
      'Secure credentials are required in production'
    )
  })

  it('reads secure credentials from endpoint with TTL and caches result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        iceServers: [{ urls: 'turn:turn.service:3478', username: 'u', credential: 'c' }],
        mqttBrokers: [{ url: 'wss://mqtt.service/mqtt', username: 'm', password: 'p' }],
        ttlSeconds: 120
      })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'

    const credentials = await importCredentialsModule()
    const first = await credentials.getSessionCredentials()
    const second = await credentials.getSessionCredentials()

    expect(first.source).toBe('endpoint')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
    expect(typeof first.expiresAt).toBe('number')
  })

  it('sends bearer token header and honors absolute expiresAt from endpoint payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        iceServers: [{ urls: ['turn:turn-a.example.com:3478'], username: 'u', credential: 'c' }],
        mqttBrokers: [{ url: 'wss://mqtt.example.com/mqtt', username: 'm', password: 'p' }],
        expiresAt: '2030-01-01T00:00:00.000Z'
      })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'
    process.env.P2P_CREDENTIALS_BEARER_TOKEN = 'token-123'

    const credentials = await importCredentialsModule()
    const session = await credentials.getSessionCredentials()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://credentials.service/session',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer token-123' }
      })
    )
    expect(session.expiresAt).toBe(Date.parse('2030-01-01T00:00:00.000Z'))
  })

  it('falls back to env credentials when endpoint fails or returns invalid payload', async () => {
    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'
    process.env.TURN_URLS = 'turn:turn1.example.com:3478, turn:turn2.example.com:3478'
    process.env.TURN_USERNAME = 'turn-user'
    process.env.TURN_CREDENTIAL = 'turn-secret'

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        iceServers: [{ urls: [] }],
        mqttBrokers: []
      })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const credentials = await importCredentialsModule()
    const first = await credentials.getSessionCredentials(true)
    const second = await credentials.getSessionCredentials(true)

    expect(first.source).toBe('env')
    expect(second.source).toBe('env')
    expect(first.iceServers.some(server => Array.isArray(server.urls) && server.urls.length === 2)).toBe(true)
  })

  it('refreshes expired endpoint cache based on cache skew and supports in-flight de-duplication', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'

    const responsePayload = {
      iceServers: [{ urls: 'turn:turn.service:3478', username: 'u', credential: 'c' }],
      mqttBrokers: [{ url: 'wss://mqtt.service/mqtt', username: 'm', password: 'p' }],
      ttlSeconds: 10
    }

    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => responsePayload
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const credentials = await importCredentialsModule()
    credentials.configureCredentialRuntime({
      isProduction: false,
      enforceSecureProduction: true,
      cacheSkewMs: 5000
    })

    const firstA = credentials.getSessionCredentials(true)
    const firstB = credentials.getSessionCredentials(false)
    await Promise.all([firstA, firstB])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:00:07.000Z'))
    await credentials.getSessionCredentials()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('exposes credential runtime snapshot across stale refresh and endpoint failure recovery', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'
      process.env.TURN_URLS = 'turn:turn-backup.example.com:3478'
      process.env.TURN_USERNAME = 'backup-user'
      process.env.TURN_CREDENTIAL = 'backup-secret'

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            iceServers: [{ urls: 'turn:turn.service:3478', username: 'u', credential: 'c' }],
            mqttBrokers: [{ url: 'wss://mqtt.service/mqtt', username: 'm', password: 'p' }],
            ttlSeconds: 30
          })
        })
        .mockRejectedValueOnce(new Error('network-down'))
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

      const credentials = await importCredentialsModule()
      credentials.configureCredentialRuntime({
        isProduction: false,
        enforceSecureProduction: true,
        cacheSkewMs: 10_000
      })

      const first = await credentials.getSessionCredentials(true)
      expect(first.source).toBe('endpoint')

      let snapshot = credentials.getCredentialRuntimeSnapshot()
      expect(snapshot.cacheStatus).toBe('fresh')
      expect(snapshot.source).toBe('endpoint')
      expect(snapshot.lastFetchError).toBeNull()

      vi.setSystemTime(new Date('2026-01-01T00:00:21.000Z'))
      snapshot = credentials.getCredentialRuntimeSnapshot()
      expect(snapshot.cacheStatus).toBe('stale')

      const refreshed = await credentials.getSessionCredentials()
      expect(refreshed.source).toBe('env')
      expect(fetchMock).toHaveBeenCalledTimes(2)

      snapshot = credentials.getCredentialRuntimeSnapshot()
      expect(snapshot.source).toBe('env')
      expect(snapshot.lastFetchError).toContain('network-down')
      expect(snapshot.lastFetchAttemptAt).not.toBeNull()
      expect(snapshot.lastFetchSuccessAt).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears runtime fetch error after a successful endpoint renewal', async () => {
    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'
    process.env.TURN_URLS = 'turn:turn-backup.example.com:3478'
    process.env.TURN_USERNAME = 'backup-user'
    process.env.TURN_CREDENTIAL = 'backup-secret'

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary-endpoint-outage'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          iceServers: [{ urls: 'turn:turn.service:3478', username: 'u', credential: 'c' }],
          mqttBrokers: [{ url: 'wss://mqtt.service/mqtt', username: 'm', password: 'p' }],
          ttlSeconds: 120
        })
      })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const credentials = await importCredentialsModule()
    const fallbackSession = await credentials.getSessionCredentials(true)
    expect(fallbackSession.source).toBe('env')
    expect(credentials.getCredentialRuntimeSnapshot().lastFetchError).toContain('temporary-endpoint-outage')

    const endpointSession = await credentials.getSessionCredentials(true)
    expect(endpointSession.source).toBe('endpoint')
    expect(credentials.getCredentialRuntimeSnapshot().lastFetchError).toBeNull()
  })

  it('reports in-flight refresh state while endpoint request is pending', async () => {
    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'

    let resolveFetch: unknown = null

    const fetchMock = vi.fn().mockImplementation(() => new Promise<unknown>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const credentials = await importCredentialsModule()
    const pending = credentials.getSessionCredentials(true)
    expect(credentials.getCredentialRuntimeSnapshot().inFlight).toBe(true)

    const fetchResolver = resolveFetch as ((value: unknown) => void) | null
    if (!fetchResolver) {
      throw new Error('Expected pending credential fetch resolver')
    }

    fetchResolver({
      ok: true,
      json: async () => ({
        iceServers: [{ urls: 'turn:turn.service:3478', username: 'u', credential: 'c' }],
        mqttBrokers: [{ url: 'wss://mqtt.service/mqtt', username: 'm', password: 'p' }],
        ttlSeconds: 60
      })
    })

    await pending
    expect(credentials.getCredentialRuntimeSnapshot().inFlight).toBe(false)
  })

  it('exposes backward-compatible sync getters from env cache path', async () => {
    process.env.TURN_URLS = 'turn:turn.example.com:3478'
    process.env.TURN_USERNAME = 'turn-user'
    process.env.TURN_CREDENTIAL = 'turn-secret'

    const credentials = await importCredentialsModule()
    const iceServers = credentials.getICEServers()
    const mqttBrokers = credentials.getMQTTBrokers()

    expect(iceServers.some(server => server.username === 'turn-user')).toBe(true)
    expect(Array.isArray(mqttBrokers)).toBe(true)
  })

  it('sync getters return cached session values after endpoint fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        iceServers: [{ urls: 'turn:cached.example.com:3478', username: 'u', credential: 'c' }],
        mqttBrokers: [{ url: 'wss://cached.example.com/mqtt', username: 'm', password: 'p' }],
        ttlSeconds: 120
      })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'

    const credentials = await importCredentialsModule()
    await credentials.getSessionCredentials()

    const iceServers = credentials.getICEServers()
    const mqttBrokers = credentials.getMQTTBrokers()

    expect(iceServers[0].urls).toBe('turn:cached.example.com:3478')
    expect(mqttBrokers[0].url).toBe('wss://cached.example.com/mqtt')
  })

  it('allows fallback credentials in production when enforcement is disabled', async () => {
    const credentials = await importCredentialsModule()
    credentials.configureCredentialRuntime({
      isProduction: true,
      enforceSecureProduction: false
    })

    const session = await credentials.getSessionCredentials()
    expect(session.source).toBe('fallback')
  })

  it('validates production configuration with endpoint or secure env material', async () => {
    const credentials = await importCredentialsModule()
    credentials.configureCredentialRuntime({
      isProduction: true,
      enforceSecureProduction: true
    })

    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'
    expect(credentials.validateCredentialConfiguration()).toEqual({
      ok: true,
      message: 'Credential configuration is valid.'
    })

    delete process.env.P2P_CREDENTIALS_URL
    process.env.TURN_URLS = 'turn:turn.example.com:3478'
    process.env.TURN_USERNAME = 'turn-user'
    process.env.TURN_CREDENTIAL = 'turn-secret'
    expect(credentials.validateCredentialConfiguration()).toEqual({
      ok: true,
      message: 'Credential configuration is valid.'
    })
  })

  it('fails validation for malformed endpoint and incomplete credential groups', async () => {
    const credentials = await importCredentialsModule()
    credentials.configureCredentialRuntime({
      isProduction: true,
      enforceSecureProduction: true
    })

    process.env.P2P_CREDENTIALS_URL = 'not-a-url'
    process.env.TURN_URLS = 'turn:turn.example.com:3478'
    process.env.MQTT_PRIVATE_URL = 'wss://mqtt.example.com/mqtt'
    process.env.MQTT_PRIVATE_USERNAME = 'mqtt-user'

    const result = credentials.validateCredentialConfiguration()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('P2P_CREDENTIALS_URL must be a valid URL.')
    expect(result.message).toContain('TURN credentials are incomplete.')
    expect(result.message).toContain('Private MQTT credentials are incomplete.')
  })

  it('requires secure transport protocols for endpoint and private MQTT in production secure mode', async () => {
    const credentials = await importCredentialsModule()
    credentials.configureCredentialRuntime({
      isProduction: true,
      enforceSecureProduction: true
    })

    process.env.P2P_CREDENTIALS_URL = 'http://credentials.service/session'
    process.env.MQTT_PRIVATE_URL = 'ws://mqtt.service/mqtt'
    process.env.MQTT_PRIVATE_USERNAME = 'mqtt-user'
    process.env.MQTT_PRIVATE_PASSWORD = 'mqtt-pass'

    const result = credentials.validateCredentialConfiguration()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('P2P_CREDENTIALS_URL must use https in production secure mode.')
    expect(result.message).toContain('MQTT_PRIVATE_URL must use wss in production secure mode.')
  })

  it('fails when bearer token is set without endpoint and when expiry format is invalid', async () => {
    const credentials = await importCredentialsModule()
    credentials.configureCredentialRuntime({
      isProduction: false,
      enforceSecureProduction: true
    })

    process.env.P2P_CREDENTIALS_BEARER_TOKEN = 'token-123'
    process.env.CREDENTIALS_EXPIRES_AT = 'definitely-not-a-date'

    const result = credentials.validateCredentialConfiguration()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('P2P_CREDENTIALS_BEARER_TOKEN is set but P2P_CREDENTIALS_URL is missing.')
    expect(result.message).toContain('CREDENTIALS_EXPIRES_AT must be a valid unix epoch (seconds/ms) or ISO datetime.')
  })

  it('normalizes numeric expiresAt payload values from endpoint (seconds vs milliseconds)', async () => {
    process.env.P2P_CREDENTIALS_URL = 'https://credentials.service/session'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          iceServers: [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }],
          mqttBrokers: [{ url: 'wss://mqtt.example.com/mqtt', username: 'm', password: 'p' }],
          expiresAt: 2000000000
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          iceServers: [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }],
          mqttBrokers: [{ url: 'wss://mqtt.example.com/mqtt', username: 'm', password: 'p' }],
          expiresAt: 2000000000000
        })
      })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    let credentials = await importCredentialsModule()
    let session = await credentials.getSessionCredentials(true)
    expect(session.expiresAt).toBe(2000000000 * 1000)

    credentials = await importCredentialsModule()
    session = await credentials.getSessionCredentials(true)
    expect(session.expiresAt).toBe(2000000000000)
  })

  it('generates TURN credentials with timestamp and base64 secret', async () => {
    const credentials = await importCredentialsModule()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

    const result = credentials.generateTURNCredentials('shared-secret', 'alice', 3600)
    expect(result.username).toMatch(/^\d+:alice$/)
    expect(result.credential).toMatch(/^[A-Za-z0-9+/=]+$/)

    vi.useRealTimers()
  })
})
