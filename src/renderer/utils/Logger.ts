/**
 * Logger Utility
 * Centralized logging with export capability for troubleshooting
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  module: string
  message: string
  data?: any
}

class Logger {
  private logs: LogEntry[] = []
  private maxLogs: number = 5000  // Keep last 5000 entries
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

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data: data !== undefined ? this.sanitizeData(data) : undefined
    }

    // Store in memory
    this.logs.push(entry)
    
    // Trim if exceeds max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
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
  private sanitizeData(data: any): any {
    try {
      // Handle common non-serializable types
      if (data instanceof Error) {
        return {
          name: data.name,
          message: data.message,
          stack: data.stack
        }
      }
      
      if (data instanceof MediaStream) {
        return {
          type: 'MediaStream',
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
          type: 'RTCPeerConnection',
          connectionState: data.connectionState,
          iceConnectionState: data.iceConnectionState,
          signalingState: data.signalingState
        }
      }

      // Try to serialize
      JSON.stringify(data)
      return data
    } catch (e) {
      // If serialization fails, return string representation
      return String(data)
    }
  }

  /**
   * Get all logs
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
   * Download logs as a file
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
   * Clear all logs
   */
  clearLogs() {
    this.logs = []
    console.info('[Logger] Logs cleared')
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
      timestamp: new Date().toISOString()
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
