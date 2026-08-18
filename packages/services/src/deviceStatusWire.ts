import type {
  DeviceExecutionOccupancy,
  DeviceExecutionOccupancyState
} from './laboratory'
import { ServiceError } from './errors'

/**
 * 解码 Backend/Edge 可选的设备级执行占用摘要。
 *
 * @param value snake_case 或 camelCase wire 数组；nullish 表示服务未提供投影。
 * @returns 规范前端占用数组，或表示未提供的 null。
 */
export function parseDeviceExecutionOccupancies(
  value: unknown
): DeviceExecutionOccupancy[] | null {
  if (value == null) return null
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw invalidOccupancy('execution_occupancies must be an object array')
  }
  return (value as Record<string, unknown>[]).map((raw) => {
    const state = requiredString(raw.state, 'execution_occupancies[].state')
    if (!isExecutionOccupancyState(state)) {
      throw invalidOccupancy(
        'execution_occupancies[].state must be reserved, running, or uncertain'
      )
    }
    return {
      leaseUuid: optionalString(raw.lease_uuid ?? raw.leaseUuid) ?? null,
      workflowTaskUuid: optionalString(
        raw.workflow_task_uuid ?? raw.workflowTaskUuid
      ) ?? null,
      workflowNodeJobUuid: requiredString(
        raw.workflow_node_job_uuid ?? raw.workflowNodeJobUuid,
        'execution_occupancies[].workflow_node_job_uuid'
      ),
      state,
      actionName: optionalString(raw.action_name ?? raw.actionName) ?? null,
      acquiredAt: optionalString(raw.acquired_at ?? raw.acquiredAt) ?? null
    }
  })
}

/** 判断 wire 状态是否属于设备执行占用的公开枚举。 */
function isExecutionOccupancyState(
  value: string
): value is DeviceExecutionOccupancyState {
  return value === 'reserved' || value === 'running' || value === 'uncertain'
}

/** 读取必填非空字符串。 */
function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)
  if (!result) throw invalidOccupancy(`${field} must be a non-empty string`)
  return result
}

/** 读取可选非空字符串。 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result || undefined
}

/** 判断未知 JSON 值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** 创建可诊断、不可重试的设备占用合同错误。 */
function invalidOccupancy(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_BACKEND_DEVICE_CATALOG',
    message: `Backend 设备目录响应无效：${detail}`,
    retryable: false
  })
}
