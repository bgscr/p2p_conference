import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron before import
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}))

import { contextBridge, ipcRenderer } from 'electron'

// Import the preload script to trigger execution (calls exposeInMainWorld)
import '../preload'

// Extract the exposed API object from the mock call.
// This is captured once after the module executes; the object reference stays valid.
const exposedApi = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>).mock.calls[0][1]

describe('Preload Script', () => {
  beforeEach(() => {
    // Only clear ipcRenderer mocks so per-test assertions are isolated.
    // Do NOT clear contextBridge – it was called once at module-load time.
    vi.mocked(ipcRenderer.invoke).mockClear()
    vi.mocked(ipcRenderer.on).mockClear()
    vi.mocked(ipcRenderer.send).mockClear()
    vi.mocked(ipcRenderer.removeAllListeners).mockClear()
  })

  // -------------------------------------------------------
  // 1. contextBridge.exposeInMainWorld called with all methods
  // -------------------------------------------------------
  describe('exposeInMainWorld registration', () => {
    it('should call exposeInMainWorld with "electronAPI"', () => {
      expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
        'electronAPI',
        expect.any(Object),
      )
    })

    it('should expose all expected methods', () => {
      const expectedMethods = [
        'getMicPermission',
        'requestMicPermission',
        'getAppVersion',
        'getPlatform',
        'onMicPermissionChanged',
        'onDownloadLogs',
        'log',
        'getLogsDir',
        'openLogsFolder',
        'updateCallState',
        'updateMuteState',
        'showWindow',
        'flashWindow',
        'onTrayToggleMute',
        'onTrayLeaveCall',
        'getICEServers',
        'getMQTTBrokers',
      ]

      for (const method of expectedMethods) {
        expect(exposedApi).toHaveProperty(method)
        expect(typeof exposedApi[method]).toBe('function')
      }
    })
  })

  // -------------------------------------------------------
  // 2. invoke methods call correct IPC channel
  // -------------------------------------------------------
  describe('invoke methods', () => {
    it('getMicPermission invokes "get-mic-permission"', () => {
      exposedApi.getMicPermission()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-mic-permission')
    })

    it('requestMicPermission invokes "request-mic-permission"', () => {
      exposedApi.requestMicPermission()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('request-mic-permission')
    })

    it('getAppVersion invokes "get-app-version"', () => {
      exposedApi.getAppVersion()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-app-version')
    })

    it('getPlatform invokes "get-platform"', () => {
      exposedApi.getPlatform()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-platform')
    })

    it('getLogsDir invokes "get-logs-dir"', () => {
      exposedApi.getLogsDir()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-logs-dir')
    })

    it('openLogsFolder invokes "open-logs-folder"', () => {
      exposedApi.openLogsFolder()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('open-logs-folder')
    })

    it('getICEServers invokes "get-ice-servers"', () => {
      exposedApi.getICEServers()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-ice-servers')
    })

    it('getMQTTBrokers invokes "get-mqtt-brokers"', () => {
      exposedApi.getMQTTBrokers()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-mqtt-brokers')
    })
  })

  // -------------------------------------------------------
  // 3. send methods call correct IPC channel with correct args
  // -------------------------------------------------------
  describe('send methods', () => {
    it('updateCallState sends "update-call-state" with state object', () => {
      const state = { inCall: true, muted: false }
      exposedApi.updateCallState(state)
      expect(ipcRenderer.send).toHaveBeenCalledWith('update-call-state', state)
    })

    it('updateMuteState sends "update-mute-state" with muted flag', () => {
      exposedApi.updateMuteState(true)
      expect(ipcRenderer.send).toHaveBeenCalledWith('update-mute-state', true)
    })

    it('showWindow sends "show-window"', () => {
      exposedApi.showWindow()
      expect(ipcRenderer.send).toHaveBeenCalledWith('show-window')
    })

    it('flashWindow sends "flash-window"', () => {
      exposedApi.flashWindow()
      expect(ipcRenderer.send).toHaveBeenCalledWith('flash-window')
    })
  })

  // -------------------------------------------------------
  // 4. Event listener methods register callbacks and return cleanup
  // -------------------------------------------------------
  describe('event listener methods', () => {
    it('onMicPermissionChanged registers listener and returns cleanup', () => {
      const callback = vi.fn()
      const cleanup = exposedApi.onMicPermissionChanged(callback)

      expect(ipcRenderer.on).toHaveBeenCalledWith(
        'mic-permission-changed',
        expect.any(Function),
      )
      expect(typeof cleanup).toBe('function')

      cleanup()
      expect(ipcRenderer.removeAllListeners).toHaveBeenCalledWith('mic-permission-changed')
    })

    it('onMicPermissionChanged forwards the granted argument to callback', () => {
      const callback = vi.fn()
      exposedApi.onMicPermissionChanged(callback)

      // Get the wrapper that was registered with ipcRenderer.on
      const registeredWrapper = (ipcRenderer.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'mic-permission-changed',
      )![1]

      // Simulate IPC event with granted = true
      registeredWrapper({}, true)
      expect(callback).toHaveBeenCalledWith(true)
    })

    it('onDownloadLogs registers listener and returns cleanup', () => {
      const callback = vi.fn()
      const cleanup = exposedApi.onDownloadLogs(callback)

      expect(ipcRenderer.on).toHaveBeenCalledWith('download-logs', expect.any(Function))
      expect(typeof cleanup).toBe('function')

      cleanup()
      expect(ipcRenderer.removeAllListeners).toHaveBeenCalledWith('download-logs')
    })

    it('onDownloadLogs invokes callback when event fires', () => {
      const callback = vi.fn()
      exposedApi.onDownloadLogs(callback)

      const registeredWrapper = (ipcRenderer.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'download-logs',
      )![1]

      registeredWrapper()
      expect(callback).toHaveBeenCalled()
    })

    it('onTrayToggleMute registers listener and returns cleanup', () => {
      const callback = vi.fn()
      const cleanup = exposedApi.onTrayToggleMute(callback)

      expect(ipcRenderer.on).toHaveBeenCalledWith('tray-toggle-mute', expect.any(Function))
      expect(typeof cleanup).toBe('function')

      cleanup()
      expect(ipcRenderer.removeAllListeners).toHaveBeenCalledWith('tray-toggle-mute')
    })

    it('onTrayToggleMute invokes callback when event fires', () => {
      const callback = vi.fn()
      exposedApi.onTrayToggleMute(callback)

      const registeredWrapper = (ipcRenderer.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'tray-toggle-mute',
      )![1]

      registeredWrapper()
      expect(callback).toHaveBeenCalled()
    })

    it('onTrayLeaveCall registers listener and returns cleanup', () => {
      const callback = vi.fn()
      const cleanup = exposedApi.onTrayLeaveCall(callback)

      expect(ipcRenderer.on).toHaveBeenCalledWith('tray-leave-call', expect.any(Function))
      expect(typeof cleanup).toBe('function')

      cleanup()
      expect(ipcRenderer.removeAllListeners).toHaveBeenCalledWith('tray-leave-call')
    })

    it('onTrayLeaveCall invokes callback when event fires', () => {
      const callback = vi.fn()
      exposedApi.onTrayLeaveCall(callback)

      const registeredWrapper = (ipcRenderer.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === 'tray-leave-call',
      )![1]

      registeredWrapper()
      expect(callback).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------
  // 5. log() sends correct payload structure
  // -------------------------------------------------------
  describe('log method', () => {
    it('sends log-message with level, module, message, and data', () => {
      const data = { key: 'value' }
      exposedApi.log('info', 'TestModule', 'hello world', data)
      expect(ipcRenderer.send).toHaveBeenCalledWith('log-message', {
        level: 'info',
        module: 'TestModule',
        message: 'hello world',
        data,
      })
    })

    it('sends log-message with data as undefined when omitted', () => {
      exposedApi.log('warn', 'MyModule', 'a warning')
      expect(ipcRenderer.send).toHaveBeenCalledWith('log-message', {
        level: 'warn',
        module: 'MyModule',
        message: 'a warning',
        data: undefined,
      })
    })

    it('sends log-message with "error" level', () => {
      exposedApi.log('error', 'ErrModule', 'something failed', { err: 'details' })
      expect(ipcRenderer.send).toHaveBeenCalledWith('log-message', {
        level: 'error',
        module: 'ErrModule',
        message: 'something failed',
        data: { err: 'details' },
      })
    })

    it('sends log-message with "debug" level', () => {
      exposedApi.log('debug', 'DebugMod', 'debug info')
      expect(ipcRenderer.send).toHaveBeenCalledWith('log-message', {
        level: 'debug',
        module: 'DebugMod',
        message: 'debug info',
        data: undefined,
      })
    })
  })
})
