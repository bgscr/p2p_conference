#!/usr/bin/env node

import { readFile } from 'fs/promises'
import path from 'path'
import process from 'process'

const ROOT = process.cwd()
const DEFAULT_HOTSPOT_BRANCH_FILES = [
  'electron/services/virtualAudioInstaller.ts',
  'src/renderer/App.tsx',
  'src/renderer/signaling/SimplePeerManager.ts',
  'src/renderer/components/RoomView.tsx'
]

function resolveArg(name) {
  const index = process.argv.findIndex(arg => arg === `--${name}`)
  if (index >= 0 && process.argv[index + 1]) {
    return path.resolve(ROOT, process.argv[index + 1])
  }
  return null
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function pctDelta(current, baseline) {
  if (baseline === 0 || baseline == null || current == null) return null
  return ((current - baseline) / baseline) * 100
}

function formatPct(value) {
  if (value == null) return 'n/a'
  return `${value.toFixed(2)}%`
}

function fail(message) {
  console.error(`THRESHOLD FAILED: ${message}`)
  process.exitCode = 1
}

function parseHotspotFiles(value) {
  if (!value) return DEFAULT_HOTSPOT_BRANCH_FILES
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function main() {
  const currentPath = resolveArg('current') ?? path.join(ROOT, 'artifacts', 'baseline-report.json')
  const baselinePath = resolveArg('baseline')

  const current = await readJson(currentPath)
  const baseline = baselinePath ? await readJson(baselinePath) : null

  const maxRendererRegressionPct = Number(process.env.MAX_RENDERER_SIZE_REGRESSION_PCT ?? '10')
  const minBranchCoverage = Number(process.env.MIN_BRANCH_COVERAGE ?? '90')
  const minLineCoverage = Number(process.env.MIN_LINE_COVERAGE ?? '92')
  const minHotspotBranchCoverage = Number(process.env.MIN_HOTSPOT_BRANCH_COVERAGE ?? '90')
  const hotspotFiles = parseHotspotFiles(process.env.HOTSPOT_BRANCH_FILES)

  const branchCoverage = current.coverage?.branches
  const lineCoverage = current.coverage?.lines
  const hotspotCoverage = current.coverage?.hotspots ?? {}

  if (typeof branchCoverage === 'number' && branchCoverage < minBranchCoverage) {
    fail(`branch coverage ${branchCoverage}% is below required ${minBranchCoverage}%`)
  }

  if (typeof lineCoverage === 'number' && lineCoverage < minLineCoverage) {
    fail(`line coverage ${lineCoverage}% is below required ${minLineCoverage}%`)
  }

  if (baseline) {
    const rendererDelta = pctDelta(current.bundle?.rendererBytes, baseline.bundle?.rendererBytes)
    if (rendererDelta != null && rendererDelta > maxRendererRegressionPct) {
      fail(`renderer bundle grew by ${formatPct(rendererDelta)} (limit ${maxRendererRegressionPct}%)`)
    }
  }

  for (const hotspotFile of hotspotFiles) {
    const hotspot = hotspotCoverage[hotspotFile]
    const hotspotBranches = hotspot?.branches
    if (typeof hotspotBranches !== 'number') {
      fail(`hotspot branch coverage missing for ${hotspotFile}; ensure coverage artifacts include this file`)
      continue
    }
    if (hotspotBranches < minHotspotBranchCoverage) {
      fail(`hotspot branch coverage ${hotspotBranches}% is below required ${minHotspotBranchCoverage}% for ${hotspotFile}`)
    }
  }

  if (process.exitCode !== 1) {
    console.log('Threshold checks passed')
    if (baseline) {
      const rendererDelta = pctDelta(current.bundle?.rendererBytes, baseline.bundle?.rendererBytes)
      console.log(`Renderer bundle delta: ${formatPct(rendererDelta)}`)
    }
    console.log(`Line coverage: ${lineCoverage ?? 'n/a'}%`)
    console.log(`Branch coverage: ${branchCoverage ?? 'n/a'}%`)
    for (const hotspotFile of hotspotFiles) {
      const hotspot = hotspotCoverage[hotspotFile]
      const branches = hotspot?.branches ?? 'n/a'
      const covered = hotspot?.coveredBranches ?? 'n/a'
      const total = hotspot?.totalBranches ?? 'n/a'
      console.log(`Hotspot branch coverage (${hotspotFile}): ${branches}% (${covered}/${total})`)
    }
  }
}

main().catch((error) => {
  console.error('Failed to validate thresholds:', error)
  process.exitCode = 1
})
