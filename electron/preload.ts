/**
 * Electron Preload Script
 * Exposes secure IPC bridge between main and renderer processes
 */

import { contextBridge, ipcRenderer } from 'electron'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Exposed API for renderer process
 */
const electronAPI = {
  // Microphone permissions
  getMicPermission: (): Promise<string> => ipcRenderer.invoke('get-mic-permission'),
  requestMicPermission: (): Promise<boolean> => ipcRenderer.invoke('request-mic-permission'),
  
  // App info
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getPlatform: (): Promise<{
    platform: NodeJS.Platform
    arch: string
    version: string
  }> => ipcRenderer.invoke('get-platform'),
  
  // Event listeners
  onMicPermissionChanged: (callback: (granted: boolean) => void) => {
    ipcRenderer.on('mic-permission-changed', (_, granted) => callback(granted))
    return () => {
      ipcRenderer.removeAllListeners('mic-permission-changed')
    }
  },
  
  // Download logs handler
  onDownloadLogs: (callback: () => void) => {
    ipcRenderer.on('download-logs', () => callback())
    return () => {
      ipcRenderer.removeAllListeners('download-logs')
    }
  },
  
  // ============================================
  // Logging API
  // ============================================
  
  /**
   * Send a log message to main process for file logging
   */
  log: (level: LogLevel, module: string, message: string, data?: any): void => {
    ipcRenderer.send('log-message', { level, module, message, data })
  },
  
  /**
   * Get the logs directory path
   */
  getLogsDir: (): Promise<string> => ipcRenderer.invoke('get-logs-dir'),
  
  /**
   * Open the logs folder in file explorer
   */
  openLogsFolder: (): Promise<boolean> => ipcRenderer.invoke('open-logs-folder'),
  
  // ============================================
  // System Tray Integration
  // ============================================
  
  /**
   * Update call state in the main process (for tray menu)
   */
  updateCallState: (state: { inCall: boolean; muted: boolean }): void => {
    ipcRenderer.send('update-call-state', state)
  },
  
  /**
   * Update mute state in the main process (for tray icon)
   */
  updateMuteState: (muted: boolean): void => {
    ipcRenderer.send('update-mute-state', muted)
  },
  
  /**
   * Request to show the main window
   */
  showWindow: (): void => {
    ipcRenderer.send('show-window')
  },
  
  /**
   * Flash the window to get user attention
   */
  flashWindow: (): void => {
    ipcRenderer.send('flash-window')
  },
  
  /**
   * Listen for tray mute toggle events
   */
  onTrayToggleMute: (callback: () => void) => {
    ipcRenderer.on('tray-toggle-mute', () => callback())
    return () => {
      ipcRenderer.removeAllListeners('tray-toggle-mute')
    }
  },
  
  /**
   * Listen for tray leave call events
   */
  onTrayLeaveCall: (callback: () => void) => {
    ipcRenderer.on('tray-leave-call', () => callback())
    return () => {
      ipcRenderer.removeAllListeners('tray-leave-call')
    }
  },
  
  // ============================================
  // Credentials API (kept in main process for security)
  // ============================================
  
  /**
   * Get ICE server configuration (STUN + TURN)
   * Credentials are stored in main process to avoid exposure in renderer
   */
  getICEServers: (): Promise<Array<{
    urls: string | string[]
    username?: string
    credential?: string
  }>> => ipcRenderer.invoke('get-ice-servers'),
  
  /**
   * Get MQTT broker configurations
   * Credentials are stored in main process to avoid exposure in renderer
   */
  getMQTTBrokers: (): Promise<Array<{
    url: string
    username?: string
    password?: string
  }>> => ipcRenderer.invoke('get-mqtt-brokers')
}

// Expose to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// TypeScript type declaration for renderer
export type ElectronAPI = typeof electronAPI
