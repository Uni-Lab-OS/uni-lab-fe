import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import type { BuildFailure } from 'esbuild'
import type { DeviceCardAuthoringContext, DeviceCardDiagnostic, DeviceCardManifest } from '@unilab/device-card-sdk'
import { scanSource } from './security'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue'])

export async function projectSourceHash(
  projectDir: string,
  manifest: DeviceCardManifest,
  overlayProjectDir?: string
): Promise<string> {
  const hash = createHash('sha256')
  hash.update('source\u0000')
  for (const path of await projectFiles(projectDir)) {
    const relativePath = relative(projectDir, path).replaceAll('\\', '/')
    hash.update(relativePath)
    hash.update('\u0000')
    hash.update(await readFile(path))
    hash.update('\u0000')
  }
  if (overlayProjectDir) {
    hash.update('overlay\u0000')
    for (const path of await projectFiles(overlayProjectDir)) {
      const relativePath = relative(overlayProjectDir, path).replaceAll('\\', '/')
      hash.update(relativePath)
      hash.update('\u0000')
      hash.update(await readFile(path))
      hash.update('\u0000')
    }
  }
  if (manifest.templateCard) {
    hash.update('template-card\u0000')
    hash.update(manifest.templateCard)
    hash.update('\u0000')
  }
  return hash.digest('hex')
}

async function projectFiles(
  root: string,
  directory = root
): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '.unilab-card'
    ) {
      continue
    }
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...await projectFiles(root, absolute))
    } else if (entry.isFile()) {
      result.push(absolute)
    }
  }
  return result.sort()
}

export async function scanProjectSources(
  root: string,
  directory = root
): Promise<DeviceCardDiagnostic[]> {
  const diagnostics: DeviceCardDiagnostic[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === '.unilab-card' ||
      entry.name === 'tests'
    ) {
      continue
    }
    const absolute = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        severity: 'error',
        code: 'source.symlink',
        message: '卡片源码不能包含符号链接。',
        path: relative(root, absolute)
      })
    } else if (entry.isDirectory()) {
      diagnostics.push(...await scanProjectSources(root, absolute))
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      diagnostics.push(
        ...scanSource(await readFile(absolute, 'utf8'), relative(root, absolute))
      )
    }
  }
  return diagnostics
}

export function elementNameFor(
  manifest: DeviceCardManifest,
  sourceHash: string
): string {
  const safeId = manifest.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `ulcard-${safeId}-${sourceHash.slice(0, 8)}`
}

function isAuthoringContext(value: unknown): value is DeviceCardAuthoringContext {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 'device-card-authoring-context/v1' &&
    typeof record.deviceTypeId === 'string' &&
    typeof record.title === 'string' &&
    Array.isArray(record.actions) &&
    !!record.stateSchema &&
    typeof record.stateSchema === 'object' &&
    !!record.sampleState &&
    typeof record.sampleState === 'object' &&
    Array.isArray(record.media)
  )
}

export async function readProjectAuthoringContext(
  projectDir: string
): Promise<DeviceCardAuthoringContext | undefined> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(resolve(projectDir, 'authoring-context.json'), 'utf8')
    )
    return isAuthoringContext(raw) ? raw : undefined
  } catch {
    return undefined
  }
}

export async function readProjectMockState(
  projectDir: string
): Promise<Record<string, unknown>> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(resolve(projectDir, 'mock.json'), 'utf8')
    )
    return raw != null && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function mergeHostAuthoringContext(
  runtime: DeviceCardAuthoringContext | undefined,
  project: DeviceCardAuthoringContext | undefined
): DeviceCardAuthoringContext | undefined {
  if (!runtime) return undefined
  if (!project) return runtime
  return {
    ...runtime,
    stateSchema: { ...runtime.stateSchema },
    sampleState: { ...project.sampleState, ...runtime.sampleState }
  }
}

export function esbuildDiagnostics(error: unknown): DeviceCardDiagnostic[] {
  const failure = error as Partial<BuildFailure>
  if (Array.isArray(failure.errors)) {
    return failure.errors.map((item) => ({
      severity: 'error',
      code: 'build.esbuild',
      message: item.text,
      path: item.location?.file
    }))
  }
  return [{
    severity: 'error',
    code: 'build.failed',
    message: error instanceof Error ? error.message : String(error)
  }]
}

export function hasErrors(diagnostics: DeviceCardDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}
