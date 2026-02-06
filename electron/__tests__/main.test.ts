import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type Mock } from 'vitest'

  // Mock process.getSystemVersion (Electron API, not available in Node)
  ; (process as any).getSystemVersion = vi.fn().mockReturnValue('10.0.0')

/* ------------------------------------------------------------------ */
/*  Mocks – vi.hoisted() makes these available to hoisted vi.mock()    */
/* ------------------------------------------------------------------ */

const {
  existsSyncMock,
  mockResizedImage,
  mockIcon,
  mockFallbackIcon,
  mockWebContents,
  mockBrowserWindowInstance,
  mockTrayInstance,
  electronMock,
  loggerMock,
  credentialsMock,
  lastMenuTemplateRef,
} = vi.hoisted(() => {
  const existsSyncMock = vi.fn().mockReturnValue(false)

  const mockResizedImage = { isEmpty: () => false, getSize: () => ({ width: 32, height: 32 }) }
  const mockIcon = {
    isEmpty: vi.fn().mockReturnValue(false),
    resize: vi.fn().mockReturnValue(mockResizedImage),
    getSize: vi.fn().mockReturnValue({ width: 256, height: 256 }),
  }
  const mockFallbackIcon = { isEmpty: () => false, resize: vi.fn() }

  const mockWebContents = {
    session: { webRequest: { onHeadersReceived: vi.fn() } },
    on: vi.fn(),
    openDevTools: vi.fn(),
    send: vi.fn(),
  }
  const mockBrowserWindowInstance = {
    webContents: mockWebContents,
    on: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn().mockReturnValue(true),
    flashFrame: vi.fn(),
  }

  const mockTrayInstance = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    setImage: vi.fn(),
    on: vi.fn(),
    displayBalloon: vi.fn(),
  }

  // Store menu templates so we can inspect & invoke click callbacks
  const lastMenuTemplateRef: { value: any[] } = { value: [] }

  const electronMock = {
    app: {
      quit: vi.fn(),
      getPath: vi.fn().mockReturnValue('/tmp'),
      getAppPath: vi.fn().mockReturnValue('/app'),
      getVersion: vi.fn().mockReturnValue('1.2.3'),
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      name: 'TestApp',
      isPackaged: false,
    },
    BrowserWindow: Object.assign(
      vi.fn(function () { return mockBrowserWindowInstance }),
      { getAllWindows: vi.fn().mockReturnValue([]) },
    ),
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
    },
    Tray: vi.fn(function () { return mockTrayInstance }),
    Menu: {
      buildFromTemplate: vi.fn((template: any[]) => {
        lastMenuTemplateRef.value = template
        return { items: template }
      }),
      setApplicationMenu: vi.fn(),
    },
    nativeImage: {
      createFromPath: vi.fn().mockReturnValue(mockIcon),
      createFromDataURL: vi.fn().mockReturnValue(mockFallbackIcon),
    },
    shell: {
      openPath: vi.fn(),
      openExternal: vi.fn(),
    },
    systemPreferences: {
      getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
      askForMediaAccess: vi.fn().mockResolvedValue(true),
    },
  }

  const loggerMock = {
    fileLogger: {
      init: vi.fn().mockResolvedValue(undefined),
      getLogsDir: vi.fn().mockReturnValue('/logs'),
      logFromRenderer: vi.fn(),
      createModuleLogger: () => ({
        info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
      }),
    },
    MainLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    TrayLog: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    IPCLog: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }

  const credentialsMock = {
    getICEServers: vi.fn().mockReturnValue([{ urls: 'stun:stun.example.com' }]),
    getMQTTBrokers: vi.fn().mockReturnValue([{ url: 'ws://broker' }]),
  }

  return {
    existsSyncMock,
    mockResizedImage,
    mockIcon,
    mockFallbackIcon,
    mockWebContents,
    mockBrowserWindowInstance,
    mockTrayInstance,
    electronMock,
    loggerMock,
    credentialsMock,
    lastMenuTemplateRef,
  }
})

/* ------------------------------------------------------------------ */
/*  Register vi.mock calls (hoisted to top)                            */
/* ------------------------------------------------------------------ */

vi.mock('fs', () => {
  const mocks = {
    existsSync: existsSyncMock,
    mkdirSync: vi.fn(),
  }
  return { ...mocks, default: mocks }
})

vi.mock('electron', () => electronMock)
vi.mock('../logger', () => loggerMock)
vi.mock('../credentials', () => credentialsMock)

/* ------------------------------------------------------------------ */
/*  Import module under test (runs top-level side-effects)             */
/* ------------------------------------------------------------------ */
import { __testing } from '../main'
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, systemPreferences } from 'electron'
import { fileLogger } from '../logger'

/* ------------------------------------------------------------------ */
/*  Capture handler references registered during module load           */
/*  (before any clearAllMocks wipes the call history)                  */
/* ------------------------------------------------------------------ */

/** Snapshot IPC handle registrations from module load */
const ipcHandleMap = new Map<string, (...args: any[]) => any>()
for (const [channel, handler] of (ipcMain.handle as Mock).mock.calls) {
  ipcHandleMap.set(channel, handler)
}

/** Snapshot IPC on registrations from module load */
const ipcOnMap = new Map<string, (...args: any[]) => any>()
for (const [channel, handler] of (ipcMain.on as Mock).mock.calls) {
  ipcOnMap.set(channel, handler)
}

/** Snapshot app.on registrations from module load */
const appOnMap = new Map<string, (...args: any[]) => any>()
for (const [event, handler] of (app.on as Mock).mock.calls) {
  appOnMap.set(event, handler)
}

/** Snapshot that app.whenReady was called during module load */
const whenReadyCalledDuringLoad = (app.whenReady as Mock).mock.calls.length > 0

/**
 * Capture the 'activate' handler registered inside whenReady().then().
 * The mock resolves immediately, so the .then() runs as a microtask.
 * We need to flush microtasks and capture the handler BEFORE clearAllMocks wipes it.
 */
let activateHandler: ((...args: any[]) => any) | undefined

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Get an IPC handler registered via ipcMain.handle */
function getIpcHandler(channel: string): ((...args: any[]) => any) | undefined {
  return ipcHandleMap.get(channel)
}

/** Get an IPC handler registered via ipcMain.on */
function getIpcOnHandler(channel: string): ((...args: any[]) => any) | undefined {
  return ipcOnMap.get(channel)
}

/** Get a handler registered via app.on. Falls back to latest mock calls for
 *  events registered asynchronously (e.g. 'activate' inside whenReady). */
function getAppOnHandler(event: string): ((...args: any[]) => any) | undefined {
  const captured = appOnMap.get(event)
  if (captured) return captured
  // Fallback: search current mock calls (for async registrations)
  const calls = (app.on as Mock).mock.calls
  const match = calls.find((c: any[]) => c[0] === event)
  return match ? match[1] : undefined
}

