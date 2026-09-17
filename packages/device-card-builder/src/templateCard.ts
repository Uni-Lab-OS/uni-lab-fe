import { access, readFile, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import {
  parseDeviceCardManifest,
  validateDeviceCardManifest,
  type DeviceCardAuthoringContext,
  type DeviceCardDiagnostic,
  type DeviceCardManifest,
  type JsonObject
} from '@unilab/device-card-sdk'

import {
  readProjectAuthoringContext,
  readProjectMockState
} from './buildSupport'

export interface EffectiveCardProject {
  manifestProjectDir: string
  sourceProjectDir: string
  overlayProjectDir?: string
  manifest: DeviceCardManifest
}

export async function resolveTemplateCardPath(
  anchorDir: string,
  templateCardRef: string
): Promise<string> {
  const normalized = templateCardRef.trim().replace(/\\/g, '/')
  let current = resolve(anchorDir)
  while (true) {
    const candidate = resolve(current, normalized)
    if (await hasCardManifest(candidate)) {
      return realpath(candidate)
    }
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  throw new Error(`找不到 templateCard 目录：${templateCardRef}`)
}

export async function resolveEffectiveCardProject(
  projectDir: string,
  options?: { templateAnchorDir?: string }
): Promise<{
  effective: EffectiveCardProject
  diagnostics: DeviceCardDiagnostic[]
}> {
  const diagnostics: DeviceCardDiagnostic[] = []
  const manifestProjectDir = await realpath(resolve(projectDir))
  const templateAnchorDir = options?.templateAnchorDir
    ? await realpath(resolve(options.templateAnchorDir))
    : manifestProjectDir
  let rawDomain: Record<string, unknown>
  try {
    rawDomain = JSON.parse(
      await readFile(resolve(manifestProjectDir, 'card.manifest.json'), 'utf8')
    ) as Record<string, unknown>
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'manifest.read',
      message: error instanceof Error ? error.message : String(error),
      path: 'card.manifest.json'
    })
    return {
      effective: {
        manifestProjectDir,
        sourceProjectDir: manifestProjectDir,
        manifest: {} as DeviceCardManifest
      },
      diagnostics
    }
  }

  diagnostics.push(...validateDeviceCardManifest(rawDomain))
  const templateCardRef = rawDomain.templateCard
  if (typeof templateCardRef !== 'string') {
    return {
      effective: {
        manifestProjectDir,
        sourceProjectDir: manifestProjectDir,
        manifest: parseDeviceCardManifest(rawDomain)
      },
      diagnostics
    }
  }

  let templateProjectDir: string
  try {
    templateProjectDir = await resolveTemplateCardPath(
      templateAnchorDir,
      templateCardRef
    )
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'manifest.template_card',
      message: error instanceof Error ? error.message : String(error),
      path: 'templateCard'
    })
    return {
      effective: {
        manifestProjectDir,
        sourceProjectDir: manifestProjectDir,
        manifest: {} as DeviceCardManifest
      },
      diagnostics
    }
  }

  let rawTemplate: Record<string, unknown>
  try {
    rawTemplate = JSON.parse(
      await readFile(resolve(templateProjectDir, 'card.manifest.json'), 'utf8')
    ) as Record<string, unknown>
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'manifest.template_read',
      message: error instanceof Error ? error.message : String(error),
      path: templateCardRef
    })
    return {
      effective: {
        manifestProjectDir,
        sourceProjectDir: manifestProjectDir,
        manifest: {} as DeviceCardManifest
      },
      diagnostics
    }
  }

  const merged = mergeManifestRecords(rawTemplate, rawDomain)
  diagnostics.push(...validateDeviceCardManifest(merged))
  return {
    effective: {
      manifestProjectDir,
      sourceProjectDir: templateProjectDir,
      overlayProjectDir: manifestProjectDir,
      manifest: parseDeviceCardManifest(merged)
    },
    diagnostics
  }
}

