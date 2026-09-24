import type { RequestTransport } from '../../transport/request'
import { decodeTaskJobs, decodeTaskRuntimeDetail } from './codec'
import type { WorkflowExecutionReadPort } from './port'
import type { TaskJobsResponse, WorkflowExecutionRecord } from './api'

export class WorkflowExecutionReadClient implements WorkflowExecutionReadPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1'
  ) {}

  async getTaskDetail(taskUuid: string) {
    const response = await this.transport.request<WorkflowExecutionRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}`
    })
    return decodeTaskRuntimeDetail(response.data)
  }

  async listTaskJobs(taskUuid: string) {
    const response = await this.transport.request<TaskJobsResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}/jobs`
    })
    return decodeTaskJobs(response.data)
  }
}

