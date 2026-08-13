import {
  buildDeviceCardAuthoringSampleState,
  createDeviceCardAuthoringContext
} from '@unilab/device-card-authoring-kit'
import type {
  DeviceCardAuthoringContext,
  DeviceCardAuthoringTarget
} from '@unilab/device-card-sdk'
import type { DeviceCatalogItem } from '@unilab/services'

/**
 * 把 OS 设备目录条目转换为中立的卡片开发目标。
 *
 * @param device OS 投影的实例、规范设备定义与能力合同。
 * @param runtimeState 当前实例的遥测样例，只用于生成 Mock 状态。
 * @returns 不含 Services、URL 或鉴权信息的开发目标。
 */
export function createAuthoringTarget(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): DeviceCardAuthoringTarget {
  if (!device.definition) {
    throw new Error(
      `设备 ${device.deviceId} 缺少 PackageCatalog 设备定义，不能创建设备卡片。`
    )
  }
  const target: DeviceCardAuthoringTarget = {
    deviceId: device.deviceId,
    definition: device.definition,
    title: device.label,
    online: device.online,
    actions: device.actions.map((action) => ({
      action: action.actionName,
      label: action.label,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      riskLevel: action.riskLevel,
      busy: action.isBusy
    })),
    stateSchema: device.stateSchema,
    media: []
  }
  return {
    ...target,
    sampleState: buildDeviceCardAuthoringSampleState(target, runtimeState)
  }
}

/**
 * 为源码工作区生成版本化设备卡开发上下文。
 *
 * @param device OS 设备目录条目。
 * @param runtimeState 当前实例的遥测样例。
 * @returns 由共享 authoring-kit 生成的 v2 开发上下文。
 */
export function createAuthoringContext(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): DeviceCardAuthoringContext {
  return createDeviceCardAuthoringContext(
    createAuthoringTarget(device, runtimeState),
    runtimeState
  )
}

/**
 * 生成卡片 Mock 模式的正式状态样例。
 *
 * @param device OS 设备目录条目。
 * @param runtimeState 当前实例的遥测样例。
 * @returns 只包含正式状态合同和 Host 状态的样例快照。
 */
export function buildAuthoringSampleState(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildDeviceCardAuthoringSampleState(
    createAuthoringTarget(device),
    runtimeState
  )
}
