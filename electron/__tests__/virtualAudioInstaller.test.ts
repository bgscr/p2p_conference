import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())
const getAppPathMock = vi.hoisted(() => vi.fn(() => '/app'))

vi.mock('child_process', () => ({
  execFile: execFileMock,
  default: {
    execFile: execFileMock
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: getAppPathMock
  },
  default: {
    app: {
      getAppPath: getAppPathMock
    }
  }
}))

type Provider = 'vb-cable' | 'blackhole'
type ExecCallback = (error: Error | null, stdout?: string, stderr?: string) => void

const ORIGINAL_PLATFORM = process.platform
const ORIGINAL_RESOURCES_PATH = (process as any).resourcesPath

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true
  })
}

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex').toLowerCase()
}

function createBundledInstaller(
  root: string,
  provider: Provider,
  options?: {
    installerFile?: string
    installerContent?: string
    hashOverride?: string
    packageId?: string
    omitInstaller?: boolean
    manifestOverrides?: Record<string, unknown>
  }
): { installerPath: string } {
  const folder = provider === 'vb-cable' ? 'vb-cable' : 'blackhole'
  const defaultInstallerFile = provider === 'vb-cable' ? 'setup.exe' : 'BlackHole2ch.pkg'
  const installerFile = options?.installerFile || defaultInstallerFile
  const installerContent = options?.installerContent || `${provider}-installer`
  const dir = join(root, 'drivers', folder)
  mkdirSync(dir, { recursive: true })

  const installerPath = join(dir, installerFile)
  if (!options?.omitInstaller) {
    writeFileSync(installerPath, installerContent)
  }

  const manifest = {
    provider,
    version: '1.0.0',
    installerFile,
    sha256: options?.hashOverride || sha256(installerContent),
    verificationMode: 'hash-only',
    timeoutMs: 180000,
    ...(options?.packageId ? { packageId: options.packageId } : {}),
    ...(options?.manifestOverrides || {})
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  return { installerPath }
}

describe('virtualAudioInstaller service', () => {
  let tempRoot = ''

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    tempRoot = mkdtempSync(join(tmpdir(), 'p2p-va-installer-'))
    Object.defineProperty(process, 'resourcesPath', {
      value: tempRoot,
      configurable: true
    })
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
    setPlatform(ORIGINAL_PLATFORM)
    Object.defineProperty(process, 'resourcesPath', {
      value: ORIGINAL_RESOURCES_PATH,
      configurable: true
    })
  })

  it('maps preferred provider by platform', async () => {
    const service = await import('../services/virtualAudioInstaller')
    expect(service.getPreferredProviderForPlatform('win32')).toBe('vb-cable')
    expect(service.getPreferredProviderForPlatform('darwin')).toBe('blackhole')
    expect(service.getPreferredProviderForPlatform('linux')).toBeNull()
  })

  it('validates bundled assets when manifest + hash match', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable')
    const service = await import('../services/virtualAudioInstaller')

    expect(service.validateBundledVirtualAudioAssets('vb-cable')).toEqual({
      ok: true,
      message: 'vb-cable installer bundle verified.'
    })

    const state = service.getVirtualAudioInstallerState()
    expect(state.platformSupported).toBe(true)
    expect(state.bundleReady).toBe(true)
  })

  it('reports hash mismatch in bundled validation', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', { hashOverride: 'deadbeef' })
    const service = await import('../services/virtualAudioInstaller')

    const result = service.validateBundledVirtualAudioAssets('blackhole')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('hash mismatch')
  })

  it('returns unsupported install result for non-supported platform/provider combination', async () => {
    setPlatform('linux')
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-unsupported')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'unsupported',
      correlationId: 'cid-unsupported'
    })
  })

  it('installs VB-CABLE successfully on Windows when installer exit code is 0', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable')
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      callback(null, '0', '')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-win')

    expect(execFileMock).toHaveBeenCalled()
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'installed',
      code: 0,
      correlationId: 'cid-win'
    })
  })

  it('uses single-flight lock for concurrent install calls', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable')

    let pendingCallback: ExecCallback = () => {
      throw new Error('expected pending installer callback')
    }
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _opts: any,
        callback: ExecCallback
      ) => {
      pendingCallback = callback
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')

    const first = service.installVirtualAudioDriver('vb-cable', 'cid-1')
    const second = service.installVirtualAudioDriver('vb-cable', 'cid-2')

    expect(execFileMock).toHaveBeenCalledTimes(1)

    const inProgressState = service.getVirtualAudioInstallerState()
    expect(inProgressState.inProgress).toBe(true)
    expect(inProgressState.activeProvider).toBe('vb-cable')

    pendingCallback(null, '0', '')
    const [resultA, resultB] = await Promise.all([first, second])

    expect(resultA.state).toBe('installed')
    expect(resultB.state).toBe('installed')
    expect(service.getVirtualAudioInstallerState().inProgress).toBe(false)
  })

  it('returns already-installed on macOS when packageId is already present', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', { packageId: 'audio.exist.blackhole2ch' })

    execFileMock.mockImplementation((file: string, args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/sbin/pkgutil' && args[0] === '--pkg-info') {
        callback(null, 'package info', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file} ${args.join(' ')}`), '', 'unexpected')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac')

    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'already-installed',
      correlationId: 'cid-mac'
    })
    const calledCommands = execFileMock.mock.calls.map((call) => call[0] as string)
    expect(calledCommands).not.toContain('/usr/bin/osascript')
  })

  it('returns unsupported installer state on non-supported platforms', async () => {
    setPlatform('linux')
    const service = await import('../services/virtualAudioInstaller')
    const state = service.getVirtualAudioInstallerState()

    expect(state).toMatchObject({
      inProgress: false,
      platformSupported: false,
      bundleReady: false
    })
    expect(state.bundleMessage).toContain('No virtual audio installer is supported')
  })

  it('reports validation failure for provider mismatch in manifest', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', {
      manifestOverrides: { provider: 'blackhole' }
    })
    const service = await import('../services/virtualAudioInstaller')

    expect(service.validateBundledVirtualAudioAssets('vb-cable')).toEqual({
      ok: false,
      message: 'vb-cable manifest provider mismatch.'
    })
  })

  it('fails strict windows verification when signer metadata is missing', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', {
      manifestOverrides: { verificationMode: 'strict', expectedPublisher: '' }
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-strict-missing-signer')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-strict-missing-signer'
    })
    expect(result.message).toContain('expected signer')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('fails strict windows verification on signer mismatch', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', {
      manifestOverrides: { verificationMode: 'strict', expectedPublisher: 'VB-Audio' }
    })
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      callback(null, JSON.stringify({ status: 'Valid', subject: 'CN=Unexpected Publisher' }), '')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-strict-mismatch')

    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-strict-mismatch'
    })
    expect(result.message).toContain('publisher mismatch')
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('maps windows UAC cancellation to user-cancelled', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable')
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      callback(new Error('The operation was canceled by the user.'), '', '')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-uac-cancel')

    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'user-cancelled',
      code: 1223,
      correlationId: 'cid-uac-cancel'
    })
  })

  it('maps macOS authorization cancellation to user-cancelled', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole')
    execFileMock.mockImplementation((file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/bin/osascript') {
        callback(new Error('User canceled authorization prompt'), '', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file}`), '', '')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-cancel')

    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'user-cancelled',
      code: 1223,
      correlationId: 'cid-mac-cancel'
    })
  })

  it('runs strict mac verification (signature + notarization) before install', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', {
      manifestOverrides: {
        verificationMode: 'strict',
        expectedTeamId: 'TEAM123',
        expectedSignerContains: 'Existential Audio',
        requireNotarization: true
      }
    })
    execFileMock.mockImplementation((file: string, args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/sbin/pkgutil' && args[0] === '--check-signature') {
        callback(null, 'Developer ID Installer: Existential Audio\nTeam Identifier: TEAM123', '')
        return {} as any
      }
      if (file === '/usr/sbin/spctl') {
        callback(null, 'accepted', '')
        return {} as any
      }
      if (file === '/usr/bin/osascript') {
        callback(null, '0', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file} ${args.join(' ')}`), '', '')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-strict')

    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'installed',
      code: 0,
      correlationId: 'cid-mac-strict'
    })
    const calledCommands = execFileMock.mock.calls.map((call) => call[0] as string)
    expect(calledCommands).toContain('/usr/sbin/pkgutil')
    expect(calledCommands).toContain('/usr/sbin/spctl')
    expect(calledCommands).toContain('/usr/bin/osascript')
  })
})
