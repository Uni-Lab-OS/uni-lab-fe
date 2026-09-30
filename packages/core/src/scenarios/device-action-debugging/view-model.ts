import type {
  DeviceActionRunAccepted,
  DeviceActionRunRequest,
  DeviceActionRunView,
  DeviceSummary,
  ActionDefinition,
  ActionDefinitionSummary,
} from '../../domain/device-action/model'
import type {
  NodeJobFeedbackPage,
  WorkflowNodeJobDetail,
} from '../../domain/workflow-execution-read/model'

export interface DeviceActionDebuggingQuery {
  readonly devicePage?: number
  readonly actionPage?: number
  readonly pageSize?: number
}

export interface DeviceActionDebuggingViewModel {
  readonly kind: 'device_action_debugging'
  readonly query: DeviceActionDebuggingQuery
  readonly devices: readonly DeviceSummary[]
  readonly actions: readonly ActionDefinitionSummary[]
  readonly selectedDeviceUuid: string | null
  readonly selectedActionUuid: string | null
  readonly selectedAction: ActionDefinition | null
  readonly runRequest: DeviceActionRunRequest | null
  readonly acceptedRun: DeviceActionRunAccepted | null
  readonly run: DeviceActionRunView | null
  readonly nodeJob: WorkflowNodeJobDetail | null
  readonly feedback: NodeJobFeedbackPage | null
}

export function createDeviceActionDebuggingViewModel(
  query: DeviceActionDebuggingQuery,
  devices: readonly DeviceSummary[],
  actions: readonly ActionDefinitionSummary[],
): DeviceActionDebuggingViewModel {
  return {
    kind: 'device_action_debugging',
    query,
    devices,
    actions,
    selectedDeviceUuid: null,
    selectedActionUuid: null,
    selectedAction: null,
    runRequest: null,
    acceptedRun: null,
    run: null,
    nodeJob: null,
    feedback: null,
  }
}