export function resolveOverlayRelativePath(
  sourceProjectDir: string,
  overlayProjectDir: string | undefined,
  importerPath: string,
  specifier: string
): string | undefined {
  if (!overlayProjectDir || !specifier.startsWith('.')) return undefined
  const relativeImporter = relative(sourceProjectDir, importerPath)
  const joined = resolve(
    sourceProjectDir,
    dirname(relativeImporter),
    specifier
  )
  const relativeTarget = relative(sourceProjectDir, joined).replaceAll('\\', '/')
  const overlayCandidate = resolve(overlayProjectDir, relativeTarget)
  return findExistingModule(overlayCandidate)
}

export function resolveEntryFile(
  sourceProjectDir: string,
  overlayProjectDir: string | undefined,
  entryRel: string
): string {
  if (overlayProjectDir) {
    const overlayEntry = resolve(overlayProjectDir, entryRel)
    if (existsSync(overlayEntry)) return overlayEntry
  }
  return resolve(sourceProjectDir, entryRel)
}

function mergeManifestRecords(
  template: Record<string, unknown>,
  domain: Record<string, unknown>
): Record<string, unknown> {
  const mergedConfig = mergeJsonObject(
    template.config,
    domain.config
  )
  return {
    ...template,
    ...domain,
    permissions: domain.permissions ?? template.permissions,
    uiFeatures: domain.uiFeatures ?? template.uiFeatures,
    entry: domain.entry ?? template.entry,
    authoringProfile: domain.authoringProfile ?? template.authoringProfile,
    sdkVersion: domain.sdkVersion ?? template.sdkVersion,
    ...(mergedConfig ? { config: mergedConfig } : {})
  }
}

function mergeJsonObject(
  left: unknown,
  right: unknown
): JsonObject | undefined {
  if (!isRecord(left) && !isRecord(right)) return undefined
  const base = isRecord(left) ? left : {}
  const override = isRecord(right) ? right : {}
  const defaults = mergeJsonValue(base.defaults, override.defaults)
  const schema = mergeJsonValue(base.schema, override.schema)
  const version = typeof override.version === 'number'
    ? override.version
    : typeof base.version === 'number'
      ? base.version
      : 1
  return {
    version,
    defaults: (defaults ?? {}) as JsonObject,
    schema: (schema ?? {}) as JsonObject
  }
}

function mergeJsonValue(left: unknown, right: unknown): unknown {
  if (!isRecord(left) || !isRecord(right)) {
    return right ?? left
  }
  return { ...left, ...right }
}

async function hasCardManifest(directory: string): Promise<boolean> {
  try {
    await access(resolve(directory, 'card.manifest.json'))
    return true
  } catch {
    return false
  }
}