/** Helper to find a menu item by label in the last captured template */
function findMenuItem(label: string): any | undefined {
  function search(items: any[]): any {
    for (const item of items) {
      if (item.label === label) return item
      if (item.submenu) {
        const found = search(item.submenu)
        if (found) return found
      }
    }
    return undefined
  }
  return search(lastMenuTemplateRef.value)
}

/* ------------------------------------------------------------------ */
/*  One-time setup: flush microtasks so whenReady().then() completes   */
/* ------------------------------------------------------------------ */
beforeAll(async () => {
  // whenReady() resolves immediately (mocked), but .then() runs as a microtask.
  // We need to flush microtasks to capture the 'activate' handler on app.on.
  await new Promise(resolve => setTimeout(resolve, 10))
  const calls = (app.on as Mock).mock.calls
  const match = calls.find((c: any[]) => c[0] === 'activate')
  if (match) activateHandler = match[1]
})

/* ------------------------------------------------------------------ */
/*  Reset shared state before each test                                */
/* ------------------------------------------------------------------ */
beforeEach(() => {
  vi.clearAllMocks()

  // Reset __testing state
  __testing.mainWindow = null
  __testing.tray = null
  __testing.isMuted = false
  __testing.isInCall = false
  __testing.isQuitting = false

    // Re-set process.getSystemVersion mock (Electron API)
    ; (process as any).getSystemVersion = vi.fn().mockReturnValue('10.0.0')

  // Re-set default mock behaviours that individual tests may override
  mockIcon.isEmpty.mockReturnValue(false)
  mockIcon.getSize.mockReturnValue({ width: 256, height: 256 })
  mockIcon.resize.mockReturnValue(mockResizedImage)
  existsSyncMock.mockReturnValue(false)
  electronMock.nativeImage.createFromPath.mockReturnValue(mockIcon)
  electronMock.nativeImage.createFromDataURL.mockReturnValue(mockFallbackIcon)
  electronMock.systemPreferences.getMediaAccessStatus.mockReturnValue('granted')
  electronMock.systemPreferences.askForMediaAccess.mockResolvedValue(true)
  electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
  mockBrowserWindowInstance.isVisible.mockReturnValue(true)

    // Reset BrowserWindow & Tray constructors (use function for constructor compatibility)
    ; (electronMock.BrowserWindow as unknown as Mock).mockImplementation(function () { return mockBrowserWindowInstance })
    ; (electronMock.Tray as unknown as Mock).mockImplementation(function () { return mockTrayInstance })
})

/* ================================================================== */
/*  TESTS                                                              */
/* ================================================================== */

describe('getAppIconPath', () => {
  it('returns the first existing path', () => {
    existsSyncMock
      .mockReturnValueOnce(false) // dev path
      .mockReturnValueOnce(true)  // resourcesPath

    const result = __testing.getAppIconPath()
    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(existsSyncMock).toHaveBeenCalledTimes(2)
  })

  it('tries all 4 paths before returning undefined', () => {
    existsSyncMock.mockReturnValue(false)
    const result = __testing.getAppIconPath()
    expect(result).toBeUndefined()
    expect(existsSyncMock).toHaveBeenCalledTimes(4)
  })

  it('returns the very first path if it exists', () => {
    existsSyncMock.mockReturnValueOnce(true)
    const result = __testing.getAppIconPath()
    expect(result).toBeDefined()
    expect(existsSyncMock).toHaveBeenCalledTimes(1)
  })

  it('returns the third path when only that one exists', () => {
    existsSyncMock
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    const result = __testing.getAppIconPath()
    expect(result).toBeDefined()
    expect(existsSyncMock).toHaveBeenCalledTimes(3)
  })

  it('returns the fourth path when only that one exists', () => {
    existsSyncMock
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    const result = __testing.getAppIconPath()
    expect(result).toBeDefined()
    expect(existsSyncMock).toHaveBeenCalledTimes(4)
  })
})

/* ------------------------------------------------------------------ */

describe('getAppIcon', () => {
  describe('when icon file exists and is not empty', () => {
    beforeEach(() => {
      existsSyncMock.mockReturnValueOnce(true) // getAppIconPath finds it
    })

    it('returns the loaded icon for non-tray use without resizing', () => {
      const result = __testing.getAppIcon(false)
      expect(nativeImage.createFromPath).toHaveBeenCalled()
      expect(mockIcon.resize).not.toHaveBeenCalled()
      expect(result).toBe(mockIcon)
    })

    it('resizes to 32 on win32 for tray use', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        const result = __testing.getAppIcon(true)
        expect(mockIcon.resize).toHaveBeenCalledWith({ width: 32, height: 32, quality: 'best' })
        expect(result).toBe(mockResizedImage)
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
      }
    })

    it('resizes to 22 on non-win32 for tray use', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      try {
        __testing.getAppIcon(true)
        expect(mockIcon.resize).toHaveBeenCalledWith({ width: 22, height: 22, quality: 'best' })
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
      }
    })

    it('does not resize for tray if icon already has correct size (win32)', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      mockIcon.getSize.mockReturnValue({ width: 32, height: 32 })
      try {
        const result = __testing.getAppIcon(true)
        expect(mockIcon.resize).not.toHaveBeenCalled()
        expect(result).toBe(mockIcon)
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
      }
    })

    it('does not resize for tray if icon already has correct size (non-win32)', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      mockIcon.getSize.mockReturnValue({ width: 22, height: 22 })
      try {
        const result = __testing.getAppIcon(true)
        expect(mockIcon.resize).not.toHaveBeenCalled()
        expect(result).toBe(mockIcon)
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
      }
    })
  })

  describe('when icon is empty', () => {
    it('falls back to createFallbackIcon', () => {
      existsSyncMock.mockReturnValueOnce(true)
      mockIcon.isEmpty.mockReturnValue(true)
      const result = __testing.getAppIcon(false)
      expect(nativeImage.createFromDataURL).toHaveBeenCalled()
      expect(result).toBe(mockFallbackIcon)
    })
  })

  describe('when createFromPath throws', () => {
    it('falls back to createFallbackIcon', () => {
      existsSyncMock.mockReturnValueOnce(true)
      electronMock.nativeImage.createFromPath.mockImplementation(() => {
        throw new Error('load failed')
      })
      const result = __testing.getAppIcon(false)
      expect(nativeImage.createFromDataURL).toHaveBeenCalled()
      expect(result).toBe(mockFallbackIcon)
    })
  })

  describe('when no icon path found', () => {
    it('falls back to createFallbackIcon', () => {
      existsSyncMock.mockReturnValue(false)
      const result = __testing.getAppIcon(false)
      expect(nativeImage.createFromDataURL).toHaveBeenCalled()
      expect(result).toBe(mockFallbackIcon)
    })
  })

  it('defaults forTray to false when called with no arguments', () => {
    existsSyncMock.mockReturnValue(false) // no icon path found
    __testing.getAppIcon()
    // Fallback icon should be 256 (non-tray). Verify the SVG passed contains 256.
    const call = (nativeImage.createFromDataURL as Mock).mock.calls[0][0]
    const decoded = Buffer.from(call.replace('data:image/svg+xml;base64,', ''), 'base64').toString()
    expect(decoded).toContain('width="256"')
    expect(decoded).toContain('height="256"')
  })
})

