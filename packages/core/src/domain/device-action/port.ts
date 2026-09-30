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
