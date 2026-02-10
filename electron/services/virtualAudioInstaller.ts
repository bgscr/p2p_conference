import { app } from 'electron'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

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

interface VBCableManifest {
  provider: VirtualAudioProvider
  version: string
  installerFile: string
  sha256: string
  expectedPublisher?: string
  expectedSignerContains?: string
  expectedTeamId?: string
  requireNotarization?: boolean
  verificationMode?: 'hash-only' | 'strict'
  packageId?: string
  silentArgs?: string[]
  timeoutMs?: number
}

const DEFAULT_INSTALL_TIMEOUT_MS = 180000
const INSTALLER_DIR_SEGMENTS: Record<VirtualAudioProvider, string[]> = {
  'vb-cable': ['drivers', 'vb-cable'],
  blackhole: ['drivers', 'blackhole']
}

let activeInstallPromise: Promise<VirtualAudioInstallResult> | null = null
let activeProvider: VirtualAudioProvider | undefined

function isWindows(): boolean {
  return process.platform === 'win32'
}

function isMacOS(): boolean {
  return process.platform === 'darwin'
}

function toPSSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function toAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function getInstallerDirSegments(provider: VirtualAudioProvider): string[] {
  return INSTALLER_DIR_SEGMENTS[provider]
}

export function getPreferredProviderForPlatform(platform: NodeJS.Platform = process.platform): VirtualAudioProvider | null {
  if (platform === 'win32') {
    return 'vb-cable'
  }
  if (platform === 'darwin') {
    return 'blackhole'
  }
  return null
}

function isProviderSupported(provider: VirtualAudioProvider): boolean {
  if (provider === 'vb-cable') {
    return isWindows()
  }
  if (provider === 'blackhole') {
    return isMacOS()
  }
  return false
}

function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message))
          return
        }
        resolve(stdout.trim())
      }
    )
  })
}

function runCommand(filePath: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      filePath,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          const details = (stderr || stdout || error.message || '').toString().trim()
          reject(new Error(details || String(error)))
          return
        }
        resolve((stdout || '').toString().trim())
      }
    )
  })
}

function mapExitCode(code: number): VirtualAudioInstallResult['state'] {
  switch (code) {
    case 0:
      return 'installed'
    case 1638:
      return 'already-installed'
    case 3010:
    case 1641:
      return 'reboot-required'
    case 1223:
      return 'user-cancelled'
    default:
      return 'failed'
  }
}

function getCandidateInstallerDirs(provider: VirtualAudioProvider): string[] {
  const segments = getInstallerDirSegments(provider)
  return [
    join(process.resourcesPath || '', ...segments),
    join(app.getAppPath(), 'build', ...segments),
    join(process.cwd(), 'build', ...segments)
  ]
}

function resolveManifestPath(provider: VirtualAudioProvider): string | null {
  const path = getCandidateInstallerDirs(provider)
    .map((dir) => join(dir, 'manifest.json'))
    .find((candidate) => existsSync(candidate))
  return path || null
}

function loadManifest(provider: VirtualAudioProvider): { manifest: VBCableManifest; manifestPath: string; installerPath: string } | null {
  const manifestPath = resolveManifestPath(provider)
  if (!manifestPath) {
    return null
  }

  const raw = readFileSync(manifestPath, 'utf-8')
  const manifest = JSON.parse(raw) as VBCableManifest
  const installerPath = join(manifestPath, '..', manifest.installerFile)

  return { manifest, manifestPath, installerPath }
}

function computeSha256(path: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex').toLowerCase()
}

function getVerificationMode(manifest: VBCableManifest): 'hash-only' | 'strict' {
  if (manifest.verificationMode === 'strict') {
    return 'strict'
  }
  if (manifest.verificationMode === 'hash-only') {
    return 'hash-only'
  }

  // Legacy fallback for existing VB-CABLE manifests.
  if (manifest.provider === 'vb-cable' && manifest.expectedPublisher) {
    return 'strict'
  }
  return 'hash-only'
}

