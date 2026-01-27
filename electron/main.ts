/**
 * Electron Main Process
 * Handles window management, system permissions, tray, and IPC communication
 */

import { app, BrowserWindow, ipcMain, systemPreferences, Menu, shell, Tray, nativeImage } from 'electron'
import { join } from 'path'
import { fileLogger, MainLog, TrayLog, IPCLog } from './logger'
import type { LogLevel } from './logger'

// Handle creating/removing shortcuts on Windows when installing/uninstalling
try {
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

/**
 * Create a simple tray icon using nativeImage
 * Creates a 16x16 (or 32x32 for retina) icon with a simple microphone design
 */
function createTrayIcon(muted: boolean = false): Electron.NativeImage {
  // Use PNG icons for Windows/Linux to ensure they render correctly
  if (process.platform !== 'darwin') {
    const iconName = muted ? 'tray-muted.png' : 'tray-default.png'
    const iconPath = join(__dirname, 'icons', iconName)
    // MainLog.debug('Loading tray icon', { path: iconPath })
    return nativeImage.createFromPath(iconPath)
  }

  // Create a simple icon programmatically for macOS (which handles data URLs well)
  // In production, you would use actual icon files
  const size = 22
  const scale = 2

  // Create a data URL for a simple microphone icon
  const canvas = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size * scale}" height="${size * scale}" viewBox="0 0 24 24" fill="none" stroke="${muted ? '#ef4444' : '#3b82f6'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
      ${muted ? '<line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444" stroke-width="2.5"/>' : ''}
    </svg>
  `

  // Convert SVG to data URL
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`

  return nativeImage.createFromDataURL(dataUrl)
}

/**
 * Create and configure the system tray
 */
function createTray(): void {
  const icon = createTrayIcon(isMuted)
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
  const icon = createTrayIcon(isMuted)
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

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
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

  mainWindow.webContents.on('console-message', (_, __, message) => {
    // Note: Renderer logs are now handled via IPC for file logging
    // This just catches any stray console.log calls
  })

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

  MainLog.info('App starting', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: process.versions.electron
  })

  const micPermission = await requestMicrophonePermission()
  MainLog.info('Microphone permission', { granted: micPermission })

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
