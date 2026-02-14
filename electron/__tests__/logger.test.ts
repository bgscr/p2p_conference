import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks (hoisted) ────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/exe/path/app.exe'),
    isPackaged: false,
  },
}))

vi.mock('fs', () => {
  const mocks = {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    appendFile: vi.fn((...args: any[]) => {
      const callback = args.at(-1)
      if (typeof callback === 'function') {
        callback(null)
      }
    }),
    readdirSync: vi.fn().mockReturnValue([]),
    unlinkSync: vi.fn(),
    statSync: vi.fn(),
  }
  return { ...mocks, default: mocks }
})

// ── Imports (after mocks) ──────────────────────────────────────────

import { app } from 'electron'
import { existsSync, mkdirSync, appendFile, readdirSync, unlinkSync, statSync } from 'fs'
import { fileLogger, MainLog, TrayLog, IPCLog } from '../logger'
import type { LogLevel } from '../logger'

// ── Helpers ────────────────────────────────────────────────────────

/** Reset the singleton to a clean pre-init state */
function resetLogger() {
  ;(fileLogger as any).initialized = false
  ;(fileLogger as any).initPromise = null
  ;(fileLogger as any).logsDir = ''
  ;(fileLogger as any).currentLogFile = ''
  ;(fileLogger as any).writeQueue = []
  ;(fileLogger as any).isWriting = false
  ;(fileLogger as any).config = {
    maxAgeDays: 7,
    maxSizeMB: 10,
    consoleOutput: true,
    minLevel: 'debug',
  }
}

const today = new Date().toISOString().split('T')[0]

// ── Tests ──────────────────────────────────────────────────────────

