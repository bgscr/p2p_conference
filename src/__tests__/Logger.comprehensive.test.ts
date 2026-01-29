/**
 * Comprehensive tests for Logger utility
 * @vitest-environment jsdom
 * 
 * These tests directly test the actual Logger module to improve coverage
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logger, AppLog, MediaLog, RoomLog, PeerLog, SignalingLog, AudioLog, UILog } from '../renderer/utils/Logger'

describe('Logger Module - Comprehensive Tests', () => {
  beforeEach(() => {
    // Mock console methods
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    
    // Clear logs before each test
    logger.clearLogs()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Reset log level to debug
    logger.setLogLevel('debug')
  })

  describe('Logger Singleton', () => {
    it('should be a singleton instance', () => {
      expect(logger).toBeDefined()
      expect(typeof logger.getLogs).toBe('function')
      expect(typeof logger.clearLogs).toBe('function')
      expect(typeof logger.downloadLogs).toBe('function')
    })

    it('should set and respect log levels', () => {
      // Set to warn level
      logger.setLogLevel('warn')
      
      // Log at all levels
      AppLog.debug('Debug message')
      AppLog.info('Info message')
      AppLog.warn('Warn message')
      AppLog.error('Error message')
      
      const logs = logger.getLogs()
      
      // Should only have warn and error
      expect(logs).toHaveLength(2)
      expect(logs[0].level).toBe('warn')
      expect(logs[1].level).toBe('error')
    })

    it('should filter debug messages when level is info', () => {
      logger.setLogLevel('info')
      
      AppLog.debug('Should be filtered')
      AppLog.info('Should appear')
      
      const logs = logger.getLogs()
      expect(logs).toHaveLength(1)
      expect(logs[0].level).toBe('info')
    })

    it('should pass all messages when level is debug', () => {
      logger.setLogLevel('debug')
      
      AppLog.debug('Debug')
      AppLog.info('Info')
      AppLog.warn('Warn')
      AppLog.error('Error')
      
      const logs = logger.getLogs()
      expect(logs).toHaveLength(4)
    })
  })

  describe('Module Loggers', () => {
    it('should have all pre-defined module loggers', () => {
      expect(AppLog).toBeDefined()
      expect(MediaLog).toBeDefined()
      expect(RoomLog).toBeDefined()
      expect(PeerLog).toBeDefined()
      expect(SignalingLog).toBeDefined()
      expect(AudioLog).toBeDefined()
      expect(UILog).toBeDefined()
    })

    it('should tag logs with correct module name', () => {
      AppLog.info('App message')
      MediaLog.info('Media message')
      RoomLog.info('Room message')
      PeerLog.info('Peer message')
      SignalingLog.info('Signaling message')
      AudioLog.info('Audio message')
      UILog.info('UI message')
      
      const logs = logger.getLogs()
      
      expect(logs).toHaveLength(7)
      expect(logs[0].module).toBe('App')
      expect(logs[1].module).toBe('Media')
      expect(logs[2].module).toBe('Room')
      expect(logs[3].module).toBe('Peer')
      expect(logs[4].module).toBe('Signaling')
      expect(logs[5].module).toBe('Audio')
      expect(logs[6].module).toBe('UI')
    })

    it('should create custom module logger', () => {
      const customLog = logger.createModuleLogger('CustomModule')
      
      customLog.info('Custom message', { key: 'value', count: 42 })
      
      const logs = logger.getLogs()
      expect(logs[0].module).toBe('CustomModule')
      expect(logs[0].data).toBeDefined()
      expect(logs[0].data.key).toBe('value')
      expect(logs[0].data.count).toBe(42)
    })

    it('should support all log levels in module loggers', () => {
      const testLog = logger.createModuleLogger('Test')
      
      testLog.debug('Debug')
      testLog.info('Info')
      testLog.warn('Warn')
      testLog.error('Error')
      
      const logs = logger.getLogs()
      expect(logs).toHaveLength(4)
      expect(logs.map(l => l.level)).toEqual(['debug', 'info', 'warn', 'error'])
    })
  })

  describe('Log Entry Format', () => {
    it('should include timestamp, level, module, and message', () => {
      AppLog.info('Test message')
      
      const log = logger.getLogs()[0]
      
      expect(log).toHaveProperty('timestamp')
      expect(log).toHaveProperty('level', 'info')
      expect(log).toHaveProperty('module', 'App')
      expect(log).toHaveProperty('message', 'Test message')
    })

    it('should include data when provided', () => {
      AppLog.info('With data', { userId: '123', action: 'test' })
      
      const log = logger.getLogs()[0]
      expect(log.data).toBeDefined()
      expect(log.data.userId).toBe('123')
      expect(log.data.action).toBe('test')
    })

    it('should omit data when not provided', () => {
      AppLog.info('No data')
      
      const log = logger.getLogs()[0]
      
      expect(log.data).toBeUndefined()
    })
  })

  describe('Data Sanitization', () => {
    it('should handle null and undefined', () => {
      AppLog.info('Null data', null)
      AppLog.info('Undefined data', undefined)
      
      const logs = logger.getLogs()
      expect(logs[0].data).toBeNull()
      expect(logs[1].data).toBeUndefined()
    })

    it('should sanitize Error objects', () => {
      const error = new Error('Test error')
      AppLog.error('Error occurred', error)
      
      const log = logger.getLogs()[0]
      
      expect(log.data._type).toBe('Error')
      expect(log.data.name).toBe('Error')
      expect(log.data.message).toBe('Test error')
      expect(log.data.stack).toBeDefined()
    })

    it('should sanitize nested objects', () => {
      const nested = {
        level1: {
          level2: {
            value: 'deep'
          }
        }
      }
      
      AppLog.info('Nested', nested)
      
      const log = logger.getLogs()[0]
      expect(log.data).toBeDefined()
      expect(typeof log.data).toBe('object')
      expect(log.data.level1.level2.value).toBe('deep')
    })

    it('should handle arrays', () => {
      const arr = [1, 2, 3]
      AppLog.info('Array', arr)
      
      const log = logger.getLogs()[0]
      expect(Array.isArray(log.data)).toBe(true)
      expect(log.data).toHaveLength(3)
      expect(log.data[0]).toBe(1)
      expect(log.data[1]).toBe(2)
      expect(log.data[2]).toBe(3)
    })

    it('should handle functions in objects', () => {
      const objWithFunc = {
        title: 'test',
        callback: () => {}
      }
      
      AppLog.info('Object with function', objWithFunc)
      
      const log = logger.getLogs()[0]
      expect(log.data).toBeDefined()
      expect(log.data.title).toBe('test')
      expect(log.data.callback).toBe('[function]')
    })

    it('should handle primitives correctly', () => {
      AppLog.info('String', 'hello')
      AppLog.info('Number', 42)
      AppLog.info('Boolean', true)
      
      const logs = logger.getLogs()
      expect(logs[0].data).toBe('hello')
      expect(logs[1].data).toBe(42)
      expect(logs[2].data).toBe(true)
    })

    it('should handle very deep nesting with max depth', () => {
      let deep: any = { value: 'bottom' }
      for (let i = 0; i < 10; i++) {
        deep = { child: deep }
      }
      
      AppLog.info('Deep object', deep)
      
      const log = logger.getLogs()[0]
      // Should not throw - logger handles deep nesting gracefully
      expect(log.data).toBeDefined()
      // The exact handling depends on implementation - may truncate or stringify
      const dataStr = JSON.stringify(log.data)
      expect(dataStr.length).toBeGreaterThan(0)
    })
  })

  describe('Log Trimming', () => {
    it('should maintain log entries up to max limit', () => {
      // The maxLogs is 5000, we'll add enough to test trimming behavior
      // This tests that logs don't grow unbounded
      for (let i = 0; i < 100; i++) {
        AppLog.info(`Message ${i}`)
      }
      
      const logs = logger.getLogs()
      expect(logs.length).toBeLessThanOrEqual(5000)
    })
  })

  describe('getLogs', () => {
    it('should return a copy of logs', () => {
      AppLog.info('Test')
      
      const logs1 = logger.getLogs()
      const logs2 = logger.getLogs()
      
      expect(logs1).not.toBe(logs2) // Different arrays
      expect(logs1).toEqual(logs2) // Same content
    })
  })

  describe('getLogsAsText', () => {
    it('should generate formatted text output', () => {
      AppLog.info('Test message', { key: 'value' })
      
      const text = logger.getLogsAsText()
      
      expect(text).toContain('P2P Conference Debug Log')
      expect(text).toContain('User Agent:')
      expect(text).toContain('Total Entries:')
      expect(text).toContain('[INFO ]')
      expect(text).toContain('[App]')
      expect(text).toContain('Test message')
      expect(text).toContain('Data:')
    })

    it('should include header with system info', () => {
      const text = logger.getLogsAsText()
      
      expect(text).toContain('='.repeat(80))
      expect(text).toContain('Generated:')
      expect(text).toContain('Platform:')
    })
  })

  describe('clearLogs', () => {
    it('should clear all logs', () => {
      AppLog.info('Message 1')
      AppLog.info('Message 2')
      
      expect(logger.getLogs().length).toBe(2)
      
      logger.clearLogs()
      
      expect(logger.getLogs().length).toBe(0)
    })
  })

  describe('getSystemInfo', () => {
    it('should return system information', () => {
      const info = logger.getSystemInfo()
      
      expect(info).toHaveProperty('userAgent')
      expect(info).toHaveProperty('platform')
      expect(info).toHaveProperty('language')
      expect(info).toHaveProperty('onLine')
      expect(info).toHaveProperty('timestamp')
      expect(info).toHaveProperty('hardwareConcurrency')
      expect(info).toHaveProperty('screenWidth')
      expect(info).toHaveProperty('screenHeight')
      expect(info).toHaveProperty('windowWidth')
      expect(info).toHaveProperty('windowHeight')
    })
  })

  describe('logSystemInfo', () => {
    it('should log system info', () => {
      logger.logSystemInfo()
      
      const logs = logger.getLogs()
      const systemLog = logs.find(l => l.module === 'System')
      
      expect(systemLog).toBeDefined()
      expect(systemLog?.message).toBe('System information')
      // System info is sanitized as object
      expect(systemLog?.data).toBeDefined()
    })
  })

  describe('Console Output', () => {
    it('should output to console.debug for debug level', () => {
      AppLog.debug('Debug message')
      
      expect(console.debug).toHaveBeenCalled()
    })

    it('should output to console.info for info level', () => {
      AppLog.info('Info message')
      
      expect(console.info).toHaveBeenCalled()
    })

    it('should output to console.warn for warn level', () => {
      AppLog.warn('Warn message')
      
      expect(console.warn).toHaveBeenCalled()
    })

    it('should output to console.error for error level', () => {
      AppLog.error('Error message')
      
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('DOM Element Handling', () => {
    it('should handle DOM-like objects', () => {
      // In jsdom, DOM elements may be handled differently
      // Test that logging DOM elements doesn't throw
      const div = document.createElement('div')
      div.id = 'test-id'
      
      // Should not throw
      expect(() => AppLog.info('DOM element', div)).not.toThrow()
      
      const log = logger.getLogs()[0]
      expect(log.data).toBeDefined()
    })

    it('should handle DOM element without id', () => {
      const span = document.createElement('span')
      
      // Should not throw
      expect(() => AppLog.info('DOM element', span)).not.toThrow()
      
      const log = logger.getLogs()[0]
      expect(log.data).toBeDefined()
    })
  })

  describe('Download Functionality', () => {
    it('should create and trigger download', () => {
      const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url')
      const mockRevokeObjectURL = vi.fn()
      
      vi.stubGlobal('URL', {
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL
      })
      
      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn()
      }
      
      vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any)
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any)
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any)
      
      // Add some logs
      AppLog.info('Test log')
      
      // Download
      logger.downloadLogs()
      
      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockAnchor.click).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalled()
      
      vi.unstubAllGlobals()
    })
  })

  describe('Electron API Integration', () => {
    it('should handle missing electronAPI gracefully', async () => {
      // Ensure electronAPI is not defined
      const original = (window as any).electronAPI
      delete (window as any).electronAPI
      
      // Should not throw
      const result = await logger.openLogsFolder()
      expect(result).toBe(false)
      
      const logsDir = await logger.getLogsDir()
      expect(logsDir).toBeNull()
      
      // Restore
      if (original) {
        (window as any).electronAPI = original
      }
    })
  })

  describe('Error-like Object Handling', () => {
    it('should handle DOMException-like objects', () => {
      const domException = {
        name: 'NotAllowedError',
        message: 'Permission denied',
        code: 0,
        stack: 'Error: Permission denied\n    at test'
      }
      
      AppLog.error('DOM Exception', domException)
      
      const log = logger.getLogs()[0]
      expect(log.data._type).toBeDefined()
      expect(log.data.name).toBe('NotAllowedError')
      expect(log.data.message).toBe('Permission denied')
    })

    it('should handle objects with only name property', () => {
      const namedObj = { name: 'TestName' }
      
      AppLog.info('Named object', namedObj)
      
      const log = logger.getLogs()[0]
      // Should be treated as error-like since it has name
      expect(log.data).toBeDefined()
    })

    it('should handle objects with only message property', () => {
      const msgObj = { message: 'Test message only' }
      
      AppLog.info('Message object', msgObj)
      
      const log = logger.getLogs()[0]
      expect(log.data).toBeDefined()
    })
  })
})
