import type { RequestTransport } from '../../transport/request'
import {
  decodeActionDefinition,
  decodeActionDefinitionList,
  decodeActionRunAccepted,
  decodeAuthoringDeviceCatalog,
  decodeDeviceList
} from './codec'
import type { DeviceActionPort } from './port'
import type {
  ActionDefinitionDetailResponse,
  ActionDefinitionListResponse,
  DeviceActionRunResponse,
  DeviceListResponse
} from './api'
import type {
  DeviceActionRunRequest,
  DeviceActionRunView
} from './model'
import {
  WorkflowExecutionReadClient
} from '../workflow-execution-read/client'
import type {
  WorkflowExecutionReadPort
} from '../workflow-execution-read/port'
import { DeviceActionError } from './errors'

type DeviceActionExecutionReadPort = Pick<
  WorkflowExecutionReadPort,
  'getTaskDetail' | 'listTaskJobs'
>

export class DeviceActionClient implements DeviceActionPort {
  private readonly executionRead: DeviceActionExecutionReadPort
  private readonly apiPrefix: string

  constructor(
    private readonly transport: RequestTransport,
    executionReadOrApiPrefix: DeviceActionExecutionReadPort | string = '/api/v1',
    apiPrefix = '/api/v1'
  ) {
    if (typeof executionReadOrApiPrefix === 'string') {
      this.executionRead = new WorkflowExecutionReadClient(transport, executionReadOrApiPrefix)
      this.apiPrefix = executionReadOrApiPrefix
    } else {
      this.executionRead = executionReadOrApiPrefix
      this.apiPrefix = apiPrefix
    }
  }

  async listDevices() {
    const response = await this.transport.request<DeviceListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/devices`
    })
    const devices = decodeDeviceList(response.data)
    if (devices.length > 0) return devices

    // Local Workspace 尚未建立运行时 binding 时，/devices 会明确返回空数组。
    // 4174 控制台此时回退到 authoring/device-catalog；这里保持同一语义，
    // 并读取完整模板目录给设备包动作补上 workflow node template UUID。
    const [catalogResponse, templateResponse] = await Promise.all([
      this.transport.request({
        method: 'GET',
        url: `${this.apiPrefix}/authoring/device-catalog`
      }),
      this.transport.request({
        method: 'GET',
        url: `${this.apiPrefix}/workflow-node-templates?page=1&page_size=200`
      })
    ])
    const definitions = decodeActionDefinitionList(templateResponse.data)
    return decodeAuthoringDeviceCatalog(catalogResponse.data, definitions)
  }

  async listActionDefinitions(input: {
    readonly page?: number
    readonly pageSize?: number
  } = {}) {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      page_size: String(input.pageSize ?? 100),
      node_type: 'device_action'
    })
    const response = await this.transport.request<ActionDefinitionListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-node-templates?${params.toString()}`
    })
    return decodeActionDefinitionList(response.data)
  }

  async getActionDefinition(actionUuid: string) {
    const response = await this.transport.request<ActionDefinitionDetailResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-node-templates/${encodeURIComponent(actionUuid)}`
    })
    return decodeActionDefinition(response.data)
  }

  async createActionRun(request: DeviceActionRunRequest) {
    const response = await this.transport.request<DeviceActionRunResponse>({
      method: 'POST',
      url: `${this.apiPrefix}/device-action-runs`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        material_uuid: request.materialUuid,
        workflow_node_template_uuid: request.workflowNodeTemplateUuid,
        param: request.param,
        ...(request.executionPolicy === undefined
          ? {}
          : { execution_policy: request.executionPolicy }),
        idempotency_key: request.idempotencyKey,
        ...(request.description === undefined ? {} : { description: request.description }),
        ...(request.metadata === undefined ? {} : { meta_data: request.metadata })
      }
    })
    return decodeActionRunAccepted(response.data)
  }

  async getActionRun(taskUuid: string): Promise<DeviceActionRunView> {
    const [task, jobs] = await Promise.all([
      this.executionRead.getTaskDetail(taskUuid),
      this.executionRead.listTaskJobs(taskUuid)
    ])
    if (jobs.length !== 1) {
      throw new DeviceActionError(
        'INVALID_ACTION_RUN_RESPONSE',
        `设备单动作任务 ${taskUuid} 必须包含且仅包含一个 NodeJob`
      )
    }
    return {
      kind: 'device_action_run_view',
      source: 'os',
      task,
      job: jobs[0]!
    }
  }
}
