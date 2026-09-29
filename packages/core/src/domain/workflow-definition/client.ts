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
    readonly status?: 'published' | 'all'
  } = {}): Promise<readonly PublishedWorkflowRevisionSummary[]> {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      page_size: String(input.pageSize ?? 100)
    })
    if (input.status !== 'all') params.set('status', 'published')
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.apiPrefix}/workflows?${params.toString()}`
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