async function verifyWindowsSignature(installerPath: string, expectedSignerContains: string): Promise<{ ok: boolean; message?: string }> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$sig = Get-AuthenticodeSignature -FilePath ${toPSSingleQuoted(installerPath)}`,
    '$result = @{',
    '  status = $sig.Status.ToString()',
    '  subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "" }',
    '}',
    '$result | ConvertTo-Json -Compress'
  ].join('\n')

  try {
    const raw = await runPowerShell(script, 20000)
    const parsed = JSON.parse(raw) as { status?: string; subject?: string }
    const status = parsed.status || ''
    const subject = parsed.subject || ''

    if (status.toLowerCase() !== 'valid') {
      return { ok: false, message: `Authenticode status is ${status || 'unknown'}` }
    }

    if (!subject.toLowerCase().includes(expectedSignerContains.toLowerCase())) {
      return { ok: false, message: 'Installer publisher mismatch' }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Failed to verify signature: ${String(err)}` }
  }
}

async function verifyMacPackageSignature(
  installerPath: string,
  expectedTeamId?: string,
  expectedSignerContains?: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const output = await runCommand('/usr/sbin/pkgutil', ['--check-signature', installerPath], 20000)
    if (!output) {
      return { ok: false, message: 'No signature output from pkgutil.' }
    }

    if (expectedTeamId) {
      const teamIdMatch = output.match(/Team Identifier:\s*(.+)/i)
      const teamId = teamIdMatch?.[1]?.trim()
      if (!teamId || teamId !== expectedTeamId) {
        return { ok: false, message: `Installer Team ID mismatch (found: ${teamId || 'unknown'}).` }
      }
    }

    if (expectedSignerContains) {
      const normalized = output.toLowerCase()
      if (!normalized.includes(expectedSignerContains.toLowerCase())) {
        return { ok: false, message: 'Installer signer does not match expected value.' }
      }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Failed to verify package signature: ${String(err)}` }
  }
}

async function verifyMacNotarization(installerPath: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await runCommand('/usr/sbin/spctl', ['-a', '-vv', '-t', 'install', installerPath], 20000)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: `Installer notarization check failed: ${String(err)}` }
  }
}

async function runStrictVerification(manifest: VBCableManifest, installerPath: string): Promise<{ ok: boolean; message?: string }> {
  if (manifest.provider === 'vb-cable') {
    const expectedSigner = manifest.expectedSignerContains || manifest.expectedPublisher
    if (!expectedSigner) {
      return { ok: false, message: 'Strict verification requires expected signer information.' }
    }
    return verifyWindowsSignature(installerPath, expectedSigner)
  }

  if (manifest.provider === 'blackhole') {
    const signature = await verifyMacPackageSignature(
      installerPath,
      manifest.expectedTeamId,
      manifest.expectedSignerContains
    )
    if (!signature.ok) {
      return signature
    }
    if (manifest.requireNotarization) {
      return verifyMacNotarization(installerPath)
    }
    return { ok: true }
  }

  return { ok: false, message: 'Unsupported provider for strict verification.' }
}

async function executeElevatedInstaller(
  installerPath: string,
  args: string[],
  timeoutMs: number
): Promise<{ code?: number; error?: string }> {
  const argList = args.map((arg) => toPSSingleQuoted(arg)).join(', ')
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$proc = Start-Process -FilePath ${toPSSingleQuoted(installerPath)} -ArgumentList @(${argList}) -Verb RunAs -Wait -PassThru`,
    'Write-Output $proc.ExitCode'
  ].join('\n')

  try {
    const output = await runPowerShell(script, timeoutMs)
    const parsed = Number.parseInt(output, 10)
    if (Number.isNaN(parsed)) {
      return { error: `Unexpected installer output: ${output}` }
    }
    return { code: parsed }
  } catch (err: any) {
    const text = String(err?.message || err || '')
    if (text.toLowerCase().includes('canceled by the user')) {
      return { code: 1223 }
    }
    return { error: text }
  }
}

