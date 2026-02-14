/**
 * Electron Main Process
 * Handles window management, system permissions, tray, and IPC communication
 */

import { app, BrowserWindow, ipcMain, systemPreferences, Menu, shell, Tray, nativeImage, session } from 'electron'

// Suppress security warnings in development (CSP unsafe-eval is required by Vite HMR)
// This warning will not appear in production builds
if (process.env.NODE_ENV === "development" || process.defaultApp) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}
import { join } from 'path'
import { existsSync } from 'fs'
import { fileLogger, MainLog, TrayLog, IPCLog } from './logger'
import type { LogLevel } from './logger'
import {
  getICEServers,
  getMQTTBrokers,
  getSessionCredentials,
  getCredentialRuntimeSnapshot,
  configureCredentialRuntime,
  validateCredentialConfiguration
} from './credentials'
import {
  installVirtualAudioDriver,
  getVirtualAudioInstallerState,
  validateBundledVirtualAudioAssets,
  type VirtualAudioProvider
} from './services/virtualAudioInstaller'
import { exportDiagnosticsBundle } from './services/diagnosticsBundle'
import {
  getScreenSourcesForIpc,
  setupDisplayMediaHandler as setupDisplayMediaRequestHandler
} from './services/displayMedia'

// Handle creating/removing shortcuts on Windows when installing/uninstalling
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (require('electron-squirrel-startup')) {
    app.quit()
  }
} catch {
  // electron-squirrel-startup not installed, skip
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let isMuted = false
let isInCall = false
const appStartTime = Date.now()

function getHealthSnapshot() {
  return {
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - appStartTime) / 1000),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    memoryUsage: process.memoryUsage(),
    windowVisible: mainWindow?.isVisible() ?? false,
    inCall: isInCall,
    muted: isMuted,
    credentialRuntime: getCredentialRuntimeSnapshot()
  }
}

function setupDisplayMediaHandler(): void {
  setupDisplayMediaRequestHandler({ currentSession: session.defaultSession, logger: MainLog })
}

/**
 * Get the application icon path - checks both development and production locations
 * Uses build/icons/icon.png as the main application icon
 */
function getAppIconPath(): string | undefined {
  const possiblePaths = [
    // Development: relative to project root
    join(__dirname, '..', '..', 'build', 'icons', 'icon.png'),
    // Production (packaged): in resources
    join(process.resourcesPath || '', 'icons', 'icon.png'),
    // Alternative: next to the executable
    join(__dirname, 'icons', 'icon.png'),
    // Packaged app: build folder copied to resources
    join(process.resourcesPath || '', 'build', 'icons', 'icon.png'),
  ]

  for (const iconPath of possiblePaths) {
    if (existsSync(iconPath)) {
      MainLog.debug('Found app icon', { path: iconPath })
      return iconPath
    }
  }

  MainLog.warn('App icon not found in any expected location')
  return undefined
}

/**
 * Get the application icon as a NativeImage
 * Resizes for tray use if needed
 */
function getAppIcon(forTray: boolean = false): Electron.NativeImage {
  const iconPath = getAppIconPath()

  if (iconPath) {
    try {
      const icon = nativeImage.createFromPath(iconPath)

      if (!icon.isEmpty()) {
        if (forTray) {
          // Resize for system tray (16x16 or 32x32 on Windows)
          const traySize = process.platform === 'win32' ? 32 : 22
          const size = icon.getSize()
          if (size.width !== traySize || size.height !== traySize) {
            MainLog.debug('Resizing icon for tray', { original: size, target: traySize })
            return icon.resize({ width: traySize, height: traySize, quality: 'best' })
          }
        }
        return icon
      }
    } catch (err) {
      MainLog.warn('Failed to load app icon', { path: iconPath, error: String(err) })
    }
  }

  // Return fallback icon
  return createFallbackIcon(forTray)
}

/**
 * Create a fallback icon when icon files are not available
 */