describe('FileLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetLogger()
    // Defaults: dev mode, logsDir does not exist yet
    ;(app as any).isPackaged = false
    process.env.NODE_ENV = 'development'
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(readdirSync).mockReturnValue([])
    vi.mocked(appendFile).mockImplementation((...args: any[]) => {
      const callback = args.at(-1)
      if (typeof callback === 'function') {
        callback(null)
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ────────────────────────────────────────────────────────────────
  // init()
  // ────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('should initialize in dev mode and create logs directory', async () => {
      await fileLogger.init()

      expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
      expect(fileLogger.getLogsDir()).toBeTruthy()
    })

    it('should not create logs dir when it already exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true)

      await fileLogger.init()

      expect(mkdirSync).not.toHaveBeenCalled()
    })

    it('should return early when already initialized', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()

      // Second call should be a no-op
      await fileLogger.init()

      expect(mkdirSync).not.toHaveBeenCalled()
      expect(readdirSync).not.toHaveBeenCalled()
    })

    it('should return same promise when init is called concurrently', async () => {
      vi.mocked(existsSync).mockReturnValue(true)

      const p1 = fileLogger.init()
      const p2 = fileLogger.init()

      // Both calls should resolve without error
      await Promise.all([p1, p2])

      // _doInit should only run once: readdirSync is called by cleanupOldLogs
      expect(readdirSync).toHaveBeenCalledTimes(1)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // _doInit �?path resolution
  // ────────────────────────────────────────────────────────────────

  describe('_doInit path resolution', () => {
    it('should resolve dev mode path via dirname(__dirname) twice + /logs', async () => {
      process.env.NODE_ENV = 'development'
      ;(app as any).isPackaged = false

      await fileLogger.init()

      // In dev the logsDir is join(dirname(dirname(__dirname)), 'logs')
      const logsDir = fileLogger.getLogsDir()
      expect(logsDir).toBeTruthy()
      expect(logsDir).toContain('logs')
      // app.getPath('exe') should NOT be called in dev mode
      expect(app.getPath).not.toHaveBeenCalledWith('exe')
    })

    it('should resolve production path for win32', async () => {
      process.env.NODE_ENV = 'production'
      ;(app as any).isPackaged = true

      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })

      vi.mocked(app.getPath).mockReturnValue('/install/dir/myapp.exe')

      await fileLogger.init()

      // Windows: dirname(exePath) + /logs
      const logsDir = fileLogger.getLogsDir()
      expect(logsDir).toContain('logs')
      expect(app.getPath).toHaveBeenCalledWith('exe')

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('should resolve production path for darwin (macOS)', async () => {
      process.env.NODE_ENV = 'production'
      ;(app as any).isPackaged = true

      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

      vi.mocked(app.getPath).mockReturnValue('/Applications/MyApp.app/Contents/MacOS/myapp')

      await fileLogger.init()

      // macOS: join(dirname(exePath), '..', '..', '..') + /logs
      // The resulting logsDir should navigate out of the .app bundle
      const logsDir = fileLogger.getLogsDir()
      expect(logsDir).toContain('logs')
      expect(app.getPath).toHaveBeenCalledWith('exe')

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    it('should fall back to console-only on init failure', async () => {
      vi.mocked(existsSync).mockImplementation(() => {
        throw new Error('permission denied')
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await fileLogger.init()

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to initialize file logger:',
        expect.any(Error)
      )
      // Should still mark as initialized (console-only fallback)
      expect((fileLogger as any).initialized).toBe(true)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // cleanupOldLogs
  // ────────────────────────────────────────────────────────────────

  describe('cleanupOldLogs', () => {
    it('should delete log files older than maxAgeDays', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        'p2p-conference-2000-01-01.log' as any,
      ])
      vi.mocked(statSync).mockReturnValue({
        mtime: new Date('2000-01-01'),
      } as any)

      await fileLogger.init()

      expect(unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('p2p-conference-2000-01-01.log')
      )
    })

    it('should NOT delete recent log files', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        `p2p-conference-${today}.log` as any,
      ])
      vi.mocked(statSync).mockReturnValue({
        mtime: new Date(),
      } as any)

      await fileLogger.init()

      expect(unlinkSync).not.toHaveBeenCalled()
    })

    it('should skip files that do not match the log naming pattern', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        'other.txt' as any,
        'readme.md' as any,
        'p2p-conference-2000-01-01.txt' as any, // wrong extension
        'debug-2000-01-01.log' as any, // wrong prefix
      ])

      await fileLogger.init()

      // statSync should never be called for non-matching files
      expect(statSync).not.toHaveBeenCalled()
      expect(unlinkSync).not.toHaveBeenCalled()
    })

    it('should ignore stat errors for individual files', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        'p2p-conference-2000-01-01.log' as any,
        'p2p-conference-2000-01-02.log' as any,
      ])
      vi.mocked(statSync)
        .mockImplementationOnce(() => {
          throw new Error('ENOENT')
        })
        .mockReturnValueOnce({ mtime: new Date('2000-01-02') } as any)

      await fileLogger.init()

      // First file errored, second should still be deleted (old)
      expect(unlinkSync).toHaveBeenCalledTimes(1)
      expect(unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('p2p-conference-2000-01-02.log')
      )
    })

    it('should handle readdirSync failure gracefully', async () => {
      // existsSync returns true for logsDir creation check and for cleanupOldLogs check
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error('EACCES')
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await fileLogger.init()

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to cleanup old logs:',
        expect.any(Error)
      )
      // Logger should still be initialized
      expect((fileLogger as any).initialized).toBe(true)
    })

    it('should skip cleanup when logsDir does not exist', async () => {
      // existsSync returns false initially (triggers mkdirSync), then we need
      // to simulate that cleanupOldLogs sees the dir as not existing.
      // Since cleanupOldLogs runs after mkdirSync, we control both calls:
      let callCount = 0
      vi.mocked(existsSync).mockImplementation(() => {
        callCount++
        // 1st call: _doInit checking if logsDir exists => false => mkdirSync
        // 2nd call: cleanupOldLogs checking if logsDir exists => false => return early
        return callCount === 1 ? false : false
      })

      await fileLogger.init()

      expect(mkdirSync).toHaveBeenCalled()
      expect(readdirSync).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────
  // writeLog �?level filtering
  // ────────────────────────────────────────────────────────────────

  describe('writeLog �?level filtering', () => {
    beforeEach(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
    })

    it('should filter out debug messages when minLevel is info', async () => {
      ;(fileLogger as any).config.minLevel = 'info'
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.debug('Mod', 'should be filtered')

      expect(appendFile).not.toHaveBeenCalled()
    })

    it('should filter out debug and info when minLevel is warn', async () => {
      ;(fileLogger as any).config.minLevel = 'warn'
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.debug('Mod', 'filtered')
      fileLogger.info('Mod', 'filtered')
      fileLogger.warn('Mod', 'included')

      const calls = vi.mocked(appendFile).mock.calls
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toContain('included')
    })

    it('should only allow error when minLevel is error', async () => {
      ;(fileLogger as any).config.minLevel = 'error'
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.debug('Mod', 'no')
      fileLogger.info('Mod', 'no')
      fileLogger.warn('Mod', 'no')
      fileLogger.error('Mod', 'yes')

      const calls = vi.mocked(appendFile).mock.calls
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toContain('yes')
    })

    it('should allow all levels when minLevel is debug', async () => {
      ;(fileLogger as any).config.minLevel = 'debug'
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.debug('M', 'd')
      fileLogger.info('M', 'i')
      fileLogger.warn('M', 'w')
      fileLogger.error('M', 'e')

      expect(appendFile).toHaveBeenCalledTimes(4)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // writeLog �?data serialization
  // ────────────────────────────────────────────────────────────────

  describe('writeLog �?data serialization', () => {
    beforeEach(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()
    })

    it('should include short data inline when serialized length < 1000', () => {
      fileLogger.info('Mod', 'msg', { key: 'value' })

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('| {"key":"value"}')
    })

    it('should truncate data when serialized length >= 1000', () => {
      const bigData = { payload: 'x'.repeat(1100) }

      fileLogger.info('Mod', 'msg', bigData)

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('...(truncated)')
      // The truncated portion should be 1000 chars of the JSON
      expect(written).not.toContain('"x'.repeat(1100))
    })

    it('should handle non-serializable data', () => {
      const circular: any = {}
      circular.self = circular

      fileLogger.info('Mod', 'msg', circular)

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[non-serializable data]')
    })

    it('should not include data separator when data is undefined', () => {
      fileLogger.info('Mod', 'msg')

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).not.toContain(' | ')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // writeLog �?console output
  // ────────────────────────────────────────────────────────────────

  describe('writeLog �?console output', () => {
    beforeEach(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()
    })

    it('should call console.debug for debug level', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      fileLogger.debug('Mod', 'debug msg')
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]'),
        expect.anything()
      )
    })

    it('should call console.info for info level', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
      fileLogger.info('Mod', 'info msg')
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO ]'),
        expect.anything()
      )
    })

    it('should call console.warn for warn level', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      fileLogger.warn('Mod', 'warn msg')
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN ]'),
        expect.anything()
      )
    })

    it('should call console.error for error level', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      fileLogger.error('Mod', 'error msg')
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.anything()
      )
    })

    it('should pass data object to console when provided', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const data = { foo: 'bar' }

      fileLogger.info('Mod', 'msg', data)

      expect(spy).toHaveBeenCalledWith(expect.any(String), data)
    })

    it('should pass empty string to console when data is undefined', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

      fileLogger.info('Mod', 'msg')

      expect(spy).toHaveBeenCalledWith(expect.any(String), '')
    })

    it('should not call console methods when consoleOutput is false', () => {
      ;(fileLogger as any).config.consoleOutput = false

      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      fileLogger.debug('M', 'd')
      fileLogger.info('M', 'i')
      fileLogger.warn('M', 'w')
      fileLogger.error('M', 'e')

      expect(debugSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────
  // writeLog �?file output
  // ────────────────────────────────────────────────────────────────

  describe('writeLog �?file output', () => {
    beforeEach(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()
    })

    it('should write to file with correct format', () => {
      fileLogger.info('TestMod', 'hello world')

      expect(appendFile).toHaveBeenCalledTimes(1)
      const [filePath, content, encoding] = vi.mocked(appendFile).mock.calls[0]

      expect(filePath).toContain(`p2p-conference-${today}.log`)
      expect(content).toContain('[INFO ]')
      expect(content).toContain('[TestMod]')
      expect(content).toContain('hello world')
      expect((content as string).endsWith('\n')).toBe(true)
      expect(encoding).toBe('utf8')
    })

    it('should not write to file when not initialized', () => {
      // Reset to uninitialized state
      ;(fileLogger as any).initialized = false
      ;(fileLogger as any).logsDir = ''
      vi.clearAllMocks()

      fileLogger.info('Mod', 'should not write')

      expect(appendFile).not.toHaveBeenCalled()
    })

    it('should not write to file when initialized but logsDir is empty (fallback mode)', () => {
      ;(fileLogger as any).initialized = true
      ;(fileLogger as any).logsDir = ''
      vi.clearAllMocks()

      fileLogger.info('Mod', 'no file write')

      expect(appendFile).not.toHaveBeenCalled()
    })

    it('should detect date change and update log file', () => {
      // Simulate that currentLogFile was set to yesterday
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      const logsDir = fileLogger.getLogsDir()
      ;(fileLogger as any).currentLogFile = `${logsDir}/p2p-conference-${yesterdayStr}.log`
      vi.clearAllMocks()

      fileLogger.info('Mod', 'new day message')

      // Should have written to a file with today's date
      const writtenPath = vi.mocked(appendFile).mock.calls[0][0] as string
      expect(writtenPath).toContain(`p2p-conference-${today}.log`)
    })

    it('should handle appendFile failure gracefully', () => {
      vi.mocked(appendFile).mockImplementation((...args: any[]) => {
        const callback = args.at(-1)
        if (typeof callback === 'function') {
          callback(new Error('disk full'))
        }
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      fileLogger.info('Mod', 'msg')

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to write to log file:',
        expect.any(Error)
      )
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Public logging methods
  // ────────────────────────────────────────────────────────────────

  describe('public logging methods', () => {
    beforeEach(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()
    })

    it('debug() should write a DEBUG log', () => {
      fileLogger.debug('Mod', 'debug message', { x: 1 })
      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[DEBUG]')
      expect(written).toContain('[Mod]')
      expect(written).toContain('debug message')
    })

    it('info() should write an INFO log', () => {
      fileLogger.info('Mod', 'info message')
      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[INFO ]')
    })

    it('warn() should write a WARN log', () => {
      fileLogger.warn('Mod', 'warn message')
      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[WARN ]')
    })

    it('error() should write an ERROR log', () => {
      fileLogger.error('Mod', 'error message')
      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[ERROR]')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // createModuleLogger
  // ────────────────────────────────────────────────────────────────

  describe('createModuleLogger', () => {
    beforeEach(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()
    })

    it('should return an object with debug, info, warn, error methods', () => {
      const mod = fileLogger.createModuleLogger('MyModule')

      expect(typeof mod.debug).toBe('function')
      expect(typeof mod.info).toBe('function')
      expect(typeof mod.warn).toBe('function')
      expect(typeof mod.error).toBe('function')
    })

    it('should prefix logs with the module name', () => {
      const mod = fileLogger.createModuleLogger('CustomMod')

      mod.info('test info')
      mod.debug('test debug')
      mod.warn('test warn')
      mod.error('test error')

      const calls = vi.mocked(appendFile).mock.calls
      expect(calls).toHaveLength(4)
      for (const call of calls) {
        expect(call[1]).toContain('[CustomMod]')
      }
    })

    it('should forward data argument', () => {
      const mod = fileLogger.createModuleLogger('DataMod')
      const data = { key: 'val' }

      mod.info('msg', data)

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('{"key":"val"}')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Exported module loggers
  // ────────────────────────────────────────────────────────────────

  describe('exported module loggers', () => {
    beforeEach(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()
    })

    it('MainLog should log with [Main] module', () => {
      MainLog.info('main message')
      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[Main]')
      expect(written).toContain('main message')
    })

    it('TrayLog should log with [Tray] module', () => {
      TrayLog.warn('tray warning')
      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[Tray]')
      expect(written).toContain('tray warning')
    })

    it('IPCLog should log with [IPC] module', () => {
      IPCLog.error('ipc error')
      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[IPC]')
      expect(written).toContain('ipc error')
    })

    it('MainLog should have all four log methods', () => {
      expect(typeof MainLog.debug).toBe('function')
      expect(typeof MainLog.info).toBe('function')
      expect(typeof MainLog.warn).toBe('function')
      expect(typeof MainLog.error).toBe('function')
    })

    it('TrayLog should have all four log methods', () => {
      expect(typeof TrayLog.debug).toBe('function')
      expect(typeof TrayLog.info).toBe('function')
      expect(typeof TrayLog.warn).toBe('function')
      expect(typeof TrayLog.error).toBe('function')
    })

    it('IPCLog should have all four log methods', () => {
      expect(typeof IPCLog.debug).toBe('function')
      expect(typeof IPCLog.info).toBe('function')
      expect(typeof IPCLog.warn).toBe('function')
      expect(typeof IPCLog.error).toBe('function')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // getLogsDir / getCurrentLogFile
  // ────────────────────────────────────────────────────────────────

  describe('getLogsDir / getCurrentLogFile', () => {
    it('getLogsDir should return empty string before init', () => {
      expect(fileLogger.getLogsDir()).toBe('')
    })

    it('getCurrentLogFile should return empty string before init', () => {
      expect(fileLogger.getCurrentLogFile()).toBe('')
    })

    it('getLogsDir should return the logs directory after init', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()

      const logsDir = fileLogger.getLogsDir()
      expect(logsDir).toBeTruthy()
      expect(logsDir).toContain('logs')
    })

    it('getCurrentLogFile should return a dated log file path after init', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()

      const logFile = fileLogger.getCurrentLogFile()
      expect(logFile).toContain(`p2p-conference-${today}.log`)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // logFromRenderer
  // ────────────────────────────────────────────────────────────────

  describe('logFromRenderer', () => {
    beforeEach(async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()
    })

    it('should prefix module with "Renderer:"', () => {
      fileLogger.logFromRenderer('info', 'App', 'renderer message')

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[Renderer:App]')
      expect(written).toContain('renderer message')
    })

    it('should respect level filtering', () => {
      ;(fileLogger as any).config.minLevel = 'error'

      fileLogger.logFromRenderer('info', 'App', 'filtered')

      expect(appendFile).not.toHaveBeenCalled()
    })

    it('should pass through data argument', () => {
      fileLogger.logFromRenderer('warn', 'Component', 'warning', { detail: 42 })

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[Renderer:Component]')
      expect(written).toContain('{"detail":42}')
    })

    it('should work with all log levels', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
      for (const level of levels) {
        fileLogger.logFromRenderer(level, 'Mod', `${level} msg`)
      }

      expect(appendFile).toHaveBeenCalledTimes(4)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // updateCurrentLogFile (via writeLog date change)
  // ────────────────────────────────────────────────────────────────

  describe('updateCurrentLogFile', () => {
    it('should set currentLogFile based on today date during init', async () => {
      vi.mocked(existsSync).mockReturnValue(true)

      await fileLogger.init()

      expect(fileLogger.getCurrentLogFile()).toContain(`p2p-conference-${today}.log`)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Edge cases
  // ────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty message', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.info('Mod', '')

      expect(appendFile).toHaveBeenCalledTimes(1)
    })

    it('should handle special characters in module and message', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.info('My/Module [v2]', 'message with "quotes" & <brackets>')

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('[My/Module [v2]]')
      expect(written).toContain('message with "quotes" & <brackets>')
    })

    it('should handle data being null', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.info('Mod', 'msg', null)

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('| null')
    })

    it('should handle data being 0', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.info('Mod', 'msg', 0)

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('| 0')
    })

    it('should handle data being false', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.info('Mod', 'msg', false)

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('| false')
    })

    it('should handle data being an empty string', async () => {
      vi.mocked(existsSync).mockReturnValue(true)
      await fileLogger.init()
      vi.clearAllMocks()

      fileLogger.info('Mod', 'msg', '')

      const written = vi.mocked(appendFile).mock.calls[0][1] as string
      expect(written).toContain('| ""')
    })
  })
})

