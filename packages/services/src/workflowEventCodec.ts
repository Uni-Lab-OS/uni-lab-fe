import type {
  WorkflowAuthoringChangedEvent
} from './workflowAuthoringContracts'
import type {
  DeviceActionTaskChangedEvent,
  DeviceCatalogChangedEvent,
  WorkflowDefinitionChangedEvent,
  WorkflowRuntimeChangedEvent
} from './workflowTaskContracts'

/** 解码工作流创作（Workflow Authoring）失效事件。 */
export function parseAuthoringChangedData(
  value: string
): WorkflowAuthoringChangedEvent['data'] | null {
  try {
    const data = JSON.parse(value) as Record<string, unknown>
    if (
      typeof data.workflow_uuid !== 'string' ||
      typeof data.cause !== 'string' ||
      typeof data.workflow_revision !== 'number' ||
      !(data.draft_hash === null || typeof data.draft_hash === 'string') ||
      !(
        data.candidate_hash === null ||
        typeof data.candidate_hash === 'string'
      )
    ) return null
    return {
      workflow_uuid: data.workflow_uuid,
      cause: data.cause,
      workflow_revision: data.workflow_revision,
      draft_hash: data.draft_hash,
      candidate_hash: data.candidate_hash
    }
  } catch {
    return null
  }
}

/** 解码 Backend 工作流定义 revision 失效事件。 */
export function parseWorkflowDefinitionChangedData(
  value: string
): WorkflowDefinitionChangedEvent['data'] | null {
  try {
    const data = JSON.parse(value) as Record<string, unknown>
    if (
      Object.keys(data).length !== 2 ||
      typeof data.workflow_uuid !== 'string' ||
      data.workflow_uuid.trim() === '' ||
      !Number.isSafeInteger(data.workflow_revision) ||
      (data.workflow_revision as number) < 1
    ) return null
    return {
      workflow_uuid: data.workflow_uuid,
      workflow_revision: data.workflow_revision as number
    }
  } catch {
    return null
  }
}

/** 解码工作流运行（Workflow Runtime）失效事件。 */
export function parseRuntimeChangedData(
  value: string
): WorkflowRuntimeChangedEvent['data'] | null {
  try {
    const data = JSON.parse(value) as Record<string, unknown>
    if (
      Object.keys(data).length !== 1 ||
      typeof data.workflow_task_uuid !== 'string' ||
      data.workflow_task_uuid.trim() === ''
    ) return null
    return { workflow_task_uuid: data.workflow_task_uuid }
  } catch {
    return null
  }
}

/** 解码单设备动作任务失效事件。 */
export function parseDeviceActionTaskChangedData(
  value: string
): DeviceActionTaskChangedEvent['data'] | null {
  try {
    const data = JSON.parse(value) as Record<string, unknown>
    if (
      Object.keys(data).length !== 1 ||
      typeof data.task_uuid !== 'string' ||
      data.task_uuid.trim() === ''
    ) return null
    return { task_uuid: data.task_uuid }
  } catch {
    return null
  }
}

/** 解码设备目录版本失效事件。 */
export function parseDeviceCatalogChangedData(
  value: string
): DeviceCatalogChangedEvent['data'] | null {
  try {
    const data = JSON.parse(value) as Record<string, unknown>
    if (
      Object.keys(data).length !== 1 ||
      !Number.isSafeInteger(data.catalog_revision) ||
      (data.catalog_revision as number) < 1
    ) return null
    return { catalog_revision: data.catalog_revision as number }
  } catch {
    return null
  }
}
