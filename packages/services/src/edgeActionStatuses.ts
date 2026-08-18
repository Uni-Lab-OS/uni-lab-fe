import { requestData, type HttpClient } from './http'

const EDGE_ACTION_STATUS_TIMEOUT_MS = 750

export interface EdgeActionStatusTarget {
  id: string
  deviceKey: string
  actions: Array<{
    actionName: string
    isBusy: boolean
    busyStatusKnown: boolean
    currentJobId: string | null
  }>
}

interface EdgeActionStatus {
  isBusy: boolean
  currentJobId: string | null
}

type EdgeActionStatusIndex = Map<string, Map<string, EdgeActionStatus>>

/**
 * 读取 OS 微后端（OS Microbackend）已有的动作占用汇总。
 *
 * @param http 已绑定当前 Edge 地址的 HTTP 客户端。
 * @param signal 可选请求取消信号。
 * @returns 以 Edge 本地设备 ID 和动作名索引的占用状态；接口不可用时返回 null。
 */
export async function loadEdgeActionStatuses(
  http: HttpClient,
  signal?: AbortSignal
): Promise<EdgeActionStatusIndex | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const request = readEdgeActionStatuses(http, signal).catch(() => null)
  try {
    return await Promise.race([
      request,
      new Promise<null>((resolve) => {
        timeout = setTimeout(resolve, EDGE_ACTION_STATUS_TIMEOUT_MS, null)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/**
 * 执行一次 Edge 动作状态读取与 wire 解码。
 *
 * @param http 已绑定 Edge 地址的 HTTP 客户端。
 * @param signal 调用方原始取消信号，保持共享读取的取消身份一致。
 * @returns 已解码动作占用索引；响应不完整时返回 null。
 */
async function readEdgeActionStatuses(
  http: HttpClient,
  signal?: AbortSignal
): Promise<EdgeActionStatusIndex | null> {
  const raw = await requestData<unknown>(http, '/api/v1/actions', { signal })
  if (!isRecord(raw) || !isRecord(raw.devices)) return null
  const result: EdgeActionStatusIndex = new Map()
  for (const [deviceId, rawDevice] of Object.entries(raw.devices)) {
    if (!isRecord(rawDevice) || !isRecord(rawDevice.actions)) continue
    const actions = new Map<string, EdgeActionStatus>()
    for (const [actionName, rawAction] of Object.entries(rawDevice.actions)) {
      if (!isRecord(rawAction)) continue
      const busyWire = firstDefined(
        rawAction.is_busy,
        rawAction.isBusy,
        rawAction.busy
      )
      if (typeof busyWire !== 'boolean') continue
      actions.set(actionName, {
        isBusy: busyWire,
        currentJobId: optionalString(
          rawAction.current_job_id ?? rawAction.currentJobId
        ) ?? null
      })
    }
    if (actions.size) result.set(deviceId, actions)
  }
  return result
}

/**
 * 把 Edge 动作占用投影并入共享设备目录，不让组件感知服务端类型。
 *
 * @param devices 已按 Backend-shaped Contract 解码的设备目录。
 * @param statuses Edge 本地设备 ID 对应的动作占用索引。
 * @returns 无返回值；只更新本次请求产生的内存 DTO。
 */
export function mergeEdgeActionStatuses(
  devices: EdgeActionStatusTarget[],
  statuses: EdgeActionStatusIndex
): void {
  for (const device of devices) {
    const actionStatuses = statuses.get(device.deviceKey) ?? statuses.get(device.id)
    if (!actionStatuses) continue
    for (const action of device.actions) {
      const status = actionStatuses.get(action.actionName)
      if (!status) continue
      action.isBusy = status.isBusy
      action.busyStatusKnown = true
      action.currentJobId = status.currentJobId
    }
  }
}

/** 返回参数中第一个非 nullish wire 值。 */
function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value != null)
}

/** 读取可选非空字符串，供 Edge 动作状态兼容边界使用。 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result || undefined
}

/** 判断未知 JSON 值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
