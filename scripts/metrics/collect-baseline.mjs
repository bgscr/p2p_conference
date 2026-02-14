#!/usr/bin/env node

import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import path from 'path'
import process from 'process'
import { execSync } from 'child_process'

const ROOT = process.cwd()
const ARTIFACT_DIR = path.join(ROOT, 'artifacts')
const DEFAULT_OUT = path.join(ARTIFACT_DIR, 'baseline-report.json')
const HOTSPOT_BRANCH_FILES = [
  'electron/services/virtualAudioInstaller.ts',
  'src/renderer/App.tsx',
  'src/renderer/signaling/SimplePeerManager.ts',
  'src/renderer/components/RoomView.tsx'
]

function resolveArg(name, fallback) {
  const index = process.argv.findIndex(arg => arg === `--${name}`)
  if (index >= 0 && process.argv[index + 1]) {
    return path.resolve(ROOT, process.argv[index + 1])
  }
  return fallback
}

async function fileExists(targetPath) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function listFilesRecursive(dir) {
  const exists = await fileExists(dir)
  if (!exists) return []

  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

async function collectBundleMetrics() {
  const candidateRoots = [
    path.join(ROOT, 'dist'),
    path.join(ROOT, 'out', 'renderer'),
    path.join(ROOT, 'out')
  ]

  const dedupedFiles = new Map()
  for (const candidateRoot of candidateRoots) {
    const files = await listFilesRecursive(candidateRoot)
    for (const filePath of files) {
      const absolutePath = path.resolve(filePath)
      const dedupeKey = absolutePath.replaceAll('\\', '/').toLowerCase()
      if (!dedupedFiles.has(dedupeKey)) {
        dedupedFiles.set(dedupeKey, absolutePath)
      }
    }
  }

  const jsLikeFiles = Array.from(dedupedFiles.values()).filter(filePath =>
    filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.css')
  )

  const bundles = []
  for (const filePath of jsLikeFiles) {
    const fileStat = await stat(filePath)
    bundles.push({
      file: path.relative(ROOT, filePath).replaceAll('\\', '/'),
      bytes: fileStat.size
    })
  }

  const totalBytes = bundles.reduce((sum, bundle) => sum + bundle.bytes, 0)
  const rendererBytes = bundles
    .filter(bundle => bundle.file.includes('renderer'))
    .reduce((sum, bundle) => sum + bundle.bytes, 0)

  return {
    totalBytes,
    rendererBytes,
    bundles: bundles.sort((a, b) => b.bytes - a.bytes)
  }
}

async function collectCoverageMetrics() {
  const coverageSummaryPath = path.join(ROOT, 'coverage', 'coverage-summary.json')
  const coverageFinalPath = path.join(ROOT, 'coverage', 'coverage-final.json')
  const normalizePath = (value) => String(value).replaceAll('\\', '/')
  const createEmptyHotspotReport = () => Object.fromEntries(
    HOTSPOT_BRANCH_FILES.map((file) => [file, {
      branches: null,
      coveredBranches: null,
      totalBranches: null,
      sourceFile: null
    }])
  )

  const resolveHotspotPath = (keys, targetFile) => {
    const normalizedTarget = normalizePath(targetFile)
    return keys.find((candidate) => normalizePath(candidate).endsWith(normalizedTarget)) || null
  }

  if (await fileExists(coverageSummaryPath)) {
    const summary = JSON.parse(await readFile(coverageSummaryPath, 'utf8'))
    const total = summary.total || {}
    const summaryKeys = Object.keys(summary).filter((key) => key !== 'total')
    const hotspots = createEmptyHotspotReport()

    for (const targetFile of HOTSPOT_BRANCH_FILES) {
      const sourcePath = resolveHotspotPath(summaryKeys, targetFile)
      if (!sourcePath) continue
      const record = summary[sourcePath]
      hotspots[targetFile] = {
        branches: record?.branches?.pct ?? null,
        coveredBranches: record?.branches?.covered ?? null,
        totalBranches: record?.branches?.total ?? null,
        sourceFile: normalizePath(sourcePath)
      }
    }

    return {
      lines: total.lines?.pct ?? null,
      functions: total.functions?.pct ?? null,
      branches: total.branches?.pct ?? null,
      statements: total.statements?.pct ?? null,
      source: 'coverage-summary.json',
      hotspots
    }
  }

  if (await fileExists(coverageFinalPath)) {
    const finalReport = JSON.parse(await readFile(coverageFinalPath, 'utf8'))
    const files = Object.values(finalReport)

    let linesCovered = 0
    let linesTotal = 0
    let functionsCovered = 0
    let functionsTotal = 0
    let branchesCovered = 0
    let branchesTotal = 0
    let statementsCovered = 0
    let statementsTotal = 0
    const finalKeys = Object.keys(finalReport)
    const hotspots = createEmptyHotspotReport()
    const calculateBranchCounters = (branchMap) => {
      let covered = 0
      let total = 0
      for (const branchHits of Object.values(branchMap || {})) {
        const hits = Array.isArray(branchHits) ? branchHits : []
        for (const hit of hits) {
          total += 1
          if (Number(hit) > 0) covered += 1
        }
      }
      return { covered, total }
    }

    for (const fileRecord of files) {
      const record = fileRecord
      const lineEntries = Object.values(record.l ?? {})
      for (const hit of lineEntries) {
        linesTotal += 1
        if (Number(hit) > 0) linesCovered += 1
      }

      const fnEntries = Object.values(record.f ?? {})
      for (const hit of fnEntries) {
        functionsTotal += 1
        if (Number(hit) > 0) functionsCovered += 1
      }

      const statementEntries = Object.values(record.s ?? {})
      for (const hit of statementEntries) {
        statementsTotal += 1
        if (Number(hit) > 0) statementsCovered += 1
      }

      const branchEntries = Object.values(record.b ?? {})
      for (const branchHits of branchEntries) {
        const hits = Array.isArray(branchHits) ? branchHits : []
        for (const hit of hits) {
          branchesTotal += 1
          if (Number(hit) > 0) branchesCovered += 1
        }
      }
    }

    for (const targetFile of HOTSPOT_BRANCH_FILES) {
      const sourcePath = resolveHotspotPath(finalKeys, targetFile)
      if (!sourcePath) continue
      const record = finalReport[sourcePath]
      const counters = calculateBranchCounters(record?.b)
      hotspots[targetFile] = {
        branches: counters.total === 0 ? null : Number(((counters.covered / counters.total) * 100).toFixed(2)),
        coveredBranches: counters.covered,
        totalBranches: counters.total,
        sourceFile: normalizePath(sourcePath)
      }
    }

    const pct = (covered, total) => (total === 0 ? null : Number(((covered / total) * 100).toFixed(2)))
    return {
      lines: pct(linesCovered, linesTotal),
      functions: pct(functionsCovered, functionsTotal),
      branches: pct(branchesCovered, branchesTotal),
      statements: pct(statementsCovered, statementsTotal),
      source: 'coverage-final.json',
      hotspots
    }
  }

  return {
    lines: null,
    functions: null,
    branches: null,
    statements: null,
    source: 'none',
    hotspots: createEmptyHotspotReport()
  }
}

async function readJsonIfPresent(relativePath) {
  const absolutePath = path.join(ROOT, relativePath)
  if (!(await fileExists(absolutePath))) {
    return null
  }
  try {
    const raw = await readFile(absolutePath)
    let content = raw.toString('utf8')
    if (content.includes('\u0000')) {
      content = raw.toString('utf16le')
    }
    content = content.replace(/^\uFEFF/, '')
    return JSON.parse(content)
  } catch {
    return null
  }
}

function collectGitMetadata() {
  const metadata = { branch: null, commit: null }
  try {
    metadata.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
    metadata.commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    // Ignore git metadata failures.
  }
  return metadata
}

function extractVitestDurationMs(report) {
  if (!report) return null
  if (typeof report.duration === 'number') return report.duration
  if (typeof report.testDuration === 'number') return report.testDuration
  if (typeof report.stats?.duration === 'number') return report.stats.duration

  const startTimes = []
  const endTimes = []
  let summedDuration = 0
  let hasDuration = false
  const seen = new Set()

  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item)
      }
      return
    }

    if (typeof value.startTime === 'number') {
      startTimes.push(value.startTime)
    }

    if (typeof value.endTime === 'number') {
      endTimes.push(value.endTime)
    }

    const duration =
      typeof value.duration === 'number'
        ? value.duration
        : typeof value.testDuration === 'number'
          ? value.testDuration
          : null

    if (duration !== null) {
      summedDuration += duration
      hasDuration = true
    }

    for (const child of Object.values(value)) {
      walk(child)
    }
  }

  walk(report)

  if (startTimes.length > 0 && endTimes.length > 0) {
    const durationFromBounds = Math.max(...endTimes) - Math.min(...startTimes)
    if (Number.isFinite(durationFromBounds) && durationFromBounds >= 0) {
      return durationFromBounds
    }
  }

  if (hasDuration) {
    return summedDuration
  }

  return null
}

