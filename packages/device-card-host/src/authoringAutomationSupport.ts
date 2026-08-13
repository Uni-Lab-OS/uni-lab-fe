import { access, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import {
  DEVICE_CARD_SDK_VERSION,
  DEVICE_CARD_TOOLING_VERSION,
  DEVICE_CARD_UI_CATALOG_VERSION,
  createDeviceCardAuthoringContext,
  createDeviceCardProjectFiles
} from '@unilab/device-card-authoring-kit'
import {
  isDeviceDefinitionReference,
  parseDeviceCardManifest,
  type DeviceCardAuthoringProfile,
  type DeviceCardAuthoringTarget,
  type DeviceCardAuthoringVersions,
  type InstalledDeviceCard
} from '@unilab/device-card-sdk'
import { DEVICE_CARD_BUILDER_VERSION } from '@unilab/device-card-builder'
import type { ActiveSession } from './authoringAutomationTypes'
import {
  authoringError,
  DeviceCardAuthoringError
} from './authoringAutomationError'
import type { DeviceCardWorkspaceArtifact } from './workspace'

export const DEVICE_CARD_AUTHORING_PROFILES: readonly DeviceCardAuthoringProfile[] = [
  'vue-web-component-v1',
  'react-web-component-v1',
  'web-component-lite-v1'
]

export function assertCreatableTarget(target: DeviceCardAuthoringTarget): void {
  if (!target.deviceId.trim()) {
    throw authoringError('DEVICE_ID_MISSING', '目标设备缺少稳定 Device ID。')
  }
  if (!isDeviceDefinitionReference(target.definition)) {
    throw authoringError(
      'DEVICE_TYPE_UNRESOLVED',
      '目标设备缺少完整的 PackageCatalog definition 来源证据。'
    )
  }
}

export async function materializeProject(
  projectDir: string,
  context: ReturnType<typeof createDeviceCardAuthoringContext>,
  profile: DeviceCardAuthoringProfile
): Promise<void> {
  let createdDirectory = false
  if (await exists(projectDir)) {
    const info = await lstat(projectDir)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw authoringError('INVALID_ARGUMENT', '项目目标必须是普通目录。')
    }
    if ((await readdir(projectDir)).length > 0) {
      throw authoringError('DIRECTORY_NOT_EMPTY', 'bootstrap 目标目录不是空目录。', {
        projectDir
      })
    }
  } else {
    await mkdir(projectDir, { recursive: true })
    createdDirectory = true
  }

  const files = createDeviceCardProjectFiles(context, profile)
  const written: string[] = []
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const destination = resolve(projectDir, relativePath)
      if (!isInside(projectDir, destination)) {
        throw authoringError('DIRECTORY_OUTSIDE_GRANT', '模板路径越过授权目录。')
      }
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, content, { encoding: 'utf8', flag: 'wx' })
      written.push(destination)
    }
  } catch (error) {
    await Promise.all(written.reverse().map((path) => rm(path, { force: true })))
    if (createdDirectory) await rm(projectDir, { recursive: true, force: true })
    if (error instanceof DeviceCardAuthoringError) throw error
    throw authoringError(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : '项目生成失败。',
      {},
      error
    )
  }
}

export async function assertExistingProject(projectDir: string): Promise<void> {
  let info
  try {
    info = await lstat(projectDir)
  } catch (error) {
    throw authoringError('INVALID_ARGUMENT', '接入的项目目录不存在。', {
      projectDir
    }, error)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw authoringError('INVALID_ARGUMENT', '接入目标必须是普通目录。')
  }
  try {
    await access(resolve(projectDir, 'card.manifest.json'))
  } catch (error) {
    throw authoringError('INVALID_ARGUMENT', '项目缺少 card.manifest.json。', {}, error)
  }
}

/**
 * 读取 attach 项目自己的 Authoring Profile。
 *
 * attach 不得使用新建项目的默认 Profile 猜测现有源码类型，否则可能用 Vue
 * 声明刷新 React 或原生 Web Component 项目。
 */
export async function readExistingProjectProfile(
  projectDir: string
): Promise<DeviceCardAuthoringProfile> {
  const manifestPath = resolve(projectDir, 'card.manifest.json')
  try {
    const info = await lstat(manifestPath)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw authoringError(
        'INVALID_ARGUMENT',
        'card.manifest.json 必须是普通文件。'
      )
    }
    const manifest = parseDeviceCardManifest(
      JSON.parse(await readFile(manifestPath, 'utf8'))
    )
    return manifest.authoringProfile
  } catch (error) {
    if (error instanceof DeviceCardAuthoringError) throw error
    throw authoringError(
      'INVALID_ARGUMENT',
      '无法从 card.manifest.json 读取有效的 authoringProfile。',
      { manifestPath },
      error
    )
  }
}