async function executeMacPkgInstaller(installerPath: string, timeoutMs: number): Promise<{ code?: number; error?: string }> {
  const script = [
    `set pkgPath to ${toAppleScriptString(installerPath)}`,
    'try',
    '  do shell script "/usr/sbin/installer -pkg " & quoted form of pkgPath & " -target /" with administrator privileges',
    '  return "0"',
    'on error errMsg number errNum',
    '  if errNum = -128 then return "1223"',
    '  return errNum as string',
    'end try'
  ].join('\n')

  try {
    const output = await runCommand('/usr/bin/osascript', ['-e', script], timeoutMs)
    const parsed = Number.parseInt(output.trim(), 10)
    if (Number.isNaN(parsed)) {
      return { error: `Unexpected installer output: ${output}` }
    }
    return { code: parsed }
  } catch (err: any) {
    const text = String(err?.message || err || '')
    if (/user canceled|user cancelled|-\s*128|error number -128/i.test(text)) {
      return { code: 1223 }
    }
    const match = text.match(/(?:error number|number)\s+(-?\d+)/i)
    if (match) {
      const parsed = Number.parseInt(match[1], 10)
      if (!Number.isNaN(parsed)) {
        return { code: parsed === -128 ? 1223 : parsed }
      }
    }
    return { error: text }
  }
}

async function isMacPackageInstalled(packageId: string): Promise<boolean> {
  try {
    await runCommand('/usr/sbin/pkgutil', ['--pkg-info', packageId], 15000)
    return true
  } catch {
    return false
  }
}

async function installVBCable(correlationId?: string): Promise<VirtualAudioInstallResult> {
  if (!isProviderSupported('vb-cable')) {
    return {
      provider: 'vb-cable',
      state: 'unsupported',
      message: 'VB-CABLE installer is only supported on Windows.',
      correlationId
    }
  }

  const loaded = loadManifest('vb-cable')
  if (!loaded) {
    return {
      provider: 'vb-cable',
      state: 'failed',
      message: 'VB-CABLE manifest not found in bundled resources.',
      correlationId
    }
  }

  const { manifest, installerPath } = loaded
  if (manifest.provider !== 'vb-cable') {
    return {
      provider: 'vb-cable',
      state: 'failed',
      message: 'VB-CABLE manifest provider mismatch.',
      correlationId
    }
  }

  if (!existsSync(installerPath)) {
    return {
      provider: 'vb-cable',
      state: 'failed',
      message: `VB-CABLE installer not found: ${installerPath}`,
      correlationId
    }
  }

  const actualHash = computeSha256(installerPath)
  if (actualHash !== manifest.sha256.toLowerCase()) {
    return {
      provider: 'vb-cable',
      state: 'failed',
      message: 'Installer hash verification failed.',
      correlationId
    }
  }

  if (getVerificationMode(manifest) === 'strict') {
    const verification = await runStrictVerification(manifest, installerPath)
    if (!verification.ok) {
      return {
        provider: 'vb-cable',
        state: 'failed',
        message: verification.message || 'Installer strict verification failed.',
        correlationId
      }
    }
  }

  const timeoutMs = manifest.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS
  const exec = await executeElevatedInstaller(installerPath, manifest.silentArgs || [], timeoutMs)
  if (typeof exec.code !== 'number') {
    return {
      provider: 'vb-cable',
      state: 'failed',
      message: exec.error || 'VB-CABLE installer failed to start.',
      correlationId
    }
  }

  const state = mapExitCode(exec.code)
  return {
    provider: 'vb-cable',
    state,
    code: exec.code,
    requiresRestart: state === 'reboot-required',
    correlationId,
    message: state === 'failed' ? `Installer exited with code ${exec.code}` : undefined
  }
}

