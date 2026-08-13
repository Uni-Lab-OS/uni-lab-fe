import { randomUUID } from 'node:crypto'
import type {
  LocalDeviceProvisioning,
  LocalDeviceProvisioningStatus,
  StartLocalDeviceProvisioningInput
} from '@unilab/device-provisioning'
import type { DeviceSquareDetail } from '@unilab/services'

import { downloadDevicePackageWithCli } from './devicePackageCli'
import {
  createCloudDeviceSquare,
  devicePackageCliConfig
} from './localDeviceProvisioningAdapters'
import type { LocalRuntimeManager } from './localRuntimeManager'

type ActiveProvisioningRuntime = ReturnType<
  LocalRuntimeManager['getDeviceProvisioningRuntime']
>
type SaveRecord = (
  record: LocalDeviceProvisioning
) => Promise<LocalDeviceProvisioning>
type TransitionRecord = (
  record: LocalDeviceProvisioning,
  status: LocalDeviceProvisioningStatus
) => Promise<LocalDeviceProvisioning>
type FailRecord = (
  record: LocalDeviceProvisioning,
  stage: LocalDeviceProvisioningStatus,
  error: unknown
) => Promise<LocalDeviceProvisioning>

interface DownloadOperations {
  save: SaveRecord
  transition: TransitionRecord
  fail: FailRecord
}

/** 创建接入身份并把云端设备包下载到 OS 受管缓存。 */
export async function startProvisioningDownload(
  input: StartLocalDeviceProvisioningInput,
  active: ActiveProvisioningRuntime,
  operations: DownloadOperations
): Promise<LocalDeviceProvisioning> {
  const now = new Date().toISOString()
  let record = await operations.save({
    schemaVersion: 'local-device-provisioning/v1',
    provisioningId: randomUUID(),
    cloudEnvironment: input.cloudEnvironment,
    templateUuid: input.templateUuid,
    cloudDeviceName: '',
    cloudDisplayName: '',
    packageName: '',
    packageVersion: '',
    artifactDigest: '',
    catalogDigest: '',
    definitionFqid: '',
    cacheKey: '',
    configurationSchema: {},
    configuration: null,
    instanceId: '',
    instanceUuid: '',
    displayName: '',
    graphPath: active.runtime.graphPath,
    graphFingerprint: '',
    backupPath: '',
    actionCount: 0,
    status: 'requested',
    diagnostic: null,
    createdAt: now,
    updatedAt: now
  })
  try {
    record = await operations.transition(record, 'resolving')
    const square = createCloudDeviceSquare(input.cloudEnvironment)
    const detail = await square.getDeviceDetail(input.templateUuid)
    record = await saveCloudDeviceDetail(record, detail, operations.save)
    const candidate = await square.resolvePackageCandidate(
      input.templateUuid,
      detail
    )
    record = await operations.save({
      ...record,
      packageName: candidate.packageName,
      packageVersion: candidate.version,
      artifactDigest: candidate.artifactDigest,
      catalogDigest: candidate.catalogDigest,
      definitionFqid: candidate.definitionFqid
    })
    record = await operations.transition(record, 'downloading')
    const downloaded = await downloadDevicePackageWithCli(
      devicePackageCliConfig(active.runtime, input.cloudEnvironment),
      candidate
    )
    record = await operations.transition({
      ...record,
      packageName: downloaded.distribution,
      packageVersion: downloaded.version,
      cacheKey: downloaded.cacheKey,
      catalogDigest: downloaded.catalogDigest,
      configurationSchema: downloaded.configurationSchema
    }, 'package_cached')
    return operations.transition(record, 'configuration_required')
  } catch (error) {
    return operations.fail(record, record.status, error)
  }
}

/** 使用原接入身份恢复失败的设备包下载。 */
export async function resumeProvisioningDownload(
  record: LocalDeviceProvisioning,
  active: ActiveProvisioningRuntime,
  operations: DownloadOperations
): Promise<LocalDeviceProvisioning> {
  try {
    record = await operations.transition(record, 'resolving')
    const square = createCloudDeviceSquare(record.cloudEnvironment)
    const detail = await square.getDeviceDetail(record.templateUuid)
    record = await saveCloudDeviceDetail(record, detail, operations.save)
    const candidate = await square.resolvePackageCandidate(
      record.templateUuid,
      detail
    )
    record = await operations.save({
      ...record,
      packageName: candidate.packageName,
      packageVersion: candidate.version,
      artifactDigest: candidate.artifactDigest,
      catalogDigest: candidate.catalogDigest,
      definitionFqid: candidate.definitionFqid
    })
    record = await operations.transition(record, 'downloading')
    const downloaded = await downloadDevicePackageWithCli(
      devicePackageCliConfig(active.runtime, record.cloudEnvironment),
      candidate
    )
    return operations.transition({
      ...record,
      packageName: downloaded.distribution,
      packageVersion: downloaded.version,
      cacheKey: downloaded.cacheKey,
      catalogDigest: downloaded.catalogDigest,
      configurationSchema: downloaded.configurationSchema
    }, 'configuration_required')
  } catch (error) {
    return operations.fail(record, record.status, error)
  }
}

/** 保存云端设备展示身份和可诊断发布字段。 */
async function saveCloudDeviceDetail(
  record: LocalDeviceProvisioning,
  detail: DeviceSquareDetail,
  save: SaveRecord
): Promise<LocalDeviceProvisioning> {
  const packageInfo = detail.packageInfo
  const sourceRegistry = detail.sourceRegistry
  const effectiveTemplate = detail.effectiveTemplate
  const displayName = detail.displayName || detail.name
  return save({
    ...record,
    cloudDeviceName: detail.name,
    cloudDisplayName: displayName,
    packageName: textValue(packageInfo.name),
    packageVersion: textValue(packageInfo.version),
    artifactDigest: textValue(packageInfo.artifact_digest ?? packageInfo.sha256),
    catalogDigest: textValue(packageInfo.catalog_digest),
    definitionFqid: textValue(
      sourceRegistry.package_definition_fqid ??
        effectiveTemplate.package_definition_fqid
    ),
    displayName: record.displayName || displayName
  })
}

/** 把未知云端诊断字段安全收窄为字符串。 */
function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
