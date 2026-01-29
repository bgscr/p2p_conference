/**
 * Unit tests for Logger utility
 * Tests logging functionality, log level filtering, and data sanitization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================
// Extracted Logger logic for testing (avoids browser/Electron dependencies)
// ============================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
    timestamp: string
    level: LogLevel
    module: string
    message: string
    data?: any
}

/**
 * Testable Logger class (extracted logic without browser dependencies)
 */
class TestableLogger {
    private logs: LogEntry[] = []
    private maxLogs: number = 5000
    private logLevel: LogLevel = 'debug'

    private levelPriority: Record<LogLevel, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3
    }

    setLogLevel(level: LogLevel) {
        this.logLevel = level
    }

    getLogLevel(): LogLevel {
        return this.logLevel
    }

    createModuleLogger(module: string) {
        return {
            debug: (message: string, data?: any) => this.log('debug', module, message, data),
            info: (message: string, data?: any) => this.log('info', module, message, data),
            warn: (message: string, data?: any) => this.log('warn', module, message, data),
            error: (message: string, data?: any) => this.log('error', module, message, data),
        }
    }

    log(level: LogLevel, module: string, message: string, data?: any) {
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

        this.logs.push(entry)

        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs)
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

            JSON.stringify(data)
            return data
        } catch {
            return String(data)
        }
    }

    getLogs(): LogEntry[] {
        return [...this.logs]
    }

    getLogsAsText(): string {
        const lines: string[] = [
            '='.repeat(80),
            'P2P Conference Debug Log',
            `Generated: ${new Date().toISOString()}`,
            `Total Entries: ${this.logs.length}`,
            '='.repeat(80),
            ''
        ]

        for (const entry of this.logs) {
            const line = `[${entry.timestamp}] [${entry.level.toUpperCase().padEnd(5)}] [${entry.module}] ${entry.message}`
            lines.push(line)
        }

        return lines.join('\n')
    }

    clearLogs() {
        this.logs = []
    }

    setMaxLogs(max: number) {
        this.maxLogs = max
    }
}

// ============================================
// Test Suites
// ============================================