/* ------------------------------------------------------------------ */

describe('createFallbackIcon', () => {
  it('creates an SVG icon of size 32 when forTray=true', () => {
    __testing.createFallbackIcon(true)
    const call = (nativeImage.createFromDataURL as Mock).mock.calls[0][0] as string
    expect(call.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const decoded = Buffer.from(call.replace('data:image/svg+xml;base64,', ''), 'base64').toString()
    expect(decoded).toContain('width="32"')
    expect(decoded).toContain('height="32"')
  })

  it('creates an SVG icon of size 256 when forTray=false', () => {
    __testing.createFallbackIcon(false)
    const call = (nativeImage.createFromDataURL as Mock).mock.calls[0][0] as string
    const decoded = Buffer.from(call.replace('data:image/svg+xml;base64,', ''), 'base64').toString()
    expect(decoded).toContain('width="256"')
    expect(decoded).toContain('height="256"')
  })

  it('defaults forTray to false', () => {
    __testing.createFallbackIcon()
    const call = (nativeImage.createFromDataURL as Mock).mock.calls[0][0] as string
    const decoded = Buffer.from(call.replace('data:image/svg+xml;base64,', ''), 'base64').toString()
    expect(decoded).toContain('width="256"')
  })

  it('returns a nativeImage', () => {
    const icon = __testing.createFallbackIcon(false)
    expect(icon).toBe(mockFallbackIcon)
  })
})

/* ------------------------------------------------------------------ */

describe('createTrayIcon', () => {
  it('delegates to getAppIcon with forTray=true', () => {
    // When no path found, fallback is used with forTray=true -> size=32
    existsSyncMock.mockReturnValue(false)
    __testing.createTrayIcon()
    const call = (nativeImage.createFromDataURL as Mock).mock.calls[0][0] as string
    const decoded = Buffer.from(call.replace('data:image/svg+xml;base64,', ''), 'base64').toString()
    expect(decoded).toContain('width="32"')
  })
})

/* ------------------------------------------------------------------ */

describe('createTray', () => {
  it('creates a Tray instance with icon and tooltip', () => {
    __testing.createTray()
    expect(Tray).toHaveBeenCalled()
    expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('P2P Conference')
  })

  it('registers click and double-click handlers', () => {
    __testing.createTray()
    const onCalls = mockTrayInstance.on.mock.calls
    const events = onCalls.map((c: any) => c[0])
    expect(events).toContain('click')
    expect(events).toContain('double-click')
  })

  it('calls updateTrayMenu', () => {
    __testing.createTray()
    // updateTrayMenu calls tray.setContextMenu
    expect(mockTrayInstance.setContextMenu).toHaveBeenCalled()
  })

  it('sets __testing.tray to the created instance', () => {
    __testing.createTray()
    expect(__testing.tray).toBe(mockTrayInstance)
  })

  describe('click handler', () => {
    let clickHandler: (...args: any[]) => void

    beforeEach(() => {
      __testing.createTray()
      const clickCall = mockTrayInstance.on.mock.calls.find((c: any) => c[0] === 'click')
      clickHandler = clickCall[1]
    })

    it('returns early on darwin (no-op)', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      try {
        __testing.mainWindow = mockBrowserWindowInstance as any
        clickHandler()
        // On darwin, the click should not toggle visibility
        expect(mockBrowserWindowInstance.hide).not.toHaveBeenCalled()
        expect(mockBrowserWindowInstance.show).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('hides visible window on Windows/Linux', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        __testing.mainWindow = mockBrowserWindowInstance as any
        mockBrowserWindowInstance.isVisible.mockReturnValue(true)
        clickHandler()
        expect(mockBrowserWindowInstance.hide).toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('shows hidden window on Windows/Linux', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        __testing.mainWindow = mockBrowserWindowInstance as any
        mockBrowserWindowInstance.isVisible.mockReturnValue(false)
        clickHandler()
        expect(mockBrowserWindowInstance.show).toHaveBeenCalled()
        expect(mockBrowserWindowInstance.focus).toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('does nothing when mainWindow is null on non-darwin', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        __testing.mainWindow = null
        expect(() => clickHandler()).not.toThrow()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })
  })

  describe('double-click handler', () => {
    let dblClickHandler: (...args: any[]) => void

    beforeEach(() => {
      __testing.createTray()
      const dblClickCall = mockTrayInstance.on.mock.calls.find((c: any) => c[0] === 'double-click')
      dblClickHandler = dblClickCall[1]
    })

    it('shows and focuses the window', () => {
      __testing.mainWindow = mockBrowserWindowInstance as any
      dblClickHandler()
      expect(mockBrowserWindowInstance.show).toHaveBeenCalled()
      expect(mockBrowserWindowInstance.focus).toHaveBeenCalled()
    })

    it('does nothing when mainWindow is null', () => {
      __testing.mainWindow = null
      expect(() => dblClickHandler()).not.toThrow()
    })
  })
})

/* ------------------------------------------------------------------ */

describe('updateTrayMenu', () => {
  beforeEach(() => {
    __testing.tray = mockTrayInstance as any
  })

  it('returns immediately when tray is null', () => {
    __testing.tray = null
    __testing.updateTrayMenu()
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled()
  })

  it('builds a context menu and sets it on the tray', () => {
    __testing.updateTrayMenu()
    expect(Menu.buildFromTemplate).toHaveBeenCalledWith(expect.any(Array))
    expect(mockTrayInstance.setContextMenu).toHaveBeenCalled()
  })

  describe('when isInCall=false', () => {
    beforeEach(() => {
      __testing.isInCall = false
      __testing.isMuted = false
      __testing.updateTrayMenu()
    })

    it('disables the mute item', () => {
      const muteItem = findMenuItem('Mute Microphone')
      expect(muteItem).toBeDefined()
      expect(muteItem.enabled).toBe(false)
    })

    it('disables the leave call item', () => {
      const leaveItem = findMenuItem('Leave Call')
      expect(leaveItem).toBeDefined()
      expect(leaveItem.enabled).toBe(false)
    })

    it('shows status as Not in Call', () => {
      const statusItem = findMenuItem('\u26AA Not in Call')
      expect(statusItem).toBeDefined()
      expect(statusItem.enabled).toBe(false)
    })
  })

  describe('when isInCall=true', () => {
    beforeEach(() => {
      __testing.isInCall = true
      __testing.isMuted = false
      __testing.updateTrayMenu()
    })

    it('enables the mute item', () => {
      const muteItem = findMenuItem('Mute Microphone')
      expect(muteItem).toBeDefined()
      expect(muteItem.enabled).toBe(true)
    })

    it('enables the leave call item', () => {
      const leaveItem = findMenuItem('Leave Call')
      expect(leaveItem).toBeDefined()
      expect(leaveItem.enabled).toBe(true)
    })

    it('shows status as In Call', () => {
      const statusItem = findMenuItem('\uD83D\uDFE2 In Call')
      expect(statusItem).toBeDefined()
    })
  })

  describe('mute label reflects isMuted', () => {
    it('shows "Mute Microphone" when not muted', () => {
      __testing.isMuted = false
      __testing.isInCall = true
      __testing.updateTrayMenu()
      expect(findMenuItem('Mute Microphone')).toBeDefined()
      expect(findMenuItem('Unmute Microphone')).toBeUndefined()
    })

    it('shows "Unmute Microphone" when muted', () => {
      __testing.isMuted = true
      __testing.isInCall = true
      __testing.updateTrayMenu()
      expect(findMenuItem('Unmute Microphone')).toBeDefined()
      expect(findMenuItem('Mute Microphone')).toBeUndefined()
    })
  })

  describe('menu item click callbacks', () => {
    it('Show Window shows and focuses mainWindow', () => {
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.updateTrayMenu()
      const item = findMenuItem('Show Window')
      item.click()
      expect(mockBrowserWindowInstance.show).toHaveBeenCalled()
      expect(mockBrowserWindowInstance.focus).toHaveBeenCalled()
    })

    it('Show Window is safe when mainWindow is null', () => {
      __testing.mainWindow = null
      __testing.updateTrayMenu()
      const item = findMenuItem('Show Window')
      expect(() => item.click()).not.toThrow()
    })

    it('Hide Window hides mainWindow', () => {
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.updateTrayMenu()
      const item = findMenuItem('Hide Window')
      item.click()
      expect(mockBrowserWindowInstance.hide).toHaveBeenCalled()
    })

    it('Mute toggle flips isMuted, sends IPC, and re-renders', () => {
      __testing.isInCall = true
      __testing.isMuted = false
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.tray = mockTrayInstance as any
      __testing.updateTrayMenu()

      const muteItem = findMenuItem('Mute Microphone')
      muteItem.click()

      expect(__testing.isMuted).toBe(true)
      expect(mockWebContents.send).toHaveBeenCalledWith('tray-toggle-mute')
    })

    it('Leave Call sends tray-leave-call IPC', () => {
      __testing.isInCall = true
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.updateTrayMenu()

      const leaveItem = findMenuItem('Leave Call')
      leaveItem.click()
      expect(mockWebContents.send).toHaveBeenCalledWith('tray-leave-call')
    })

    it('Open Logs Folder calls shell.openPath', () => {
      __testing.updateTrayMenu()
      const item = findMenuItem('Open Logs Folder')
      item.click()
      expect(shell.openPath).toHaveBeenCalledWith('/logs')
    })

    it('Open Logs Folder does nothing when logsDir is falsy', () => {
      ; (fileLogger.getLogsDir as Mock).mockReturnValueOnce('')
      __testing.updateTrayMenu()
      const item = findMenuItem('Open Logs Folder')
      item.click()
      expect(shell.openPath).not.toHaveBeenCalled()
    })

    it('Download Logs sends download-logs IPC', () => {
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.updateTrayMenu()
      const item = findMenuItem('Download Logs')
      item.click()
      expect(mockWebContents.send).toHaveBeenCalledWith('download-logs')
    })

    it('Quit sets isQuitting and calls app.quit', () => {
      __testing.updateTrayMenu()
      const quitItem = findMenuItem('Quit')
      quitItem.click()
      expect(__testing.isQuitting).toBe(true)
      expect(app.quit).toHaveBeenCalled()
    })
  })
})

/* ------------------------------------------------------------------ */

describe('updateTrayIcon', () => {
  beforeEach(() => {
    __testing.tray = mockTrayInstance as any
  })

  it('returns immediately when tray is null', () => {
    __testing.tray = null
    __testing.updateTrayIcon()
    expect(mockTrayInstance.setImage).not.toHaveBeenCalled()
  })

  it('sets a new image on the tray', () => {
    __testing.updateTrayIcon()
    expect(mockTrayInstance.setImage).toHaveBeenCalled()
  })

  it('sets tooltip to base string when not in call', () => {
    __testing.isInCall = false
    __testing.updateTrayIcon()
    expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('P2P Conference')
  })

  it('sets tooltip with "- In Call" when in call and not muted', () => {
    __testing.isInCall = true
    __testing.isMuted = false
    __testing.updateTrayIcon()
    expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('P2P Conference - In Call')
  })

  it('sets tooltip with "- Muted" when in call and muted', () => {
    __testing.isInCall = true
    __testing.isMuted = true
    __testing.updateTrayIcon()
    expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('P2P Conference - Muted')
  })
})

/* ------------------------------------------------------------------ */

describe('createMenu', () => {
  it('builds and sets an application menu', () => {
    __testing.createMenu()
    expect(Menu.buildFromTemplate).toHaveBeenCalled()
    expect(Menu.setApplicationMenu).toHaveBeenCalled()
  })

  it('includes macOS app menu when platform is darwin', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      __testing.createMenu()
      const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
      // First item should be the app name menu on macOS
      expect(template[0].label).toBe('TestApp')
      expect(template[0].submenu).toBeDefined()
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true })
    }
  })

  it('does not include macOS app menu on non-darwin', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      __testing.createMenu()
      const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
      expect(template[0].label).toBe('File')
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true })
    }
  })

  it('File menu last item is role:close on macOS, role:quit on others', () => {
    const orig = process.platform

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    __testing.createMenu()
    let template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    let fileMenu = template.find((m: any) => m.label === 'File')
    let lastItem = fileMenu.submenu[fileMenu.submenu.length - 1]
    expect(lastItem.role).toBe('close')

    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    __testing.createMenu()
    template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    fileMenu = template.find((m: any) => m.label === 'File')
    lastItem = fileMenu.submenu[fileMenu.submenu.length - 1]
    expect(lastItem.role).toBe('quit')

    Object.defineProperty(process, 'platform', { value: orig, configurable: true })
  })

  it('Help menu contains Learn More item', () => {
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const helpMenu = template.find((m: any) => m.label === 'Help')
    expect(helpMenu).toBeDefined()
    const learnMore = helpMenu.submenu.find((i: any) => i.label === 'Learn More')
    expect(learnMore).toBeDefined()
  })

  it('Learn More click opens external URL', async () => {
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const helpMenu = template.find((m: any) => m.label === 'Help')
    const learnMore = helpMenu.submenu.find((i: any) => i.label === 'Learn More')
    await learnMore.click()
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com')
  })

  it('File > Open Logs Folder click opens logs directory', () => {
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const fileMenu = template.find((m: any) => m.label === 'File')
    const openLogs = fileMenu.submenu.find((i: any) => i.label === 'Open Logs Folder')
    openLogs.click()
    expect(shell.openPath).toHaveBeenCalledWith('/logs')
  })

  it('File > Open Logs Folder click does nothing when logsDir is falsy', () => {
    ; (fileLogger.getLogsDir as Mock).mockReturnValueOnce('')
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const fileMenu = template.find((m: any) => m.label === 'File')
    const openLogs = fileMenu.submenu.find((i: any) => i.label === 'Open Logs Folder')
    openLogs.click()
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('File > Download Logs sends download-logs IPC', () => {
    __testing.mainWindow = mockBrowserWindowInstance as any
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const fileMenu = template.find((m: any) => m.label === 'File')
    const downloadLogs = fileMenu.submenu.find((i: any) => i.label === 'Download Logs')
    downloadLogs.click()
    expect(mockWebContents.send).toHaveBeenCalledWith('download-logs')
  })

  it('File > Minimize to Tray hides mainWindow', () => {
    __testing.mainWindow = mockBrowserWindowInstance as any
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const fileMenu = template.find((m: any) => m.label === 'File')
    const minimizeToTray = fileMenu.submenu.find((i: any) => i.label === 'Minimize to Tray')
    minimizeToTray.click()
    expect(mockBrowserWindowInstance.hide).toHaveBeenCalled()
  })

  it('Window > Minimize to Tray hides mainWindow', () => {
    __testing.mainWindow = mockBrowserWindowInstance as any
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const windowMenu = template.find((m: any) => m.label === 'Window')
    const minimizeToTray = windowMenu.submenu.find((i: any) => i.label === 'Minimize to Tray')
    minimizeToTray.click()
    expect(mockBrowserWindowInstance.hide).toHaveBeenCalled()
  })

  it('Help > Open Logs Folder opens logs dir', () => {
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const helpMenu = template.find((m: any) => m.label === 'Help')
    const openLogs = helpMenu.submenu.find((i: any) => i.label === 'Open Logs Folder')
    openLogs.click()
    expect(shell.openPath).toHaveBeenCalledWith('/logs')
  })

  it('Help > Download Logs sends download-logs IPC', () => {
    __testing.mainWindow = mockBrowserWindowInstance as any
    __testing.createMenu()
    const template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    const helpMenu = template.find((m: any) => m.label === 'Help')
    const downloadLogs = helpMenu.submenu.find((i: any) => i.label === 'Download Logs')
    downloadLogs.click()
    expect(mockWebContents.send).toHaveBeenCalledWith('download-logs')
  })

  it('Edit menu varies by platform (macOS includes pasteAndMatchStyle)', () => {
    const orig = process.platform

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    __testing.createMenu()
    let template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    let editMenu = template.find((m: any) => m.label === 'Edit')
    const macRoles = editMenu.submenu.map((i: any) => i.role).filter(Boolean)
    expect(macRoles).toContain('pasteAndMatchStyle')

    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    __testing.createMenu()
    template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    editMenu = template.find((m: any) => m.label === 'Edit')
    const winRoles = editMenu.submenu.map((i: any) => i.role).filter(Boolean)
    expect(winRoles).not.toContain('pasteAndMatchStyle')

    Object.defineProperty(process, 'platform', { value: orig, configurable: true })
  })

  it('Window menu varies by platform (macOS has front/window roles)', () => {
    const orig = process.platform

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    __testing.createMenu()
    let template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    let windowMenu = template.find((m: any) => m.label === 'Window')
    const macRoles = windowMenu.submenu.map((i: any) => i.role).filter(Boolean)
    expect(macRoles).toContain('front')

    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    __testing.createMenu()
    template = (Menu.buildFromTemplate as Mock).mock.calls[0][0]
    windowMenu = template.find((m: any) => m.label === 'Window')
    const winRoles = windowMenu.submenu.map((i: any) => i.role).filter(Boolean)
    expect(winRoles).toContain('close')
    expect(winRoles).not.toContain('front')

    Object.defineProperty(process, 'platform', { value: orig, configurable: true })
  })
})

