import type { DeviceActionPresentations } from './action-presentation'
import type {
  ActionDefinition,
  ActionDefinitionSummary,
  DeviceActionRunAccepted,
  DeviceActionRunRequest,
  DeviceActionRunView,
  DeviceSummary,
} from './model'

export interface DeviceActionPort {
  listDevices(): Promise<readonly DeviceSummary[]>

  listActionDefinitions(input?: {
    readonly page?: number
    readonly pageSize?: number
  }): Promise<readonly ActionDefinitionSummary[]>

  getActionDefinition(actionUuid: string): Promise<ActionDefinition>

  createActionRun(request: DeviceActionRunRequest): Promise<DeviceActionRunAccepted>

  getActionRun(taskUuid: string): Promise<DeviceActionRunView>
}

/**
 * 设备动作展示元数据（能力 deviceAction.presentation）。只在 profile 声明该能力时调用，
 * 不通过试请求推断后端是否支持。
 */
export interface DeviceActionPresentationPort {
  getActionPresentations(): Promise<DeviceActionPresentations>
}
