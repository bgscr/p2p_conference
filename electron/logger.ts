/**
 * File-based Logger for Electron Main Process
 * Writes logs to {app-root}/logs/ folder
 * 
 * Log files are organized by date: p2p-conference-YYYY-MM-DD.log
 * Old logs are automatically cleaned up after 7 days
 */

import { app } from 'electron'
import { existsSync, mkdirSync, appendFileSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join, dirname } from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogConfig {
  maxAgeDays: number      // Delete logs older than this
  maxSizeMB: number       // Max size per log file before rotation
  consoleOutput: boolean  // Also print to console
  minLevel: LogLevel      // Minimum level to log
}

const DEFAULT_CONFIG: LogConfig = {
  maxAgeDays: 7,
  maxSizeMB: 10,
  consoleOutput: true,
  minLevel: 'debug'
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

class FileLogger {
  private logsDir: string = ''
  private config: LogConfig
  private currentLogFile: string = ''
  private initialized: boolean = false
  private initPromise: Promise<void> | null = null

  constructor(config: Partial<LogConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize the logger - determines log directory based on app state
   * In development: uses project root/logs
   * In production: uses app installation directory/logs
   */
  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._doInit()
    return this.initPromise
  }

  private async _doInit(): Promise<void> {
    try {
      // Determine the logs directory
      // In production: use the app's installation directory
      // In development: use the project root
      const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
      
      if (isDev) {
        // Development: use project root (where package.json is)
        // __dirname in compiled code is out/main/, so go up TWO levels to reach project root
        this.logsDir = join(dirname(dirname(__dirname)), 'logs')
      } else {
        // Production: use the directory where the app executable is located
        // This puts logs next to the .exe/.app rather than in system app data
        const exePath = app.getPath('exe')
        const appDir = process.platform === 'darwin' 
          ? join(dirname(exePath), '..', '..', '..')  // macOS: go out of .app bundle
          : dirname(exePath)  // Windows/Linux: same dir as exe
        this.logsDir = join(appDir, 'logs')
      }

      // Create logs directory if it doesn't exist
      if (!existsSync(this.logsDir)) {
        mkdirSync(this.logsDir, { recursive: true })
      }

      // Set current log file
      this.updateCurrentLogFile()

      // Clean up old logs
      this.cleanupOldLogs()

      this.initialized = true
      
      // Log initialization
      this.info('Logger', 'File logger initialized', {
        logsDir: this.logsDir,
        isDev,
        platform: process.platform
      })
    } catch (err) {
      console.error('Failed to initialize file logger:', err)
      // Fall back to console-only logging
      this.initialized = true
    }
  }

  /**
   * Update the current log file name based on today's date
   */
  private updateCurrentLogFile(): void {
    const date = new Date().toISOString().split('T')[0]  // YYYY-MM-DD
    this.currentLogFile = join(this.logsDir, `p2p-conference-${date}.log`)
  }

  /**
   * Clean up log files older than maxAgeDays
   */
  private cleanupOldLogs(): void {
    try {
      if (!existsSync(this.logsDir)) return

      const files = readdirSync(this.logsDir)
      const now = Date.now()
      const maxAge = this.config.maxAgeDays * 24 * 60 * 60 * 1000

      for (const file of files) {
        if (!file.startsWith('p2p-conference-') || !file.endsWith('.log')) {
          continue
        }

        const filePath = join(this.logsDir, file)
        try {
          const stats = statSync(filePath)
          if (now - stats.mtime.getTime() > maxAge) {
            unlinkSync(filePath)
            console.log(`[Logger] Deleted old log file: ${file}`)
          }
        } catch {
          // Ignore errors for individual files
        }
      }
    } catch (err) {
      console.error('Failed to cleanup old logs:', err)
    }
  }

  /**
   * Write a log entry
   */
  private writeLog(level: LogLevel, module: string, message: string, data?: any): void {
    // Check log level
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.config.minLevel]) {
      return
    }

    const timestamp = new Date().toISOString()
    const levelStr = level.toUpperCase().padEnd(5)
    
    // Format the log line
    let logLine = `[${timestamp}] [${levelStr}] [${module}] ${message}`
    
    if (data !== undefined) {
      try {
        const dataStr = JSON.stringify(data)
        if (dataStr.length < 1000) {
          logLine += ` | ${dataStr}`
        } else {
          logLine += ` | ${dataStr.substring(0, 1000)}...(truncated)`
        }
      } catch {
        logLine += ` | [non-serializable data]`
      }
    }
    
    logLine += '\n'

    // Console output
    if (this.config.consoleOutput) {
      const consoleMsg = `[${timestamp}] [${levelStr}] [${module}] ${message}`
      switch (level) {
        case 'debug':
          console.debug(consoleMsg, data !== undefined ? data : '')
          break
        case 'info':
          console.info(consoleMsg, data !== undefined ? data : '')
          break
        case 'warn':
          console.warn(consoleMsg, data !== undefined ? data : '')
          break
        case 'error':
          console.error(consoleMsg, data !== undefined ? data : '')
          break
      }
    }

    // File output
    if (this.initialized && this.logsDir) {
      try {
        // Check if we need to update the log file (new day)
        const expectedFile = join(this.logsDir, `p2p-conference-${new Date().toISOString().split('T')[0]}.log`)
        if (expectedFile !== this.currentLogFile) {
          this.updateCurrentLogFile()
        }

        appendFileSync(this.currentLogFile, logLine, 'utf8')
      } catch (err) {
        // If file write fails, at least we have console output
        console.error('Failed to write to log file:', err)
      }
    }
  }

  // Public logging methods
  debug(module: string, message: string, data?: any): void {
    this.writeLog('debug', module, message, data)
  }

  info(module: string, message: string, data?: any): void {
    this.writeLog('info', module, message, data)
  }

  warn(module: string, message: string, data?: any): void {
    this.writeLog('warn', module, message, data)
  }

  error(module: string, message: string, data?: any): void {
    this.writeLog('error', module, message, data)
  }

  /**
   * Create a module-specific logger
   */
  createModuleLogger(module: string) {
    return {
      debug: (message: string, data?: any) => this.debug(module, message, data),
      info: (message: string, data?: any) => this.info(module, message, data),
      warn: (message: string, data?: any) => this.warn(module, message, data),
      error: (message: string, data?: any) => this.error(module, message, data)
    }
  }

  /**
   * Get the logs directory path
   */
  getLogsDir(): string {
    return this.logsDir
  }

  /**
   * Get the current log file path
   */
  getCurrentLogFile(): string {
    return this.currentLogFile
  }

  /**
   * Log from renderer process (via IPC)
   */
  logFromRenderer(level: LogLevel, module: string, message: string, data?: any): void {
    this.writeLog(level, `Renderer:${module}`, message, data)
  }
}

// Export singleton instance
export const fileLogger = new FileLogger()

// Export module loggers for main process
export const MainLog = fileLogger.createModuleLogger('Main')
export const TrayLog = fileLogger.createModuleLogger('Tray')
export const IPCLog = fileLogger.createModuleLogger('IPC')
