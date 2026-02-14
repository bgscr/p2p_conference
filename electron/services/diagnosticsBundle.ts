import { existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'

const REDACTED_KEYS = ['password', 'token', 'secret', 'credential', 'authorization']

function redactSensitiveData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveData(entry)) as T
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>
    const redactedObject: Record<string, unknown> = {}
    Object.entries(objectValue).forEach(([key, entry]) => {
      const lowerKey = key.toLowerCase()
      redactedObject[key] = REDACTED_KEYS.some((maskedKey) => lowerKey.includes(maskedKey))
        ? '[REDACTED]'
        : redactSensitiveData(entry)
    })
    return redactedObject as T
  }

  return value
}

interface ExportDiagnosticsBundleOptions {
  diagnosticsRootDir: string
  logsDir: string | null
  currentLogFile: string | null
  payload?: unknown
  healthSnapshot: unknown
  appVersion: string
  platform: string
  arch: string
  osVersion: string
  now?: () => number
}

export async function exportDiagnosticsBundle(
  options: ExportDiagnosticsBundleOptions
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const {
    diagnosticsRootDir,
    logsDir,
    currentLogFile,
    payload,
    healthSnapshot,
    appVersion,
    platform,
    arch,
    osVersion,
    now = () => Date.now()
  } = options

  try {
    if (!existsSync(diagnosticsRootDir)) {
      mkdirSync(diagnosticsRootDir, { recursive: true })
    }

    const diagnosticsPath = join(diagnosticsRootDir, `diagnostics-${now()}.json`)
    const diagnosticsPayload = {
      generatedAt: new Date().toISOString(),
      health: healthSnapshot,
      app: { version: appVersion, platform, arch, osVersion },
      logs: { logsDir, currentLogFile },
      payload: redactSensitiveData(payload ?? null)
    }

    await writeFile(diagnosticsPath, JSON.stringify(diagnosticsPayload, null, 2), 'utf8')
    return { ok: true, path: diagnosticsPath }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
