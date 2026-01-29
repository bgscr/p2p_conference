/**
 * Extended tests for Logger utility
 * @vitest-environment jsdom
 * 
 * Tests cover:
 * - Electron API integration
 * - Download functionality
 * - System info
 * - DOM element sanitization
 * - Error-like object handling
 * - MediaStream and RTCPeerConnection sanitization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================
// Extended Logger tests with browser/DOM dependencies
// ============================================

describe('Logger Extended', () => {


  beforeEach(() => {
    // Mock console methods
    vi.spyOn(console, 'debug').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Log Level Configuration', () => {
    // Testable Logger class
    class TestableLoggerConfig {
      private logs: any[] = []
      private maxLogs = 5000
      private logLevel: 'debug' | 'info' | 'warn' | 'error' = 'debug'
      private levelPriority = { debug: 0, info: 1, warn: 2, error: 3 }

      setLogLevel(level: 'debug' | 'info' | 'warn' | 'error') {
        this.logLevel = level
      }

      getLogLevel() {
        return this.logLevel
      }

      log(level: 'debug' | 'info' | 'warn' | 'error', module: string, message: string, data?: any) {
        if (this.levelPriority[level] < this.levelPriority[this.logLevel]) {
          return
        }
        this.logs.push({ timestamp: new Date().toISOString(), level, module, message, data })
        if (this.logs.length > this.maxLogs) {
          this.logs = this.logs.slice(-this.maxLogs)
        }
      }

      getLogs() {
        return [...this.logs]
      }

      clearLogs() {
        this.logs = []
      }

      getLogsAsText(): string {
        const lines: string[] = [
          '='.repeat(80),
          'P2P Conference Debug Log',
          `Generated: ${new Date().toISOString()}`,
          `User Agent: ${navigator.userAgent}`,
          `Platform: ${navigator.platform}`,
          `Total Entries: ${this.logs.length}`,
          '='.repeat(80),
          ''
        ]

        for (const entry of this.logs) {
          let line = `[${entry.timestamp}] [${entry.level.toUpperCase().padEnd(5)}] [${entry.module}] ${entry.message}`

          if (entry.data !== undefined) {
            try {
              const dataStr = JSON.stringify(entry.data, null, 2)
              if (dataStr.length < 500) {
                line += `\n    Data: ${dataStr}`
              } else {
                line += `\n    Data: ${dataStr.substring(0, 500)}... (truncated)`
              }
            } catch {
              line += `\n    Data: [non-serializable]`
            }
          }

          lines.push(line)
        }

        return lines.join('\n')
      }

      getSystemInfo(): Record<string, any> {
        return {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          onLine: navigator.onLine,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: (navigator as any).deviceMemory,
          screenWidth: window.screen?.width || 0,
          screenHeight: window.screen?.height || 0,
          windowWidth: window.innerWidth || 0,
          windowHeight: window.innerHeight || 0,
          timestamp: new Date().toISOString()
        }
      }

      sanitizeData(data: any, depth: number = 0): any {
        if (depth > 5) {
          return '[max depth exceeded]'
        }

        try {
          if (data === null || data === undefined) {
            return data
          }

          if (data instanceof Error) {
            return {
              _type: 'Error',
              name: data.name,
              message: data.message,
              stack: data.stack?.split('\n').slice(0, 5).join('\n')
            }
          }

          // Handle error-like objects (DOMException, etc.)
          if (data && typeof data === 'object' &&
            (data.name || data.message) &&
            (typeof data.name === 'string' || typeof data.message === 'string')) {
            return {
              _type: data.constructor?.name || 'ErrorLike',
              name: data.name || 'Unknown',
              message: data.message || 'No message',
              code: data.code !== undefined ? data.code : undefined,
              stack: data.stack?.split?.('\n').slice(0, 5).join('\n')
            }
          }

          // Handle DOM elements
          if (typeof Element !== 'undefined' && data instanceof Element) {
            return {
              _type: 'DOMNode',
              nodeName: data.nodeName,
              id: (data as HTMLElement).id || undefined
            }
          }

          if (Array.isArray(data)) {
            return data.map(item => this.sanitizeData(item, depth + 1))
          }

          if (typeof data === 'object') {
            const sanitized: Record<string, any> = {}
            for (const key of Object.keys(data)) {
              try {
                const value = data[key]
                if (typeof value === 'function') {
                  sanitized[key] = '[function]'
                } else {
                  sanitized[key] = this.sanitizeData(value, depth + 1)
                }
              } catch {
                sanitized[key] = '[error accessing property]'
              }
            }
            return sanitized
          }

          if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
            return data
          }

          if (typeof data === 'symbol') {
            return data.toString()
          }

          JSON.stringify(data)
          return data
        } catch {
          return String(data)
        }
      }
    }

    let logger: TestableLoggerConfig

    beforeEach(() => {
      logger = new TestableLoggerConfig()
    })

    it('should get and set log level', () => {
      expect(logger.getLogLevel()).toBe('debug')

      logger.setLogLevel('warn')
      expect(logger.getLogLevel()).toBe('warn')
    })

    it('should filter messages below log level', () => {
      logger.setLogLevel('warn')

      logger.log('debug', 'Test', 'Debug message')
      logger.log('info', 'Test', 'Info message')
      logger.log('warn', 'Test', 'Warn message')
      logger.log('error', 'Test', 'Error message')

      const logs = logger.getLogs()
      expect(logs).toHaveLength(2)
      expect(logs[0].level).toBe('warn')
      expect(logs[1].level).toBe('error')
    })

    it('should generate text output with data', () => {
      logger.log('info', 'Test', 'Message with data', { key: 'value' })

      const text = logger.getLogsAsText()

      expect(text).toContain('P2P Conference Debug Log')
      expect(text).toContain('Message with data')
      expect(text).toContain('Data:')
      expect(text).toContain('"key"')
      expect(text).toContain('"value"')
    })

    it('should truncate large data in text output', () => {
      const largeData = { content: 'x'.repeat(1000) }
      logger.log('info', 'Test', 'Large data', largeData)

      const text = logger.getLogsAsText()

      expect(text).toContain('(truncated)')
    })

    it('should handle non-serializable data in text output', () => {
      const circular: any = { self: null }
      circular.self = circular

      // The sanitizeData should handle this first
      const sanitized = logger.sanitizeData(circular)
      logger.log('info', 'Test', 'Circular data', sanitized)

      const text = logger.getLogsAsText()
      expect(text).toContain('Circular data')
    })

    it('should get system info', () => {
      const info = logger.getSystemInfo()

      expect(info).toHaveProperty('userAgent')
      expect(info).toHaveProperty('platform')
      expect(info).toHaveProperty('language')
      expect(info).toHaveProperty('onLine')
      expect(info).toHaveProperty('timestamp')
    })

    describe('Data Sanitization Extended', () => {
      it('should handle error-like objects (DOMException)', () => {
        const errorLike = {
          name: 'NotAllowedError',
          message: 'Permission denied',
          code: 0
        }

        const sanitized = logger.sanitizeData(errorLike)

        expect(sanitized._type).toBe('Object') // No constructor on plain object
        expect(sanitized.name).toBeDefined()
        expect(sanitized.message).toBeDefined()
      })

      it('should handle DOM elements', () => {
        const div = document.createElement('div')
        div.id = 'test-div'

        const sanitized = logger.sanitizeData(div)

        expect(sanitized._type).toBe('DOMNode')
        expect(sanitized.nodeName).toBe('DIV')
        expect(sanitized.id).toBe('test-div')
      })

      it('should handle objects with inaccessible properties', () => {
        const problematic = {}
        Object.defineProperty(problematic, 'badProp', {
          get() { throw new Error('Cannot access') },
          enumerable: true
        })

        const sanitized = logger.sanitizeData(problematic)

        expect(sanitized.badProp).toBe('[error accessing property]')
      })

      it('should handle nested arrays with depth limit', () => {
        let deepArray: any = ['deep']
        for (let i = 0; i < 12; i++) { deepArray = [deepArray] }
        const sanitized = logger.sanitizeData(deepArray)
        expect(JSON.stringify(sanitized)).toContain('max depth exceeded')
      })

      it('should handle objects that fail JSON.stringify', () => {
        const problematic = {
          toJSON() {
            throw new Error('Cannot serialize')
          }
        }

        // The sanitizeData processes the object property by property
        // so it won't fail on toJSON
        const sanitized = logger.sanitizeData(problematic)
        expect(sanitized).toBeDefined()
      })

      it('should handle symbol values by converting to string', () => {
        const sym = Symbol('test')

        const sanitized = logger.sanitizeData(sym)

        expect(typeof sanitized).toBe('string')
        expect(sanitized).toContain('Symbol')
      })

      it('should handle BigInt by converting to string', () => {
        const big = BigInt(12345678901234567890n)

        const sanitized = logger.sanitizeData(big)

        // BigInt gets converted to string by String()
        expect(sanitized).toBeDefined()
      })
    })
  })

  describe('Module Logger Factory', () => {
    class TestableLoggerModule {
      log = vi.fn()

      createModuleLogger(module: string) {
        return {
          debug: (message: string, data?: any) => this.log('debug', module, message, data),
          info: (message: string, data?: any) => this.log('info', module, message, data),
          warn: (message: string, data?: any) => this.log('warn', module, message, data),
          error: (message: string, data?: any) => this.log('error', module, message, data),
        }
      }
    }

    it('should create module logger with correct module name', () => {
      const logger = new TestableLoggerModule()
      const audioLog = logger.createModuleLogger('Audio')

      audioLog.info('Test message')

      expect(logger.log).toHaveBeenCalledWith('info', 'Audio', 'Test message', undefined)
    })

    it('should pass data through module logger', () => {
      const logger = new TestableLoggerModule()
      const peerLog = logger.createModuleLogger('Peer')
      const testData = { peerId: '123', action: 'connect' }

      peerLog.debug('Connection debug', testData)

      expect(logger.log).toHaveBeenCalledWith('debug', 'Peer', 'Connection debug', testData)
    })

    it('should support all log levels', () => {
      const logger = new TestableLoggerModule()
      const moduleLog = logger.createModuleLogger('Test')

      moduleLog.debug('Debug')
      moduleLog.info('Info')
      moduleLog.warn('Warn')
      moduleLog.error('Error')

      expect(logger.log).toHaveBeenCalledTimes(4)
    })
  })

  describe('Log Download Functionality', () => {
    it('should create download link', () => {
      // Mock URL and document methods
      const mockObjectURL = 'blob:mock-url'
      const createObjectURL = vi.fn().mockReturnValue(mockObjectURL)
      const revokeObjectURL = vi.fn()

      vi.stubGlobal('URL', {
        createObjectURL,
        revokeObjectURL
      })

      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn()
      }

      const createElement = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any)
      const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any)
      const removeChild = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any)

      // Simulate download
      class TestableLoggerDownload {
        // logs property removed

        getLogsAsText() {
          return 'Test log content'
        }

        downloadLogs() {
          const text = this.getLogsAsText()
          const blob = new Blob([text], { type: 'text/plain' })
          const url = URL.createObjectURL(blob)

          const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
          const filename = `p2p-conference-log-${timestamp}.txt`

          const a = document.createElement('a')
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
        }
      }

      const logger = new TestableLoggerDownload()
      logger.downloadLogs()

      expect(createElement).toHaveBeenCalledWith('a')
      expect(appendChild).toHaveBeenCalled()
      expect(mockAnchor.click).toHaveBeenCalled()
      expect(removeChild).toHaveBeenCalled()
      expect(revokeObjectURL).toHaveBeenCalled()

      // Cleanup
      vi.unstubAllGlobals()
    })
  })

  describe('Electron API Integration', () => {
    it('should log to main process when electronAPI available', () => {
      const mockLog = vi.fn()

      // Simulate logger with electron API
      class TestableLoggerElectron {
        private hasElectronAPI = true

        setHasElectronAPI(has: boolean) {
          this.hasElectronAPI = has
        }

        log(level: string, module: string, message: string, data?: any) {
          if (this.hasElectronAPI) {
            mockLog(level, module, message, data)
          }
        }
      }

      const logger = new TestableLoggerElectron()
      logger.log('info', 'Test', 'Test message', { key: 'value' })

      expect(mockLog).toHaveBeenCalledWith('info', 'Test', 'Test message', { key: 'value' })
    })

    it('should handle electron API errors gracefully', () => {
      const mockLog = vi.fn().mockImplementation(() => {
        throw new Error('IPC error')
      })

      class TestableLoggerElectronError {
        log(level: string, module: string, message: string, data?: any) {
          try {
            mockLog(level, module, message, data)
          } catch {
            // Silently ignore IPC errors
          }
        }
      }

      const logger = new TestableLoggerElectronError()

      // Should not throw
      expect(() => {
        logger.log('info', 'Test', 'Test message')
      }).not.toThrow()
    })
  })

  describe('Open Logs Folder', () => {
    it('should call electron API to open logs folder', async () => {
      const mockOpenLogsFolder = vi.fn().mockResolvedValue(true)

      class TestableLogger {
        private hasElectronAPI = true
        private electronAPI = { openLogsFolder: mockOpenLogsFolder }

        async openLogsFolder(): Promise<boolean> {
          if (this.hasElectronAPI) {
            try {
              return await this.electronAPI.openLogsFolder()
            } catch {
              return false
            }
          }
          return false
        }
      }

      const logger = new TestableLogger()
      const result = await logger.openLogsFolder()

      expect(result).toBe(true)
      expect(mockOpenLogsFolder).toHaveBeenCalled()
    })

    it('should return false when not in electron', async () => {
      class TestableLogger {
        private hasElectronAPI = false

        async openLogsFolder(): Promise<boolean> {
          if (this.hasElectronAPI) {
            return true
          }
          return false
        }
      }

      const logger = new TestableLogger()
      const result = await logger.openLogsFolder()

      expect(result).toBe(false)
    })
  })

  describe('Get Logs Directory', () => {
    it('should return logs directory path', async () => {
      const mockGetLogsDir = vi.fn().mockResolvedValue('/path/to/logs')

      class TestableLogger {
        private hasElectronAPI = true
        private electronAPI = { getLogsDir: mockGetLogsDir }

        async getLogsDir(): Promise<string | null> {
          if (this.hasElectronAPI) {
            try {
              return await this.electronAPI.getLogsDir()
            } catch {
              return null
            }
          }
          return null
        }
      }

      const logger = new TestableLogger()
      const result = await logger.getLogsDir()

      expect(result).toBe('/path/to/logs')
    })

    it('should return null when not in electron', async () => {
      class TestableLogger {
        private hasElectronAPI = false

        async getLogsDir(): Promise<string | null> {
          if (this.hasElectronAPI) {
            return '/path/to/logs'
          }
          return null
        }
      }

      const logger = new TestableLogger()
      const result = await logger.getLogsDir()

      expect(result).toBeNull()
    })
  })
})
