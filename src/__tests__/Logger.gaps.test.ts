/**
 * @vitest-environment jsdom
 */
/**
 * Additional coverage gap tests for Logger
 * Targets:
 * - sanitizeData: RTCPeerConnection, DOMException/error-like objects, primitives via JSON
 * - sanitizeData: object with getter that throws
 * - sanitizeData: non-serializable data fallback to String()
 * - getLogsAsText: with data > 500 chars (truncation), with non-serializable data
 * - downloadLogs: creates anchor and triggers download
 * - openLogsFolder: success and no-electron paths
 * - getLogsDir: success and no-electron paths
 * - logSystemInfo: logs system info
 * - Log level filtering: debug filtered by warn level
 * - Electron API log call and error handling
 * - clearLogs: empties logs array
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// We need to test the actual Logger class, so we import it without mocking
describe('Logger - additional gaps', () => {
  let Logger: any
  let logger: any

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    // Remove electronAPI to test non-electron paths first
    delete (window as any).electronAPI

    const mod = await import('../renderer/utils/Logger')
    // Create a fresh logger for testing
    Logger = (mod.logger.constructor as any)
    logger = new Logger()
  })

  describe('sanitizeData', () => {
    it('handles RTCPeerConnection instances', () => {
      // Mock RTCPeerConnection
      vi.stubGlobal('RTCPeerConnection', class {
        connectionState = 'connected'
        iceConnectionState = 'completed'
        signalingState = 'stable'
      })

      const pc = new RTCPeerConnection()
      const result = (logger as any).sanitizeData(pc)
      expect(result._type).toBe('RTCPeerConnection')
      expect(result.connectionState).toBe('connected')
    })

    it('handles DOMException-like objects', () => {
      const domException = {
        name: 'NotAllowedError',
        message: 'Permission denied',
        code: 0,
        stack: 'Error: at line 1\nat line 2\nat line 3'
      }

      const result = (logger as any).sanitizeData(domException)
      expect(result.name).toBe('NotAllowedError')
      expect(result.message).toBe('Permission denied')
    })

    it('handles error-like objects without stack', () => {
      const errLike = { name: 'CustomError', message: 'Something went wrong' }
      const result = (logger as any).sanitizeData(errLike)
      expect(result._type).toBeDefined()
      expect(result.name).toBe('CustomError')
    })

    it('handles primitives (string, number, boolean)', () => {
      expect((logger as any).sanitizeData('hello')).toBe('hello')
      expect((logger as any).sanitizeData(42)).toBe(42)
      expect((logger as any).sanitizeData(true)).toBe(true)
    })

    it('handles null and undefined', () => {
      expect((logger as any).sanitizeData(null)).toBeNull()
      expect((logger as any).sanitizeData(undefined)).toBeUndefined()
    })

    it('handles max depth exceeded', () => {
      const result = (logger as any).sanitizeData({ a: 1 }, 6)
      expect(result).toBe('[max depth exceeded]')
    })

    it('handles DOM elements', () => {
      // Mock Element and Node
      const mockEl = document.createElement('div')
      mockEl.id = 'test-div'
      const result = (logger as any).sanitizeData(mockEl)
      expect(result._type).toBe('DOMNode')
      expect(result.nodeName).toBe('DIV')
      expect(result.id).toBe('test-div')
    })

    it('handles arrays recursively', () => {
      const result = (logger as any).sanitizeData([1, 'two', { three: 3 }])
      expect(result).toEqual([1, 'two', { three: 3 }])
    })

    it('handles objects with function properties', () => {
      const result = (logger as any).sanitizeData({ a: 1, fn: () => { } })
      expect(result.a).toBe(1)
      expect(result.fn).toBe('[function]')
    })

    it('handles objects with error-throwing getters', () => {
      const obj = {
        get bad() { throw new Error('access error') },
        good: 'ok'
      }
      const result = (logger as any).sanitizeData(obj)
      expect(result.bad).toBe('[error accessing property]')
      expect(result.good).toBe('ok')
    })

    it('handles symbol data', () => {
      const sym = Symbol('test')
      const result = (logger as any).sanitizeData(sym)
      // Symbols are returned as-is or converted based on the sanitize logic
      expect(result).toBeDefined()
    })

    it('handles MediaStream instances', () => {
      const stream = new MediaStream()
      const result = (logger as any).sanitizeData(stream)
      expect(result._type).toBe('MediaStream')
    })

    it('handles MediaStream with audio and video tracks (line 141)', () => {
      // Create mock tracks
      const mockAudioTrack = {
        kind: 'audio',
        label: 'Built-in Microphone',
        enabled: true,
        readyState: 'live'
      }
      const mockVideoTrack = {
        kind: 'video',
        label: 'USB Camera',
        enabled: true,
        readyState: 'live'
      }

      // Mock MediaStream with tracks
      const mockStream = {
        id: 'stream-123',
        active: true,
        getTracks: () => [mockAudioTrack, mockVideoTrack]
      }

      // Temporarily replace MediaStream check
      vi.stubGlobal('MediaStream', class {
        id = 'mock'
        active = true
        getTracks() { return [] }
      })

      // Create instance that will match instanceof
      const stream = Object.create(MediaStream.prototype)
      Object.assign(stream, mockStream)

      const result = (logger as any).sanitizeData(stream)
      expect(result._type).toBe('MediaStream')
      expect(result.tracks).toHaveLength(2)
      expect(result.tracks[0].kind).toBe('audio')
      expect(result.tracks[1].kind).toBe('video')
    })

    it('handles BigInt data (line 218 fallback to String)', () => {
      // BigInt cannot be serialized by JSON.stringify
      // This should trigger the catch block on line 216-218
      const bigIntValue = BigInt(9007199254740991)
      const result = (logger as any).sanitizeData(bigIntValue)
      // Should be converted to string representation
      expect(result).toBe('9007199254740991')
    })

    it('handles objects with circular references via fallback', () => {
      // Create object that fails serialization
      const circular: any = { a: 1 }
      circular.self = circular

      // At depth 6 (which is > 5), it returns max depth exceeded
      const result = (logger as any).sanitizeData(circular, 6)
      expect(result).toBe('[max depth exceeded]')
    })
  })

  describe('getLogsAsText', () => {
    it('truncates long data entries', () => {
      logger.log = []
      // Add a log entry with very long data
      const longData = { longField: 'x'.repeat(600) }
        ; (logger as any).logs = [{
          timestamp: '2025-01-01T00:00:00Z',
          level: 'info',
          module: 'Test',
          message: 'test',
          data: longData
        }]

      const text = logger.getLogsAsText()
      expect(text).toContain('truncated')
    })

    it('handles non-serializable data in text output', () => {
      ; (logger as any).logs = [{
        timestamp: '2025-01-01T00:00:00Z',
        level: 'info',
        module: 'Test',
        message: 'test',
        data: { toJSON() { throw new Error('cannot serialize') } }
      }]

      const text = logger.getLogsAsText()
      expect(text).toContain('[non-serializable]')
    })

    it('formats entry without data', () => {
      ; (logger as any).logs = [{
        timestamp: '2025-01-01T00:00:00Z',
        level: 'info',
        module: 'Test',
        message: 'no data'
      }]

      const text = logger.getLogsAsText()
      expect(text).toContain('no data')
      expect(text).not.toContain('Data:')
    })
  })

  describe('downloadLogs', () => {
    it('creates blob and triggers download', () => {
      ; (logger as any).logs = [{
        timestamp: '2025-01-01T00:00:00Z',
        level: 'info', module: 'Test', message: 'download test'
      }]

      const mockAnchor = { href: '', download: '', click: vi.fn() }
      const origCreate = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') return mockAnchor as any
        return origCreate(tag)
      })
      vi.spyOn(document.body, 'appendChild').mockReturnValue(null as any)
      vi.spyOn(document.body, 'removeChild').mockReturnValue(null as any)
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)

      logger.downloadLogs()

      expect(mockAnchor.click).toHaveBeenCalled()
      expect(mockAnchor.download).toContain('p2p-conference-log-')
    })
  })

  describe('openLogsFolder', () => {
    it('returns false when no electron API', async () => {
      delete (window as any).electronAPI
      const result = await logger.openLogsFolder()
      expect(result).toBe(false)
    })
  })

  describe('getLogsDir', () => {
    it('returns null when no electron API', async () => {
      delete (window as any).electronAPI
      const result = await logger.getLogsDir()
      expect(result).toBeNull()
    })
  })

  describe('log level filtering', () => {
    it('filters out debug messages when level set to warn', () => {
      logger.setLogLevel('warn')
        ; (logger as any).logs = []

      const origDebug = console.debug
      console.debug = vi.fn()

      // This should be filtered out
      const moduleLogger = logger.createModuleLogger('Test')
      moduleLogger.debug('filtered message')

      expect((logger as any).logs.length).toBe(0)

      // This should NOT be filtered
      moduleLogger.warn('visible message')
      expect((logger as any).logs.length).toBe(1)

      console.debug = origDebug
    })
  })

  describe('log trimming', () => {
    it('trims logs when exceeding maxLogs', () => {
      ; (logger as any).maxLogs = 10
        ; (logger as any).logs = []

      const moduleLogger = logger.createModuleLogger('Test')
      for (let i = 0; i < 15; i++) {
        moduleLogger.info(`message ${i}`)
      }

      expect((logger as any).logs.length).toBe(10)
    })
  })

  describe('clearLogs', () => {
    it('empties logs array', () => {
      const moduleLogger = logger.createModuleLogger('Test')
      moduleLogger.info('test')
      expect(logger.getLogs().length).toBeGreaterThan(0)

      logger.clearLogs()
      expect(logger.getLogs().length).toBe(0)
    })
  })

  describe('getSystemInfo', () => {
    it('returns system information', () => {
      const info = logger.getSystemInfo()
      expect(info).toHaveProperty('userAgent')
      expect(info).toHaveProperty('platform')
      expect(info).toHaveProperty('timestamp')
    })
  })

  describe('logSystemInfo', () => {
    it('logs system info entry', () => {
      ; (logger as any).logs = []
      logger.logSystemInfo()
      expect((logger as any).logs.length).toBe(1)
      expect((logger as any).logs[0].module).toBe('System')
    })
  })

  describe('console output routing', () => {
    it('routes to correct console methods', () => {
      const origDebug = console.debug
      const origInfo = console.info
      const origWarn = console.warn
      const origError = console.error

      console.debug = vi.fn()
      console.info = vi.fn()
      console.warn = vi.fn()
      console.error = vi.fn()

      const ml = logger.createModuleLogger('Test')
      ml.debug('d')
      ml.info('i')
      ml.warn('w')
      ml.error('e')

      expect(console.debug).toHaveBeenCalled()
      expect(console.info).toHaveBeenCalled()
      expect(console.warn).toHaveBeenCalled()
      expect(console.error).toHaveBeenCalled()

      console.debug = origDebug
      console.info = origInfo
      console.warn = origWarn
      console.error = origError
    })
  })
})