function findExistingModule(basePath: string): string | undefined {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    resolve(basePath, 'index.ts'),
    resolve(basePath, 'index.tsx')
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function overlayTemplateAuthoringContext(
  templateContext: DeviceCardAuthoringContext,
  manifest: Pick<DeviceCardManifest, 'deviceTypes' | 'title'>
): DeviceCardAuthoringContext {
  const deviceTypeId = manifest.deviceTypes[0] ?? templateContext.deviceTypeId
  const deviceId = deviceTypeId.includes('.')
    ? deviceTypeId.split('.').at(-1) ?? templateContext.deviceId
    : templateContext.deviceId
  return {
    ...templateContext,
    deviceTypeId,
    ...(deviceId ? { deviceId } : {}),
    title: manifest.title
  }
}

/** 领域仓缺 authoring-context 时，从 templateCard 模板继承离线预览上下文。 */
export async function resolveTemplateCardAuthoringPreview(
  projectDir: string
): Promise<{
  authoringContext: DeviceCardAuthoringContext
  mockState: Record<string, unknown>
} | undefined> {
  const manifestProjectDir = await realpath(resolve(projectDir))
  const domainContext = await readProjectAuthoringContext(manifestProjectDir)
  const domainMock = await readProjectMockState(manifestProjectDir)
  if (domainContext) {
    return { authoringContext: domainContext, mockState: domainMock }
  }

  let rawDomain: Record<string, unknown>
  try {
    rawDomain = JSON.parse(
      await readFile(resolve(manifestProjectDir, 'card.manifest.json'), 'utf8')
    ) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (typeof rawDomain.templateCard !== 'string') return undefined

  let templateProjectDir: string
  try {
    templateProjectDir = await resolveTemplateCardPath(
      manifestProjectDir,
      rawDomain.templateCard
    )
  } catch {
    return undefined
  }

  const templateContext = await readProjectAuthoringContext(templateProjectDir)
  if (!templateContext) return undefined

  const manifest = parseDeviceCardManifest(
    mergeManifestRecords(
      JSON.parse(
        await readFile(resolve(templateProjectDir, 'card.manifest.json'), 'utf8')
      ) as Record<string, unknown>,
      rawDomain
    )
  )
  const templateMock = await readProjectMockState(templateProjectDir)
  return {
    authoringContext: overlayTemplateAuthoringContext(templateContext, manifest),
    mockState: { ...templateMock, ...domainMock }
  }
}

/**
 * templateCard 引用在 Host 模式下按 OS 设备目录收窄权限，避免模板 MoveIt
 * 动作与 Preview 等领域设备不匹配时构建失败。
 */
export function narrowTemplateCardPermissionsForHost(
  manifest: DeviceCardManifest,
  context: DeviceCardAuthoringContext
): { manifest: DeviceCardManifest; diagnostics: DeviceCardDiagnostic[] } {
  const diagnostics: DeviceCardDiagnostic[] = []
  const availableActions = new Set(
    context.actions.map((action) => action.action)
  )
  const availableState = new Set(Object.keys(context.stateSchema))
  const availableMedia = new Set(context.media)
  const actions = manifest.permissions.actions.filter((action) => {
    if (availableActions.has(action)) return true
    diagnostics.push({
      severity: 'warning',
      code: 'context.action_unavailable',
      message: `Action ${action} 不在当前设备 OS 目录中，Live 模式已移除该权限。`,
      path: 'permissions.actions'
    })
    return false
  })
  const state = manifest.permissions.state.filter((key) => {
    if (availableState.has(key)) return true
    diagnostics.push({
      severity: 'warning',
      code: 'context.state_unavailable',
      message: `状态字段 ${key} 不在当前设备 OS 目录中，Live 模式已移除该权限。`,
      path: 'permissions.state'
    })
    return false
  })
  const media = manifest.permissions.media.filter((key) => {
    if (availableMedia.has(key)) return true
    diagnostics.push({
      severity: 'warning',
      code: 'context.media_unavailable',
      message: `媒体资源 ${key} 不在当前设备 OS 目录中，Live 模式已移除该权限。`,
      path: 'permissions.media'
    })
    return false
  })
  return {
    manifest: {
      ...manifest,
      permissions: { actions, state, media }
    },
    diagnostics
  }
}

/** 文件监听：template 引用卡片需同时 watch 领域目录与 template 目录。 */
export async function listDeviceCardWatchRoots(
  projectDir: string
): Promise<string[]> {
  const manifestProjectDir = await realpath(resolve(projectDir))
  try {
    const rawDomain = JSON.parse(
      await readFile(resolve(manifestProjectDir, 'card.manifest.json'), 'utf8')
    ) as Record<string, unknown>
    if (typeof rawDomain.templateCard === 'string') {
      const templateProjectDir = await resolveTemplateCardPath(
        manifestProjectDir,
        rawDomain.templateCard
      )
      return [manifestProjectDir, templateProjectDir]
    }
  } catch {
    // 缺 manifest 或 template 未就绪时只 watch 领域目录。
  }
  return [manifestProjectDir]
}