function createFallbackIcon(forTray: boolean = false): Electron.NativeImage {
  const size = forTray ? 32 : 256

  // Create a simple P2P network icon as SVG
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="6" fill="#3b82f6"/>
      <g transform="translate(4, 4)" fill="none" stroke="white" stroke-width="1.5">
        <!-- Top left node -->
        <rect x="1" y="1" width="8" height="6" rx="1.5"/>
        <!-- Top right node -->
        <rect x="15" y="1" width="8" height="6" rx="1.5"/>
        <!-- Bottom center node -->
        <rect x="8" y="17" width="8" height="6" rx="1.5"/>
        <!-- Connecting lines -->
        <path d="M5 7 L5 11 L12 11 L12 17" stroke-linecap="round"/>
        <path d="M19 7 L19 11 L12 11" stroke-linecap="round"/>
      </g>
    </svg>
  `

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  return nativeImage.createFromDataURL(dataUrl)
}

/**
 * Create the tray icon - uses the app icon
 */
function createTrayIcon(): Electron.NativeImage {
  return getAppIcon(true)
}

/**
 * Create and configure the system tray
 */
function createTray(): void {
  const icon = createTrayIcon()
  tray = new Tray(icon)

  tray.setToolTip('P2P Conference')

  updateTrayMenu()

  // Click behavior differs by platform
  tray.on('click', () => {
    if (process.platform === 'darwin') {
      // On macOS, click shows the menu (default behavior)
      return
    }
    // On Windows/Linux, click toggles window visibility
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  TrayLog.info('System tray created')
}

/**
 * Update the tray context menu based on current state
 */
function updateTrayMenu(): void {
  if (!tray) return

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    {
      label: 'Hide Window',
      click: () => {
        mainWindow?.hide()
      }
    },
    { type: 'separator' },
    {
      label: isMuted ? 'Unmute Microphone' : 'Mute Microphone',
      enabled: isInCall,
      click: () => {
        isMuted = !isMuted
        mainWindow?.webContents.send('tray-toggle-mute')
        updateTrayIcon()
        updateTrayMenu()
        TrayLog.info('Mute toggled from tray', { muted: isMuted })
      }
    },
    {
      label: 'Leave Call',
      enabled: isInCall,
      click: () => {
        mainWindow?.webContents.send('tray-leave-call')
        TrayLog.info('Leave call triggered from tray')
      }
    },
    { type: 'separator' },
    {
      label: isInCall ? '🟢 In Call' : '⚪ Not in Call',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Open Logs Folder',
      click: () => {
        const logsDir = fileLogger.getLogsDir()
        if (logsDir) {
          shell.openPath(logsDir)
        }
      }
    },
    {
      label: 'Download Logs',
      click: () => {
        mainWindow?.webContents.send('download-logs')
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        MainLog.info('App quitting from tray menu')
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
}

/**
 * Update tray icon based on mute state
 */
function updateTrayIcon(): void {
  if (!tray) return
  const icon = createTrayIcon()
  tray.setImage(icon)

  // Update tooltip
  let tooltip = 'P2P Conference'
  if (isInCall) {
    tooltip += isMuted ? ' - Muted' : ' - In Call'
  }
  tray.setToolTip(tooltip)
}

/**
 * Create the application menu
 */
function createMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App Menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),

    // File Menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Logs Folder',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const logsDir = fileLogger.getLogsDir()
            if (logsDir) {
              shell.openPath(logsDir)
            }
          }
        },
        {
          label: 'Download Logs',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            mainWindow?.webContents.send('download-logs')
          }
        },
        { type: 'separator' },
        {
          label: 'Minimize to Tray',
          accelerator: 'CmdOrCtrl+M',
          click: () => {
            mainWindow?.hide()
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },

    // Edit Menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const }
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const }
        ])
      ]
    },

    // View Menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },

    // Window Menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        {
          label: 'Minimize to Tray',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => {
            mainWindow?.hide()
          }
        },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
          { type: 'separator' as const },
          { role: 'window' as const }
        ] : [
          { role: 'close' as const }
        ])
      ]
    },

    // Help Menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Logs Folder',
          click: () => {
            const logsDir = fileLogger.getLogsDir()
            if (logsDir) {
              shell.openPath(logsDir)
            }
          }
        },
        {
          label: 'Download Logs',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            mainWindow?.webContents.send('download-logs')
          }
        },
        { type: 'separator' },
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/**
 * Create the main application window
 */
function createWindow(): void {
  MainLog.info('Creating main window')

  // Get the application icon for the window
  const appIcon = getAppIcon(false)

  // Robust preload path resolution
  const possiblePaths = [
    join(__dirname, '../preload/index.mjs'), // ESM build (default for type: module)
    join(__dirname, '../preload/index.js'),  // CJS build fallback
    join(app.getAppPath(), 'out/preload/index.mjs'),
    join(app.getAppPath(), 'out/preload/index.js')
  ]

  let preloadPath = ''
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      preloadPath = p
      break
    }
  }

  if (preloadPath) {
    MainLog.info('Preload script found', { path: preloadPath })
  } else {
    MainLog.error('Preload script NOT found', { searchedPaths: possiblePaths })
    // Fallback to standard path even if not found (might work in some dev envs)
    preloadPath = join(__dirname, '../preload/index.js')
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: appIcon,  // Set window/taskbar icon
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
  })

  // Set COOP/COEP headers for SharedArrayBuffer support (WAS/AudioWorklet)
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp']
      }
    })
  })

  // Create the menu
  createMenu()

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
    MainLog.info('Loading development server')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    MainLog.info('Loading production build')
  }

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    MainLog.error('Failed to load', { errorCode, errorDescription })
  })

  // Note: Renderer logs are now handled via IPC for file logging
  // No need to capture console-message events here

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    MainLog.info('Main window ready and shown')
  })

  // Minimize to tray instead of closing (when in call)
  mainWindow.on('close', (event) => {
    if (!isQuitting && isInCall) {
      event.preventDefault()
      mainWindow?.hide()
      MainLog.info('Window hidden to tray (call active)')

      // Show notification that app is minimized to tray
      if (tray && process.platform !== 'darwin') {
        tray.displayBalloon({
          title: 'P2P Conference',
          content: 'App minimized to tray. Call is still active.',
          iconType: 'info'
        })
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    MainLog.info('Main window closed')
  })
}

/**
 * Request microphone permission on macOS
 */
async function requestMicrophonePermission(): Promise<boolean> {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    MainLog.info('Checking microphone permission', { status })

    if (status === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      MainLog.info('Microphone permission requested', { granted })
      return granted
    }

    return status === 'granted'
  }

  return true
}

/**
 * App ready handler
 */
app.whenReady().then(async () => {
  // Initialize file logger first
  await fileLogger.init()

  const isProductionRuntime = app.isPackaged || process.env.NODE_ENV === 'production'
  const allowInsecureProduction =
    (process.env.P2P_ALLOW_INSECURE_PRODUCTION ?? 'true').trim().toLowerCase() === 'true'
  const enforceSecureProduction = !allowInsecureProduction

  configureCredentialRuntime({
    isProduction: isProductionRuntime,
    enforceSecureProduction
  })

  const credentialValidation = validateCredentialConfiguration()
  if (!credentialValidation.ok) {
    if (isProductionRuntime && enforceSecureProduction) {
      MainLog.error('Credential validation failed in secure production mode', {
        message: credentialValidation.message
      })
      throw new Error(credentialValidation.message)
    }
    MainLog.warn('Credential validation failed (dev mode fallback allowed)', {
      message: credentialValidation.message
    })
  } else {
    MainLog.info('Credential configuration validated', { message: credentialValidation.message })
  }

  MainLog.info('App starting', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: process.versions.electron
  })

  const micPermission = await requestMicrophonePermission()
  MainLog.info('Microphone permission', { granted: micPermission })

  const defaultVirtualAudioProvider: VirtualAudioProvider | null =
    process.platform === 'win32' ? 'vb-cable' : process.platform === 'darwin' ? 'blackhole' : null
  const bundleValidation = defaultVirtualAudioProvider
    ? validateBundledVirtualAudioAssets(defaultVirtualAudioProvider)
    : { ok: false, message: 'No virtual audio installer is supported on this platform.' }
  if (bundleValidation.ok) {
    MainLog.info('Virtual audio installer assets verified', {
      provider: defaultVirtualAudioProvider,
      platform: process.platform,
      message: bundleValidation.message
    })
  } else {
    MainLog.warn('Virtual audio installer assets unavailable', {
      provider: defaultVirtualAudioProvider,
      platform: process.platform,
      message: bundleValidation.message
    })
  }

  // Configure screen capture support before creating windows.
  setupDisplayMediaHandler()

  createWindow()
  createTray()

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((error) => {
  MainLog.error('Failed to initialize app', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  })
  app.quit()
})

/**
 * Quit when all windows are closed (except on macOS)
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    MainLog.info('All windows closed, quitting')
    app.quit()
  }
})

/**
 * Cleanup on quit
 */
app.on('before-quit', () => {
  isQuitting = true
  MainLog.info('App quitting')
})

/**
 * IPC Handlers
 */

ipcMain.handle('get-mic-permission', async () => {
  if (process.platform === 'darwin') {
    return systemPreferences.getMediaAccessStatus('microphone')
  }
  return 'granted'
})

ipcMain.handle('request-mic-permission', async () => {
  return await requestMicrophonePermission()
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('get-platform', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: process.getSystemVersion()
  }
})

ipcMain.handle('get-screen-sources', async () => {
  const sources = await getScreenSourcesForIpc(IPCLog)
  return sources.map((source) => ({ id: source.id, name: source.name }))
})

ipcMain.handle('open-remote-mic-setup-doc', async () => {
  try {
    const candidates = [
      join(app.getAppPath(), 'docs', 'REMOTE_MIC_SETUP.md'),
      join(process.cwd(), 'docs', 'REMOTE_MIC_SETUP.md')
    ]

    const docPath = candidates.find(candidate => existsSync(candidate))
    if (docPath) {
      await shell.openPath(docPath)
      IPCLog.info('Opened remote mic setup doc', { path: docPath })
      return true
    }

    IPCLog.warn('Remote mic setup doc not found', { searched: candidates })
    return false
  } catch (err) {
    IPCLog.error('Failed to open remote mic setup doc', { error: String(err) })
    return false
  }
})

ipcMain.handle('get-audio-routing-diagnostics', () => {
  return {
    platform: process.platform,
    osVersion: process.getSystemVersion(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node
  }
})

ipcMain.handle('install-virtual-audio-driver', async (_, provider: VirtualAudioProvider, correlationId?: string) => {
  const result = await installVirtualAudioDriver(provider, correlationId)
  IPCLog.info('Virtual audio driver installation result', {
    provider,
    state: result.state,
    code: result.code,
    message: result.message,
    platform: process.platform,
    correlationId: correlationId || null
  })
  return result
})

ipcMain.handle('get-virtual-audio-installer-state', () => {
  return getVirtualAudioInstallerState()
})

/**
 * Logging IPC Handlers
 */

// Handle log messages from renderer process
ipcMain.on('log-message', (_, args: { level: LogLevel; module: string; message: string; data?: any }) => {
  fileLogger.logFromRenderer(args.level, args.module, args.message, args.data)
})

// Get logs directory path
ipcMain.handle('get-logs-dir', () => {
  return fileLogger.getLogsDir()
})

// Open logs folder in file explorer
ipcMain.handle('open-logs-folder', async () => {
  const logsDir = fileLogger.getLogsDir()
  if (logsDir) {
    await shell.openPath(logsDir)
    IPCLog.info('Opened logs folder', { path: logsDir })
    return true
  }
  return false
})

/**
 * Tray-related IPC handlers
 */

// Update call state from renderer
ipcMain.on('update-call-state', (_, state: { inCall: boolean; muted: boolean }) => {
  isInCall = state.inCall
  isMuted = state.muted
  updateTrayIcon()
  updateTrayMenu()
  IPCLog.debug('Call state updated', state)
})

// Update mute state from renderer
ipcMain.on('update-mute-state', (_, muted: boolean) => {
  isMuted = muted
  updateTrayIcon()
  updateTrayMenu()
  IPCLog.debug('Mute state updated', { muted })
})

// Show window from renderer request
ipcMain.on('show-window', () => {
  mainWindow?.show()
  mainWindow?.focus()
})

// Flash window to get attention
ipcMain.on('flash-window', () => {
  mainWindow?.flashFrame(true)
})

/**
 * Credentials IPC handlers
 * These keep sensitive credentials in the main process
 */

ipcMain.handle('get-session-credentials', async () => {
  IPCLog.debug('Session credentials requested')
  try {
    const credentials = await getSessionCredentials()
    return credentials
  } catch (err) {
    IPCLog.error('Failed to resolve session credentials', { error: String(err) })
    throw err
  }
})

// Get ICE servers configuration (STUN + TURN with credentials)
ipcMain.handle('get-ice-servers', () => {
  IPCLog.debug('ICE servers requested')
  return getICEServers()
})

// Get MQTT brokers configuration
ipcMain.handle('get-mqtt-brokers', () => {
  IPCLog.debug('MQTT brokers requested')
  return getMQTTBrokers()
})

ipcMain.handle('get-health-snapshot', () => {
  IPCLog.debug('Health snapshot requested')
  return getHealthSnapshot()
})

ipcMain.handle('export-diagnostics-bundle', async (_event, payload?: unknown) => {
  const diagnosticsDir = join(fileLogger.getLogsDir() || app.getPath('userData'), 'diagnostics')
  const result = await exportDiagnosticsBundle({
    diagnosticsRootDir: diagnosticsDir,
    logsDir: fileLogger.getLogsDir(),
    currentLogFile: fileLogger.getCurrentLogFile(),
    payload,
    healthSnapshot: getHealthSnapshot(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osVersion: process.getSystemVersion()
  })

  if (result.ok) {
    IPCLog.info('Diagnostics bundle exported', { path: result.path })
  } else {
    IPCLog.error('Failed to export diagnostics bundle', { error: result.error })
  }
  return result
})

/**
 * Testing surface - exposes internal helpers and state setters for unit tests only.
 * Not used in production runtime.
 */
export const __testing = {
  getAppIconPath,
  getAppIcon,
  createFallbackIcon,
  createTrayIcon,
  createTray,
  updateTrayMenu,
  updateTrayIcon,
  createMenu,
  createWindow,
  setupDisplayMediaHandler,
  requestMicrophonePermission,
  // State getters/setters for test assertions
  get mainWindow() { return mainWindow },
  set mainWindow(w) { mainWindow = w },
  get tray() { return tray },
  set tray(t) { tray = t },
  get isMuted() { return isMuted },
  set isMuted(v) { isMuted = v },
  get isInCall() { return isInCall },
  set isInCall(v) { isInCall = v },
  get isQuitting() { return isQuitting },
  set isQuitting(v) { isQuitting = v },
}
