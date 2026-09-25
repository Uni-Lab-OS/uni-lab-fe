import type { DeviceActionPort } from '../../domain/device-action/port'
import type {
  DeviceActionRunRequest
} from '../../domain/device-action/model'
import type { WorkflowExecutionReadPort } from '../../domain/workflow-execution-read/port'
import {
  createDeviceActionDebuggingViewModel,
  type DeviceActionDebuggingQuery,
  type DeviceActionDebuggingViewModel
} from './view-model'

export interface DeviceActionDebuggingScenario {
  load(query?: DeviceActionDebuggingQuery): Promise<DeviceActionDebuggingViewModel>
  inspectAction(
    viewModel: DeviceActionDebuggingViewModel,
    actionUuid: string
  ): Promise<DeviceActionDebuggingViewModel>
  startRun(
    viewModel: DeviceActionDebuggingViewModel,
    request: DeviceActionRunRequest
  ): Promise<DeviceActionDebuggingViewModel>
  inspectRun(
    viewModel: DeviceActionDebuggingViewModel,
    taskUuid: string,
    input?: { readonly afterSequence?: number; readonly limit?: number }
  ): Promise<DeviceActionDebuggingViewModel>
}

export function createDeviceActionDebuggingScenario(
  deviceActions: DeviceActionPort,
  executionRead: WorkflowExecutionReadPort
): DeviceActionDebuggingScenario {
    return {
    async load(query = {}) {
      const [devices, actions] = await Promise.all([
        deviceActions.listDevices(),
        deviceActions.listActionDefinitions({
          page: query.actionPage,
          pageSize: query.pageSize
        })
      ])
      return createDeviceActionDebuggingViewModel(query, devices, actions)
    },

    async inspectAction(viewModel, actionUuid) {
      const action = await deviceActions.getActionDefinition(actionUuid)
      return {
        ...viewModel,
        selectedActionUuid: actionUuid,
        selectedAction: action
      }
    },

    async startRun(viewModel, request) {
      const acceptedRun = await deviceActions.createActionRun(request)
      return {
        ...viewModel,
        runRequest: request,
        acceptedRun,
        run: null,
        nodeJob: null,
        feedback: null
      }
    },

    async inspectRun(viewModel, taskUuid, input) {
      const run = await deviceActions.getActionRun(taskUuid)
      const [nodeJob, feedback] = await Promise.all([
        executionRead.getNodeJobDetail(run.job.jobUuid),
        executionRead.listNodeJobFeedback(run.job.jobUuid, input)
      ])
      return {
        ...viewModel,
        acceptedRun: viewModel.acceptedRun?.taskUuid === taskUuid
          ? viewModel.acceptedRun
          : null,
        run,
        nodeJob,
        feedback
      }
    }
  }
}
