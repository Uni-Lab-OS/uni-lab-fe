/** 候选本地设备接入（LocalDeviceProvisioning）的跨进程稳定合同。 */

export const DEVICE_PROVISIONING_IPC_SCHEMA_VERSION =
  'device-provisioning-ipc/v2' as const

export interface DeviceProvisioningIpcContract {
  readonly schemaVersion: typeof DEVICE_PROVISIONING_IPC_SCHEMA_VERSION
  readonly features: {
    readonly adoptExisting: true
  }
}

export const DEVICE_PROVISIONING_IPC_CONTRACT: DeviceProvisioningIpcContract = {
  schemaVersion: DEVICE_PROVISIONING_IPC_SCHEMA_VERSION,
  features: { adoptExisting: true }
}

/** ROS 2 设备节点实例 ID 的跨进程统一格式，不允许横线、点或数字开头。 */
export const ROS_DEVICE_INSTANCE_ID_PATTERN =
  '[A-Za-z_][A-Za-z0-9_]{0,127}' as const

const ROS_DEVICE_INSTANCE_ID = new RegExp(
  `^${ROS_DEVICE_INSTANCE_ID_PATTERN}$`,
  'u'
)

/**
 * 判断未知值是否可直接作为 ROS 2 设备节点实例 ID。
 *
 * @param value Renderer、Main 持久记录或调用方提供的未知实例身份。
 * @returns 仅在值满足 ROS 2 节点名字符、首字符和长度约束时返回 true。
 */
export function isRosDeviceInstanceId(value: unknown): value is string {
  return typeof value === 'string' && ROS_DEVICE_INSTANCE_ID.test(value)
}

/**
 * 校验并返回去除首尾空白后的 ROS 2 设备节点实例 ID。
 *
 * @param value 已由调用边界读取、但尚未验证 ROS 2 规则的字符串。
 * @returns 可安全写入设备图并用于 `/api/v1/devices` 对账的实例 ID。
 * @throws 值包含横线、点、其他非法字符、数字开头或超过 128 字符时抛出错误。
 */
export function requireRosDeviceInstanceId(value: string): string {
  const normalized = value.trim()
  if (!isRosDeviceInstanceId(normalized)) {
    throw new Error(
      '设备实例 ID 必须以字母或下划线开头，且只能包含字母、数字和下划线（最多 128 字符）'
    )
  }
  return normalized
}

export type CloudEnvironment = 'test' | 'uat' | 'production'

export interface CloudEnvironmentOption {
  readonly id: CloudEnvironment
  readonly label: string
  readonly host: string
  readonly apiUrl: string
}

export const CLOUD_ENVIRONMENT_OPTIONS: readonly CloudEnvironmentOption[] = [
  {
    id: 'test',
    label: '测试环境',
    host: 'leap-lab.test.bohrium.com',
    apiUrl: 'https://leap-lab.test.bohrium.com/api/v1'
  },
  {
    id: 'uat',
    label: 'UAT 环境',
    host: 'uni-lab.uat.bohrium.com',
    apiUrl: 'https://uni-lab.uat.bohrium.com/api/v1'
  },
  {
    id: 'production',
    label: '正式环境',
    host: 'leap-lab.bohrium.com',
    apiUrl: 'https://leap-lab.bohrium.com/api/v1'
  }
] as const

/**
 * 判断跨进程输入是否是受支持的固定云端环境。
 *
 * @param value Renderer 或持久化文件提供的未知环境值。
 * @returns 仅在值属于测试、UAT 或正式环境时返回 true。
 */
export function isCloudEnvironment(value: unknown): value is CloudEnvironment {
  return value === 'test' || value === 'uat' || value === 'production'
}

/**
 * 读取一个固定云端环境的展示名称、主机名和 API 根地址。
 *
 * @param environment 已通过合同校验的云端环境身份。
 * @returns 与环境一一对应的不可变配置；环境未知时抛出错误。
 */
export function cloudEnvironmentOption(
  environment: CloudEnvironment
): CloudEnvironmentOption {
  const option = CLOUD_ENVIRONMENT_OPTIONS.find(
    (candidate) => candidate.id === environment
  )
  if (!option) throw new Error(`不支持的云端环境：${String(environment)}`)
  return option
}

export type LocalDeviceProvisioningStatus =
  | 'requested'
  | 'resolving'
  | 'downloading'
  | 'package_cached'
  | 'configuration_required'
  | 'graph_staged'
  | 'restart_required'
  | 'activating'
  | 'driver_ready'
  | 'ready'
  | 'failed'
  | 'canceled'
  | 'removing'
  | 'removed'

export interface LocalDeviceProvisioningDiagnostic {
  stage: LocalDeviceProvisioningStatus
  message: string
  retryable: boolean
  recordedAt: string
}

export interface LocalDeviceProvisioning {
  schemaVersion: 'local-device-provisioning/v1'
  provisioningId: string
  cloudEnvironment: CloudEnvironment
  templateUuid: string
  cloudDeviceName: string
  cloudDisplayName: string
  packageName: string
  packageVersion: string
  artifactDigest: string
  catalogDigest: string
  definitionFqid: string
  cacheKey: string
  configurationSchema: Record<string, unknown>
  configuration: Record<string, unknown> | null
  instanceId: string
  instanceUuid: string
  displayName: string
  graphPath: string
  graphFingerprint: string
  backupPath: string
  actionCount: number
  status: LocalDeviceProvisioningStatus
  diagnostic: LocalDeviceProvisioningDiagnostic | null
  createdAt: string
  updatedAt: string
}

export interface StartLocalDeviceProvisioningInput {
  cloudEnvironment: CloudEnvironment
  templateUuid: string
}

export interface ConfigureLocalDeviceProvisioningInput {
  provisioningId: string
  instanceId: string
  displayName: string
  adoptExisting: boolean
  configuration: Record<string, unknown>
}

export interface RetryLocalDeviceProvisioningInput {
  provisioningId: string
}

export interface RemoveLocalDeviceProvisioningInput {
  provisioningId: string
}

export interface RestoreLocalDeviceProvisioningInput {
  provisioningId: string
}

export interface DevicePackageUploadRequest {
  workspacePath: string
  cloudEnvironment: CloudEnvironment
  ak: string
  sk: string
}

export interface DevicePackageDownloadSummary {
  status: 'package_cached'
  cacheKey: string
  cacheHit: boolean
  distribution: string
  version: string
  namespace: string
  definitionFqid: string
  catalogDigest: string
  configurationSchema: Record<string, unknown>
}

export interface DevicePackageInspection {
  distribution: string
  version: string
  namespace: string
  catalogDigest: string
  devices: Array<{
    fqid: string
    displayName: string
  }>
  resources: Array<{
    fqid: string
    displayName: string
  }>
  workflows: Array<{
    fqid: string
    displayName: string
  }>
}

export interface DevicePackageUploadResult {
  status: 'published'
  cloudEnvironment: CloudEnvironment
  distribution: string
  version: string
  artifactDigest: string
  visibleInSquare: boolean
}

export interface DeviceProvisioningPathSelection {
  kind: 'packageWorkspace'
}
