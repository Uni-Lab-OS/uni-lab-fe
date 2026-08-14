import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { WorkbenchLaunchError } from './launch-error'
import type {
  WorkspacePackageMount,
  WorkspacePackageMountProjection
} from './index'

/** Wait only for contracts required to enter the Workbench shell.
 *
 * Workflow catalogs are populated by Uni-Lab OS in the background and may
 * temporarily return 503.  They must not keep device debugging, package
 * authoring, or the Material scene behind the process-start gate.
 */
export async function waitForWorkbenchReadiness(
  backendUrl: string,
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<WorkspacePackageMountProjection> {
  const probes: Array<[string, (payload: unknown) => boolean]> = [
    ['/api/v1/health', isHealthReady],
    ['/api/v1/devices', isSuccessfulEnvelope],
    ['/api/v1/resource-templates?limit=1', isResourceTemplateCatalogReady]
  ]
  for (const [path, accepts] of probes) {
    const deadline = Date.now() + timeoutMs
    let ready = false
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new WorkbenchLaunchError(
          'os_readiness_failed',
          `Uni-Lab OS 在 ${path} 就绪前退出`,
          '检查 OS 启动日志并修复依赖或配置错误'
        )
      }
      try {
        const response = await fetch(`${backendUrl}${path}`, {
          signal: AbortSignal.timeout(1_000)
        })
        if (response.ok && accepts(await response.json())) {
          ready = true
          break
        }
      } catch {
        // The managed process is still starting.
      }
      await delay(200)
    }
    if (!ready) {
      throw new WorkbenchLaunchError(
        'os_readiness_failed',
        `等待 Uni-Lab OS 就绪超时：${backendUrl}${path}`,
        '检查 OS 日志、依赖和端口占用后重试'
      )
    }
  }
  const mountPayload = await fetchWorkbenchReadinessPayload(
    backendUrl,
    child,
    '/api/v1/workspace/package-mounts',
    timeoutMs
  )
  return parseWorkspacePackageMountProjection(mountPayload)
}

async function fetchWorkbenchReadinessPayload(
  backendUrl: string,
  child: ChildProcessWithoutNullStreams,
  path: string,
  timeoutMs: number
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new WorkbenchLaunchError(
        'os_readiness_failed',
        `Uni-Lab OS 在 ${path} 就绪前退出`,
        '检查 OS 启动日志并修复依赖或配置错误'
      )
    }
    try {
      const response = await fetch(`${backendUrl}${path}`, {
        signal: AbortSignal.timeout(1_000)
      })
      if (response.ok) return await response.json()
    } catch {
      // The managed process is still publishing the fixed workspace generation.
    }
    await delay(200)
  }
  throw new WorkbenchLaunchError(
    'os_readiness_failed',
    `等待 Uni-Lab OS 就绪超时：${backendUrl}${path}`,
    '确认 OS 版本支持 workspace-package-mounts/v1 后重试'
  )
}

export function parseWorkspacePackageMountProjection(
  payload: unknown
): WorkspacePackageMountProjection {
  if (!isRecord(payload) || payload['code'] !== 0 || !isRecord(payload['data'])) {
    throw new WorkbenchLaunchError(
      'os_readiness_failed',
      'Uni-Lab OS 未返回有效的 Workspace 软件包挂载信封',
      '升级到支持 workspace-package-mounts/v1 的 Uni-Lab OS'
    )
  }
  const data = payload['data']
  const items = data['items']
  if (
    data['schemaVersion'] !== 'workspace-package-mounts/v1' ||
    !nonEmptyString(data['editablePackageId']) ||
    !nonEmptyString(data['dependencyRevision']) ||
    !nonEmptyString(data['catalogRevision']) ||
    !nonEmptyString(data['mountRevision']) ||
    !Array.isArray(items) || items.length === 0
  ) {
    throw new WorkbenchLaunchError(
      'os_readiness_failed',
      'Uni-Lab OS Workspace 软件包挂载投影形状无效',
      '检查 OS 包目录编译诊断并重新启动 Workbench'
    )
  }
  const parsedItems = items.map(parseWorkspacePackageMount)
  const packageIds = new Set(parsedItems.map(item => item.packageId))
  const editableItems = parsedItems.filter(item => item.editable)
  if (
    packageIds.size !== parsedItems.length || editableItems.length !== 1 ||
    editableItems[0]?.packageId !== data['editablePackageId']
  ) {
    throw new WorkbenchLaunchError(
      'os_readiness_failed',
      'Uni-Lab OS Workspace 软件包挂载身份冲突',
      '修复重复包身份或可编辑包选择后重试'
    )
  }
  return {
    schemaVersion: 'workspace-package-mounts/v1',
    editablePackageId: data['editablePackageId'],
    dependencyRevision: data['dependencyRevision'],
    catalogRevision: data['catalogRevision'],
    mountRevision: data['mountRevision'],
    items: parsedItems
  }
}

function parseWorkspacePackageMount(value: unknown): WorkspacePackageMount {
  if (
    !isRecord(value) ||
    !nonEmptyString(value['packageId']) ||
    !nonEmptyString(value['distributionName']) ||
    !nonEmptyString(value['version']) ||
    !nonEmptyString(value['namespace']) ||
    typeof value['editable'] !== 'boolean' ||
    value['readOnly'] !== !value['editable'] ||
    value['sourceKind'] !== 'workspace' ||
    !fileUri(value['importRootUri']) ||
    !fileUri(value['packageRootUri']) ||
    !nonEmptyString(value['contentDigest']) ||
    !nonEmptyString(value['catalogDigest'])
  ) {
    throw new WorkbenchLaunchError(
      'os_readiness_failed',
      'Uni-Lab OS 返回了无效的软件包挂载项',
      '检查 OS PackageCatalog 与 WorkspaceSource 配对'
    )
  }
  return {
    packageId: value['packageId'],
    distributionName: value['distributionName'],
    version: value['version'],
    namespace: value['namespace'],
    editable: value['editable'],
    readOnly: value['readOnly'],
    sourceKind: 'workspace',
    importRootUri: value['importRootUri'],
    packageRootUri: value['packageRootUri'],
    contentDigest: value['contentDigest'],
    catalogDigest: value['catalogDigest']
  }
}

function isHealthReady(payload: unknown): boolean {
  return isRecord(payload) && payload['status'] === 'ok'
}

function isSuccessfulEnvelope(payload: unknown): boolean {
  return isRecord(payload) && payload['code'] === 0
}

function isResourceTemplateCatalogReady(payload: unknown): boolean {
  if (!isRecord(payload) || payload['code'] !== 0 || !isRecord(payload['data'])) {
    return false
  }
  const items = payload['data']['items']
  return Array.isArray(items) && items.some(item => (
    isRecord(item)
    && nonEmptyString(item['uuid'])
    && nonEmptyString(item['name'])
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function fileUri(value: unknown): value is string {
  if (!nonEmptyString(value)) return false
  try {
    return new URL(value).protocol === 'file:'
  } catch {
    return false
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}
