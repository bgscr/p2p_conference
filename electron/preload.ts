/**
 * Electron Preload Script
 * Exposes secure IPC bridge between main and renderer processes
 */

import { contextBridge, ipcRenderer } from 'electron'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type VirtualAudioProvider = 'vb-cable' | 'blackhole'

export type VirtualAudioInstallState =
  | 'installed'
  | 'already-installed'
  | 'reboot-required'
  | 'user-cancelled'
  | 'failed'
  | 'unsupported'

export interface VirtualAudioInstallResult {
  provider: VirtualAudioProvider
  state: VirtualAudioInstallState
  code?: number
  requiresRestart?: boolean
  message?: string
  correlationId?: string
}

export interface VirtualAudioInstallerState {
  inProgress: boolean
  platformSupported: boolean
  activeProvider?: VirtualAudioProvider
  bundleReady: boolean
  bundleMessage?: string
}

export interface SessionCredentials {
  iceServers: Array<{
    urls: string | string[]
    username?: string
    credential?: string
  }>
  mqttBrokers: Array<{
    url: string
    username?: string
    password?: string
  }>
  source: 'endpoint' | 'env' | 'fallback'
  fetchedAt: number
  expiresAt?: number
}

export interface DiagnosticsExportResult {
  ok: boolean
  path?: string
  error?: string
}

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

  /**
   * Get available desktop capture sources for screen sharing fallback.
   */
  getScreenSources: (): Promise<Array<{
    id: string
    name: string
  }>> => ipcRenderer.invoke('get-screen-sources'),

  /**
   * Open remote microphone mapping setup guide.
   */
  openRemoteMicSetupDoc: (): Promise<boolean> => ipcRenderer.invoke('open-remote-mic-setup-doc'),

  /**
   * Get basic platform diagnostics for remote audio routing.
   */
  getAudioRoutingDiagnostics: (): Promise<{
    platform: NodeJS.Platform
    osVersion: string
    appVersion: string
    electronVersion: string
    nodeVersion: string
  }> => ipcRenderer.invoke('get-audio-routing-diagnostics'),

  /**
   * Install a bundled virtual audio driver on supported platforms.
   */
  installVirtualAudioDriver: (
    provider: VirtualAudioProvider,
    correlationId?: string
  ): Promise<VirtualAudioInstallResult> => ipcRenderer.invoke('install-virtual-audio-driver', provider, correlationId),

  /**
   * Get current installer state (single-flight guard + support).
   */
  getVirtualAudioInstallerState: (): Promise<VirtualAudioInstallerState> =>
    ipcRenderer.invoke('get-virtual-audio-installer-state'),
  
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
  }>> => ipcRenderer.invoke('get-mqtt-brokers'),

  /**
   * Get full session credentials with TTL-aware refresh in main process.
   */
  getSessionCredentials: (): Promise<SessionCredentials> => ipcRenderer.invoke('get-session-credentials'),

  /**
   * Export a redacted diagnostics bundle from the main process.
   */
  exportDiagnosticsBundle: (payload?: unknown): Promise<DiagnosticsExportResult> =>
    ipcRenderer.invoke('export-diagnostics-bundle', payload),

  /**
   * Get app and runtime health snapshot from main process.
   */
  getHealthSnapshot: (): Promise<{
    timestamp: string
    uptimeSeconds: number
    appVersion: string
    platform: NodeJS.Platform
    arch: string
    nodeVersion: string
    electronVersion: string
    memoryUsage: {
      rss: number
      heapTotal: number
      heapUsed: number
      external: number
      arrayBuffers: number
    }
    windowVisible: boolean
    inCall: boolean
    muted: boolean
    credentialRuntime?: {
      hasCachedSession: boolean
      source: 'endpoint' | 'env' | 'fallback' | null
      fetchedAt: number | null
      expiresAt: number | null
      expiresInMs: number | null
      cacheStatus: 'missing' | 'fresh' | 'stale' | 'expired'
      inFlight: boolean
      cacheSkewMs: number
      lastFetchAttemptAt: number | null
      lastFetchSuccessAt: number | null
      lastFetchError: string | null
    }
  }> => ipcRenderer.invoke('get-health-snapshot')
}

// Expose to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// TypeScript type declaration for renderer
export type ElectronAPI = typeof electronAPI