function extractPlaywrightDurationMs(report) {
  if (!report) return null
  if (typeof report.duration === 'number') return report.duration
  if (typeof report.stats?.duration === 'number') return report.stats.duration

  let summedDuration = 0
  let hasDuration = false
  const seen = new Set()

  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item)
      }
      return
    }

    if (Array.isArray(value.results)) {
      for (const result of value.results) {
        if (typeof result?.duration === 'number') {
          summedDuration += result.duration
          hasDuration = true
        }
      }
    }

    for (const child of Object.values(value)) {
      walk(child)
    }
  }

  walk(report)
  return hasDuration ? summedDuration : null
}

async function main() {
  const outputPath = resolveArg('out', DEFAULT_OUT)
  await mkdir(path.dirname(outputPath), { recursive: true })

  const [bundleMetrics, coverageMetrics, vitestReport, playwrightReport] = await Promise.all([
    collectBundleMetrics(),
    collectCoverageMetrics(),
    readJsonIfPresent('vitest-report.json'),
    readJsonIfPresent('playwright-results.json')
  ])

  const report = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    git: collectGitMetadata(),
    bundle: bundleMetrics,
    coverage: coverageMetrics,
    tests: {
      unitDurationMs: extractVitestDurationMs(vitestReport),
      e2eDurationMs: extractPlaywrightDurationMs(playwrightReport)
    },
    performance: {
      startupMs: null,
      roomJoinMs: null,
      cpuMemoryProfile: null
    }
  }

  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`Baseline report written to ${path.relative(ROOT, outputPath).replaceAll('\\', '/')}`)
}

main().catch((error) => {
  console.error('Failed to collect baseline metrics:', error)
  process.exitCode = 1
})
