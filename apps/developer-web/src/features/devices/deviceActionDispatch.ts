import { createDeviceActionDebuggingViewModel } from '@unilab-fe/core'
import type { DeviceActionState, DeviceSummary } from '@unilab-fe/core'
import type { StudioBackend } from '../../app/backend'

export interface DeviceActionAccepted {
  readonly taskUuid: string
  readonly jobUuid: string
}

/** 任务名“设备 · 动作”，便于在任务列表中辨认（现场 11.14：避免“未命名任务”）。 */
export function deviceActionTaskName(device: DeviceSummary, actionLabel: string): string {
  return `${device.label} · ${actionLabel}`
}

/**
 * 向 OS 下发一次设备单动作。单动作始终作用于当前设备；每次下发生成新的幂等键，
 * 受理（201）不代表执行完成，结果由 DeviceActionRunResult 读取 Task/Job 判断。
 */
export async function startDeviceActionRun(
  backend: StudioBackend,
  request: {
    readonly device: DeviceSummary
    readonly action: DeviceActionState
    readonly param: Readonly<Record<string, unknown>>
    readonly description: string
  },
): Promise<DeviceActionAccepted> {
  if (!request.action.actionDefinitionUuid) throw new Error('当前 OS 没有返回可执行的动作定义')
  const viewModel = createDeviceActionDebuggingViewModel({}, [], [])
  const next = await backend.core.deviceActionDebugging.startRun(viewModel, {
    materialUuid: request.device.materialUuid,
    workflowNodeTemplateUuid: request.action.actionDefinitionUuid,
    param: request.param,
    idempotencyKey: crypto.randomUUID(),
    description: request.description,
  })
  if (!next.acceptedRun) throw new Error('OS 未返回已接受的动作任务')
  return { taskUuid: next.acceptedRun.taskUuid, jobUuid: next.acceptedRun.jobUuid }
}
