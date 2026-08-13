import type {
  CloudEnvironment,
  DevicePackageInspection,
  DevicePackageUploadResult
} from '@unilab/device-provisioning'

import {
  parseFinalJson,
  runCommand,
  type DevicePackageCliCommandRunner
} from './devicePackageCli'

export interface DevicePackagePublishCliConfig {
  unilabExecutable: string
  commandWorkingDirectory: string
  managedWorkingDirectory: string
  backendBaseUrl: string
}

/**
 * 只读编译一个 Package Workspace 并投影可供用户确认的发布身份。
 *
 * @param config Main 已校验的 Conda CLI 与工作目录。
 * @param workspacePath 用户通过受控目录选择器选中的 Package Workspace。
 * @param commandRunner 可替换的无 shell CLI 端口。
 * @returns distribution、版本、namespace、摘要和定义摘要。
 */
export async function inspectDevicePackageWorkspace(
  config: Pick<
    DevicePackagePublishCliConfig,
    'unilabExecutable' | 'commandWorkingDirectory'
  >,
  workspacePath: string,
  commandRunner: DevicePackageCliCommandRunner = runCommand
): Promise<DevicePackageInspection> {
  const result = await commandRunner({
    command: required(config.unilabExecutable, 'unilab 可执行文件'),
    cwd: required(config.commandWorkingDirectory, 'CLI 工作目录'),
    args: [
      'package',
      'inspect',
      '--path',
      required(workspacePath, 'Package Workspace'),
      '--json'
    ]
  })
  return inspectionFromCatalog(parseFinalJson(result.stdout))
}

/**
 * 复用当前 OS 的 storage token、OSS PUT 与 `/lab/resource` 发布设备包。
 *
 * @param config Main 已校验的 Conda CLI 与工作目录。
 * @param input 受控 Workspace、固定云端环境和本次发布的一次性 Lab AK/SK。
 * @param commandRunner 可替换的无 shell CLI 端口。
 * @returns 云端现有上传链路返回的稳定发布身份。
 */
export async function uploadDevicePackageWorkspace(
  config: DevicePackagePublishCliConfig,
  input: {
    workspacePath: string
    cloudEnvironment: CloudEnvironment
    ak: string
    sk: string
  },
  commandRunner: DevicePackageCliCommandRunner = runCommand
): Promise<DevicePackageUploadResult> {
  const result = await commandRunner({
    command: required(config.unilabExecutable, 'unilab 可执行文件'),
    cwd: required(config.commandWorkingDirectory, 'CLI 工作目录'),
    args: [
      '--working_dir',
      required(config.managedWorkingDirectory, 'OS 受管工作目录'),
      '--addr',
      required(config.backendBaseUrl, '云端 API 根地址'),
      'package',
      'upload',
      '--path',
      required(input.workspacePath, 'Package Workspace'),
      '--auth-stdin',
      '--json'
    ],
    stdin: JSON.stringify({
      schema_version: 'unilab-package-upload-auth/v1',
      ak: required(input.ak, 'Lab AK'),
      sk: required(input.sk, 'Lab SK')
    })
  })
  const raw = parseFinalJson(result.stdout)
  if (raw.status !== 'published') {
    throw new Error(`设备包上传 CLI 返回未知状态：${String(raw.status ?? '')}`)
  }
  const artifactDigest = text(raw.artifact_digest, 'artifact_digest')
  if (!/^sha256:[0-9a-f]{64}$/u.test(artifactDigest)) {
    throw new Error('设备包上传 CLI artifact_digest 无效')
  }
  return {
    status: 'published',
    cloudEnvironment: input.cloudEnvironment,
    distribution: text(raw.distribution, 'distribution'),
    version: text(raw.version, 'version'),
    artifactDigest,
    visibleInSquare: false
  }
}

/** 把完整 PackageCatalog 收敛成 Electron 发布确认所需的只读摘要。 */
export function inspectionFromCatalog(
  catalog: Record<string, unknown>
): DevicePackageInspection {
  const distribution = record(catalog.distribution, 'distribution')
  const definitions = record(catalog.definitions, 'definitions')
  return {
    distribution: text(distribution.name, 'distribution.name'),
    version: text(distribution.version, 'distribution.version'),
    namespace: text(catalog.namespace, 'namespace'),
    catalogDigest: text(catalog.catalog_digest, 'catalog_digest'),
    devices: definitionSummaries(definitions.devices),
    resources: definitionSummaries(definitions.resources),
    workflows: definitionSummaries(definitions.workflows)
  }
}

/** 把一个定义集合映射为稳定 FQID 与显示名，不暴露完整编译细节。 */
function definitionSummaries(value: unknown): Array<{
  fqid: string
  displayName: string
}> {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const definition = record(item, 'definition')
    return {
      fqid: text(definition.fqid, 'definition.fqid'),
      displayName: optionalText(definition.title)
        || text(definition.id, 'definition.id')
    }
  })
}

/** 读取必填字符串并去除首尾空白。 */
function required(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空`)
  return normalized
}

/** 从 CLI JSON 读取非空字符串字段。 */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`设备包 CLI 缺少 ${field}`)
  }
  return value
}

/** 从 CLI JSON 读取可选展示字符串。 */
function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 把 CLI JSON unknown 安全收窄为普通对象。 */
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`设备包 CLI 缺少 ${field} object`)
  }
  return value as Record<string, unknown>
}
