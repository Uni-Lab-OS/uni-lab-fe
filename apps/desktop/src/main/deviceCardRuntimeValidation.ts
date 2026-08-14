import type { InstalledDeviceCardRecord, DeviceCardWorkspaceArtifact } from '@unilab/device-card-host'
import type {
  DeviceCardActionContract,
  DeviceCardAuthoringContext,
  DeviceCardBounds,
  DeviceCardRuntimeSnapshot,
  InstalledDeviceCard,
  OpenDeviceCardRequest,
  OpenDeviceCardWorkspaceRequest
} from '@unilab/device-card-sdk'
import {
  DEVICE_CARD_JOINT_PREVIEW_FEATURE,
  deviceCardTargetsDefinition,
  isDeviceDefinitionReference
} from '@unilab/device-card-sdk'

import { unavailableDeviceCardCapabilities } from './deviceCardRuntimeCapabilities'

export interface RuntimeCardRecord {
  id: string
  definitionTargets: InstalledDeviceCard['definitionTargets']
  legacyDeviceTypes: string[]
  artifactDir: string
  metadata: InstalledDeviceCardRecord['metadata']
}

/**
 * 为 OS RobotCommissioning owner 生成稳定 Host sessionKey。
 *
 * 同一卡片、同一设备实例、同一 Mock/Live 模式必须复用；视图重建不得换新
 * UUID，否则会丢掉 OS 已占用的维护会话，后续 open 只会得到 409。
 */
export function robotCommissioningSessionKey(
  record: Pick<RuntimeCardRecord, 'metadata'>,
  context: Pick<DeviceCardRuntimeSnapshot, 'mode' | 'device'>
): string {
  const deviceId = context.device.deviceId ?? 'unbound'
  return `${record.metadata.sourceHash}:${deviceId}:${context.mode}`
}

/** 确认设备卡支持当前设备类型和 Live 能力目录。 */
export function assertDeviceCardRuntimeCapabilities(
  record: RuntimeCardRecord,
  request: OpenDeviceCardRequest | OpenDeviceCardWorkspaceRequest
): void {
  if (request.context.jointPreview && !record.metadata.manifest.uiFeatures.includes(
    DEVICE_CARD_JOINT_PREVIEW_FEATURE
  )) {
    throw new Error('卡片 Manifest 未声明 joint-preview 能力。')
  }
  const definitionFqid = request.context.device.definitionFqid
  const packageCard = record.definitionTargets.length > 0
  const supported = packageCard
    ? deviceCardTargetsDefinition(record.definitionTargets, definitionFqid)
    : record.legacyDeviceTypes.includes(request.context.device.deviceTypeId)
  if (!supported) {
    throw new Error(
      `卡片不支持设备定义 ${definitionFqid || request.context.device.deviceTypeId}。`
    )
  }
  if (request.context.mode !== 'live') return
  if (!packageCard) {
    throw new Error('v1 遗留卡片仅可用于 Mock；请按当前领域设备包重新生成卡片。')
  }
  if (!isDeviceDefinitionReference(request.context.device.definition)) {
    throw new Error('当前设备缺少完整的 PackageCatalog definition 来源证据。')
  }
  const unavailable = unavailableDeviceCardCapabilities(
    record.metadata.manifest.permissions,
    {
      actions: request.availableActions?.map((action) => action.action),
      state: request.availableState,
      media: request.availableMedia
    }
  )
  if (unavailable.actions.length > 0) {
    throw new Error(
      `当前 OS 设备目录不包含卡片请求的 Action：${unavailable.actions.join('、')}`
    )
  }
  if (unavailable.state.length > 0) {
    throw new Error(
      `当前 OS 设备目录不包含卡片请求的实时状态：${unavailable.state.join('、')}`
    )
  }
  if (unavailable.media.length > 0) {
    throw new Error(
      `当前 OS 设备目录不包含卡片请求的媒体资源：${unavailable.media.join('、')}`
    )
  }
}

export function publicRecord(record: InstalledDeviceCardRecord): InstalledDeviceCard {
  return {
    key: record.key,
    id: record.id,
    version: record.version,
    title: record.title,
    definitionTargets: structuredClone(record.definitionTargets),
    definitionFqids: [...record.definitionFqids],
    legacyDeviceTypes: [...record.legacyDeviceTypes],
    deviceTypes: record.deviceTypes,
    authoringProfile: record.authoringProfile,
    installedAt: record.installedAt
  }
}

export function workspaceRuntimeRecord(
  artifact: DeviceCardWorkspaceArtifact
): RuntimeCardRecord {
  return {
    id: artifact.metadata.cardId,
    definitionTargets: artifact.metadata.manifest.schemaVersion === 2
      ? structuredClone(artifact.metadata.manifest.targets)
      : [],
    legacyDeviceTypes: artifact.metadata.manifest.schemaVersion === 1
      ? [...artifact.metadata.manifest.deviceTypes]
      : [],
    artifactDir: artifact.artifactDir,
    metadata: artifact.metadata
  }
}

