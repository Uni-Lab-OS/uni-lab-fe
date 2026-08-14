import { isAbsolute, relative, resolve, sep } from 'node:path'

import {
  deviceCardAuthoringDefinitionFqid,
  deviceCardTargetsDefinition,
  isDeviceCardRealtimeStateDefinition,
  type DeviceCardAuthoringContext,
  type DeviceCardDiagnostic,
  type DeviceCardManifest
} from '@unilab/device-card-sdk'

const FORBIDDEN_SOURCE: ReadonlyArray<{
  code: string
  pattern: RegExp
  message: string
}> = [
  {
    code: 'source.network_fetch',
    pattern: /\bfetch\s*\(/,
    message: '卡片不能直接调用 fetch；请通过 Host Bridge 获取数据。'
  },
  {
    code: 'source.network_socket',
    pattern: /\b(?:WebSocket|EventSource|XMLHttpRequest)\b/,
    message: '卡片不能建立网络连接。'
  },
  {
    code: 'source.dynamic_code',
    pattern: /\b(?:eval|Function)\s*\(/,
    message: '卡片不能执行动态代码。'
  },
  {
    code: 'source.worker',
    pattern: /\b(?:Worker|SharedWorker)\s*\(/,
    message: '卡片不能创建 Worker。'
  },
  {
    code: 'source.dynamic_import',
    pattern: /\bimport\s*\(/,
    message: '卡片不能使用动态 import。'
  },
  {
    code: 'source.send_beacon',
    pattern: /\bsendBeacon\s*\(/,
    message: '卡片不能发送 beacon。'
  },
  {
    code: 'source.node_runtime',
    pattern: /\b(?:process|require|module|Buffer|globalThis)\b/,
    message: '卡片不能访问 Node.js 运行时。'
  }
]

export function scanSource(
  source: string,
  path: string
): DeviceCardDiagnostic[] {
  return FORBIDDEN_SOURCE.flatMap((rule) =>
    rule.pattern.test(source)
      ? [{
          severity: 'error' as const,
          code: rule.code,
          message: rule.message,
          path
        }]
      : []
  )
}

/**
 * 对照 Host 开发上下文验证定义目标和最小能力权限。
 *
 * @param manifest 待构建的 v1 或 v2 Manifest。
 * @param context Host 权威开发上下文；缺失时所有能力权限失败关闭。
 * @param options 是否允许 v1 项目预览旧状态声明。
 * @returns 定义来源或能力越权的结构化诊断。
 */
export function validatePermissionsAgainstContext(
  manifest: DeviceCardManifest,
  context?: DeviceCardAuthoringContext,
  options: { allowLegacyPreviewState?: boolean } = {}
): DeviceCardDiagnostic[] {
  if (!context) {
    return [
      ...manifest.permissions.state.map((key) => ({
        severity: 'error' as const,
        code: 'context.state_permission',
        message: `状态字段 ${key} 缺少 Authoring Context 声明。`,
        path: 'permissions.state'
      })),
      ...manifest.permissions.actions.map((action) => ({
        severity: 'error' as const,
        code: 'context.action_permission',
        message: `Action ${action} 缺少 Authoring Context 声明。`,
        path: 'permissions.actions'
      })),
      ...manifest.permissions.media.map((key) => ({
        severity: 'error' as const,
        code: 'context.media_permission',
        message: `媒体资源 ${key} 缺少 Authoring Context 声明。`,
        path: 'permissions.media'
      }))
    ]
  }
  const diagnostics: DeviceCardDiagnostic[] = []
  const definitionFqid = deviceCardAuthoringDefinitionFqid(context)
  const supportsDefinition = manifest.schemaVersion === 2
    ? context.schemaVersion === 'device-card-authoring-context/v2' &&
      deviceCardTargetsDefinition(manifest.targets, definitionFqid)
    : manifest.deviceTypes.includes(definitionFqid)
  if (!supportsDefinition) {
    diagnostics.push({
      severity: 'error',
      code: 'context.definition_fqid',
      message: `卡片不支持设备定义 ${definitionFqid}。`,
      path: manifest.schemaVersion === 2 ? 'targets' : 'deviceTypes'
    })
  } else if (
    manifest.schemaVersion === 2 &&
    context.schemaVersion === 'device-card-authoring-context/v2'
  ) {
    const target = manifest.targets.find(
      candidate => candidate.definitionFqid === context.definition.fqid
    )
    if (target && (
      target.authoredAgainst.definitionVersion !== context.definition.version ||
      target.authoredAgainst.definitionContentHash !== context.definition.contentHash ||
      target.authoredAgainst.packageCatalogDigest !==
        context.definition.packageCatalog.catalogDigest
    )) {
      diagnostics.push({
        severity: 'error',
        code: 'context.definition_provenance',
        message: '卡片 authored-against 证据与当前 Authoring Context 不一致。',
        path: 'targets'
      })
    }
  }
  const actions = new Set(context.actions.map((action) => action.action))
  for (const action of manifest.permissions.actions) {
    if (!actions.has(action)) {
      diagnostics.push({
        severity: 'error',
        code: 'context.action_permission',
        message: `Action ${action} 不在 OS Authoring Context 中。`,
        path: 'permissions.actions'
      })
    }
  }
  for (const key of manifest.permissions.state) {
    if (!Object.prototype.hasOwnProperty.call(context.stateSchema, key)) {
      diagnostics.push({
        severity: 'error',
        code: 'context.state_permission',
        message: `状态字段 ${key} 不在 Authoring Context 中。`,
        path: 'permissions.state'
      })
      continue
    }
    if (
      !isDeviceCardRealtimeStateDefinition(context.stateSchema[key]) &&
      !(
        options.allowLegacyPreviewState &&
        isLegacyPreviewStateDefinition(context.stateSchema[key])
      )
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'context.state_not_realtime',
        message: `状态字段 ${key} 不是可订阅的正式实时状态。`,
        path: 'permissions.state'
      })
    }
  }
  const media = new Set(context.media)
  for (const key of manifest.permissions.media) {
    if (!media.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'context.media_permission',
        message: `媒体资源 ${key} 不在 Authoring Context 中。`,
        path: 'permissions.media'
      })
    }
  }
  return diagnostics
}

function isLegacyPreviewStateDefinition(value: unknown): boolean {
  return isRecord(value) &&
    !Object.prototype.hasOwnProperty.call(value, 'source') &&
    !Object.prototype.hasOwnProperty.call(value, 'status')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 判断 candidate 是否落在 root 目录树内。
 *
 * Windows 上 `path.relative` 在跨盘符时返回目标绝对路径，而不是 `..`。
 * 不能把这种结果当成“在项目内”，否则 Vue/React 框架文件会被当成卡片源码，
 * 其内部 `@vue/*`、`scheduler` 导入会被白名单误拒。
 *
 * @param root 项目根目录。
 * @param candidate 待判断路径。
 * @returns 在 root 内（含 root 自身）时为 true。
 */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot === '' || (
    !isAbsolute(pathFromRoot) &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`)
  )
}

export function assertInside(root: string, candidate: string): string {
  const absoluteRoot = resolve(root)
  const absoluteCandidate = resolve(root, candidate)
  const pathFromRoot = relative(absoluteRoot, absoluteCandidate)
  if (
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    (pathFromRoot === '' && candidate !== '.')
  ) {
    throw new Error(`路径越界：${candidate}`)
  }
  return absoluteCandidate
}

export function isSafeArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\')) return false
  const parts = path.split('/')
  return parts.every((part) =>
    part.length > 0 &&
    part !== '.' &&
    part !== '..' &&
    !part.includes('\u0000')
  )
}
