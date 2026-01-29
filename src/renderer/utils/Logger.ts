/**
 * Logger Utility
 * Centralized logging with both in-memory storage and file output (via IPC)
 * 
 * Logs are:
 * 1. Stored in memory for quick access and download
 * 2. Sent to main process for file-based logging in {app-root}/logs/
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  data?: any
}

// Check if we're running in Electron with the API available
const hasElectronAPI = typeof window !== 'undefined' && 
  (window as any).electronAPI?.log !== undefined

class Logger {
  private logs: LogEntry[] = []
  private maxLogs: number = 5000  // Keep last 5000 entries in memory
  private logLevel: LogLevel = 'debug'
  
  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  }

  /**
   * Set minimum log level
   */
  setLogLevel(level: LogLevel) {
    this.logLevel = level
  }

  /**
   * Create a logger for a specific module
   */
  createModuleLogger(module: string) {
    return {
      debug: (message: string, data?: any) => this.log('debug', module, message, data),
      info: (message: string, data?: any) => this.log('info', module, message, data),
      warn: (message: string, data?: any) => this.log('warn', module, message, data),
      error: (message: string, data?: any) => this.log('error', module, message, data),
    }
  }

  /**
   * Log a message
   */
  private log(level: LogLevel, module: string, message: string, data?: any) {
    // Check log level
    if (this.levelPriority[level] < this.levelPriority[this.logLevel]) {
      return
    }

    const sanitizedData = data !== undefined ? this.sanitizeData(data) : undefined
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data: sanitizedData
    }

    // Store in memory
    this.logs.push(entry)
    
    // Trim if exceeds max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }

    // Send to main process for file logging (if available)
    if (hasElectronAPI) {
      try {
        (window as any).electronAPI.log(level, module, message, sanitizedData)
      } catch {
        // Ignore IPC errors - console output will still work
      }
    }

    // Also output to console
    const consoleMsg = `[${entry.timestamp}] [${level.toUpperCase()}] [${module}] ${message}`
    
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

  /**
   * Sanitize data for logging (handle circular references, etc.)
   */
  private sanitizeData(data: any, depth: number = 0): any {
    // Prevent infinite recursion
    if (depth > 5) {
      return '[max depth exceeded]'
    }

    try {
      // Handle null/undefined
      if (data === null || data === undefined) {
        return data
      }

      // Handle common non-serializable types
      if (data instanceof Error) {
        return {
          _type: 'Error',
          name: data.name,
          message: data.message,
          stack: data.stack?.split('\n').slice(0, 5).join('\n') // Truncate stack
        }
      }

      // Handle DOMException and similar error-like objects
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
      
      if (data instanceof MediaStream) {
        return {
          _type: 'MediaStream',
          id: data.id,
          active: data.active,
          tracks: data.getTracks().map(t => ({
            kind: t.kind,
            label: t.label,
            enabled: t.enabled,
            readyState: t.readyState
          }))
        }
      }

      if (data instanceof RTCPeerConnection) {
        return {
          _type: 'RTCPeerConnection',
          connectionState: data.connectionState,
          iceConnectionState: data.iceConnectionState,
          signalingState: data.signalingState
        }
      }

      // Handle DOM elements
      if (data instanceof Element || data instanceof Node) {
        return {
          _type: 'DOMNode',
          nodeName: data.nodeName,
          id: (data as HTMLElement).id || undefined
        }
      }

      // Handle arrays - sanitize each element
      if (Array.isArray(data)) {
        return data.map(item => this.sanitizeData(item, depth + 1))
      }

      // Handle plain objects - sanitize each property
      if (typeof data === 'object') {
        const sanitized: Record<string, any> = {}
        for (const key of Object.keys(data)) {
          try {
            const value = data[key]
            // Skip functions
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

      // Primitives are safe
      if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        return data
      }

      // Try to serialize
      JSON.stringify(data)
      return data
    } catch {
      // If serialization fails, return string representation
      return String(data)
    }
  }

  /**
   * Get all logs from memory
   */
  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  /**
   * Get logs as formatted text
   */
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

  /**
   * Download logs as a file (in-memory logs)
   */
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
    
    console.info(`[Logger] Downloaded ${this.logs.length} log entries to ${filename}`)
  }

  /**
   * Open the logs folder (if running in Electron)
   */
  async openLogsFolder(): Promise<boolean> {
    if (hasElectronAPI) {
      try {
        return await (window as any).electronAPI.openLogsFolder()
      } catch {
        return false
      }
    }
    return false
  }

  /**
   * Get the logs directory path (if running in Electron)
   */
  async getLogsDir(): Promise<string | null> {
    if (hasElectronAPI) {
      try {
        return await (window as any).electronAPI.getLogsDir()
      } catch {
        return null
      }
    }
    return null
  }

  /**
   * Clear all in-memory logs
   */
  clearLogs() {
    this.logs = []
    console.info('[Logger] In-memory logs cleared')
  }

  /**
   * Get system info for debugging
   */
  getSystemInfo(): Record<string, any> {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      onLine: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as any).deviceMemory,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      timestamp: new Date().toISOString(),
      hasElectronAPI
    }
  }

  /**
   * Log system info at startup
   */
  logSystemInfo() {
    const info = this.getSystemInfo()
    this.log('info', 'System', 'System information', info)
  }
}

// Export singleton instance
export const logger = new Logger()

// Export module loggers for convenience
export const AppLog = logger.createModuleLogger('App')
export const MediaLog = logger.createModuleLogger('Media')
export const RoomLog = logger.createModuleLogger('Room')
export const PeerLog = logger.createModuleLogger('Peer')
export const SignalingLog = logger.createModuleLogger('Signaling')
export const AudioLog = logger.createModuleLogger('Audio')
export const UILog = logger.createModuleLogger('UI')
