import { createHash } from 'node:crypto'
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm
} from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import {
  buildDeviceCard,
  unpackDeviceCard,
  type DeviceCardBuildMetadata
} from '@unilab/device-card-builder'
import type {
  DeviceCardAuthoringContext,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'

export interface InstalledDeviceCardRecord extends InstalledDeviceCard {
  artifactDir: string
  metadata: DeviceCardBuildMetadata
}

export async function installDeviceCardArchive(options: {
  archivePath: string
  storeRoot: string
  authoringContext?: DeviceCardAuthoringContext
}): Promise<InstalledDeviceCardRecord> {
  const storeRoot = resolve(options.storeRoot)
  await mkdir(storeRoot, { recursive: true })
  const stage = await mkdtemp(join(storeRoot, '.staging-'))
  try {
    const sourceDir = join(stage, 'source')
    await unpackDeviceCard(options.archivePath, sourceDir)
    const artifactDir = join(stage, 'artifact')
    const build = await buildDeviceCard({
      projectDir: sourceDir,
      outDir: artifactDir,
      authoringContext: options.authoringContext
    })
    if (!build.ok || !build.metadata) {
      throw new Error(
        build.diagnostics.map((diagnostic) =>
          `${diagnostic.code}: ${diagnostic.message}`
        ).join('\n') || 'Electron 权威构建失败。'
      )
    }
    const target = artifactPath(storeRoot, build.metadata)
    await mkdir(resolve(target, '..'), { recursive: true })
    if (await exists(target)) {
      await rm(stage, { recursive: true, force: true })
      return readInstalledCard(target)
    }
    await copyFile(options.archivePath, join(artifactDir, 'source.ulcard'))
    await rename(artifactDir, target)
    return readInstalledCard(target)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

export async function listInstalledDeviceCards(
  storeRoot: string
): Promise<InstalledDeviceCardRecord[]> {
  const root = resolve(storeRoot)
  if (!await exists(root)) return []
  const records: InstalledDeviceCardRecord[] = []
  for (const cardId of await safeDirectories(root)) {
    if (cardId.startsWith('.')) continue
    for (const version of await safeDirectories(join(root, cardId))) {
      for (const hash of await safeDirectories(join(root, cardId, version))) {
        const artifactDir = join(root, cardId, version, hash)
        try {
          records.push(await readInstalledCard(artifactDir))
        } catch {
          // 忽略不完整的暂存目录；导入使用原子 rename。
        }
      }
    }
  }
  return records.sort((left, right) =>
    right.installedAt.localeCompare(left.installedAt)
  )
}

export async function readInstalledCard(
  artifactDir: string
): Promise<InstalledDeviceCardRecord> {
  const metadata = JSON.parse(
    await readFile(resolve(artifactDir, 'artifact.json'), 'utf8')
  ) as DeviceCardBuildMetadata
  if (metadata.schemaVersion !== 'device-card-artifact/v1') {
    throw new Error('不支持的卡片 Artifact schema。')
  }
  return {
    key: artifactKey(metadata),
    id: metadata.cardId,
    version: metadata.cardVersion,
    title: metadata.manifest.title,
    deviceTypes: metadata.manifest.deviceTypes,
    authoringProfile: metadata.manifest.authoringProfile,
    installedAt: metadata.builtAt,
    artifactDir: resolve(artifactDir),
    metadata
  }
}

export function artifactKey(metadata: DeviceCardBuildMetadata): string {
  return [
    encodeURIComponent(metadata.cardId),
    encodeURIComponent(metadata.cardVersion),
    metadata.sourceHash
  ].join(':')
}

export function verifyArtifactKey(
  record: InstalledDeviceCardRecord,
  key: string
): boolean {
  const left = createHash('sha256').update(record.key).digest()
  const right = createHash('sha256').update(key).digest()
  return left.length === right.length && left.equals(right)
}

function artifactPath(
  storeRoot: string,
  metadata: DeviceCardBuildMetadata
): string {
  return join(
    storeRoot,
    safeSegment(metadata.cardId),
    safeSegment(metadata.cardVersion),
    metadata.sourceHash
  )
}

function safeSegment(value: string): string {
  const normalized = basename(value).replace(/[^A-Za-z0-9._-]/g, '_')
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error(`无效的 Artifact 路径段：${value}`)
  }
  return normalized
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function safeDirectories(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
