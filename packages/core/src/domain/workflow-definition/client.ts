import type { RequestTransport } from '../../transport/request'
import {
  decodePublishedWorkflow,
  decodePublishedWorkflowList,
  decodeWorkflowListHasMore
} from './codec'
import { WorkflowDefinitionError } from './errors'
import type { WorkflowDefinitionPort } from './port'
import type {
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary
} from './model'

import type {
  PublishedWorkflowResponse,
  WorkflowGraphResponse
} from './api'

// OS 会核对当前源码与发布版本；完整目录和大型 DAG 读取使用独立预算。
const WORKFLOW_DEFINITION_TIMEOUT_MS = 60_000

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
    readonly allPages?: boolean
    readonly status?: 'published' | 'all'
  } = {}): Promise<readonly PublishedWorkflowRevisionSummary[]> {
    const revisions: PublishedWorkflowRevisionSummary[] = []
    const identities = new Set<string>()
    let page = input.page ?? 1
    while (true) {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(input.pageSize ?? 100)
      })
      if (input.status !== 'all') params.set('status', 'published')
      const response = await this.transport.request<unknown>({
        method: 'GET',
        url: `${this.apiPrefix}/workflows?${params.toString()}`,
        timeoutMs: WORKFLOW_DEFINITION_TIMEOUT_MS
      })
      const items = decodePublishedWorkflowList(response.data)
      for (const item of items) {
        if (identities.has(item.workflowUuid)) {
          throw new WorkflowDefinitionError('INVALID_WORKFLOW_DEFINITION', '工作流目录分页重复，请重新读取')
        }
        identities.add(item.workflowUuid)
        revisions.push(item)
      }
      if (!input.allPages || !decodeWorkflowListHasMore(response.data)) return revisions
      if (items.length === 0) {
        throw new WorkflowDefinitionError('INVALID_WORKFLOW_DEFINITION', '工作流目录返回空页但仍声明后续页')
      }
      page += 1
    }
  }

  async getPublishedRevision(workflowUuid: string): Promise<PublishedWorkflowRevision> {
    const encodedUuid = encodeURIComponent(workflowUuid)
    const [summary, graph] = await Promise.all([
      this.transport.request<PublishedWorkflowResponse>({
        method: 'GET',
        url: `${this.apiPrefix}/workflows/${encodedUuid}`,
        timeoutMs: WORKFLOW_DEFINITION_TIMEOUT_MS
      }),
      this.transport.request<WorkflowGraphResponse>({
        method: 'GET',
        url: `${this.apiPrefix}/workflows/${encodedUuid}/graph`,
        timeoutMs: WORKFLOW_DEFINITION_TIMEOUT_MS
      })
    ])
    return decodePublishedWorkflow(summary.data, graph.data)
  }

  async deleteWorkflowDefinition(workflowUuid: string): Promise<void> {
    await this.transport.request<unknown>({
      method: 'DELETE',
      url: `${this.apiPrefix}/workflows/${encodeURIComponent(workflowUuid)}`
    })
  }
}