/* ------------------------------------------------------------------ */

describe('createWindow', () => {
  it('creates a BrowserWindow', () => {
    __testing.createWindow()
    expect(BrowserWindow).toHaveBeenCalled()
  })

  it('sets mainWindow to the created instance', () => {
    __testing.createWindow()
    expect(__testing.mainWindow).toBe(mockBrowserWindowInstance)
  })

  it('registers webContents event handlers', () => {
    __testing.createWindow()
    const events = mockWebContents.on.mock.calls.map((c: any) => c[0])
    expect(events).toContain('did-fail-load')
  })

  it('registers window event handlers (ready-to-show, close, closed)', () => {
    __testing.createWindow()
    const events = mockBrowserWindowInstance.on.mock.calls.map((c: any) => c[0])
    expect(events).toContain('ready-to-show')
    expect(events).toContain('close')
    expect(events).toContain('closed')
  })

  it('sets up COOP/COEP headers', () => {
    __testing.createWindow()
    expect(mockWebContents.session.webRequest.onHeadersReceived).toHaveBeenCalledWith(expect.any(Function))
  })

  describe('COOP/COEP header callback', () => {
    it('adds required headers to the response', () => {
      __testing.createWindow()
      const cb = mockWebContents.session.webRequest.onHeadersReceived.mock.calls[0][0]
      const mockCallback = vi.fn()
      cb({ responseHeaders: { 'Content-Type': ['text/html'] } }, mockCallback)
      expect(mockCallback).toHaveBeenCalledWith({
        responseHeaders: {
          'Content-Type': ['text/html'],
          'Cross-Origin-Opener-Policy': ['same-origin'],
          'Cross-Origin-Embedder-Policy': ['require-corp'],
        }
      })
    })
  })

  describe('preload path resolution', () => {
    // Use path.sep-agnostic matching for cross-platform support
    const normPath = (p: string) => p.replace(/\\/g, '/')

    it('uses the first existing preload path (.mjs)', () => {
      existsSyncMock.mockImplementation((p: string) => {
        const n = normPath(p)
        return n.includes('preload/index.mjs') && !n.includes('out/')
      })

      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(normPath(opts.webPreferences.preload)).toContain('preload/index.mjs')
    })

    it('uses CJS fallback when only .js exists', () => {
      existsSyncMock.mockImplementation((p: string) => {
        const n = normPath(p)
        return n.endsWith('preload/index.js') && !n.includes('out/')
      })

      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(normPath(opts.webPreferences.preload)).toContain('preload/index.js')
    })

    it('falls back to default path when no preload files found', () => {
      existsSyncMock.mockReturnValue(false)
      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(normPath(opts.webPreferences.preload)).toContain('preload/index.js')
    })

    it('uses app path-based preload when available', () => {
      existsSyncMock.mockImplementation((p: string) => {
        return normPath(p).includes('out/preload/index.mjs')
      })

      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(normPath(opts.webPreferences.preload)).toContain('out/preload/index.mjs')
    })
  })

  describe('development mode', () => {
    it('loads URL and opens DevTools', () => {
      const origEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      try {
        __testing.createWindow()
        expect(mockBrowserWindowInstance.loadURL).toHaveBeenCalledWith('http://localhost:5173')
        expect(mockWebContents.openDevTools).toHaveBeenCalled()
      } finally {
        process.env.NODE_ENV = origEnv
      }
    })
  })

  describe('production mode', () => {
    it('loads file from disk', () => {
      const origEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        __testing.createWindow()
        expect(mockBrowserWindowInstance.loadFile).toHaveBeenCalled()
        expect(mockWebContents.openDevTools).not.toHaveBeenCalled()
      } finally {
        process.env.NODE_ENV = origEnv
      }
    })
  })

  describe('BrowserWindow options', () => {
    it('sets contextIsolation=true and nodeIntegration=false', () => {
      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(opts.webPreferences.contextIsolation).toBe(true)
      expect(opts.webPreferences.nodeIntegration).toBe(false)
    })

    it('uses hiddenInset titleBarStyle on macOS', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      try {
        __testing.createWindow()
        const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
        expect(opts.titleBarStyle).toBe('hiddenInset')
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('uses default titleBarStyle on Windows', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        __testing.createWindow()
        const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
        expect(opts.titleBarStyle).toBe('default')
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('sets show: false initially', () => {
      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(opts.show).toBe(false)
    })

    it('passes the app icon to the window', () => {
      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(opts.icon).toBeDefined()
    })

    it('sets minimum dimensions', () => {
      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(opts.minWidth).toBe(800)
      expect(opts.minHeight).toBe(600)
    })

    it('sets default dimensions', () => {
      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(opts.width).toBe(1200)
      expect(opts.height).toBe(800)
    })

    it('disables sandbox', () => {
      __testing.createWindow()
      const opts = (BrowserWindow as unknown as Mock).mock.calls[0][0]
      expect(opts.webPreferences.sandbox).toBe(false)
    })
  })

  describe('ready-to-show handler', () => {
    it('shows the window', () => {
      __testing.createWindow()
      const readyHandler = mockBrowserWindowInstance.on.mock.calls.find(
        (c: any) => c[0] === 'ready-to-show'
      )[1]
      __testing.mainWindow = mockBrowserWindowInstance as any
      readyHandler()
      expect(mockBrowserWindowInstance.show).toHaveBeenCalled()
    })
  })

  describe('close handler', () => {
    let closeHandler: (event: any) => void

    beforeEach(() => {
      __testing.createWindow()
      closeHandler = mockBrowserWindowInstance.on.mock.calls.find(
        (c: any) => c[0] === 'close'
      )[1]
    })

    it('hides to tray when in call and not quitting', () => {
      const event = { preventDefault: vi.fn() }
      __testing.isQuitting = false
      __testing.isInCall = true
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.tray = mockTrayInstance as any

      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        closeHandler(event)
        expect(event.preventDefault).toHaveBeenCalled()
        expect(mockBrowserWindowInstance.hide).toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('shows balloon notification on Windows when hiding to tray', () => {
      const event = { preventDefault: vi.fn() }
      __testing.isQuitting = false
      __testing.isInCall = true
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.tray = mockTrayInstance as any

      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        closeHandler(event)
        expect(mockTrayInstance.displayBalloon).toHaveBeenCalledWith({
          title: 'P2P Conference',
          content: 'App minimized to tray. Call is still active.',
          iconType: 'info',
        })
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('shows balloon on Linux when hiding to tray', () => {
      const event = { preventDefault: vi.fn() }
      __testing.isQuitting = false
      __testing.isInCall = true
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.tray = mockTrayInstance as any

      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      try {
        closeHandler(event)
        expect(mockTrayInstance.displayBalloon).toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('does not show balloon on macOS', () => {
      const event = { preventDefault: vi.fn() }
      __testing.isQuitting = false
      __testing.isInCall = true
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.tray = mockTrayInstance as any

      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      try {
        closeHandler(event)
        expect(mockTrayInstance.displayBalloon).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('does not show balloon when tray is null', () => {
      const event = { preventDefault: vi.fn() }
      __testing.isQuitting = false
      __testing.isInCall = true
      __testing.mainWindow = mockBrowserWindowInstance as any
      __testing.tray = null

      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        closeHandler(event)
        expect(event.preventDefault).toHaveBeenCalled()
        expect(mockTrayInstance.displayBalloon).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('allows close when quitting', () => {
      const event = { preventDefault: vi.fn() }
      __testing.isQuitting = true
      __testing.isInCall = true
      closeHandler(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('allows close when not in call', () => {
      const event = { preventDefault: vi.fn() }
      __testing.isQuitting = false
      __testing.isInCall = false
      closeHandler(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    })
  })

  describe('closed handler', () => {
    it('sets mainWindow to null', () => {
      __testing.createWindow()
      __testing.mainWindow = mockBrowserWindowInstance as any
      const closedHandler = mockBrowserWindowInstance.on.mock.calls.find(
        (c: any) => c[0] === 'closed'
      )[1]
      closedHandler()
      expect(__testing.mainWindow).toBeNull()
    })
  })

  describe('did-fail-load handler', () => {
    it('logs the error', () => {
      __testing.createWindow()
      const failHandler = mockWebContents.on.mock.calls.find(
        (c: any) => c[0] === 'did-fail-load'
      )[1]
      failHandler({}, -3, 'net::ERR_CONNECTION_REFUSED')
      expect(loggerMock.MainLog.error).toHaveBeenCalledWith(
        'Failed to load',
        { errorCode: -3, errorDescription: 'net::ERR_CONNECTION_REFUSED' }
      )
    })
  })
})

/* ------------------------------------------------------------------ */

describe('requestMicrophonePermission', () => {
  it('returns true on non-macOS platforms', async () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const result = await __testing.requestMicrophonePermission()
      expect(result).toBe(true)
      expect(systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true })
    }
  })

  it('returns true on Linux', async () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      const result = await __testing.requestMicrophonePermission()
      expect(result).toBe(true)
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true })
    }
  })

  describe('on macOS', () => {
    const orig = process.platform

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true })
    })

    it('asks for access when status is not-determined and returns true if granted', async () => {
      electronMock.systemPreferences.getMediaAccessStatus.mockReturnValue('not-determined')
      electronMock.systemPreferences.askForMediaAccess.mockResolvedValue(true)

      const result = await __testing.requestMicrophonePermission()
      expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone')
      expect(result).toBe(true)
    })

    it('returns false when access is denied after asking', async () => {
      electronMock.systemPreferences.getMediaAccessStatus.mockReturnValue('not-determined')
      electronMock.systemPreferences.askForMediaAccess.mockResolvedValue(false)

      const result = await __testing.requestMicrophonePermission()
      expect(result).toBe(false)
    })

    it('returns true when status is granted', async () => {
      electronMock.systemPreferences.getMediaAccessStatus.mockReturnValue('granted')

      const result = await __testing.requestMicrophonePermission()
      expect(result).toBe(true)
      expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
    })

    it('returns false when status is denied', async () => {
      electronMock.systemPreferences.getMediaAccessStatus.mockReturnValue('denied')

      const result = await __testing.requestMicrophonePermission()
      expect(result).toBe(false)
      expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
    })

    it('returns false when status is restricted', async () => {
      electronMock.systemPreferences.getMediaAccessStatus.mockReturnValue('restricted')

      const result = await __testing.requestMicrophonePermission()
      expect(result).toBe(false)
      expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
    })
  })
})

/* ================================================================== */
/*  IPC Handlers                                                       */
/* ================================================================== */

describe('IPC handlers', () => {
  describe('get-mic-permission', () => {
    it('is registered', () => {
      expect(ipcHandleMap.has('get-mic-permission')).toBe(true)
    })

    it('returns systemPreferences status on macOS', async () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      electronMock.systemPreferences.getMediaAccessStatus.mockReturnValue('denied')
      try {
        const handler = getIpcHandler('get-mic-permission')!
        const result = await handler()
        expect(result).toBe('denied')
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('returns "granted" on non-macOS', async () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        const handler = getIpcHandler('get-mic-permission')!
        const result = await handler()
        expect(result).toBe('granted')
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })
  })

  describe('request-mic-permission', () => {
    it('is registered', () => {
      expect(ipcHandleMap.has('request-mic-permission')).toBe(true)
    })

    it('delegates to requestMicrophonePermission', async () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        const handler = getIpcHandler('request-mic-permission')!
        const result = await handler()
        expect(result).toBe(true)
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })
  })

  describe('get-app-version', () => {
    it('is registered', () => {
      expect(ipcHandleMap.has('get-app-version')).toBe(true)
    })

    it('returns the app version', () => {
      const handler = getIpcHandler('get-app-version')!
      const result = handler()
      expect(result).toBe('1.2.3')
    })
  })

  describe('get-platform', () => {
    it('is registered', () => {
      expect(ipcHandleMap.has('get-platform')).toBe(true)
    })

    it('returns platform info object', () => {
      const handler = getIpcHandler('get-platform')!
      const result = handler()
      expect(result).toHaveProperty('platform')
      expect(result).toHaveProperty('arch')
      expect(result).toHaveProperty('version')
    })
  })

  describe('log-message', () => {
    it('is registered with ipcMain.on', () => {
      expect(ipcOnMap.has('log-message')).toBe(true)
    })

    it('calls fileLogger.logFromRenderer with all args', () => {
      const handler = getIpcOnHandler('log-message')!
      const args = { level: 'info' as const, module: 'Test', message: 'hello', data: { foo: 1 } }
      handler({}, args)
      expect(fileLogger.logFromRenderer).toHaveBeenCalledWith('info', 'Test', 'hello', { foo: 1 })
    })

    it('calls fileLogger.logFromRenderer without optional data', () => {
      const handler = getIpcOnHandler('log-message')!
      const args = { level: 'warn' as const, module: 'Mod', message: 'msg' }
      handler({}, args)
      expect(fileLogger.logFromRenderer).toHaveBeenCalledWith('warn', 'Mod', 'msg', undefined)
    })
  })

  describe('get-logs-dir', () => {
    it('is registered', () => {
      expect(ipcHandleMap.has('get-logs-dir')).toBe(true)
    })

    it('returns the logs directory', () => {
      const handler = getIpcHandler('get-logs-dir')!
      const result = handler()
      expect(result).toBe('/logs')
    })
  })

  describe('open-logs-folder', () => {
    it('is registered', () => {
      expect(ipcHandleMap.has('open-logs-folder')).toBe(true)
    })

    it('opens the logs folder and returns true', async () => {
      const handler = getIpcHandler('open-logs-folder')!
      const result = await handler()
      expect(shell.openPath).toHaveBeenCalledWith('/logs')
      expect(result).toBe(true)
    })

    it('returns false when logsDir is falsy', async () => {
      ; (fileLogger.getLogsDir as Mock).mockReturnValueOnce('')
      const handler = getIpcHandler('open-logs-folder')!
      const result = await handler()
      expect(shell.openPath).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('returns false when logsDir is null', async () => {
      ; (fileLogger.getLogsDir as Mock).mockReturnValueOnce(null)
      const handler = getIpcHandler('open-logs-folder')!
      const result = await handler()
      expect(result).toBe(false)
    })
  })

  describe('update-call-state', () => {
    it('is registered with ipcMain.on', () => {
      expect(ipcOnMap.has('update-call-state')).toBe(true)
    })

    it('updates isInCall and isMuted state', () => {
      __testing.tray = mockTrayInstance as any
      const handler = getIpcOnHandler('update-call-state')!
      handler({}, { inCall: true, muted: true })
      expect(__testing.isInCall).toBe(true)
      expect(__testing.isMuted).toBe(true)
    })

    it('calls updateTrayIcon and updateTrayMenu', () => {
      __testing.tray = mockTrayInstance as any
      const handler = getIpcOnHandler('update-call-state')!
      handler({}, { inCall: false, muted: false })
      expect(mockTrayInstance.setImage).toHaveBeenCalled()
      expect(mockTrayInstance.setToolTip).toHaveBeenCalled()
      expect(mockTrayInstance.setContextMenu).toHaveBeenCalled()
    })
  })

  describe('update-mute-state', () => {
    it('is registered with ipcMain.on', () => {
      expect(ipcOnMap.has('update-mute-state')).toBe(true)
    })

    it('updates isMuted to true', () => {
      __testing.tray = mockTrayInstance as any
      const handler = getIpcOnHandler('update-mute-state')!
      handler({}, true)
      expect(__testing.isMuted).toBe(true)
    })

    it('updates isMuted to false', () => {
      __testing.isMuted = true
      __testing.tray = mockTrayInstance as any
      const handler = getIpcOnHandler('update-mute-state')!
      handler({}, false)
      expect(__testing.isMuted).toBe(false)
    })

    it('calls updateTrayIcon and updateTrayMenu', () => {
      __testing.tray = mockTrayInstance as any
      const handler = getIpcOnHandler('update-mute-state')!
      handler({}, false)
      expect(mockTrayInstance.setImage).toHaveBeenCalled()
      expect(mockTrayInstance.setContextMenu).toHaveBeenCalled()
    })
  })

  describe('show-window', () => {
    it('is registered with ipcMain.on', () => {
      expect(ipcOnMap.has('show-window')).toBe(true)
    })

    it('shows and focuses mainWindow', () => {
      __testing.mainWindow = mockBrowserWindowInstance as any
      const handler = getIpcOnHandler('show-window')!
      handler()
      expect(mockBrowserWindowInstance.show).toHaveBeenCalled()
      expect(mockBrowserWindowInstance.focus).toHaveBeenCalled()
    })

    it('does nothing when mainWindow is null', () => {
      __testing.mainWindow = null
      const handler = getIpcOnHandler('show-window')!
      expect(() => handler()).not.toThrow()
    })
  })

  describe('flash-window', () => {
    it('is registered with ipcMain.on', () => {
      expect(ipcOnMap.has('flash-window')).toBe(true)
    })

    it('calls flashFrame(true) on mainWindow', () => {
      __testing.mainWindow = mockBrowserWindowInstance as any
      const handler = getIpcOnHandler('flash-window')!
      handler()
      expect(mockBrowserWindowInstance.flashFrame).toHaveBeenCalledWith(true)
    })

    it('does nothing when mainWindow is null', () => {
      __testing.mainWindow = null
      const handler = getIpcOnHandler('flash-window')!
      expect(() => handler()).not.toThrow()
    })
  })

  describe('get-ice-servers', () => {
    it('is registered', () => {
      expect(ipcHandleMap.has('get-ice-servers')).toBe(true)
    })

    it('returns ICE servers from credentials', () => {
      const handler = getIpcHandler('get-ice-servers')!
      const result = handler()
      expect(result).toEqual([{ urls: 'stun:stun.example.com' }])
      expect(credentialsMock.getICEServers).toHaveBeenCalled()
    })
  })

  describe('get-mqtt-brokers', () => {
    it('is registered', () => {
      expect(ipcHandleMap.has('get-mqtt-brokers')).toBe(true)
    })

    it('returns MQTT brokers from credentials', () => {
      const handler = getIpcHandler('get-mqtt-brokers')!
      const result = handler()
      expect(result).toEqual([{ url: 'ws://broker' }])
      expect(credentialsMock.getMQTTBrokers).toHaveBeenCalled()
    })
  })
})

/* ================================================================== */
/*  App lifecycle events                                               */
/* ================================================================== */

describe('App lifecycle', () => {
  describe('app.whenReady', () => {
    it('was called during module load', () => {
      expect(whenReadyCalledDuringLoad).toBe(true)
    })
  })

  describe('window-all-closed handler', () => {
    it('is registered', () => {
      expect(appOnMap.has('window-all-closed')).toBe(true)
    })

    it('quits on win32', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        const handler = getAppOnHandler('window-all-closed')!
        handler()
        expect(app.quit).toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('quits on linux', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      try {
        const handler = getAppOnHandler('window-all-closed')!
        handler()
        expect(app.quit).toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })

    it('does not quit on darwin', () => {
      const orig = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      try {
        const handler = getAppOnHandler('window-all-closed')!
        handler()
        expect(app.quit).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: orig, configurable: true })
      }
    })
  })

  describe('before-quit handler', () => {
    it('is registered', () => {
      expect(appOnMap.has('before-quit')).toBe(true)
    })

    it('sets isQuitting to true', () => {
      __testing.isQuitting = false
      const handler = getAppOnHandler('before-quit')!
      handler()
      expect(__testing.isQuitting).toBe(true)
    })
  })

  describe('activate handler (inside whenReady)', () => {
    it('is registered after init', () => {
      expect(activateHandler).toBeTypeOf('function')
    })

    it('shows existing window on activate', () => {
      __testing.mainWindow = mockBrowserWindowInstance as any
      activateHandler!()
      expect(mockBrowserWindowInstance.show).toHaveBeenCalled()
      expect(mockBrowserWindowInstance.focus).toHaveBeenCalled()
    })

    it('creates a new window if no windows exist and mainWindow is null', () => {
      __testing.mainWindow = null
        ; (BrowserWindow as unknown as any).getAllWindows.mockReturnValue([])

        ; (BrowserWindow as unknown as Mock).mockClear()
        ; (BrowserWindow as unknown as Mock).mockImplementation(function () { return mockBrowserWindowInstance })

      activateHandler!()
      expect(BrowserWindow).toHaveBeenCalled()
    })

    it('does not create window if mainWindow is null but other windows exist', () => {
      __testing.mainWindow = null
        ; (BrowserWindow as unknown as any).getAllWindows.mockReturnValue([{}])

        ; (BrowserWindow as unknown as Mock).mockClear()
      activateHandler!()
      expect(BrowserWindow).not.toHaveBeenCalled()
    })
  })
})

/* ================================================================== */
/*  State getters/setters                                              */
/* ================================================================== */

describe('__testing state accessors', () => {
  it('mainWindow getter/setter works', () => {
    const fake = {} as any
    __testing.mainWindow = fake
    expect(__testing.mainWindow).toBe(fake)
    __testing.mainWindow = null
    expect(__testing.mainWindow).toBeNull()
  })

  it('tray getter/setter works', () => {
    const fake = {} as any
    __testing.tray = fake
    expect(__testing.tray).toBe(fake)
    __testing.tray = null
    expect(__testing.tray).toBeNull()
  })

  it('isMuted getter/setter works', () => {
    __testing.isMuted = true
    expect(__testing.isMuted).toBe(true)
    __testing.isMuted = false
    expect(__testing.isMuted).toBe(false)
  })

  it('isInCall getter/setter works', () => {
    __testing.isInCall = true
    expect(__testing.isInCall).toBe(true)
    __testing.isInCall = false
    expect(__testing.isInCall).toBe(false)
  })

  it('isQuitting getter/setter works', () => {
    __testing.isQuitting = true
    expect(__testing.isQuitting).toBe(true)
    __testing.isQuitting = false
    expect(__testing.isQuitting).toBe(false)
  })
})

/* ================================================================== */
/*  All IPC channels registered check                                  */
/* ================================================================== */

describe('All expected IPC channels are registered', () => {
  const expectedHandleChannels = [
    'get-mic-permission',
    'request-mic-permission',
    'get-app-version',
    'get-platform',
    'get-logs-dir',
    'open-logs-folder',
    'get-ice-servers',
    'get-mqtt-brokers',
  ]

  const expectedOnChannels = [
    'log-message',
    'update-call-state',
    'update-mute-state',
    'show-window',
    'flash-window',
  ]

  for (const channel of expectedHandleChannels) {
    it(`ipcMain.handle('${channel}') is registered`, () => {
      expect(ipcHandleMap.has(channel)).toBe(true)
    })
  }

  for (const channel of expectedOnChannels) {
    it(`ipcMain.on('${channel}') is registered`, () => {
      expect(ipcOnMap.has(channel)).toBe(true)
    })
  }
})
