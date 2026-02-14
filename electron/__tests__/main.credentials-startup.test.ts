import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

interface MainBootScenario {
  nodeEnv?: string
  isPackaged: boolean
  allowInsecureProduction?: boolean
  validationResult: { ok: boolean; message: string }
  throwOnGetVersion?: boolean
}

interface BootMocks {
  BrowserWindow: Mock
  MainLog: {
    info: Mock
    warn: Mock
    debug: Mock
    error: Mock
  }
  configureCredentialRuntime: Mock
}

async function loadMainForScenario(scenario: MainBootScenario): Promise<BootMocks> {
  vi.resetModules()
  vi.restoreAllMocks()

  process.env = { ...ORIGINAL_ENV }
  if (scenario.nodeEnv == null) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = scenario.nodeEnv
  }
  if (scenario.allowInsecureProduction === true) {
    process.env.P2P_ALLOW_INSECURE_PRODUCTION = 'true'
  } else if (scenario.allowInsecureProduction === false) {
    process.env.P2P_ALLOW_INSECURE_PRODUCTION = 'false'
  } else {
    delete process.env.P2P_ALLOW_INSECURE_PRODUCTION
  }

  ;(process as unknown as { getSystemVersion: () => string }).getSystemVersion = () => '10.0.0'

  const browserWindowInstance = {
    webContents: {
      session: { webRequest: { onHeadersReceived: vi.fn() } },
      on: vi.fn(),
      openDevTools: vi.fn(),
      send: vi.fn()
    },
    on: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn().mockReturnValue(true),
    flashFrame: vi.fn()
  }

  const BrowserWindow = Object.assign(
    vi.fn(function MockedBrowserWindow() {
      return browserWindowInstance
    }),
    { getAllWindows: vi.fn().mockReturnValue([]) }
  )

  const appMock = {
    quit: vi.fn(),
    getPath: vi.fn().mockReturnValue('/tmp'),
    getAppPath: vi.fn().mockReturnValue('/app'),
    getVersion: scenario.throwOnGetVersion
      ? vi.fn(() => {
          throw new Error('version-failure')
        })
      : vi.fn().mockReturnValue('1.2.3'),
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    name: 'TestApp',
    isPackaged: scenario.isPackaged
  }

  const Tray = vi.fn(function MockedTray() {
    return {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      setImage: vi.fn(),
      on: vi.fn(),
      displayBalloon: vi.fn()
    }
  })

  const MainLog = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }

  const credentials = {
    getICEServers: vi.fn().mockReturnValue([]),
    getMQTTBrokers: vi.fn().mockReturnValue([]),
    getSessionCredentials: vi.fn().mockResolvedValue({
      iceServers: [],
      mqttBrokers: [],
      source: 'fallback',
      fetchedAt: Date.now()
    }),
    getCredentialRuntimeSnapshot: vi.fn().mockReturnValue({
      hasCachedSession: false,
      source: null,
      fetchedAt: null,
      expiresAt: null,
      expiresInMs: null,
      cacheStatus: 'missing',
      inFlight: false,
      cacheSkewMs: 60_000,
      lastFetchAttemptAt: null,
      lastFetchSuccessAt: null,
      lastFetchError: null
    }),
    configureCredentialRuntime: vi.fn(),
    validateCredentialConfiguration: vi.fn().mockReturnValue(scenario.validationResult)
  }

  vi.doMock('electron', () => ({
    app: appMock,
    BrowserWindow,
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn()
    },
    systemPreferences: {
      getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
      askForMediaAccess: vi.fn().mockResolvedValue(true)
    },
    Menu: {
      buildFromTemplate: vi.fn(() => ({ items: [] })),
      setApplicationMenu: vi.fn()
    },
    shell: {
      openPath: vi.fn(),
      openExternal: vi.fn()
    },
    Tray,
    nativeImage: {
      createFromPath: vi.fn().mockReturnValue({
        isEmpty: () => true,
        getSize: () => ({ width: 0, height: 0 }),
        resize: vi.fn()
      }),
      createFromDataURL: vi.fn().mockReturnValue({
        isEmpty: () => false,
        getSize: () => ({ width: 32, height: 32 }),
        resize: vi.fn()
      })
    },
    session: {
      defaultSession: {}
    }
  }))

  vi.doMock('fs', () => {
    const fsMock = {
      existsSync: vi.fn().mockReturnValue(false)
    }
    return {
      ...fsMock,
      default: fsMock
    }
  })

  vi.doMock('../logger', () => ({
    fileLogger: {
      init: vi.fn().mockResolvedValue(undefined),
      getLogsDir: vi.fn().mockReturnValue('/logs'),
      getCurrentLogFile: vi.fn().mockReturnValue('/logs/current.log'),
      logFromRenderer: vi.fn()
    },
    MainLog,
    TrayLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    IPCLog: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
  }))

  vi.doMock('../credentials', () => credentials)
  vi.doMock('../services/displayMedia', () => ({
    setupDisplayMediaHandler: vi.fn(),
    getScreenSourcesForIpc: vi.fn().mockResolvedValue([])
  }))
  vi.doMock('../services/virtualAudioInstaller', () => ({
    installVirtualAudioDriver: vi.fn().mockResolvedValue({
      provider: 'vb-cable',
      state: 'installed'
    }),
    getVirtualAudioInstallerState: vi.fn().mockReturnValue({
      inProgress: false,
      platformSupported: true
    }),
    validateBundledVirtualAudioAssets: vi.fn().mockReturnValue({
      ok: true,
      message: 'ok'
    })
  }))
  vi.doMock('../services/diagnosticsBundle', () => ({
    exportDiagnosticsBundle: vi.fn().mockResolvedValue({
      ok: true,
      path: '/logs/diagnostics/test.json'
    })
  }))

  await import('../main')
  await new Promise(resolve => setTimeout(resolve, 0))

  return {
    BrowserWindow,
    MainLog,
    configureCredentialRuntime: credentials.configureCredentialRuntime
  }
}