async function installBlackHole(correlationId?: string): Promise<VirtualAudioInstallResult> {
  if (!isProviderSupported('blackhole')) {
    return {
      provider: 'blackhole',
      state: 'unsupported',
      message: 'BlackHole installer is only supported on macOS.',
      correlationId
    }
  }

  const loaded = loadManifest('blackhole')
  if (!loaded) {
    return {
      provider: 'blackhole',
      state: 'failed',
      message: 'BlackHole manifest not found in bundled resources.',
      correlationId
    }
  }

  const { manifest, installerPath } = loaded
  if (manifest.provider !== 'blackhole') {
    return {
      provider: 'blackhole',
      state: 'failed',
      message: 'BlackHole manifest provider mismatch.',
      correlationId
    }
  }

  if (!existsSync(installerPath)) {
    return {
      provider: 'blackhole',
      state: 'failed',
      message: `BlackHole installer not found: ${installerPath}`,
      correlationId
    }
  }

  const actualHash = computeSha256(installerPath)
  if (actualHash !== manifest.sha256.toLowerCase()) {
    return {
      provider: 'blackhole',
      state: 'failed',
      message: 'Installer hash verification failed.',
      correlationId
    }
  }

  if (getVerificationMode(manifest) === 'strict') {
    const verification = await runStrictVerification(manifest, installerPath)
    if (!verification.ok) {
      return {
        provider: 'blackhole',
        state: 'failed',
        message: verification.message || 'Installer strict verification failed.',
        correlationId
      }
    }
  }

  if (manifest.packageId && await isMacPackageInstalled(manifest.packageId)) {
    return {
      provider: 'blackhole',
      state: 'already-installed',
      correlationId
    }
  }

  const timeoutMs = manifest.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS
  const exec = await executeMacPkgInstaller(installerPath, timeoutMs)
  if (typeof exec.code !== 'number') {
    return {
      provider: 'blackhole',
      state: 'failed',
      message: exec.error || 'BlackHole installer failed to start.',
      correlationId
    }
  }

  const state = mapExitCode(exec.code)
  return {
    provider: 'blackhole',
    state,
    code: exec.code,
    requiresRestart: state === 'reboot-required',
    correlationId,
    message: state === 'failed' ? `Installer exited with code ${exec.code}` : undefined
  }
}

export function getVirtualAudioInstallerState(): VirtualAudioInstallerState {
  const preferredProvider = getPreferredProviderForPlatform()
  const platformSupported = preferredProvider !== null
  const bundleValidation = preferredProvider
    ? validateBundledVirtualAudioAssets(preferredProvider)
    : { ok: false, message: 'No virtual audio installer is supported on this platform.' }

  return {
    inProgress: activeInstallPromise !== null,
    platformSupported,
    activeProvider,
    bundleReady: bundleValidation.ok,
    bundleMessage: bundleValidation.message
  }
}

export async function installVirtualAudioDriver(
  provider: VirtualAudioProvider,
  correlationId?: string
): Promise<VirtualAudioInstallResult> {
  if (!isProviderSupported(provider)) {
    return {
      provider,
      state: 'unsupported',
      message: `Provider "${provider}" is unsupported on this platform.`,
      correlationId
    }
  }

  if (activeInstallPromise) {
    return activeInstallPromise
  }

  activeProvider = provider
  activeInstallPromise = (provider === 'vb-cable'
    ? installVBCable(correlationId)
    : installBlackHole(correlationId)).finally(() => {
    activeInstallPromise = null
    activeProvider = undefined
  })

  return activeInstallPromise
}

export function validateBundledVirtualAudioAssets(provider?: VirtualAudioProvider): { ok: boolean; message: string } {
  const resolvedProvider = provider || getPreferredProviderForPlatform()
  if (!resolvedProvider) {
    return { ok: false, message: 'No virtual audio installer is supported on this platform.' }
  }

  const loaded = loadManifest(resolvedProvider)
  if (!loaded) {
    return { ok: false, message: `${resolvedProvider} manifest missing.` }
  }

  const { manifest, installerPath } = loaded
  if (manifest.provider !== resolvedProvider) {
    return { ok: false, message: `${resolvedProvider} manifest provider mismatch.` }
  }

  if (!existsSync(installerPath)) {
    return { ok: false, message: `${resolvedProvider} installer binary missing.` }
  }

  const actualHash = computeSha256(installerPath)
  if (actualHash !== manifest.sha256.toLowerCase()) {
    return { ok: false, message: `${resolvedProvider} installer hash mismatch.` }
  }

  return { ok: true, message: `${resolvedProvider} installer bundle verified.` }
}