export function normalizeBounds(bounds: DeviceCardBounds): DeviceCardBounds {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height]
    .every(Number.isFinite)) {
    throw new Error('卡片视图 bounds 无效。')
  }
  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width: Math.max(1, Math.floor(bounds.width)),
    height: Math.max(1, Math.floor(bounds.height))
  }
}

export function normalizeBoundsForZoom(
  bounds: DeviceCardBounds,
  zoomFactor: number
): DeviceCardBounds {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    throw new Error('设备卡片视图 zoom factor 无效。')
  }
  return normalizeBounds({
    x: bounds.x * zoomFactor,
    y: bounds.y * zoomFactor,
    width: bounds.width * zoomFactor,
    height: bounds.height * zoomFactor
  })
}

export function filterAllowedState(
  state: Record<string, unknown>,
  allowedKeys: string[]
): Record<string, unknown> {
  const allowed = new Set(allowedKeys)
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => allowed.has(key))
  )
}

export function isOpenRequest(value: unknown): value is OpenDeviceCardRequest {
  return isPlainRecord(value) &&
    typeof value.key === 'string' &&
    isOpenPreviewRequest(value)
}

export function isOpenWorkspaceRequest(
  value: unknown
): value is OpenDeviceCardWorkspaceRequest {
  return isPlainRecord(value) && isOpenPreviewRequest(value)
}

function isOpenPreviewRequest(value: Record<string, unknown>): boolean {
  const context = value.context
  if (!isPlainRecord(value.bounds) || !isPlainRecord(context)) return false
  if (
    (context.mode !== 'mock' && context.mode !== 'live') ||
    !isPlainRecord(context.device) ||
    typeof context.device.definitionFqid !== 'string' ||
    typeof context.device.deviceTypeId !== 'string' ||
    !isNullableString(context.device.deviceId) ||
    !isNullableString(context.device.materialId) ||
    !isPlainRecord(context.state) ||
    !isPlainRecord(context.config) ||
    (context.theme !== 'light' && context.theme !== 'dark') ||
    typeof context.locale !== 'string') return false
  if (context.jointPreview !== undefined && (
    context.mode !== 'mock' ||
    !isJointPreviewFrame(context.jointPreview, context.device.materialId)
  )) return false
  return (
      value.availableActions === undefined ||
      Array.isArray(value.availableActions) &&
      value.availableActions.every(isDeviceCardActionContract)
    ) && (
      value.availableState === undefined ||
      Array.isArray(value.availableState) &&
      value.availableState.every((key) => typeof key === 'string')
    ) && (
      value.availableMedia === undefined ||
      Array.isArray(value.availableMedia) &&
      value.availableMedia.every((key) => typeof key === 'string')
    )
}

function isJointPreviewFrame(
  value: unknown,
  materialId: unknown
): boolean {
  if (!isPlainRecord(value) ||
    typeof value.materialId !== 'string' ||
    value.materialId.length === 0 ||
    value.materialId !== materialId ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0 ||
    !isPlainRecord(value.jointStates) ||
    (value.modelRevision !== undefined &&
      typeof value.modelRevision !== 'string')) return false
  const entries = Object.entries(value.jointStates)
  return entries.length > 0 && entries.length <= 128 && entries.every(
    ([name, jointValue]) => name.trim().length > 0 &&
      name.length <= 200 &&
      typeof jointValue === 'number' &&
      Number.isFinite(jointValue) &&
      Math.abs(jointValue) <= 1_000_000
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function isAuthoringContext(
  value: unknown
): value is DeviceCardAuthoringContext {
  return isPlainRecord(value) &&
    (
      value.schemaVersion === 'device-card-authoring-context/v1' ||
      value.schemaVersion === 'device-card-authoring-context/v2'
    ) &&
    typeof value.deviceTypeId === 'string' &&
    value.deviceTypeId.length > 0 &&
    typeof value.title === 'string' &&
    Array.isArray(value.actions) &&
    value.actions.every((action) =>
      isPlainRecord(action) &&
      typeof action.action === 'string' &&
      typeof action.label === 'string' &&
      isPlainRecord(action.inputSchema) &&
      isPlainRecord(action.outputSchema) &&
      isDeviceCardRiskLevel(action.riskLevel)
    ) &&
    isPlainRecord(value.stateSchema) &&
    isPlainRecord(value.sampleState) &&
    Array.isArray(value.media) &&
    value.media.every((item) => typeof item === 'string') &&
    (
      value.schemaVersion === 'device-card-authoring-context/v1' ||
      isDeviceDefinitionReference(value.definition) &&
      value.deviceTypeId === value.definition.fqid &&
      typeof value.deviceId === 'string' && value.deviceId.length > 0
    )
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isDeviceCardActionContract(
  value: unknown
): value is DeviceCardActionContract {
  return isPlainRecord(value) &&
    typeof value.action === 'string' &&
    value.action.length > 0 &&
    typeof value.label === 'string' &&
    isPlainRecord(value.inputSchema) &&
    isPlainRecord(value.outputSchema) &&
    isDeviceCardRiskLevel(value.riskLevel) &&
    (value.busy === undefined || typeof value.busy === 'boolean')
}

function isDeviceCardRiskLevel(value: unknown): boolean {
  return value === 'normal' || value === 'dangerous' || value === 'emergency'
}