describe('main startup credential policy', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('fails closed in secure production mode when credential configuration is invalid', async () => {
    const mocks = await loadMainForScenario({
      nodeEnv: 'production',
      isPackaged: true,
      allowInsecureProduction: false,
      validationResult: {
        ok: false,
        message: 'invalid credential posture'
      }
    })

    expect(mocks.configureCredentialRuntime).toHaveBeenCalledWith({
      isProduction: true,
      enforceSecureProduction: true
    })
    expect(mocks.BrowserWindow).not.toHaveBeenCalled()
    expect(mocks.MainLog.error).toHaveBeenCalledWith(
      'Credential validation failed in secure production mode',
      expect.objectContaining({ message: 'invalid credential posture' })
    )
    expect(mocks.MainLog.error).toHaveBeenCalledWith(
      'Failed to initialize app',
      expect.objectContaining({ error: 'invalid credential posture' })
    )
  })

  it('allows insecure production override to bypass credential boot block', async () => {
    const mocks = await loadMainForScenario({
      nodeEnv: 'production',
      isPackaged: true,
      allowInsecureProduction: true,
      validationResult: {
        ok: false,
        message: 'missing secure credentials'
      },
      throwOnGetVersion: true
    })

    expect(mocks.configureCredentialRuntime).toHaveBeenCalledWith({
      isProduction: true,
      enforceSecureProduction: false
    })
    expect(mocks.MainLog.warn).toHaveBeenCalledWith(
      'Credential validation failed (dev mode fallback allowed)',
      expect.objectContaining({ message: 'missing secure credentials' })
    )
  })

  it('defaults to insecure production startup when override is unset', async () => {
    const mocks = await loadMainForScenario({
      nodeEnv: 'production',
      isPackaged: true,
      validationResult: {
        ok: false,
        message: 'missing secure credentials'
      },
      throwOnGetVersion: true
    })

    expect(mocks.configureCredentialRuntime).toHaveBeenCalledWith({
      isProduction: true,
      enforceSecureProduction: false
    })
    expect(mocks.MainLog.warn).toHaveBeenCalledWith(
      'Credential validation failed (dev mode fallback allowed)',
      expect.objectContaining({ message: 'missing secure credentials' })
    )
  })

  it('does not fail closed in development even when credential validation fails', async () => {
    const mocks = await loadMainForScenario({
      nodeEnv: 'development',
      isPackaged: false,
      allowInsecureProduction: false,
      validationResult: {
        ok: false,
        message: 'dev-only missing secure credentials'
      },
      throwOnGetVersion: true
    })

    expect(mocks.configureCredentialRuntime).toHaveBeenCalledWith({
      isProduction: false,
      enforceSecureProduction: true
    })
    expect(mocks.MainLog.warn).toHaveBeenCalledWith(
      'Credential validation failed (dev mode fallback allowed)',
      expect.objectContaining({ message: 'dev-only missing secure credentials' })
    )
  })
})
