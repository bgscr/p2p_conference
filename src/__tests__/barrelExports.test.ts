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
 * These tests use static imports which are more reliable than dynamic imports
 * and verify that all expected symbols are correctly re-exported from barrel files.
 */

import { describe, it, expect } from 'vitest'

import * as components from '../renderer/components'
import * as hooks from '../renderer/hooks'
import * as signaling from '../renderer/signaling'
import * as utils from '../renderer/utils'

describe('Barrel exports - components/index.ts', () => {
  it('exports all expected components', () => {
    expect(components.LobbyView).toBeDefined()
    expect(components.RoomView).toBeDefined()
    expect(components.ParticipantCard).toBeDefined()
    expect(components.SettingsPanel).toBeDefined()
    expect(components.DeviceSelector).toBeDefined()
    expect(components.AudioMeter).toBeDefined()
    expect(components.ConnectionOverlay).toBeDefined()
    expect(components.ErrorBanner).toBeDefined()
    expect(components.Toast).toBeDefined()
    expect(components.LeaveConfirmDialog).toBeDefined()
    expect(components.ChatPanel).toBeDefined()
  })
})

describe('Barrel exports - hooks/index.ts', () => {
  it('exports all expected hooks', () => {
    expect(hooks.useRoom).toBeDefined()
    expect(typeof hooks.useRoom).toBe('function')

    expect(hooks.useMediaStream).toBeDefined()
    expect(typeof hooks.useMediaStream).toBe('function')

    expect(hooks.useI18n).toBeDefined()
    expect(typeof hooks.useI18n).toBe('function')

    expect(hooks.useScreenShare).toBeDefined()
    expect(typeof hooks.useScreenShare).toBe('function')

    expect(hooks.useDataChannel).toBeDefined()
    expect(typeof hooks.useDataChannel).toBe('function')
  })

  it('exports selfId constant', () => {
    expect(hooks.selfId).toBeDefined()
    expect(typeof hooks.selfId).toBe('string')
  })
})

describe('Barrel exports - signaling/index.ts', () => {
  it('exports signaling utilities', () => {
    expect(signaling.SimplePeerManager).toBeDefined()
    expect(signaling.peerManager).toBeDefined()
    expect(signaling.generatePeerId).toBeDefined()
    expect(typeof signaling.generatePeerId).toBe('function')
  })

  it('exports selfId constant', () => {
    expect(signaling.selfId).toBeDefined()
    expect(typeof signaling.selfId).toBe('string')
  })

  it('exports loadCredentials function', () => {
    expect(signaling.loadCredentials).toBeDefined()
    expect(typeof signaling.loadCredentials).toBe('function')
  })
})

describe('Barrel exports - utils/index.ts', () => {
  it('exports logger with expected methods', () => {
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

  it('exports pre-defined module loggers', () => {
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

  it('exports i18n with expected methods', () => {
    expect(utils.i18n).toBeDefined()
    expect(typeof utils.i18n.t).toBe('function')
    expect(typeof utils.i18n.getLanguage).toBe('function')
    expect(typeof utils.i18n.setLanguage).toBe('function')
    expect(typeof utils.i18n.getAvailableLanguages).toBe('function')
    expect(typeof utils.i18n.subscribe).toBe('function')
  })

  it('exports standalone t function', () => {
    expect(typeof utils.t).toBe('function')
  })
})
