import type { RequestTransport } from '../../transport/request'
import {
  decodePublishedWorkflow,
  decodePublishedWorkflowList
} from './codec'
import type { WorkflowDefinitionPort } from './port'
import type {
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary
} from './model'
import type {
  PublishedWorkflowResponse,
  WorkflowGraphResponse
} from './api'

export interface WorkflowDefinitionClientOptions {
  readonly apiPrefix?: string
}

export class WorkflowDefinitionClient implements WorkflowDefinitionPort {
  private readonly apiPrefix: string

  constructor(
    private readonly transport: RequestTransport,
    options: WorkflowDefinitionClientOptions = {}
  ) {
    this.apiPrefix = options.apiPrefix ?? '/api/v1'
  }

  async listPublishedRevisions(input: {
    readonly page?: number
    readonly pageSize?: number
  } = {}): Promise<readonly PublishedWorkflowRevisionSummary[]> {
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 100
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.apiPrefix}/workflows?page=${page}&page_size=${pageSize}&status=published`
    })
    return decodePublishedWorkflowList(response.data)
  }

  async getPublishedRevision(workflowUuid: string): Promise<PublishedWorkflowRevision> {
    const encodedUuid = encodeURIComponent(workflowUuid)
    const [summary, graph] = await Promise.all([
      this.transport.request<PublishedWorkflowResponse>({
        method: 'GET',
        url: `${this.apiPrefix}/workflows/${encodedUuid}`
      }),
      this.transport.request<WorkflowGraphResponse>({
        method: 'GET',
        url: `${this.apiPrefix}/workflows/${encodedUuid}/graph`
      })
    ])
    return decodePublishedWorkflow(summary.data, graph.data)
  }
}