describe('Logger', () => {
    let logger: TestableLogger

    beforeEach(() => {
        logger = new TestableLogger()
    })

    describe('Log Level Filtering', () => {
        it('should log all levels when set to debug', () => {
            logger.setLogLevel('debug')

            logger.log('debug', 'Test', 'Debug message')
            logger.log('info', 'Test', 'Info message')
            logger.log('warn', 'Test', 'Warn message')
            logger.log('error', 'Test', 'Error message')

            expect(logger.getLogs().length).toBe(4)
        })

        it('should filter debug when set to info', () => {
            logger.setLogLevel('info')

            logger.log('debug', 'Test', 'Debug message')
            logger.log('info', 'Test', 'Info message')
            logger.log('warn', 'Test', 'Warn message')
            logger.log('error', 'Test', 'Error message')

            expect(logger.getLogs().length).toBe(3)
            expect(logger.getLogs().find(l => l.level === 'debug')).toBeUndefined()
        })

        it('should filter debug and info when set to warn', () => {
            logger.setLogLevel('warn')

            logger.log('debug', 'Test', 'Debug message')
            logger.log('info', 'Test', 'Info message')
            logger.log('warn', 'Test', 'Warn message')
            logger.log('error', 'Test', 'Error message')

            expect(logger.getLogs().length).toBe(2)
        })

        it('should only log errors when set to error', () => {
            logger.setLogLevel('error')

            logger.log('debug', 'Test', 'Debug message')
            logger.log('info', 'Test', 'Info message')
            logger.log('warn', 'Test', 'Warn message')
            logger.log('error', 'Test', 'Error message')

            expect(logger.getLogs().length).toBe(1)
            expect(logger.getLogs()[0].level).toBe('error')
        })
    })

    describe('Module Logger', () => {
        it('should create a module logger with all methods', () => {
            const moduleLog = logger.createModuleLogger('TestModule')

            expect(moduleLog.debug).toBeDefined()
            expect(moduleLog.info).toBeDefined()
            expect(moduleLog.warn).toBeDefined()
            expect(moduleLog.error).toBeDefined()
        })

        it('should log with correct module name', () => {
            const moduleLog = logger.createModuleLogger('MyModule')

            moduleLog.info('Test message')

            expect(logger.getLogs()[0].module).toBe('MyModule')
        })

        it('should support multiple module loggers', () => {
            const audioLog = logger.createModuleLogger('Audio')
            const networkLog = logger.createModuleLogger('Network')

            audioLog.info('Audio event')
            networkLog.info('Network event')

            const logs = logger.getLogs()
            expect(logs[0].module).toBe('Audio')
            expect(logs[1].module).toBe('Network')
        })
    })

    describe('Log Entry Format', () => {
        it('should create log entry with timestamp', () => {
            logger.log('info', 'Test', 'Message')

            const entry = logger.getLogs()[0]
            expect(entry.timestamp).toBeDefined()
            expect(new Date(entry.timestamp).getTime()).toBeLessThanOrEqual(Date.now())
        })

        it('should store level, module, and message', () => {
            logger.log('warn', 'MyModule', 'Warning message')

            const entry = logger.getLogs()[0]
            expect(entry.level).toBe('warn')
            expect(entry.module).toBe('MyModule')
            expect(entry.message).toBe('Warning message')
        })

        it('should store data when provided', () => {
            logger.log('info', 'Test', 'Message', { key: 'value' })

            const entry = logger.getLogs()[0]
            expect(entry.data).toEqual({ key: 'value' })
        })

        it('should not include data when not provided', () => {
            logger.log('info', 'Test', 'Message')

            const entry = logger.getLogs()[0]
            expect(entry.data).toBeUndefined()
        })
    })

    describe('Data Sanitization', () => {
        it('should pass through primitives unchanged', () => {
            expect(logger.sanitizeData('string')).toBe('string')
            expect(logger.sanitizeData(123)).toBe(123)
            expect(logger.sanitizeData(true)).toBe(true)
            expect(logger.sanitizeData(null)).toBe(null)
            expect(logger.sanitizeData(undefined)).toBe(undefined)
        })

        it('should sanitize Error objects', () => {
            const error = new Error('Test error')
            const sanitized = logger.sanitizeData(error)

            expect(sanitized._type).toBe('Error')
            expect(sanitized.name).toBe('Error')
            expect(sanitized.message).toBe('Test error')
            expect(sanitized.stack).toBeDefined()
        })

        it('should sanitize arrays', () => {
            const data = [1, 'two', { three: 3 }]
            const sanitized = logger.sanitizeData(data)

            expect(Array.isArray(sanitized)).toBe(true)
            expect(sanitized.length).toBe(3)
            expect(sanitized[0]).toBe(1)
            expect(sanitized[1]).toBe('two')
            expect(sanitized[2]).toEqual({ three: 3 })
        })

        it('should sanitize nested objects', () => {
            const data = {
                level1: {
                    level2: {
                        value: 'deep'
                    }
                }
            }
            const sanitized = logger.sanitizeData(data)

            expect(sanitized.level1.level2.value).toBe('deep')
        })

        it('should replace functions with placeholder', () => {
            const data = {
                callback: () => { },
                value: 'test'
            }
            const sanitized = logger.sanitizeData(data)

            expect(sanitized.callback).toBe('[function]')
            expect(sanitized.value).toBe('test')
        })

        it('should limit recursion depth', () => {
            // Create deeply nested object
            let deep: any = { value: 'bottom' }
            for (let i = 0; i < 10; i++) {
                deep = { nested: deep }
            }

            const sanitized = logger.sanitizeData(deep)

            // At some depth, it should return the max depth message
            let current = sanitized
            let foundMaxDepth = false
            while (current && typeof current === 'object' && current.nested) {
                current = current.nested
                if (current === '[max depth exceeded]') {
                    foundMaxDepth = true
                    break
                }
            }
            expect(foundMaxDepth).toBe(true)
        })
    })

    describe('Max Logs Limit', () => {
        it('should respect max logs limit', () => {
            logger.setMaxLogs(10)

            for (let i = 0; i < 20; i++) {
                logger.log('info', 'Test', `Message ${i}`)
            }

            expect(logger.getLogs().length).toBe(10)
        })

        it('should keep most recent logs when trimming', () => {
            logger.setMaxLogs(5)

            for (let i = 0; i < 10; i++) {
                logger.log('info', 'Test', `Message ${i}`)
            }

            const logs = logger.getLogs()
            expect(logs[0].message).toBe('Message 5')
            expect(logs[4].message).toBe('Message 9')
        })
    })

    describe('Clear Logs', () => {
        it('should clear all logs', () => {
            logger.log('info', 'Test', 'Message 1')
            logger.log('info', 'Test', 'Message 2')
            logger.log('info', 'Test', 'Message 3')

            expect(logger.getLogs().length).toBe(3)

            logger.clearLogs()

            expect(logger.getLogs().length).toBe(0)
        })

        it('should allow new logs after clearing', () => {
            logger.log('info', 'Test', 'Old message')
            logger.clearLogs()
            logger.log('info', 'Test', 'New message')

            expect(logger.getLogs().length).toBe(1)
            expect(logger.getLogs()[0].message).toBe('New message')
        })
    })

    describe('Logs as Text', () => {
        it('should format logs as text with header', () => {
            logger.log('info', 'Test', 'Test message')

            const text = logger.getLogsAsText()

            expect(text).toContain('P2P Conference Debug Log')
            expect(text).toContain('Total Entries: 1')
            expect(text).toContain('[INFO ]')
            expect(text).toContain('[Test]')
            expect(text).toContain('Test message')
        })

        it('should include all log entries', () => {
            logger.log('debug', 'Mod1', 'Debug message')
            logger.log('error', 'Mod2', 'Error message')

            const text = logger.getLogsAsText()

            expect(text).toContain('Total Entries: 2')
            expect(text).toContain('Debug message')
            expect(text).toContain('Error message')
        })
    })

    describe('getLogs returns copy', () => {
        it('should return a copy of logs, not the original array', () => {
            logger.log('info', 'Test', 'Message')

            const logs1 = logger.getLogs()
            const logs2 = logger.getLogs()

            expect(logs1).not.toBe(logs2)
            expect(logs1).toEqual(logs2)
        })
    })
})
