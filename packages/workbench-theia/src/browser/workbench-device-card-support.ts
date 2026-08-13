import {
  buildDeviceCardAuthoringSampleState,
  createDeviceCardAuthoringContext
} from '@unilab/device-card-authoring-kit'
import type {
  DeviceCardActionContract,
  DeviceCardAuthoringContext,
  DeviceCardAuthoringTarget,
  DeviceCardWorkspaceStatus
} from '@unilab/device-card-sdk'
import type {
  DeviceCatalogAction,
  DeviceCatalogItem,
  DeviceStatus
} from '@unilab/services'

export type WorkbenchDeviceMode = 'control' | 'cards'
export type WorkbenchDeviceCardOperation =
  | 'import'
  | 'open'
  | 'prepare'
  | 'rebuild'
  | 'install'
  | 'close'
  | 'export'
  | 'agent'
  | 'copy'
  | null

export interface WorkbenchDeviceCardNotice {
  kind: 'info' | 'success' | 'warning' | 'error'
  text: string
}

export interface WorkbenchDeviceCardLiveBinding {
  previewId: string
  deviceId: string
}

/**
 * 将 OS 设备目录条目映射为中立的卡片开发目标。
 *
 * @param device OS 设备目录中的实例和正式能力声明。
 * @param runtimeState 当前设备遥测投影，只用于构造开发样例。
 * @returns 不含 Services、URL 或鉴权信息的卡片开发目标。
 */
export function buildWorkbenchDeviceCardAuthoringTarget(
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
    actions: device.actions.map(mapDeviceCardAction),
    stateSchema: device.stateSchema,
    media: []
  }
  return {
    ...target,
    sampleState: buildDeviceCardAuthoringSampleState(target, runtimeState)
  }
}

/**
 * 构建设备卡源码工作区可持久化的开发上下文。
 *
 * @param device OS 设备目录中的实例和正式能力声明。
 * @param runtimeState 当前设备遥测投影，只用于构造样例值。
 * @returns 由共享 authoring-kit 生成的版本化开发上下文。
 */
export function buildWorkbenchDeviceCardAuthoringContext(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): DeviceCardAuthoringContext {
  return createDeviceCardAuthoringContext(
    buildWorkbenchDeviceCardAuthoringTarget(device, runtimeState),
    runtimeState
  )
}

/**
 * 生成卡片 Mock 模式使用的状态样例。
 *
 * @param device 当前预览对应的设备实例。
 * @param runtimeState 可选的遥测样例值。
 * @returns 只包含正式状态契约和 Host 状态的样例快照。
 */
export function buildWorkbenchDeviceCardSampleState(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildDeviceCardAuthoringSampleState(
    buildWorkbenchDeviceCardAuthoringTarget(device),
    runtimeState
  )
}

/**
 * 把设备遥测投影转换为设备卡 Host Bridge 的运行时状态。
 *
 * @param device 设备目录中的正式状态契约和动作忙碌状态。
 * @param statusMap WebSocket 推送形成的设备遥测投影。
 * @returns 可发送给受控卡片运行时的完整状态快照。
 */
export function buildWorkbenchDeviceCardRuntimeState(
  device: DeviceCatalogItem,
  statusMap: ReadonlyMap<string, DeviceStatus>
): Record<string, unknown> {
  const live = statusMap.get(device.deviceId)?.status ?? {}
  return {
    ...decodeDriverContainerState(live, device.stateSchema),
    online: device.online,
    actionBusy: Object.fromEntries(
      device.actions.map(action => [action.actionName, action.isBusy])
    )
  }
}

/**
 * 生成设备动作契约的稳定签名，避免等价数组触发原生预览重建。
 *
 * @param actions OS 设备目录中的动作列表。
 * @returns 可反序列化为卡片动作契约数组的稳定字符串。
 */
export function workbenchDeviceCardActionSignature(
  actions: readonly DeviceCatalogAction[]
): string {
  return JSON.stringify(actions.map(mapDeviceCardAction))
}

/**
 * 判断当前卡片和设备是否仍是用户明确确认的 Live 绑定。
 *
 * @param binding 最近一次明确建立的 Live 绑定。
 * @param previewId 当前预览版本身份。
 * @param deviceId 当前设备实例身份。
 * @returns 三个身份完全一致时返回 true。
 */
export function isWorkbenchDeviceCardLiveBinding(
  binding: WorkbenchDeviceCardLiveBinding | null,
  previewId: string,
  deviceId: string
): boolean {
  return Boolean(
    binding
    && previewId
    && deviceId
    && binding.previewId === previewId
    && binding.deviceId === deviceId
  )
}

/**
 * 汇总源码工作区状态，供紧凑侧栏解释下一步操作。
 *
 * @param workspace Electron 构建器返回的权威工作区状态。
 * @returns 面向用户的中文状态说明。
 */
export function workbenchDeviceCardWorkspaceSummary(
  workspace: DeviceCardWorkspaceStatus
): string {
  if (workspace.state === 'building') return '正在检查源码，完成后会自动刷新预览。'
  if (workspace.state === 'error') {
    return workspace.card
      ? '当前修改未通过检查，预览仍显示上次成功版本。'
      : '源码未通过检查，请根据诊断修复后重新检查。'
  }
  return '源码检查通过，可以在 Mock 模式预览或安装当前快照。'
}

/**
 * 将未知桌面错误转换为包含操作上下文的可恢复提示。
 *
 * @param error 捕获到的未知错误。
 * @param fallback 操作失败时的中文说明。
 * @returns 可直接呈现的错误通知。
 */
export function workbenchDeviceCardErrorNotice(
  error: unknown,
  fallback: string
): WorkbenchDeviceCardNotice {
  return {
    kind: 'error',
    text: error instanceof Error ? `${fallback}：${error.message}` : fallback
  }
}

/**
 * 将 OS 动作声明映射为卡片 Host Bridge 的最小契约。
 *
 * @param action OS 设备目录中的正式动作声明。
 * @returns 不含运行时实现细节的卡片动作契约。
 */
function mapDeviceCardAction(
  action: DeviceCatalogAction
): DeviceCardActionContract {
  return {
    action: action.actionName,
    label: action.label,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    riskLevel: action.riskLevel,
    busy: action.isBusy
  }
}

/**
 * 按正式状态契约解码 Driver 容器序列化的对象和数组。
 *
 * @param state 原始设备遥测投影。
 * @param stateSchema OS 提供的正式状态契约。
 * @returns 保持未知字段原值、仅解码已声明容器的状态。
 */
function decodeDriverContainerState(
  state: Record<string, unknown>,
  stateSchema: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!stateSchema) return state
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key,
    decodeDriverContainerValue(value, stateSchema[key])
  ]))
}

/**
 * 解码单个正式声明为对象或数组的 Driver 状态值。
 *
 * @param value Driver 上报的原始值。
 * @param definition 对应状态键的 schema 定义。
 * @returns 类型匹配的 JSON 容器，或无法安全解码时的原值。
 */
function decodeDriverContainerValue(value: unknown, definition: unknown): unknown {
  if (typeof value !== 'string' || !isRecord(definition)) return value
  if (definition.type !== 'object' && definition.type !== 'array') return value
  try {
    const parsed: unknown = JSON.parse(value)
    if (definition.type === 'array' && Array.isArray(parsed)) return parsed
    if (definition.type === 'object' && isRecord(parsed)) return parsed
  } catch {
    return value
  }
  return value
}

/**
 * 判断未知值是否为普通记录对象。
 *
 * @param value 待判断的未知值。
 * @returns 非空且非数组对象时返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
