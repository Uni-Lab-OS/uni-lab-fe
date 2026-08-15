import type { Dirent } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'

export interface WorkbenchPlcVariableTableCandidate {
  path: string
  relativePath: string
  name: string
  recommended: boolean
  recommendation: 'configured' | 'device-graph' | 'plc-table' | null
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.unilabos',
  '.venv',
  'build',
  'dist',
  'node_modules',
  '__pycache__'
])
const MAX_VISITED_FILES = 10_000
const MAX_DEPTH = 12

/** Find local PLC variable tables without uploading workspace files anywhere. */
export async function discoverWorkbenchPlcVariableTables(options: {
  workspacePath: string
  graphPath?: string
  configuredPath?: string
}): Promise<WorkbenchPlcVariableTableCandidate[]> {
  const workspacePath = await realpath(resolve(options.workspacePath))
  const csvPaths: string[] = []
  let visitedFiles = 0

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visitedFiles >= MAX_VISITED_FILES) return
    let entries: Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      // The Workspace root must remain readable, but one tool-owned cache or
      // restricted child directory must not prevent PLC-Sim CSV discovery.
      if (depth === 0) throw error
      return
    }
    for (const entry of entries) {
      if (visitedFiles >= MAX_VISITED_FILES) break
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      visitedFiles += 1
      if (extname(entry.name).toLowerCase() !== '.csv') continue
      const relativePath = relative(workspacePath, path)
      if (isLikelyPlcVariableTable(relativePath)) csvPaths.push(path)
    }
  }

  await visit(workspacePath, 0)
  const graphReferences = await referencedCsvNames(
    workspacePath,
    options.graphPath
  )
  const configuredPath = await existingCsvPath(options.configuredPath)
  const configuredName = configuredPath ? basename(configuredPath) : null
  const sorted = csvPaths
    .map(path => ({
      path,
      relativePath: relative(workspacePath, path),
      score: plcCandidateScore(relative(workspacePath, path))
    }))
    .sort((left, right) => (
      right.score - left.score
      || right.relativePath.localeCompare(left.relativePath, 'zh-CN')
    ))
  const selectedPath = configuredPath && sorted.some(item => item.path === configuredPath)
    ? configuredPath
    : sorted.find(item => graphReferences.has(basename(item.path)))?.path
      ?? sorted[0]?.path
      ?? null

  return sorted.map(item => {
    const recommended = item.path === selectedPath
    const recommendation = !recommended
      ? null
      : configuredName === basename(item.path)
        ? 'configured'
        : graphReferences.has(basename(item.path))
          ? 'device-graph'
          : 'plc-table'
    return {
      path: item.path,
      relativePath: item.relativePath,
      name: basename(item.path),
      recommended,
      recommendation
    }
  })
}

async function referencedCsvNames(
  workspacePath: string,
  graphPath?: string
): Promise<Set<string>> {
  if (!graphPath?.trim()) return new Set()
  const absolutePath = resolve(workspacePath, graphPath)
  try {
    const content = JSON.parse(await readFile(absolutePath, 'utf8')) as unknown
    const names = new Set<string>()
    collectCsvReferences(content, names)
    return names
  } catch {
    return new Set()
  }
}

function collectCsvReferences(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCsvReferences(item, names)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (
      key === 'csv_path'
      && typeof item === 'string'
      && extname(item).toLowerCase() === '.csv'
    ) {
      names.add(basename(item))
    }
    collectCsvReferences(item, names)
  }
}

async function existingCsvPath(candidate?: string): Promise<string | null> {
  if (!candidate?.trim() || extname(candidate).toLowerCase() !== '.csv') {
    return null
  }
  try {
    const path = await realpath(resolve(candidate))
    return (await stat(path)).isFile() ? path : null
  } catch {
    return null
  }
}

function isLikelyPlcVariableTable(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase()
  return /(?:^|[/_.-])plc(?:[/_.-]|$)/u.test(normalized)
    || /(?:variables?|opcua)[_-].*\.csv$/u.test(normalized)
}

function plcCandidateScore(relativePath: string): number {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase()
  let score = 0
  if (normalized.includes('/devices/')) score += 100
  if (normalized.includes('szlab_poly_plc')) score += 200
  if (/szlab_plc_\d+\.csv$/u.test(normalized)) score += 300
  const version = basename(normalized).match(/(\d{4,8})(?=\.csv$)/u)?.[1]
  if (version) score += Number(version.slice(-8)) / 100_000_000
  return score
}