export async function writeCurrentContext(
  projectDir: string,
  context: ReturnType<typeof createDeviceCardAuthoringContext>,
  profile: DeviceCardAuthoringProfile
): Promise<void> {
  // `.unilab-card` 中的声明由 Host 管理；attach 时随当前 SDK 一起刷新，
  // 避免旧项目仍使用过期 Bridge 类型，但绝不覆盖用户维护的源码。
  const generated = createDeviceCardProjectFiles(context, profile)
  const declarationPaths = [
    '.unilab-card/sdk.d.ts',
    '.unilab-card/ui-elements.d.ts',
    '.unilab-card/framework.d.ts',
    '.unilab-card/vue-shim.d.ts'
  ] as const
  const writes = [
    {
      relativePath: 'authoring-context.json',
      content: `${JSON.stringify(context, null, 2)}\n`
    },
    ...declarationPaths.map((relativePath) => ({
      relativePath,
      content: generated[relativePath] ?? ''
    }))
  ]

  // 先完整预检再产生任何写入，避免恶意祖先 symlink 导致部分刷新。
  for (const { relativePath } of writes) {
    await assertSafeProjectWritePath(
      projectDir,
      resolve(projectDir, relativePath),
      relativePath
    )
  }
  for (const { relativePath } of writes) {
    const destination = resolve(projectDir, relativePath)
    await mkdir(dirname(destination), { recursive: true })
    // mkdir 与 writeFile 之间再检查一次新建后的完整祖先链。
    await assertSafeProjectWritePath(projectDir, destination, relativePath)
  }
  for (const { relativePath, content } of writes) {
    await writeFile(resolve(projectDir, relativePath), content, 'utf8')
  }
}

export function requireReadyArtifact(record: ActiveSession): DeviceCardWorkspaceArtifact {
  try {
    return record.workspace.getReadyArtifact()
  } catch (error) {
    throw authoringError(
      'CURRENT_SOURCE_NOT_READY',
      error instanceof Error ? error.message : '当前源码尚未检查通过。',
      { state: record.workspace.getStatus().state },
      error,
      true
    )
  }
}

export function publicInstalledRecord(record: InstalledDeviceCard): InstalledDeviceCard {
  return {
    key: record.key,
    id: record.id,
    version: record.version,
    title: record.title,
    definitionTargets: structuredClone(record.definitionTargets),
    definitionFqids: [...record.definitionFqids],
    legacyDeviceTypes: [...record.legacyDeviceTypes],
    deviceTypes: [...record.deviceTypes],
    authoringProfile: record.authoringProfile,
    installedAt: record.installedAt
  }
}

export function authoringVersions(): DeviceCardAuthoringVersions {
  return {
    protocolVersion: 1,
    kitVersion: 1,
    sdkVersion: DEVICE_CARD_SDK_VERSION,
    toolingVersion: DEVICE_CARD_TOOLING_VERSION,
    hostProtocolVersion: 1,
    uiCatalogVersion: DEVICE_CARD_UI_CATALOG_VERSION,
    builderVersion: DEVICE_CARD_BUILDER_VERSION
  }
}

export function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return 120_000
  if (!Number.isFinite(value) || value < 1 || value > 10 * 60_000) {
    throw authoringError('INVALID_ARGUMENT', 'timeout 必须在 1ms 到 10 分钟之间。')
  }
  return Math.floor(value)
}

export function requiredString(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw authoringError('INVALID_ARGUMENT', `${name} 不能为空。`)
  }
  return value.trim()
}

export function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right)
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot === '' || (
    !pathFromRoot.startsWith('..') &&
    !pathFromRoot.startsWith('/') &&
    !pathFromRoot.startsWith('\\')
  )
}

/**
 * 验证 Host-owned 文件从授权项目根到目标文件的现有路径组件都不是 symlink。
 */
async function assertSafeProjectWritePath(
  projectDir: string,
  destination: string,
  relativePath: string
): Promise<void> {
  const root = resolve(projectDir)
  const candidate = resolve(destination)
  if (!isInside(root, candidate)) {
    throw authoringError(
      'DIRECTORY_OUTSIDE_GRANT',
      `${relativePath} 路径越过授权目录。`
    )
  }

  const rootInfo = await lstatIfExists(root)
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw authoringError(
      'DIRECTORY_OUTSIDE_GRANT',
      '授权项目根必须是普通目录。',
      { projectDir: root }
    )
  }

  const segments = relative(root, candidate).split(/[\\/]/u).filter(Boolean)
  let current = root
  for (const segment of segments.slice(0, -1)) {
    current = resolve(current, segment)
    const info = await lstatIfExists(current)
    if (!info) continue
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw authoringError(
        'DIRECTORY_OUTSIDE_GRANT',
        `${relativePath} 的祖先路径必须是普通目录。`,
        { path: current }
      )
    }
  }

  const destinationInfo = await lstatIfExists(candidate)
  if (destinationInfo?.isSymbolicLink()) {
    throw authoringError(
      'DIRECTORY_OUTSIDE_GRANT',
      `${relativePath} 不能是符号链接。`,
      { path: candidate }
    )
  }
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function assertNonSymlinkDestination(path: string): Promise<void> {
  if (await exists(path) && (await lstat(path)).isSymbolicLink()) {
    throw authoringError(
      'DIRECTORY_OUTSIDE_GRANT',
      '导出目标不能是符号链接。',
      { path }
    )
  }
}
