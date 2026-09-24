import type { RequestTransport } from '../../transport/request'
import { RunPreparationError } from './errors'
import type {
  RunPreparationRecord,
  SubmitRunRequest,
  RunPreflightRequest
} from './api'
import {
  decodeNodeJobDetail,
  decodePreflightReport,
  decodeSubmittedRun
} from './codec'
import type { RunPreparationPort } from './port'
import type { BindingDraft, RunConfiguration } from './model'

export class RunPreparationClient implements RunPreparationPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1'
  ) {}

  async requestPreflight(
    workflowUuid: string,
    configuration: RunConfiguration,
    binding: BindingDraft
  ) {
    const response = await this.transport.request<RunPreparationRecord>({
      method: 'POST',
      url: `${this.apiPrefix}/workflows/${encodeURIComponent(workflowUuid)}/run-preflight`,
      body: toPreflightRequest(configuration, binding)
    })
    return decodePreflightReport(response.data, configuration)
  }

  async submitRun(
    workflowUuid: string,
    configuration: RunConfiguration,
    binding: BindingDraft
  ) {
    if (Object.keys(binding.selectedResources).length > 0) {
      throw new RunPreparationError(
        'UNMAPPED_RESOURCE_SELECTION',
        'Selected resources have no confirmed OS request mapping'
      )
    }
    const response = await this.transport.request<RunPreparationRecord>({
      method: 'POST',
      url: `${this.apiPrefix}/workflow-tasks`,
      body: toSubmitRequest(workflowUuid, configuration, binding)
    })
    return decodeSubmittedRun(response.data)
  }

  async getNodeJobDetail(jobUuid: string) {
    const response = await this.transport.request<RunPreparationRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-node-jobs/${encodeURIComponent(jobUuid)}`
    })
    return decodeNodeJobDetail(response.data)
  }
}

function toPreflightRequest(
  configuration: RunConfiguration,
  binding: BindingDraft
): RunPreflightRequest {
  return {
    run_mode: configuration.runMode,
    ...(configuration.targetNodeUuid === undefined
      ? {}
      : { target_node_uuid: configuration.targetNodeUuid }),
    input: configuration.input,
    inventory_bindings: binding.inventoryBindings
  }
}

function toSubmitRequest(
  workflowUuid: string,
  configuration: RunConfiguration,
  binding: BindingDraft
): SubmitRunRequest {
  return {
    workflow_uuid: workflowUuid,
    ...toPreflightRequest(configuration, binding),
    priority: configuration.priority ?? 'normal',
    ...(configuration.description === undefined ? {} : { description: configuration.description }),
    ...(configuration.metadata === undefined ? {} : { meta_data: configuration.metadata })
  }
}
