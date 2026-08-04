import { relative, resolve, sep } from 'node:path'

import {
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
    pattern: /\b(?:process|require|module|Buffer|global)\b/,
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
  if (!manifest.deviceTypes.includes(context.deviceTypeId)) {
    diagnostics.push({
      severity: 'error',
      code: 'context.device_type',
      message: `卡片不支持设备类型 ${context.deviceTypeId}。`,
      path: 'deviceTypes'
    })
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
