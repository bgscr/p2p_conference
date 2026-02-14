import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getIceServers,
  getMqttBrokers,
  loadCredentials,
  resetCredentialsCacheForTesting
} from '../renderer/signaling/services/credentials'

describe('credentials service', () => {
  beforeEach(() => {
    resetCredentialsCacheForTesting()
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      writable: true,
      configurable: true
    })
  })

  it('loads credentials via secure session API when available', async () => {
    const getSessionCredentials = vi.fn().mockResolvedValue({
      iceServers: [{ urls: 'stun:secure.example.com:3478' }],
      mqttBrokers: [{ url: 'wss://mqtt.secure.example.com/mqtt', username: 'user', password: 'secret' }],
      source: 'endpoint'
    })

    Object.defineProperty(window, 'electronAPI', {
      value: { getSessionCredentials },
      writable: true,
      configurable: true
    })

    await loadCredentials()

    expect(getSessionCredentials).toHaveBeenCalledTimes(1)
    expect(getIceServers()).toEqual([{ urls: 'stun:secure.example.com:3478' }])
    expect(getMqttBrokers()).toEqual([
      { url: 'wss://mqtt.secure.example.com/mqtt', username: 'user', password: 'secret' }
    ])
  })

  it('fails closed when secure session API call fails', async () => {
    const getSessionCredentials = vi.fn().mockRejectedValue(new Error('secure-source-unavailable'))
    const getICEServers = vi.fn().mockResolvedValue([{ urls: 'stun:legacy.example.com:3478' }])
    const getMQTTBrokers = vi.fn().mockResolvedValue([{ url: 'wss://legacy.example.com/mqtt' }])

    Object.defineProperty(window, 'electronAPI', {
      value: {
        getSessionCredentials,
        getICEServers,
        getMQTTBrokers
      },
      writable: true,
      configurable: true
    })

    await expect(loadCredentials()).rejects.toThrow('secure-source-unavailable')
    expect(getICEServers).not.toHaveBeenCalled()
    expect(getMQTTBrokers).not.toHaveBeenCalled()
  })

  it('fails closed when secure session payload is incomplete', async () => {
    const getSessionCredentials = vi.fn().mockResolvedValue({
      iceServers: [{ urls: 'stun:only-ice.example.com:3478' }],
      mqttBrokers: []
    })

    Object.defineProperty(window, 'electronAPI', {
      value: { getSessionCredentials },
      writable: true,
      configurable: true
    })

    await expect(loadCredentials()).rejects.toThrow('missing required ICE/MQTT')
  })

  it('uses legacy preload APIs when session API is unavailable', async () => {
    const getICEServers = vi.fn().mockResolvedValue([{ urls: 'stun:legacy.example.com:3478' }])
    const getMQTTBrokers = vi.fn().mockResolvedValue([{ url: 'wss://legacy.example.com/mqtt' }])

    Object.defineProperty(window, 'electronAPI', {
      value: {
        getICEServers,
        getMQTTBrokers
      },
      writable: true,
      configurable: true
    })

    await expect(loadCredentials()).resolves.toBeUndefined()

    expect(getICEServers).toHaveBeenCalledTimes(1)
    expect(getMQTTBrokers).toHaveBeenCalledTimes(1)
    expect(getIceServers()).toEqual([{ urls: 'stun:legacy.example.com:3478' }])
    expect(getMqttBrokers()).toEqual([{ url: 'wss://legacy.example.com/mqtt' }])
  })

  it('returns the same in-flight promise for concurrent calls', async () => {
    const getSessionCredentials = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 1))
      return {
        iceServers: [{ urls: 'stun:secure.example.com:3478' }],
        mqttBrokers: [{ url: 'wss://mqtt.secure.example.com/mqtt' }]
      }
    })

    Object.defineProperty(window, 'electronAPI', {
      value: { getSessionCredentials },
      writable: true,
      configurable: true
    })

    const first = loadCredentials()
    const second = loadCredentials()

    await Promise.all([first, second])
    expect(getSessionCredentials).toHaveBeenCalledTimes(1)
  })

  it('restores default credentials after reset helper is invoked', async () => {
    const getSessionCredentials = vi.fn().mockResolvedValue({
      iceServers: [{ urls: 'stun:custom.example.com:3478' }],
      mqttBrokers: [{ url: 'wss://custom.example.com/mqtt', username: 'custom-user' }]
    })

    Object.defineProperty(window, 'electronAPI', {
      value: { getSessionCredentials },
      writable: true,
      configurable: true
    })

    await loadCredentials()
    expect(getIceServers()).toEqual([{ urls: 'stun:custom.example.com:3478' }])
    expect(getMqttBrokers()).toEqual([{ url: 'wss://custom.example.com/mqtt', username: 'custom-user' }])

    resetCredentialsCacheForTesting()
    expect(getIceServers()).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ])
    expect(getMqttBrokers()).toEqual([
      { url: 'wss://broker.emqx.io:8084/mqtt' },
      { url: 'wss://broker-cn.emqx.io:8084/mqtt' },
      { url: 'wss://test.mosquitto.org:8081/mqtt' }
    ])
  })
})
