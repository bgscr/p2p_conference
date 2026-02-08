/**
 * @vitest-environment jsdom
 */

/**
 * Tests for barrel (index.ts) file exports
 *
 * Covers:
 * - src/renderer/utils/index.ts
 * - src/renderer/hooks/index.ts
 * - src/renderer/signaling/index.ts
 * - src/renderer/components/index.ts
 *
 * These barrel files re-export from their respective modules.
 * We mock heavy dependencies to keep these tests fast and focused on verifying
 * that the barrel files correctly re-export all expected symbols.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock heavy dependencies that components/hooks/signaling pull in
vi.mock('../renderer/audio-processor/AudioPipeline', () => ({
  getAudioPipeline: vi.fn(),
  AudioPipeline: vi.fn(),
}))

vi.mock('../renderer/signaling/SimplePeerManager', () => ({
  SimplePeerManager: vi.fn().mockImplementation(() => ({
    join: vi.fn(),
    leave: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  })),
  peerManager: {
    join: vi.fn(),
    leave: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isConnected: vi.fn(),
  },
  selfId: 'mock-self-id',
  generatePeerId: vi.fn().mockReturnValue('mock-peer-id'),
  loadCredentials: vi.fn(),
}))

vi.mock('../renderer/signaling/connectionStats', () => ({
  calculateConnectionStats: vi.fn(),
}))

vi.mock('../renderer/signaling/opus', () => ({
  configureOpusSdp: vi.fn(),
}))

describe('Barrel exports - utils/index.ts', () => {
  it('should re-export Logger symbols', async () => {
    const utils = await import('../renderer/utils/index')

    expect(utils.logger).toBeDefined()
    expect(typeof utils.logger.getLogs).toBe('function')
    expect(typeof utils.logger.clearLogs).toBe('function')
    expect(typeof utils.logger.downloadLogs).toBe('function')
    expect(typeof utils.logger.getLogsAsText).toBe('function')
    expect(typeof utils.logger.setLogLevel).toBe('function')
    expect(typeof utils.logger.createModuleLogger).toBe('function')
    expect(typeof utils.logger.getSystemInfo).toBe('function')
    expect(typeof utils.logger.logSystemInfo).toBe('function')
    expect(typeof utils.logger.openLogsFolder).toBe('function')
    expect(typeof utils.logger.getLogsDir).toBe('function')
  })

  it('should re-export pre-defined module loggers', async () => {
    const utils = await import('../renderer/utils/index')

    expect(utils.AppLog).toBeDefined()
    expect(utils.MediaLog).toBeDefined()
    expect(utils.RoomLog).toBeDefined()
    expect(utils.PeerLog).toBeDefined()
    expect(utils.SignalingLog).toBeDefined()
    expect(utils.AudioLog).toBeDefined()
    expect(utils.UILog).toBeDefined()

    // Each module logger should have debug/info/warn/error methods
    for (const log of [utils.AppLog, utils.MediaLog, utils.RoomLog, utils.PeerLog, utils.SignalingLog, utils.AudioLog, utils.UILog]) {
      expect(typeof log.debug).toBe('function')
      expect(typeof log.info).toBe('function')
      expect(typeof log.warn).toBe('function')
      expect(typeof log.error).toBe('function')
    }
  })

  it('should re-export i18n symbols', async () => {
    const utils = await import('../renderer/utils/index')

    expect(utils.i18n).toBeDefined()
    expect(typeof utils.i18n.t).toBe('function')
    expect(typeof utils.i18n.getLanguage).toBe('function')
    expect(typeof utils.i18n.setLanguage).toBe('function')
    expect(typeof utils.i18n.getAvailableLanguages).toBe('function')
    expect(typeof utils.i18n.subscribe).toBe('function')

    // The standalone t function
    expect(typeof utils.t).toBe('function')
  })
})

describe('Barrel exports - hooks/index.ts', () => {
  it('should re-export useI18n hook', async () => {
    const hooks = await import('../renderer/hooks/index')

    expect(hooks.useI18n).toBeDefined()
    expect(typeof hooks.useI18n).toBe('function')
  })

  it('should re-export useRoom hook and constants', async () => {
    const hooks = await import('../renderer/hooks/index')

    expect(hooks.useRoom).toBeDefined()
    expect(typeof hooks.useRoom).toBe('function')

    expect(hooks.selfId).toBeDefined()
  })

  it('should re-export useMediaStream hook', async () => {
    const hooks = await import('../renderer/hooks/index')

    expect(hooks.useMediaStream).toBeDefined()
    expect(typeof hooks.useMediaStream).toBe('function')
  })

  it('should re-export usePeerConnections hook', async () => {
    const hooks = await import('../renderer/hooks/index')

    expect(hooks.usePeerConnections).toBeDefined()
    expect(typeof hooks.usePeerConnections).toBe('function')
  })
})

describe('Barrel exports - signaling/index.ts', () => {
  it('should re-export SimplePeerManager class', async () => {
    const signaling = await import('../renderer/signaling/index')

    expect(signaling.SimplePeerManager).toBeDefined()
  })

  it('should re-export peerManager instance', async () => {
    const signaling = await import('../renderer/signaling/index')

    expect(signaling.peerManager).toBeDefined()
  })

  it('should re-export selfId', async () => {
    const signaling = await import('../renderer/signaling/index')

    expect(signaling.selfId).toBeDefined()
  })

  it('should re-export generatePeerId', async () => {
    const signaling = await import('../renderer/signaling/index')

    expect(signaling.generatePeerId).toBeDefined()
    expect(typeof signaling.generatePeerId).toBe('function')
  })

  it('should re-export loadCredentials', async () => {
    const signaling = await import('../renderer/signaling/index')

    expect(signaling.loadCredentials).toBeDefined()
    expect(typeof signaling.loadCredentials).toBe('function')
  })
})

describe('Barrel exports - components/index.ts', () => {
  it('should re-export LobbyView component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.LobbyView).toBeDefined()
  })

  it('should re-export RoomView component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.RoomView).toBeDefined()
  })

  it('should re-export ParticipantCard component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.ParticipantCard).toBeDefined()
  })

  it('should re-export DeviceSelector component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.DeviceSelector).toBeDefined()
  })

  it('should re-export AudioMeter component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.AudioMeter).toBeDefined()
  })

  it('should re-export SettingsPanel component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.SettingsPanel).toBeDefined()
  })

  it('should re-export ConnectionOverlay component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.ConnectionOverlay).toBeDefined()
  })

  it('should re-export ErrorBanner component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.ErrorBanner).toBeDefined()
  })

  it('should re-export Toast component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.Toast).toBeDefined()
  })

  it('should re-export LeaveConfirmDialog component', async () => {
    const components = await import('../renderer/components/index')

    expect(components.LeaveConfirmDialog).toBeDefined()
  })
})
