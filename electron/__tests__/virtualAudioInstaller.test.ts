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
    vi.restoreAllMocks()
    setPlatform(ORIGINAL_PLATFORM)
    rmSync(tempRoot, { recursive: true, force: true })
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

  it('falls back to app/build installer bundle path when resourcesPath is unavailable', async () => {
    setPlatform('win32')
    Object.defineProperty(process, 'resourcesPath', {
      value: undefined,
      configurable: true
    })
    createBundledInstaller(tempRoot, 'vb-cable')
    getAppPathMock.mockReturnValue(tempRoot)

    const service = await import('../services/virtualAudioInstaller')
    expect(service.validateBundledVirtualAudioAssets('vb-cable')).toEqual({
      ok: true,
      message: 'vb-cable installer bundle verified.'
    })
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

  it('fails installation when manifest is missing for the selected provider', async () => {
    setPlatform('win32')
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot)
    getAppPathMock.mockReturnValueOnce(tempRoot)
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-missing-manifest')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-missing-manifest'
    })
    expect(result.message).toContain('manifest not found')
  })

  it('fails installation when installer binary is missing from bundle', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', { omitInstaller: true })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-missing-installer')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-missing-installer'
    })
    expect(result.message).toContain('installer not found')
  })

  it('maps installer reboot and already-installed exit codes on Windows', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable')
    const outputs = ['3010', '1638']
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      callback(null, outputs.shift() ?? '0', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const rebootResult = await service.installVirtualAudioDriver('vb-cable', 'cid-reboot')
    expect(rebootResult).toMatchObject({
      provider: 'vb-cable',
      state: 'reboot-required',
      code: 3010,
      requiresRestart: true
    })

    const alreadyInstalledResult = await service.installVirtualAudioDriver('vb-cable', 'cid-already')
    expect(alreadyInstalledResult).toMatchObject({
      provider: 'vb-cable',
      state: 'already-installed',
      code: 1638,
      requiresRestart: false
    })
  })

  it('returns failed result when installer output cannot be parsed as numeric code', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable')
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      callback(null, 'not-a-number', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-win-parse-fail')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-win-parse-fail'
    })
    expect(result.message).toContain('Unexpected installer output')
  })

  it('uses default timeout when manifest timeoutMs is omitted for VB-CABLE', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', {
      manifestOverrides: { timeoutMs: undefined }
    })
    execFileMock.mockImplementation((_file: string, _args: string[], opts: any, callback: ExecCallback) => {
      expect(opts?.timeout).toBe(180000)
      callback(null, '0', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-vb-default-timeout')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'installed',
      code: 0,
      correlationId: 'cid-vb-default-timeout'
    })
  })

  it('applies strict verification fallback when expectedPublisher exists without explicit mode', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', {
      manifestOverrides: {
        verificationMode: undefined,
        expectedPublisher: 'VB-Audio'
      }
    })
    execFileMock.mockImplementation((_file: string, args: string[], _opts: any, callback: ExecCallback) => {
      const command = String(args?.[args.length - 1] || '')
      if (command.includes('Get-AuthenticodeSignature')) {
        callback(null, JSON.stringify({ status: 'Valid', subject: 'CN=VB-Audio Software' }), '')
        return {} as any
      }
      callback(null, '0', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-legacy-strict')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'installed',
      code: 0,
      correlationId: 'cid-legacy-strict'
    })
    expect(execFileMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('fails strict mac verification when signature output is empty', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', {
      manifestOverrides: {
        verificationMode: 'strict',
        expectedSignerContains: 'Existential Audio'
      }
    })
    execFileMock.mockImplementation((file: string, args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/sbin/pkgutil' && args[0] === '--check-signature') {
        callback(null, '', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file} ${args.join(' ')}`), '', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-empty-signature')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-mac-empty-signature'
    })
    expect(result.message).toContain('No signature output')
  })

  it('fails strict mac verification when Team ID does not match', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', {
      manifestOverrides: {
        verificationMode: 'strict',
        expectedTeamId: 'TEAM123'
      }
    })
    execFileMock.mockImplementation((file: string, args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/sbin/pkgutil' && args[0] === '--check-signature') {
        callback(null, 'Developer ID Installer: Example\nTeam Identifier: OTHERTEAM', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file} ${args.join(' ')}`), '', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-team-mismatch')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-mac-team-mismatch'
    })
    expect(result.message).toContain('Team ID mismatch')
  })

  it('fails strict mac verification when notarization check fails', async () => {
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
        callback(new Error('spctl rejected package'), '', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file} ${args.join(' ')}`), '', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-notary-fail')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-mac-notary-fail'
    })
    expect(result.message).toContain('notarization check failed')
  })

  it('returns failed when osascript output is non-numeric', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole')
    execFileMock.mockImplementation((file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/bin/osascript') {
        callback(null, 'not-a-code', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file}`), '', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-parse-fail')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-mac-parse-fail'
    })
    expect(result.message).toContain('Unexpected installer output')
  })

  it('maps osascript numeric error string to failed installer exit code', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole')
    execFileMock.mockImplementation((file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/bin/osascript') {
        callback(new Error('installer failed with error number 55'), '', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file}`), '', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-error-number')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      code: 55,
      correlationId: 'cid-mac-error-number'
    })
    expect(result.message).toContain('Installer exited with code 55')
  })

  it('reports missing and installer-binary validation failures explicitly', async () => {
    setPlatform('win32')
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot)
    getAppPathMock.mockReturnValueOnce(tempRoot)
    const service = await import('../services/virtualAudioInstaller')

    expect(service.validateBundledVirtualAudioAssets('vb-cable')).toEqual({
      ok: false,
      message: 'vb-cable manifest missing.'
    })

    createBundledInstaller(tempRoot, 'vb-cable', { omitInstaller: true })
    expect(service.validateBundledVirtualAudioAssets('vb-cable')).toEqual({
      ok: false,
      message: 'vb-cable installer binary missing.'
    })
  })

  it('fails blackhole install when manifest provider mismatches or hash is invalid', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', {
      manifestOverrides: { provider: 'vb-cable' }
    })
    const service = await import('../services/virtualAudioInstaller')

    const providerMismatch = await service.installVirtualAudioDriver('blackhole', 'cid-bh-provider-mismatch')
    expect(providerMismatch).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-bh-provider-mismatch'
    })
    expect(providerMismatch.message).toContain('provider mismatch')

    createBundledInstaller(tempRoot, 'blackhole', { hashOverride: 'deadbeef' })
    const hashMismatch = await service.installVirtualAudioDriver('blackhole', 'cid-bh-hash-mismatch')
    expect(hashMismatch).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-bh-hash-mismatch'
    })
    expect(hashMismatch.message).toContain('hash verification failed')
  })

  it('returns unsupported for cross-platform provider requests', async () => {
    setPlatform('darwin')
    const serviceMac = await import('../services/virtualAudioInstaller')
    const macResult = await serviceMac.installVirtualAudioDriver('vb-cable', 'cid-vb-on-mac')
    expect(macResult).toMatchObject({
      provider: 'vb-cable',
      state: 'unsupported',
      correlationId: 'cid-vb-on-mac'
    })

    vi.resetModules()
    setPlatform('win32')
    const serviceWin = await import('../services/virtualAudioInstaller')
    const winResult = await serviceWin.installVirtualAudioDriver('blackhole', 'cid-bh-on-win')
    expect(winResult).toMatchObject({
      provider: 'blackhole',
      state: 'unsupported',
      correlationId: 'cid-bh-on-win'
    })
  })

  it('validateBundledVirtualAudioAssets reports unsupported when provider is omitted on unsupported platform', async () => {
    setPlatform('linux')
    const service = await import('../services/virtualAudioInstaller')
    expect(service.validateBundledVirtualAudioAssets()).toEqual({
      ok: false,
      message: 'No virtual audio installer is supported on this platform.'
    })
  })

  it('fails strict windows verification when authenticode status is not valid', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', {
      manifestOverrides: { verificationMode: 'strict', expectedPublisher: 'VB-Audio' }
    })
    execFileMock.mockImplementation((_file: string, args: string[], _opts: any, callback: ExecCallback) => {
      const command = String(args?.[args.length - 1] || '')
      if (command.includes('Get-AuthenticodeSignature')) {
        callback(null, JSON.stringify({ status: '', subject: '' }), '')
        return {} as any
      }
      callback(new Error('unexpected command'), '', '')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-strict-invalid-status')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-strict-invalid-status'
    })
    expect(result.message).toContain('Authenticode status')
  })

  it('runs strict mac verification with no team/signer constraints', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', {
      manifestOverrides: {
        verificationMode: 'strict',
        expectedTeamId: undefined,
        expectedSignerContains: undefined,
        requireNotarization: false
      }
    })
    execFileMock.mockImplementation((file: string, args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/sbin/pkgutil' && args[0] === '--check-signature') {
        callback(null, 'Developer ID Installer: Example', '')
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
    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-strict-no-constraints')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'installed',
      code: 0,
      correlationId: 'cid-mac-strict-no-constraints'
    })
  })

  it('fails strict mac verification when signer output does not contain expected signer', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', {
      manifestOverrides: {
        verificationMode: 'strict',
        expectedSignerContains: 'Expected Signer'
      }
    })
    execFileMock.mockImplementation((file: string, args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/sbin/pkgutil' && args[0] === '--check-signature') {
        callback(null, 'Developer ID Installer: Different Signer\nTeam Identifier: TEAM123', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file} ${args.join(' ')}`), '', '')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-signer-mismatch')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-mac-signer-mismatch'
    })
    expect(result.message).toContain('signer does not match')
  })

  it('reports unknown team id when strict mac verification expects team id but output has none', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', {
      manifestOverrides: {
        verificationMode: 'strict',
        expectedTeamId: 'TEAM123'
      }
    })
    execFileMock.mockImplementation((file: string, args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/sbin/pkgutil' && args[0] === '--check-signature') {
        callback(null, 'Developer ID Installer: Example Signer', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file} ${args.join(' ')}`), '', '')
      return {} as any
    })

    const service = await import('../services/virtualAudioInstaller')
    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-team-missing')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-mac-team-missing'
    })
    expect(result.message).toContain('found: unknown')
  })

  it('fails vb-cable install when manifest provider mismatches', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', {
      manifestOverrides: { provider: 'blackhole' }
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-vb-provider-mismatch')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-vb-provider-mismatch'
    })
    expect(result.message).toContain('provider mismatch')
  })

  it('fails vb-cable install when hash verification fails', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable', { hashOverride: 'deadbeef' })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-vb-hash-mismatch')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-vb-hash-mismatch'
    })
    expect(result.message).toContain('hash verification failed')
  })

  it('uses failed exit code message for vb-cable unknown installer code', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable')
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      callback(null, '55', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-vb-exit-55')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      code: 55,
      correlationId: 'cid-vb-exit-55'
    })
    expect(result.message).toContain('Installer exited with code 55')
  })

  it('returns failed with raw error when windows elevated installer fails without cancellation text', async () => {
    setPlatform('win32')
    createBundledInstaller(tempRoot, 'vb-cable')
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      callback(new Error('Access denied by policy'), '', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('vb-cable', 'cid-vb-raw-error')
    expect(result).toMatchObject({
      provider: 'vb-cable',
      state: 'failed',
      correlationId: 'cid-vb-raw-error'
    })
    expect(result.message).toContain('Access denied by policy')
  })

  it('returns failed with raw osascript error when mac installer error has no numeric code', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole')
    execFileMock.mockImplementation((file: string, _args: string[], _opts: any, callback: ExecCallback) => {
      if (file === '/usr/bin/osascript') {
        callback(new Error('osascript crashed unexpectedly'), '', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file}`), '', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('blackhole', 'cid-mac-raw-error')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-mac-raw-error'
    })
    expect(result.message).toContain('osascript crashed unexpectedly')
  })

  it('uses default timeout when manifest timeoutMs is omitted for BlackHole', async () => {
    setPlatform('darwin')
    createBundledInstaller(tempRoot, 'blackhole', {
      manifestOverrides: { timeoutMs: undefined }
    })
    execFileMock.mockImplementation((file: string, _args: string[], opts: any, callback: ExecCallback) => {
      if (file === '/usr/bin/osascript') {
        expect(opts?.timeout).toBe(180000)
        callback(null, '0', '')
        return {} as any
      }
      callback(new Error(`Unexpected command: ${file}`), '', '')
      return {} as any
    })
    const service = await import('../services/virtualAudioInstaller')

    const result = await service.installVirtualAudioDriver('blackhole', 'cid-bh-default-timeout')
    expect(result).toMatchObject({
      provider: 'blackhole',
      state: 'installed',
      code: 0,
      correlationId: 'cid-bh-default-timeout'
    })
  })

  it('fails blackhole install when manifest is missing or installer binary is missing', async () => {
    setPlatform('darwin')
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot)
    getAppPathMock.mockReturnValueOnce(tempRoot)
    const service = await import('../services/virtualAudioInstaller')

    const missingManifest = await service.installVirtualAudioDriver('blackhole', 'cid-bh-missing-manifest')
    expect(missingManifest).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-bh-missing-manifest'
    })
    expect(missingManifest.message).toContain('manifest not found')

    createBundledInstaller(tempRoot, 'blackhole', { omitInstaller: true })
    const missingInstaller = await service.installVirtualAudioDriver('blackhole', 'cid-bh-missing-installer')
    expect(missingInstaller).toMatchObject({
      provider: 'blackhole',
      state: 'failed',
      correlationId: 'cid-bh-missing-installer'
    })
    expect(missingInstaller.message).toContain('installer not found')
  })
})
