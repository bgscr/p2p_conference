/**
 * @vitest-environment jsdom
 */

/**
 * Tests for Logger renderer-side coverage gaps
 *
 * Covers lines 293-296 (openLogsFolder with electronAPI) and 307-310 (getLogsDir with electronAPI)
 * by dynamically importing Logger after setting up window.electronAPI
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('Logger with electronAPI available', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    delete (window as any).electronAPI
  })

  describe('openLogsFolder - with electronAPI (lines 293-296)', () => {
    it('should call electronAPI.openLogsFolder and return its result', async () => {
      const mockOpenLogsFolder = vi.fn().mockResolvedValue(true)
      ;(window as any).electronAPI = {
        log: vi.fn(),
        openLogsFolder: mockOpenLogsFolder,
        getLogsDir: vi.fn().mockResolvedValue('/some/path'),
      }

      // Dynamic import after setting electronAPI so hasElectronAPI is true
      const { logger } = await import('../renderer/utils/Logger')

      const result = await logger.openLogsFolder()

      expect(result).toBe(true)
      expect(mockOpenLogsFolder).toHaveBeenCalled()
    })

    it('should return false when electronAPI.openLogsFolder throws (catch block)', async () => {
      ;(window as any).electronAPI = {
        log: vi.fn(),
        openLogsFolder: vi.fn().mockRejectedValue(new Error('IPC failed')),
        getLogsDir: vi.fn(),
      }

      const { logger } = await import('../renderer/utils/Logger')

      const result = await logger.openLogsFolder()

      expect(result).toBe(false)
    })
  })

  describe('getLogsDir - with electronAPI (lines 307-310)', () => {
    it('should call electronAPI.getLogsDir and return the path', async () => {
      const mockGetLogsDir = vi.fn().mockResolvedValue('/app/logs')
      ;(window as any).electronAPI = {
        log: vi.fn(),
        openLogsFolder: vi.fn(),
        getLogsDir: mockGetLogsDir,
      }

      const { logger } = await import('../renderer/utils/Logger')

      const result = await logger.getLogsDir()

      expect(result).toBe('/app/logs')
      expect(mockGetLogsDir).toHaveBeenCalled()
    })

    it('should return null when electronAPI.getLogsDir throws (catch block)', async () => {
      ;(window as any).electronAPI = {
        log: vi.fn(),
        openLogsFolder: vi.fn(),
        getLogsDir: vi.fn().mockRejectedValue(new Error('IPC error')),
      }

      const { logger } = await import('../renderer/utils/Logger')

      const result = await logger.getLogsDir()

      expect(result).toBeNull()
    })
  })

  describe('log method IPC call when electronAPI is available', () => {
    it('should send log to electronAPI.log', async () => {
      const mockLog = vi.fn()
      ;(window as any).electronAPI = {
        log: mockLog,
        openLogsFolder: vi.fn(),
        getLogsDir: vi.fn(),
      }

      const { logger } = await import('../renderer/utils/Logger')

      const moduleLogger = logger.createModuleLogger('TestModule')
      moduleLogger.info('test message', { foo: 'bar' })

      expect(mockLog).toHaveBeenCalledWith('info', 'TestModule', 'test message', { foo: 'bar' })
    })

    it('should silently ignore IPC errors when logging', async () => {
      const mockLog = vi.fn().mockImplementation(() => {
        throw new Error('IPC write failed')
      })
      ;(window as any).electronAPI = {
        log: mockLog,
        openLogsFolder: vi.fn(),
        getLogsDir: vi.fn(),
      }

      const { logger } = await import('../renderer/utils/Logger')

      // Should not throw even though electronAPI.log throws
      const moduleLogger = logger.createModuleLogger('TestModule')
      expect(() => moduleLogger.error('something broke')).not.toThrow()

      // Log should still be in memory
      const logs = logger.getLogs()
      expect(logs.length).toBeGreaterThan(0)
      expect(logs[logs.length - 1].message).toBe('something broke')
    })
  })
})
